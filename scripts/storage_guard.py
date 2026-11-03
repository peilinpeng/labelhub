"""本地 Docker 容量门禁；只检查，不清理用户数据。"""
from __future__ import annotations

import math
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import time

GIB = 1024 ** 3
START_GIB = 10
STOP_GIB = 3


class StorageError(RuntimeError):
    pass


def run_output(args: list[str]) -> str:
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=30).strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
        # 不回显 Docker 原始错误，避免带出环境或命令中的凭据。
        raise StorageError(f"无法完成只读检查：{args[0]} {args[1]}；请检查 Docker 状态。") from exc


def storage_paths() -> list[Path]:
    context = None if os.environ.get('DOCKER_CONTEXT') else os.environ.get('DOCKER_HOST')
    if not context:
        context = run_output(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
    if not context.startswith('unix://'):
        raise StorageError('仅支持本地 Unix socket；远程 Docker 必须在远端执行容量检查。')
    paths = [Path.cwd().resolve()]
    if platform.system() == 'Darwin':
        disk = Path(os.environ.get('LABELHUB_DOCKER_DISK_PATH', str(
            Path.home() / 'Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw'))).expanduser()
        if not disk.is_file():
            raise StorageError('找不到 Docker.raw；请将 LABELHUB_DOCKER_DISK_PATH 指向 Docker Desktop 当前使用的磁盘文件。')
        paths.append(disk.resolve())
    elif platform.system() == 'Linux':
        root = Path(run_output(['docker', 'info', '--format', '{{.DockerRootDir}}']))
        if not root.is_dir():
            raise StorageError('Docker 数据目录不可访问；不能将本机空间冒充远端或虚拟机空间。')
        paths.append(root.resolve())
    else:
        raise StorageError('容量门禁目前支持 macOS Docker Desktop 和原生 Linux Docker。')
    return paths


def check_space(paths: list[Path], minimum_gib: float) -> list[str]:
    if not math.isfinite(minimum_gib) or minimum_gib <= 0:
        raise StorageError('空间阈值必须是正数。')
    messages = []
    for path in paths:
        if not path.exists():
            raise StorageError('被监测的存储路径已消失，停止操作。')
        try:
            free = shutil.disk_usage(path).free / GIB
        except OSError as exc:
            raise StorageError('无法读取存储空间，停止操作。') from exc
        if free < minimum_gib:
            raise StorageError(f'{path} 可用 {free:.2f} GiB，低于 {minimum_gib:g} GiB 门槛；未清理任何容器或数据卷。')
        messages.append(f'{path}：可用 {free:.2f} GiB')
    return messages


def preflight() -> list[Path]:
    paths = storage_paths()
    for message in check_space(paths, START_GIB):
        print(message, flush=True)
    run_output(['docker', 'system', 'df'])
    print('Docker 存储可读，容量预检通过。', flush=True)
    return paths


def terminate_group(process: subprocess.Popen) -> None:
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGKILL):
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            pass


def guarded_run(command: list[str], paths: list[Path], interval: float = 2) -> int:
    check_space(paths, START_GIB)
    process = subprocess.Popen(command, start_new_session=True)
    try:
        while process.poll() is None:
            check_space(paths, STOP_GIB)
            time.sleep(interval)
        check_space(paths, STOP_GIB)
        return process.returncode
    except StorageError:
        terminate_group(process)
        raise
    except KeyboardInterrupt:
        terminate_group(process)
        return 130
