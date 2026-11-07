"""准备与验证恢复目录的异盘副本；不覆盖、不删除源数据。"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import json
import re
import ipaddress
from urllib.parse import urlsplit
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import platform
import posixpath
import plistlib
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import uuid

CHUNK = 4 * 1024 * 1024
RESERVE = 1024 ** 3


class BackupError(RuntimeError):
    pass


def digest(path: Path, compressed: bool = False) -> str:
    result = hashlib.sha256()
    opener = gzip.open if compressed else open
    with opener(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b''):
            result.update(chunk)
    return result.hexdigest()


def safe_file(root: Path, name: str) -> Path:
    relative = PurePosixPath(name)
    # 清单可跨平台传输；同时拒绝 Windows 盘符、反斜线与备用数据流。
    if (relative.is_absolute() or '..' in relative.parts or not relative.parts
            or '\\' in name or ':' in name
            or any(PureWindowsPath(part).is_reserved() or part != part.rstrip(' .') for part in relative.parts)):
        raise BackupError('清单包含非法相对路径。')
    current = root
    for part in relative.parts:
        current /= part
        if is_link(current):
            raise BackupError('备份源或目标不允许通过符号链接访问文件。')
    if not current.is_file():
        raise BackupError(f'备份文件不存在：{name}')
    return current


def is_link(path: Path) -> bool:
    # Python 3.11 的 is_symlink 不识别 Windows 目录联接点。
    try:
        return path.is_symlink() or bool(getattr(path.lstat(), 'st_file_attributes', 0) & 0x400)
    except FileNotFoundError:
        return False


def allocated_bytes(info: os.stat_result) -> int:
    # Windows 不提供 st_blocks，以完整逻辑大小保守估算，不低估目标容量。
    return info.st_blocks * 512 if hasattr(info, 'st_blocks') else info.st_size


def write_private_json(path: Path, data: dict) -> None:
    # 独占创建，避免覆盖已有备份证明或跟随链接。
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def validate_member_paths(members: list[tarfile.TarInfo]) -> None:
    # mysql.sock 和 node_modules 含正常符号链接；只复制链接本身，不跟随。
    # 拒绝任何成员或硬链接目标穿过归档内符号链接，防止解包写出新建卷。
    names = [posixpath.normpath(m.name) for m in members]
    if len(names) != len(set(names)):
        raise BackupError('卷归档含重复路径，拒绝可能改变解包语义的覆盖。')
    links = {posixpath.normpath(m.name) for m in members if m.issym()}
    for member in members:
        names = [member.name]
        if member.islnk():
            target = PurePosixPath(member.linkname)
            if target.is_absolute() or '..' in target.parts:
                raise BackupError('卷归档含外部硬链接。')
            names.append(member.linkname)
        for name in names:
            normalized = posixpath.normpath(name)
            parents = {str(parent) for parent in PurePosixPath(normalized).parents}
            if parents & links or (member.islnk() and normalized in links):
                raise BackupError('卷归档成员穿过符号链接，拒绝自动恢复。')


def validate_archives(source: Path) -> None:
    records = json.loads((source / 'volume-backup-manifest.json').read_text(encoding='utf-8'))
    if not records:
        raise BackupError('数据卷归档清单为空。')
    for record in records:
        path = safe_file(source, record['archive'])
        if path.stat().st_size != record['bytes'] or digest(path) != record['sha256']:
            raise BackupError('数据卷归档与原始摘要不一致。')
        count = 0
        members = []
        with tarfile.open(path, 'r|gz') as archive:
            for member in archive:
                count += 1
                members.append(member)
                if PurePosixPath(member.name).is_absolute() or '..' in PurePosixPath(member.name).parts:
                    raise BackupError('卷归档含不安全路径。')
                if member.isdev() or member.isfifo():
                    raise BackupError('卷归档含特殊设备文件，拒绝自动恢复。')
                if member.isfile():
                    stream = archive.extractfile(member)
                    if stream is None:
                        raise BackupError('卷归档文件不可读取。')
                    while stream.read(CHUNK):
                        pass
        validate_member_paths(members)
        if count != record['members']:
            raise BackupError('卷归档成员数量不符。')
        # 完整读取 gzip 尾部，防止 tar 终止块掩盖压缩流损坏。
        digest(path, compressed=True)
    sql_files = list(source.glob('*.sql.gz'))
    if not sql_files:
        raise BackupError('缺少数据库逻辑备份。')
    for path in sql_files:
        expected = safe_file(source, path.name + '.sha256').read_text(encoding='utf-8').strip()
        if digest(path, compressed=True) != expected:
            raise BackupError('数据库逻辑备份的解压摘要不一致。')


def prepare(source: Path, manifest: Path, include_vm: bool) -> dict:
    source = source.resolve(strict=True)
    if source in manifest.resolve().parents:
        raise BackupError('传输清单必须放在源目录之外，避免自包含。')
    validate_archives(source)
    entries = []
    for path in sorted(source.rglob('*')):
        if is_link(path):
            raise BackupError('源目录含符号链接，拒绝隐式扩大备份范围。')
        if path.is_dir():
            continue
        if not stat.S_ISREG(path.stat().st_mode):
            raise BackupError('源目录含非普通文件。')
        if (path.name.startswith('Docker.raw') or '.vhdx' in path.name.lower()) and not include_vm:
            continue
        before = path.stat()
        checksum = digest(path)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise BackupError('备份源在校验期间发生变化。')
        entries.append({'path': path.relative_to(source).as_posix(), 'bytes': after.st_size,
                        'allocated_bytes': allocated_bytes(after), 'sha256': checksum})
    data = {'version': 1, 'prepared_at': datetime.now(timezone.utc).isoformat(),
            'source': str(source), 'include_vm': include_vm,
            'scope': '恢复目录全部普通文件' if include_vm else '数据库、卷归档、清单与日志；不含虚拟机整盘',
            'files': entries}
    write_private_json(manifest, data)
    return data


def disk_info(device: str) -> dict:
    return plistlib.loads(subprocess.check_output(['diskutil', 'info', '-plist', device], stderr=subprocess.PIPE))


def physical_identity(path: Path) -> dict:
    if platform.system() != 'Darwin':
        raise BackupError('异盘物理设备核验目前支持 macOS；其他系统不能自动认定异盘。')
    device = subprocess.check_output(['df', '-P', str(path)], text=True).splitlines()[-1].split()[0]
    if device.startswith('/dev/'):
        info = disk_info(device)
        stores = info.get('APFSPhysicalStores', [])
        parents = set()
        for store in stores:
            item = disk_info(store['APFSPhysicalStore'])
            parents.add(item.get('ParentWholeDisk', item['DeviceIdentifier']))
        if not stores:
            if info.get('VirtualOrPhysical') == 'Virtual':
                raise BackupError('磁盘映像不能认定为异盘备份。')
            parents.add(info.get('ParentWholeDisk', info['DeviceIdentifier']))
        # 磁盘映像上的 APFS 也可能有 PhysicalStores，必须继续验证底层设备。
        for parent in parents:
            whole = disk_info(parent)
            if whole.get('VirtualOrPhysical') == 'Virtual' or whole.get('BusProtocol') == 'Disk Image':
                raise BackupError('目标底层为磁盘映像，不能认定为异盘。')
        return {'kind': 'physical', 'devices': sorted(parents), 'filesystem': info.get('FilesystemType'),
                'volume_id': info.get('VolumeUUID', info.get('DiskUUID', info['DeviceIdentifier'])),
                'filesystem_device': path.stat().st_dev}
    mount = path.resolve()
    while mount.parent != mount and mount.parent.stat().st_dev == mount.stat().st_dev:
        mount = mount.parent
    mounts = subprocess.check_output(['mount'], text=True)
    match = re.search(r' on ' + re.escape(str(mount)) + r' \((smbfs|nfs)(?:,|\))', mounts)
    if not match:
        raise BackupError('无法证明该位置位于独立磁盘或网络文件系统。')
    filesystem = match.group(1)
    host = urlsplit('smb:' + device).hostname if device.startswith('//') else device.split(':/')[0].strip('[]')
    local_names = {'localhost', '127.0.0.1', socket.gethostname(), socket.getfqdn()}
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = False
    if not host or host in local_names or loopback:
        raise BackupError('本机回环共享不能认定为异盘。')
    return {'kind': 'network', 'filesystem': filesystem, 'host': host,
            'filesystem_device': path.stat().st_dev}


def require_separate(source: Path, target: Path) -> tuple[dict, dict]:
    source_id, target_id = physical_identity(source), physical_identity(target)
    if source_id['kind'] == target_id['kind'] == 'physical':
        if set(source_id['devices']) & set(target_id['devices']):
            raise BackupError('源和目标位于同一物理磁盘；不同 APFS 卷也不能算异盘。')
    elif source_id == target_id:
        raise BackupError('源和目标属于相同存储。')
    if source.stat().st_dev == target.stat().st_dev:
        raise BackupError('源和目标位于同一文件系统。')
    return source_id, target_id


def verify(directory: Path, data: dict) -> None:
    seen = set()
    for record in data['files']:
        if record['path'] in seen:
            raise BackupError('清单中存在重复文件。')
        seen.add(record['path'])
        path = safe_file(directory, record['path'])
        if path.stat().st_size != record['bytes'] or digest(path) != record['sha256']:
            raise BackupError(f'完整回读校验失败：{record["path"]}')
    validate_archives(directory)


def transfer(manifest: Path, destination: Path) -> Path:
    data = json.loads(manifest.read_text(encoding='utf-8'))
    if data.get('version') != 1 or not data.get('files'):
        raise BackupError('不支持的或空的传输清单。')
    if any(record['path'] in {'transfer-manifest.json', 'TRANSFER_VERIFIED.json'} for record in data['files']):
        raise BackupError('传输清单包含保留的成功报告文件名。')
    source = Path(data['source']).resolve(strict=True)
    destination = destination.resolve(strict=True)
    if not destination.is_dir():
        raise BackupError('目标必须是已存在的私有文件夹。')
    identities = require_separate(source, destination)
    minimum = sum(max(r['allocated_bytes'], min(r['bytes'], CHUNK)) for r in data['files']) + RESERVE
    if shutil.disk_usage(destination).free < minimum:
        raise BackupError('目标空间不足以容纳备份并保留 1 GiB 余量。')
    verify(source, data)
    output = destination / ('labelhub-recovery-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
    output.mkdir(mode=0o700)
    for record in data['files']:
        if require_separate(source, destination) != identities:
            raise BackupError('备份介质已变更，停止复制。')
        src = safe_file(source, record['path'])
        dst = output / record['path']
        dst.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        checksum = hashlib.sha256()
        with src.open('rb') as incoming, dst.open('xb') as outgoing:
            os.chmod(dst, 0o600)
            for block in iter(lambda: incoming.read(CHUNK), b''):
                if shutil.disk_usage(destination).free < RESERVE:
                    raise BackupError('目标余量低于 1 GiB；保留未完成副本供检查，源数据未改动。')
                checksum.update(block)
                if not block.strip(b'\0'):
                    outgoing.seek(len(block), os.SEEK_CUR)
                else:
                    outgoing.write(block)
            outgoing.truncate()
            outgoing.flush()
            os.fsync(outgoing.fileno())
        if checksum.hexdigest() != record['sha256'] or dst.stat().st_size != record['bytes']:
            raise BackupError('复制时源文件变化或写入不完整；未生成成功报告。')
    verify(output, data)
    if require_separate(source, destination) != identities:
        raise BackupError('回读后介质身份发生变化。')
    write_private_json(output / 'transfer-manifest.json', data)
    write_private_json(output / 'TRANSFER_VERIFIED.json', {
        'verified_at': datetime.now(timezone.utc).isoformat(), 'source_storage': identities[0],
        'target_storage': identities[1], 'files': len(data['files']),
        'bytes': sum(r['bytes'] for r in data['files']), 'scope': data['scope'],
        'verification': '逐文件完整 SHA-256 回读；卷归档与逻辑备份原始摘要复核通过',
        'restore_drill': '须从本目标另行执行卷恢复演练，不以摘要校验代替恢复演练'})
    return output


def restore_check(directory: Path, manifest: Path, report: Path) -> None:
    from storage_guard import check_space, storage_paths, run_output
    data = json.loads(manifest.read_text(encoding='utf-8'))
    verify(directory, data)
    paths = storage_paths()
    check_space(paths, 3)
    run_output(['docker', 'system', 'df'])
    image = run_output(['docker', 'image', 'inspect', '--format', '{{.Id}}', 'ubuntu:24.04'])
    records = json.loads((directory / 'volume-backup-manifest.json').read_text(encoding='utf-8'))
    restored = []
    for record in records:
        check_space(paths, 3)
        archive = safe_file(directory, record['archive'])
        with tarfile.open(archive) as tar:
            expanded = sum(member.size for member in tar if member.isfile())
        check_space(paths, 3 + expanded / (1024 ** 3))
        name = 'labelhub-backup-check-' + uuid.uuid4().hex
        # 唯一名称和显式所有权标签，绝不复用或覆盖已有卷。
        exists = subprocess.run(['docker', 'volume', 'inspect', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if exists.returncode == 0:
            raise BackupError('恢复验证卷意外存在，停止。')
        subprocess.run(['docker', 'volume', 'create', '--label', 'labelhub.backup-check=true', name], check=True, stdout=subprocess.DEVNULL)
        try:
            subprocess.run(['docker', 'run', '--rm', '--name', name, '--network', 'none', '--read-only',
                            '--mount', f'type=volume,source={name},target=/restore',
                            '--mount', f'type=bind,source={archive},target=/backup.tar.gz,readonly', image,
                            'sh', '-ec', 'tar -xzf /backup.tar.gz -C /restore && tar -dzf /backup.tar.gz -C /restore'],
                           check=True, timeout=600, stdout=subprocess.DEVNULL)
            restored.append(record['volume'])
            print(f'卷恢复与逐文件比较通过：{record["volume"]}', flush=True)
        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['docker', 'volume', 'rm', name], check=True, stdout=subprocess.DEVNULL)
    write_private_json(report, {'verified_at': datetime.now(timezone.utc).isoformat(),
                               'source_directory': str(directory), 'restored_volumes': restored,
                               'verification': '新建临时卷实际解包及 tar 全文件比较通过；临时资源已删除',
                               'database_boot': '本检查不包含启动恢复后的数据库或导入 SQL'})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    prepare_args = actions.add_parser('prepare')
    prepare_args.add_argument('--source', type=Path, required=True)
    prepare_args.add_argument('--manifest', type=Path, required=True)
    prepare_args.add_argument('--include-vm', action='store_true')
    copy_args = actions.add_parser('copy')
    copy_args.add_argument('--manifest', type=Path, required=True)
    copy_args.add_argument('--destination', type=Path, required=True)
    verify_args = actions.add_parser('verify')
    verify_args.add_argument('--directory', type=Path, required=True)
    verify_args.add_argument('--manifest', type=Path, required=True)
    restore_args = actions.add_parser('restore-check')
    restore_args.add_argument('--directory', type=Path, required=True)
    restore_args.add_argument('--manifest', type=Path, required=True)
    restore_args.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.action == 'prepare':
            data = prepare(args.source, args.manifest, args.include_vm)
            print(f'备份已准备：{len(data["files"])} 个文件；{data["scope"]}。尚未完成异盘复制。')
        elif args.action == 'copy':
            print(f'异盘复制与完整回读通过：{transfer(args.manifest, args.destination)}')
        elif args.action == 'restore-check':
            restore_check(args.directory.resolve(strict=True), args.manifest, args.report)
        else:
            verify(args.directory.resolve(strict=True), json.loads(args.manifest.read_text(encoding='utf-8')))
            print('内容校验通过；此操作本身不证明异盘身份或恢复演练通过。')
        return 0
    except (RuntimeError, OSError, ValueError, KeyError, EOFError, tarfile.TarError, subprocess.SubprocessError) as exc:
        print(f'备份未完成：{type(exc).__name__}：{exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
