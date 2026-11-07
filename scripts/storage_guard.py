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
    system = platform.system()
    paths = [Path.cwd().resolve()]
    if system == 'Windows':
        if context != 'npipe:////./pipe/dockerDesktopLinuxEngine':
            raise StorageError('Windows 仅支持本机 Docker Desktop Linux 引擎命名管道。')
        if run_output(['docker', 'info', '--format', '{{.OperatingSystem}}|{{.OSType}}']) != 'Docker Desktop|linux':
            raise StorageError('当前引擎不是 Docker Desktop Linux，无法核实本机存储。')
        configured = os.environ.get('LABELHUB_DOCKER_DISK_PATH')
        if not configured:
            raise StorageError('请将 LABELHUB_DOCKER_DISK_PATH 指向 Docker Desktop 当前使用的 WSL2 数据 VHDX；不能用工作区空间代替。')
        disk = Path(configured).expanduser()
        if not disk.is_absolute() or disk.suffix.lower() != '.vhdx' or not disk.is_file():
            raise StorageError('Docker 数据磁盘必须是已存在的绝对 VHDX 文件路径。')
        paths.append(disk.resolve())
        return paths
    if not context.startswith('unix://'):
        raise StorageError('仅支持本地 Unix socket；远程 Docker 必须在远端执行容量检查。')
    if system == 'Darwin':
        disk = Path(os.environ.get('LABELHUB_DOCKER_DISK_PATH', str(
            Path.home() / 'Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw'))).expanduser()
        if not disk.is_file():
            raise StorageError('找不到 Docker.raw；请将 LABELHUB_DOCKER_DISK_PATH 指向 Docker Desktop 当前使用的磁盘文件。')
        paths.append(disk.resolve())
    elif system == 'Linux':
        root = Path(run_output(['docker', 'info', '--format', '{{.DockerRootDir}}']))
        if not root.is_dir():
            raise StorageError('Docker 数据目录不可访问；不能将本机空间冒充远端或虚拟机空间。')
        paths.append(root.resolve())
    else:
        raise StorageError('容量门禁支持 Windows/macOS Docker Desktop 和原生 Linux Docker。')
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
    if platform.system() == 'Windows':
        if process.poll() is None:
            # Windows 无 killpg；按本次客户端 PID 终止整棵子进程树，不操作其他容器。
            try:
                result = subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
                if result.returncode and process.poll() is None:
                    raise StorageError('无法终止本次命令进程树，请检查客户端及部分启动的资源。')
                process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise StorageError('终止本次命令进程树失败，请检查客户端及部分启动的资源。') from exc
        return
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
    options = ({'creationflags': subprocess.CREATE_NEW_PROCESS_GROUP}
               if platform.system() == 'Windows' else {'start_new_session': True})
    process = subprocess.Popen(command, **options)
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
