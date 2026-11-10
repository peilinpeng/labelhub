"""创建全新隔离栈运行受控模型验收；任何退出路径只停止本次容器，不删除资源。"""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import socket
import subprocess
import sys
from urllib.parse import urlsplit

from local_ops import docker, inspect_ids, private_directory
from storage_guard import guarded_run, preflight, StorageError

ROOT = Path(__file__).resolve().parents[1]
SERVICES = {'mysql', 'redis', 'api', 'worker', 'scheduler', 'web', 'controlled-model'}


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def validate_inventory(containers, project):
    if not re.fullmatch(r'labelhub-ai-[a-f0-9]{16}', project):
        raise ValueError('不是本入口创建的隔离项目。')
    roles = set()
    for c in containers:
        labels = c['Config'].get('Labels') or {}
        role = labels.get('com.docker.compose.service')
        if labels.get('com.docker.compose.project') != project or role not in SERVICES or role in roles:
            raise ValueError('隔离容器身份不一致。')
        roles.add(role)
        for mount in c['Mounts']:
            if mount['Type'] == 'volume' and not mount.get('Name', '').startswith(project + '_'):
                raise ValueError('禁止复用外部数据卷。')
            if mount['Type'] == 'bind':
                expected = {'controlled-model': '/controlled_model.py', 'web': '/etc/nginx/conf.d/default.conf'}
                if mount['Destination'] != expected.get(role) or mount['RW']:
                    raise ValueError('存在非预期宿主挂载。')
        networks = {project + '_default'} | ({project + '_ingress'} if role == 'web' else set())
        if set(c['NetworkSettings']['Networks']) != networks:
            raise ValueError('禁止连接其他运行环境网络。')
    if roles != SERVICES:
        raise ValueError('隔离服务不完整。')


def verify(path):
    manifest = json.loads(path.read_text(encoding='utf-8'))
    if not re.fullmatch(r'http://127\.0\.0\.1:[0-9]+', manifest['baseURL']):
        raise ValueError('测试地址必须是本机 IPv4 环回端口。')
    containers = inspect_ids(manifest['ids'])
    validate_inventory(containers, manifest['project'])
    network = json.loads(docker('network', 'inspect', manifest['project'] + '_default'))[0]
    if not network['Internal'] or set(network['Containers']) != set(manifest['ids']):
        raise ValueError('隔离网络必须禁止外连且只包含本次容器。')
    by_role = {c['Config']['Labels']['com.docker.compose.service']: c for c in containers}
    ingress = json.loads(docker('network', 'inspect', manifest['project'] + '_ingress'))[0]
    if set(ingress['Containers']) != {by_role['web']['Id']}:
        raise ValueError('只有 Web 测试入口可以连接宿主网络。')
    if manifest['modelURL'] != manifest['baseURL'] + '/__controlled_model':
        raise ValueError('模型控制必须通过本次 Web 测试入口。')
    for role, port, field in [('web', '8080/tcp', 'baseURL')]:
        bindings = by_role[role]['NetworkSettings']['Ports'][port]
        expected = [{'HostIp': '127.0.0.1', 'HostPort': manifest[field].rsplit(':', 1)[1]}]
        if bindings != expected:
            raise ValueError('浏览器或模型端口不属于登记的隔离容器。')
    for role in ('api', 'worker', 'scheduler'):
        env = dict(x.split('=', 1) for x in by_role[role]['Config']['Env'])
        database = urlsplit(env.get('DATABASE_URL', ''))
        if database.hostname != 'mysql' or database.path != '/labelhub' or env.get('REDIS_URL') != 'redis://redis:6379':
            raise ValueError('数据服务必须来自本次隔离网络。')
        if env.get('DOUBAO_BASE_URL') != 'http://controlled-model:8010/v1' or env.get('DOUBAO_API_KEY') != 'controlled-e2e-only':
            raise ValueError('模型配置不是受控服务。')
    if any(binding for role, c in by_role.items() if role != 'web' for binding in c['NetworkSettings']['Ports'].values()):
        raise ValueError('API、数据服务和模型不得发布宿主端口。')
    for env_name, key in [('PLAYWRIGHT_BASE_URL', 'baseURL'), ('CONTROLLED_MODEL_URL', 'modelURL'), ('CONTROLLED_AI_RUN_ID', 'project')]:
        if os.environ.get(env_name) != manifest[key]:
            raise ValueError('测试目标与隔离凭证不匹配。')
    print('隔离身份、端口、独立数据卷与禁止外连网络检查通过。', flush=True)


