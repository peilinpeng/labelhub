"""验证空间不足、介质误判与备份损坏时确实阻断操作。"""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tarfile
import unittest
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import storage_guard as guard
import recovery_backup as backup
spec = importlib.util.spec_from_file_location('local_compose', Path(__file__).resolve().parents[1] / 'local-compose.py')
compose = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compose)


class StorageTests(unittest.TestCase):
    def test_low_space_prevents_child_start(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(guard.shutil, 'disk_usage', return_value=Mock(free=9 * guard.GIB)), patch.object(guard.subprocess, 'Popen') as popen:
            with self.assertRaises(guard.StorageError):
                guard.guarded_run(['never-run'], [Path(tmp)])
            popen.assert_not_called()

    def test_running_command_is_cancelled_when_space_drops(self):
        process = Mock(pid=123, returncode=-2)
        process.poll.return_value = None
        with patch.object(guard, 'check_space', side_effect=[[], guard.StorageError('空间不足')]), patch.object(guard.subprocess, 'Popen', return_value=process), patch.object(guard, 'terminate_group') as terminate:
            with self.assertRaises(guard.StorageError):
                guard.guarded_run(['test'], [Path('.')], interval=0)
            terminate.assert_called_once_with(process)

    def test_signal_escalation(self):
        process = Mock(pid=123)
        process.poll.return_value = None
        process.wait.side_effect = [subprocess.TimeoutExpired('test', 5), None]
        with patch.object(guard.os, 'killpg') as kill:
            guard.terminate_group(process)
            self.assertEqual(kill.call_count, 2)

    def test_remote_daemon_is_not_checked_as_local(self):
        with patch.dict(guard.os.environ, {'DOCKER_HOST': 'ssh://remote'}):
            with self.assertRaises(guard.StorageError):
                guard.storage_paths()

    def test_compose_options_cannot_hide_write_operation(self):
        self.assertEqual(compose.compose_command(['-f', 'ps', '--profile=tools', 'run', '--rm', 'seed']), 'run')
        self.assertEqual(compose.compose_command(['--env-file', 'up', 'build']), 'build')
        with self.assertRaises(guard.StorageError):
            compose.compose_command(['--unknown', 'build'])

    def test_recovery_operations_remain_available_when_disk_full(self):
        with patch.object(sys, 'argv', ['local-compose.py', 'down']), patch.object(compose, 'preflight') as preflight, patch.object(compose.subprocess, 'call', return_value=0):
            self.assertEqual(compose.main(), 0)
            preflight.assert_not_called()


class BackupTests(unittest.TestCase):
    def test_apfs_volumes_on_same_physical_disk_rejected(self):
        with patch.object(backup, 'physical_identity', side_effect=[{'kind': 'physical', 'devices': ['disk0']}, {'kind': 'physical', 'devices': ['disk0']}]):
            with self.assertRaises(backup.BackupError):
                backup.require_separate(Path('/'), Path('/'))

    def test_network_mount_detection_and_loopback_rejection(self):
        root = Path.cwd().resolve()
        mount = root
        while mount.parent != mount and mount.parent.stat().st_dev == mount.stat().st_dev:
            mount = mount.parent
        def run(host):
            outputs = [f'Filesystem 512-blocks Used Available Capacity Mounted on\n{host}:/share 100 0 100 0% {mount}\n', f'{host}:/share on {mount} (nfs, nodev)\n']
            with patch.object(backup.platform, 'system', return_value='Darwin'), patch.object(backup.subprocess, 'check_output', side_effect=outputs):
                return backup.physical_identity(root)
        self.assertEqual(run('nas.example')['kind'], 'network')
        with self.assertRaises(backup.BackupError):
            run('localhost')
        with self.assertRaises(backup.BackupError):
            run('[::1]')

    def test_corrupt_or_truncated_copy_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); file = root / 'data'; file.write_bytes(b'good')
            data = {'files': [{'path': 'data', 'bytes': 4, 'sha256': backup.digest(file)}]}
            file.write_bytes(b'evil')
            with self.assertRaises(backup.BackupError):
                backup.verify(root, data)
            file.write_bytes(b'g')
            with self.assertRaises(backup.BackupError):
                backup.verify(root, data)

    def test_manifest_traversal_and_symlink_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'link').symlink_to('/etc/hosts')
            for name in ['../outside', '/etc/hosts', 'link']:
                with self.assertRaises(backup.BackupError):
                    backup.safe_file(root, name)

    def test_archive_links_are_inert_and_never_followed_for_writes(self):
        link = tarfile.TarInfo('./mysql.sock'); link.type = tarfile.SYMTYPE; link.linkname = '/var/run/mysqld/mysqld.sock'
        backup.validate_member_paths([link])
        child = tarfile.TarInfo('./mysql.sock/escape')
        with self.assertRaises(backup.BackupError):
            backup.validate_member_paths([link, child])
        hard = tarfile.TarInfo('./escape'); hard.type = tarfile.LNKTYPE; hard.linkname = '../../outside'
        with self.assertRaises(backup.BackupError):
            backup.validate_member_paths([hard])

    def test_report_never_overwrites_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'report.json'; path.write_text('original')
            with self.assertRaises(FileExistsError):
                backup.write_private_json(path, {'status': 'ok'})
            self.assertEqual(path.read_text(), 'original')

    def test_transfer_full_readback_and_source_preservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source = root/'source'; target = root/'target'
            source.mkdir(); target.mkdir(); (source/'file').write_bytes(b'private-data')
            manifest = root/'manifest.json'
            data = {'version': 1, 'source': str(source), 'scope': '测试', 'files': [{'path': 'file', 'bytes': 12, 'allocated_bytes': 4096, 'sha256': backup.digest(source/'file')}]}
            manifest.write_text(json.dumps(data))
            with patch.object(backup, 'require_separate', return_value=({'kind': 'physical','devices':['disk0']},{'kind':'physical','devices':['disk9']})), patch.object(backup, 'validate_archives'), patch.object(backup.shutil, 'disk_usage', return_value=Mock(free=20*guard.GIB)):
                output = backup.transfer(manifest, target)
            self.assertEqual((output/'file').read_bytes(), b'private-data')
            self.assertEqual((source/'file').read_bytes(), b'private-data')
            self.assertTrue((output/'TRANSFER_VERIFIED.json').exists())

    def test_failed_copy_has_no_success_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); source=root/'source';target=root/'target'
            source.mkdir();target.mkdir(); (source/'data').write_bytes(b'data')
            manifest=root/'manifest.json';manifest.write_text(json.dumps({'version':1,'source':str(source),'scope':'测试','files':[{'path':'data','bytes':4,'allocated_bytes':4096,'sha256':'0'*64}]}))
            with patch.object(backup,'require_separate',return_value=({},{})),patch.object(backup.shutil,'disk_usage',return_value=Mock(free=20*guard.GIB)):
                with self.assertRaises(backup.BackupError):backup.transfer(manifest,target)
            self.assertEqual(list(target.iterdir()),[])


if __name__ == '__main__':
    unittest.main()
