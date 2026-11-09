"""保留容器与数据卷的本机运维入口；不调用 Compose up/down 或任何删除命令。"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

from recovery_backup import BackupError, digest, is_link, safe_file, write_private_json
from storage_guard import StorageError, START_GIB, STOP_GIB, check_space, preflight, terminate_group

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROFILE = ROOT / '.local' / 'operations.json'
APPS = ('api', 'worker', 'scheduler', 'web')
INFRA = ('mysql', 'redis', 'alertmanager', 'prometheus', 'grafana')
START_ORDER = INFRA + APPS
STOP_ORDER = ('web', 'api', 'scheduler', 'worker', 'grafana', 'prometheus', 'alertmanager', 'redis', 'mysql')


class OpsError(RuntimeError):
    pass


@contextmanager
def operation_lock(path):
    # 同一工作区的启停和备份互斥，避免备份暂停期间被另一个运维命令启动。
    if any(is_link(parent) for parent in (path, *path.parents)):
        raise OpsError('运维锁路径不得经过链接。')
    if not path.parent.exists():
        private_directory(path.parent)
    with path.open('a+b') as stream:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b'0')
            stream.flush()
        stream.seek(0)
        try:
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise OpsError('另一个运维命令正在执行，请等待完成；未启动或停止服务。') from None
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == 'nt':
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def docker(*args, timeout=60):
    try:
        result = subprocess.run(['docker', *args], capture_output=True, timeout=timeout)
        if result.returncode:
            raise OpsError(f'Docker {args[0]} 失败；未输出可能含密钥的原始错误。')
        return result.stdout.decode('utf-8').strip()
    except (OSError, subprocess.TimeoutExpired):
        raise OpsError(f'Docker {args[0]} 无法完成。') from None


def inspect_ids(ids):
    return json.loads(docker('inspect', *ids)) if ids else []


def service(container):
    return (container['Config'].get('Labels') or {}).get('com.docker.compose.service')


def pinned(container):
    labels = container['Config'].get('Labels') or {}
    immutable = {key: container[key] for key in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')}
    immutable['Mounts'] = sorted(container['Mounts'], key=lambda m: m['Destination'])
    # 网络端点地址会在 start 时改变；只固定网络 ID，不固定动态 IP。
    networks = {name: value['NetworkID'] for name, value in container['NetworkSettings']['Networks'].items()}
    immutable['networks'] = networks
    return {
        'id': container['Id'], 'service': service(container),
        'project': labels.get('com.docker.compose.project'), 'image': container['Image'],
        'networks': networks,
        'mounts': [{k: mount.get(k) for k in ('Type', 'Name', 'Source', 'Destination', 'RW')} for mount in immutable['Mounts']],
        'fingerprint': hashlib.sha256(json.dumps(immutable, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf-8')).hexdigest(),
    }


def private_directory(path):
    path = path.absolute()
    if any(is_link(parent) for parent in (path, *path.parents)):
        raise OpsError('私有目录不得经过符号链接或目录联接。')
    path.mkdir(mode=0o700, parents=True, exist_ok=False)
    if platform.system() == 'Windows':
        sid = subprocess.run(['whoami', '/user', '/fo', 'csv', '/nh'], check=True, capture_output=True).stdout.decode()
        import csv
        user_sid = next(csv.reader([sid.strip()]))[1]
        result = subprocess.run(['icacls', str(path), '/inheritance:r', '/grant:r',
                                 f'*{user_sid}:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'], capture_output=True)
        if result.returncode:
            raise OpsError('无法设置私有目录 ACL，未写入敏感内容。')
    return path


def db_identity(api):
    code = ('import json; from sqlalchemy import text; from app.database import engine; '
            'c=engine.connect(); print(json.dumps(list(c.execute(text("SELECT @@server_uuid, DATABASE()")).one()))); c.close()')
    return json.loads(docker('exec', api['Id'], 'python', '-c', code))


def check_redis(containers):
    code = ('from redis import Redis; from app.config import settings; '
            'print(Redis.from_url(settings.REDIS_URL).info("server")["run_id"])')
    actual = docker('exec', containers['api']['Id'], 'python', '-c', code)
    info = docker('exec', containers['redis']['Id'], 'redis-cli', '--raw', 'INFO', 'server')
    expected = next((line.split(':', 1)[1] for line in info.splitlines() if line.startswith('run_id:')), None)
    if not expected or actual != expected:
        raise OpsError('API 实际 Redis 与所选 Redis 不一致，拒绝操作。')


def register(path, app_project, infra_project, disk):
    if path.exists():
        raise OpsError('配置已存在，拒绝覆盖；重新登记请指定新文件并核实目标。')
    if disk:
        os.environ['LABELHUB_DOCKER_DISK_PATH'] = str(disk)
    preflight()
    containers = inspect_ids(docker('ps', '-aq').split())
    selected = {}
    for role in START_ORDER:
        project = app_project if role in APPS else infra_project
        matches = [c for c in containers if service(c) == role and
                   (c['Config'].get('Labels') or {}).get('com.docker.compose.project') == project and
                   (c['Config'].get('Labels') or {}).get('com.docker.compose.oneoff', 'False').lower() != 'true']
        if not matches and role in ('alertmanager', 'prometheus', 'grafana'):
            continue
        if len(matches) != 1:
            raise OpsError(f'{project}/{role} 必须恰好对应一个已有容器。')
        selected[role] = matches[0]
    actual = db_identity(selected['api'])
    mysql = selected['mysql']
    target = json.loads(docker('exec', mysql['Id'], 'sh', '-ec',
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "SELECT JSON_ARRAY(@@server_uuid, DATABASE())" "$MYSQL_DATABASE"'))
    if actual != target:
        raise OpsError('API 实际数据库与所选 MySQL 不一致，拒绝登记。')
    check_redis(selected)
    for role in ('worker', 'scheduler'):
        def db_env(c):
            return sorted(x for x in c['Config']['Env'] if x.startswith(('DATABASE_URL=', 'REDIS_URL=')))
        if db_env(selected[role]) != db_env(selected['api']):
            raise OpsError('API/worker/scheduler 数据目标不一致。')
    profile = {'version': 1, 'engine': docker('info', '--format', '{{.ID}}'),
               'disk': str(disk) if disk else os.environ.get('LABELHUB_DOCKER_DISK_PATH'),
               'database': actual, 'containers': {r: pinned(c) for r, c in selected.items()}}
    validate(profile)
    if not path.parent.exists():
        private_directory(path.parent)
    write_private_json(path, profile)
    print(f'已登记现有容器：{path}；未创建或修改任何容器/卷。')


def validate(profile, *, allow_conflicts=False):
    if profile.get('version') != 1 or profile.get('engine') != docker('info', '--format', '{{.ID}}'):
        raise OpsError('Docker 引擎或配置版本不匹配，拒绝操作。')
    registered = profile['containers']
    if not set(APPS + ('mysql', 'redis')) <= registered.keys():
        raise OpsError('配置缺少必要服务。')
    actual = inspect_ids([c['id'] for c in registered.values()])
    by_id = {c['Id']: c for c in actual}
    for role, expected in registered.items():
        if expected != pinned(by_id[expected['id']]) or role != expected['service']:
            raise OpsError(f'{role} 的容器、镜像、挂载或配置已改变，拒绝操作。')
    networks = {n for c in registered.values() for n in c['networks'].values()}
    mounts = {m['Source'] for c in registered.values() for m in c['mounts'] if m['RW']}
    others = inspect_ids(docker('ps', '-q').split())
    conflicts = [c for c in others if c['Id'] not in by_id and
                 (any(m.get('RW') and m['Source'] in mounts for m in c['Mounts']) or
                  any(n['NetworkID'] in networks for n in c['NetworkSettings']['Networks'].values()))]
    if conflicts and not allow_conflicts:
        raise OpsError('发现未登记的运行中应用或共享卷写入者；拒绝启动/备份，请先核实冲突。')
    return {r: by_id[c['id']] for r, c in registered.items()}, conflicts


def wait_ready(container_id, paths, timeout=180):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        check_space(paths, STOP_GIB)
        state = inspect_ids([container_id])[0]['State']
        if not state['Running']:
            raise OpsError('服务启动后退出；未删除容器，请检查本机日志。')
        health = state.get('Health', {}).get('Status')
        if health in (None, 'healthy'):
            return health == 'healthy'
        if health == 'unhealthy':
            raise OpsError('服务健康检查失败；未重建容器。')
        time.sleep(2)
    raise OpsError('等待服务健康检查超时。')


def start(profile, roles=None):
    containers, _ = validate(profile)
    paths = preflight()
    for role in START_ORDER:
        if role not in containers or roles is not None and role not in roles:
            continue
        validate(profile)
        check_space(paths, START_GIB)
        docker('start', containers[role]['Id'])
        healthy = wait_ready(containers[role]['Id'], paths)
        result = '已启动并通过健康检查' if healthy else '已运行（未配置容器健康检查）'
        print(f'{role} {result}。', flush=True)


def stop(profile, roles=None):
    containers, _ = validate(profile, allow_conflicts=True)
    for role in STOP_ORDER:
        if role not in containers or roles is not None and role not in roles:
            continue
        if containers[role]['State']['Running']:
            # 超时不发 SIGKILL，不为了完成备份强杀仍在处理任务的 worker。
            docker('stop', '--timeout', '-1', containers[role]['Id'], timeout=180)
            print(f'{role} 已停止，容器和卷保留。', flush=True)


def capture(command, path, paths, timeout=600):
    check_space(paths, START_GIB)
    with path.open('xb') as stream:
        options = {'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP} if platform.system() == 'Windows' else {'start_new_session': True}
        process = subprocess.Popen(command, stdout=stream, stderr=subprocess.DEVNULL, **options)
        deadline = time.monotonic() + timeout
        try:
            while process.poll() is None:
                check_space(paths, STOP_GIB)
                if time.monotonic() > deadline:
                    raise OpsError('备份读取超时，保留不完整目录，不生成成功清单。')
                time.sleep(0.2)
            if process.returncode:
                raise OpsError('备份读取失败，不生成成功清单。')
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            terminate_group(process)
            raise


def verify_files(directory, files):
    for item in files:
        path = safe_file(directory, item['path'])
        if path.stat().st_size != item['bytes'] or digest(path) != item['sha256']:
            raise OpsError('备份文件长度或 SHA-256 不一致。')
    print(f"完整回读通过：{len(files)} 个文件；尚不代表恢复演练或异盘灾备。")


def verify(directory):
    manifest = json.loads(safe_file(directory, 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != 1 or not manifest.get('files'):
        raise OpsError('备份清单为空或版本不支持。')
    verify_files(directory, manifest['files'])


def backup(profile, destination):
    # 备份包含凭据，禁止放进仓库，禁止远程路径和链接，且永不覆盖。
    destination = destination.absolute()
    if any(is_link(parent) for parent in (destination, *destination.parents)):
        raise OpsError('备份路径不得经过符号链接或目录联接。')
    destination = destination.resolve()
    if destination.is_relative_to(ROOT) or str(destination).startswith(('\\\\', '//')):
        raise OpsError('备份必须位于仓库外的本地新目录。')
    if platform.system() == 'Windows':
        import ctypes
        if ctypes.windll.kernel32.GetDriveTypeW(str(destination.anchor)) not in (2, 3):
            raise OpsError('备份目标不是本机磁盘；映射网络盘和未知介质均拒绝。')
    containers, _ = validate(profile)
    if not containers['mysql']['State']['Running'] or not containers['api']['State']['Running']:
        raise OpsError('备份前 MySQL 和 API 必须运行，以核实实际数据库身份。')
    if db_identity(containers['api']) != profile['database']:
        raise OpsError('实际数据库身份变化，拒绝备份。')
    check_redis(containers)
    paths = preflight()
    parent = destination.parent
    if not parent.is_dir():
        raise OpsError('请先准备备份父目录。')
    check_space([parent], START_GIB)
    private_directory(destination)
    paths.append(destination)
    running = {r for r, c in containers.items() if c['State']['Running']}
    completed = False
    try:
        stop(profile, running - {'mysql'})
        stopped, _ = validate(profile)
        if any(c['State']['Running'] for r, c in stopped.items() if r != 'mysql'):
            raise OpsError('写入服务未完全停止，拒绝生成一致性备份。')
        write_private_json(destination / 'containers.private.json', {'containers': list(containers.values())})
        write_private_json(destination / 'profile.private.json', profile)
        capture(['docker', 'exec', containers['mysql']['Id'], 'sh', '-ec',
                 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --events --triggers --hex-blob --set-gtid-purged=OFF --no-tablespaces "$MYSQL_DATABASE"'],
                destination / 'database.sql', paths)
        archived = set()
        archives = []
        for role, container in containers.items():
            for mount in container['Mounts']:
                if mount['Type'] not in ('volume', 'bind') or mount['Source'] in archived:
                    continue
                if role == 'mysql' and mount['Destination'] == '/var/lib/mysql':
                    continue  # 在线 MySQL 只做一致性逻辑备份，不复制活动数据目录。
                name = f'mount-{len(archives):02d}.tar'
                capture(['docker', 'cp', f"{container['Id']}:{mount['Destination']}", '-'], destination / name, paths)
                archived.add(mount['Source'])
                archives.append({'archive': name, 'service': role, 'mount': mount})
        write_private_json(destination / 'mounts.private.json', {'archives': archives})
        files = [{'path': p.name, 'bytes': p.stat().st_size, 'sha256': digest(p)} for p in sorted(destination.iterdir())]
        verify_files(destination, files)
        write_private_json(destination / 'manifest.json', {'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
            'database': profile['database'], 'files': files, 'offDisk': False, 'restoreVerified': False})
        completed = True
    finally:
        # 只恢复原先运行的服务；低空间时仍遵守启动门禁，明确报告人工恢复入口。
        try:
            start(profile, running)
        except (OpsError, StorageError) as exc:
            raise OpsError(f'服务恢复未完成：{exc} 请排除问题后执行 ops start；备份目录保留。') from None
        if not completed:
            print('本次备份未完整完成；目录保留，不作为可恢复备份使用。', file=sys.stderr)
    print(f'本机备份完成：{destination}；原服务已恢复，未删除/重建任何容器或卷。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', type=Path, default=DEFAULT_PROFILE)
    sub = parser.add_subparsers(dest='action', required=True)
    reg = sub.add_parser('register', help='只读识别并固定已有容器，不创建运行环境')
    reg.add_argument('--app-project', required=True)
    reg.add_argument('--infra-project', required=True)
    reg.add_argument('--docker-disk', type=Path)
    for command in ('status', 'start', 'stop'):
        sub.add_parser(command)
    sub.add_parser('backup').add_argument('--destination', type=Path, required=True)
    sub.add_parser('verify-backup').add_argument('directory', type=Path)
    args = parser.parse_args()
    if args.action in ('status', 'verify-backup'):
        return dispatch(args)
    try:
        with operation_lock(ROOT / '.local' / 'operations.lock'):
            return dispatch(args)
    except (OpsError, OSError) as exc:
        print(str(exc) if isinstance(exc, OpsError) else '无法获取本机运维锁。', file=sys.stderr)
        return 1


def dispatch(args):
    try:
        if args.action == 'register':
            register(args.profile, args.app_project, args.infra_project, args.docker_disk)
            return 0
        if args.action == 'verify-backup':
            verify(args.directory)
            return 0
        profile = json.loads(args.profile.read_text(encoding='utf-8'))
        if profile.get('disk'):
            os.environ['LABELHUB_DOCKER_DISK_PATH'] = profile['disk']
        if args.action == 'status':
            containers, conflicts = validate(profile, allow_conflicts=True)
            print(f"数据库：{profile['database'][1]}；服务器：{profile['database'][0]}")
            for role, c in containers.items():
                print(f"{role:14} {c['Id'][:12]} {c['State']['Status']:10} {c['State'].get('Health', {}).get('Status', '-')} {profile['containers'][role]['project']}")
            for mount in {m.get('Name') or m['Source'] for c in containers.values() for m in c['Mounts']}:
                print(f'挂载：{mount}')
            if conflicts:
                raise OpsError('存在未登记的共享数据写入者，start/backup 将拒绝执行。')
        elif args.action == 'start':
            start(profile)
        elif args.action == 'stop':
            stop(profile)
        elif args.action == 'backup':
            backup(profile, args.destination)
        return 0
    except (OpsError, StorageError, BackupError, OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        # 不打印原始 subprocess 输出、SQL、环境变量或配置内容。
        print(str(exc) if isinstance(exc, (OpsError, StorageError, BackupError)) else '运维配置或命令失败，请检查私有配置和 Docker 状态。', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