def run():
    os.chdir(ROOT)
    project = 'labelhub-ai-' + secrets.token_hex(8)
    if docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project):
        raise ValueError('项目名冲突，拒绝复用容器。')
    if any(name.startswith(project + '_') for name in docker('volume', 'ls', '-q').split()):
        raise ValueError('项目名冲突，拒绝复用卷。')
    paths = preflight()
    private = private_directory(ROOT / '.cache' / 'controlled-ai' / project)
    (private / 'empty.env').touch()
    web = free_port()
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(('COMPOSE_', 'DOUBAO_', 'MYSQL_', 'JWT_', 'LABELHUB_IMAGE', 'METRICS_')):
            env.pop(key)
    password = secrets.token_urlsafe(32)
    env.update(APP_ENV='test', DEMO_MODE='true', LABELHUB_SEED_MODE='disposable',
        LABELHUB_IMAGE_TAG=project, MYSQL_DATABASE='labelhub', MYSQL_USER='labelhub', MYSQL_PASSWORD=password,
        MYSQL_ROOT_PASSWORD=secrets.token_urlsafe(32), DATABASE_URL=f'mysql+pymysql://labelhub:{password}@mysql:3306/labelhub',
        REDIS_URL='redis://redis:6379', JWT_SECRET=secrets.token_urlsafe(40), LOGIN_RATE_LIMIT_BACKEND='memory',
        LOGIN_RATE_LIMIT_ATTEMPTS='100', LOGIN_RATE_LIMIT_WINDOW_SECONDS='300',
        AI_REVIEW_CONFIDENCE_THRESHOLD='0.6', TRUSTED_HOSTS='localhost,127.0.0.1,api', ENABLE_HSTS='false',
        FILE_STORAGE_DRIVER='local', LOCAL_STORAGE_DIR='/data/files',
        DOUBAO_API_KEY='controlled-e2e-only', DOUBAO_BASE_URL='http://controlled-model:8010/v1', DOUBAO_MODEL='controlled-e2e',
        CONTROLLED_MODEL_TOKEN=secrets.token_urlsafe(32), CONTROLLED_AI_RUN_ID=project,
        WEB_PORT=f'127.0.0.1:{web}', API_PORT='127.0.0.1:0',
        PLAYWRIGHT_BASE_URL=f'http://127.0.0.1:{web}', CONTROLLED_MODEL_URL=f'http://127.0.0.1:{web}/__controlled_model',
        CONTROLLED_AI_MANIFEST=str(private / 'manifest.json'), LABELHUB_PYTHON=sys.executable)
    # guarded_run 使用当前环境；只影响本次子进程，不修改激活文件或宿主全局变量。
    os.environ.clear()
    os.environ.update(env)
    compose = ['docker', 'compose', '--project-directory', str(ROOT), '--env-file', str(private / 'empty.env'),
               '-p', project, '-f', str(ROOT / 'docker-compose.yml'), '-f', str(ROOT / 'docker-compose.controlled-ai.yml')]
    try:
        # API 镜像先完成构建，受控服务才能使用相同镜像。
        for command in [compose + ['build', 'api', 'web'], compose + ['up', '-d', '--wait']]:
            if guarded_run(command, paths):
                raise RuntimeError('隔离构建或启动失败。')
        ids = docker('ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project).split()
        manifest = {'project': project, 'ids': ids, 'baseURL': env['PLAYWRIGHT_BASE_URL'], 'modelURL': env['CONTROLLED_MODEL_URL']}
        (private / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        verify(private / 'manifest.json')
        if guarded_run(compose + ['--profile', 'tools', 'run', '--rm', '--no-deps', 'seed'], paths):
            raise RuntimeError('隔离初始化失败。')
        executable = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
        if not executable:
            raise RuntimeError('找不到 npm。')
        return guarded_run([executable, '--prefix', 'apps/web', 'run', 'e2e:ai:browser'], paths)
    finally:
        # 不使用 down/rm/prune；失败时也不接触其他项目，保留调查证据和卷。
        ids = docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project).split()
        if ids:
            subprocess.run(['docker', 'stop', '--timeout', '60', *ids], check=True, stdout=subprocess.DEVNULL)
        print(f'本次隔离项目已停止并保留：{project}', flush=True)


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    try:
        if args.verify:
            verify(args.verify)
        else:
            sys.exit(run())
    except KeyboardInterrupt:
        sys.exit(130)
    except (ValueError, RuntimeError, StorageError, OSError, subprocess.SubprocessError) as exc:
        reason = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else '工具无法完成，请检查 Docker 和本机依赖。'
        print(f'受控链路验收失败：{reason} 未删除现有资源。', file=sys.stderr)
        sys.exit(1)
