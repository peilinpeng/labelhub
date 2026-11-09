"""本机运维安全边界：身份固定、拒绝冲突、备份失败与恢复。"""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_ops as ops


def container(role, *, running=True):
    return {'Id': role + '-id', 'Image': 'sha256:original', 'Config': {
        'Labels': {'com.docker.compose.service': role, 'com.docker.compose.project': 'test'},
        'Env': ['PRIVATE=value']}, 'HostConfig': {},
        'Mounts': [{'Type': 'volume', 'Name': role, 'Source': '/vol/' + role, 'Destination': '/data', 'RW': True}],
        'NetworkSettings': {'Networks': {'test': {'NetworkID': 'network-id'}}},
        'State': {'Running': running, 'Status': 'running' if running else 'exited'}}


class OpsTests(unittest.TestCase):
    def test_operation_lock_blocks_overlap_and_releases_after_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'operations.lock'
            with self.assertRaisesRegex(RuntimeError, 'simulated'):
                with ops.operation_lock(path):
                    with self.assertRaisesRegex(ops.OpsError, '另一个'):
                        with ops.operation_lock(path):
                            self.fail('不应同时获取运维锁')
                    raise RuntimeError('simulated')
            with ops.operation_lock(path):
                pass

    def setUp(self):
        self.containers = {r: container(r) for r in ops.START_ORDER}
        self.profile = {'version': 1, 'engine': 'engine-id', 'database': ['server', 'labelhub'],
                        'containers': {r: ops.pinned(c) for r, c in self.containers.items()}}

    def fake_docker(self, *args, **kwargs):
        if args[0] == 'info':
            return 'engine-id'
        if args[:2] == ('ps', '-q'):
            return ' '.join(c['Id'] for c in self.containers.values())
        raise AssertionError(args)

    def fake_inspect(self, ids):
        return [c for c in self.containers.values() if c['Id'] in ids]

    def test_identity_change_blocks_operation(self):
        for key, value in [('Id', 'replacement'), ('Image', 'changed'), ('HostConfig', {'Changed': True})]:
            with self.subTest(key=key):
                original = copy.deepcopy(self.containers['api'])
                self.containers['api'][key] = value
                with patch.object(ops, 'docker', side_effect=self.fake_docker), patch.object(ops, 'inspect_ids', side_effect=self.fake_inspect):
                    with self.assertRaises((ops.OpsError, KeyError)):
                        ops.validate(self.profile)
                self.containers['api'] = original

    def test_old_worker_sharing_network_blocks_start_and_backup(self):
        self.containers['old'] = container('worker')
        self.containers['old']['Id'] = 'old-worker-id'
        with patch.object(ops, 'docker', side_effect=self.fake_docker), patch.object(ops, 'inspect_ids', side_effect=self.fake_inspect):
            with self.assertRaisesRegex(ops.OpsError, '未登记'):
                ops.validate(self.profile)
            _, conflicts = ops.validate(self.profile, allow_conflicts=True)
            self.assertEqual(len(conflicts), 1)

    def test_stop_is_available_without_space_and_never_deletes(self):
        with patch.object(ops, 'validate', return_value=(self.containers, [])), patch.object(ops, 'preflight') as preflight, patch.object(ops, 'docker') as docker:
            ops.stop(self.profile)
            preflight.assert_not_called()
            self.assertEqual(len(docker.call_args_list), len(self.containers))
            self.assertTrue(all(c.args[:3] == ('stop', '--timeout', '-1') for c in docker.call_args_list))

    def test_start_low_space_prevents_any_start(self):
        with patch.object(ops, 'validate', return_value=(self.containers, [])), patch.object(ops, 'preflight', side_effect=ops.StorageError('full')), patch.object(ops, 'docker') as docker:
            with self.assertRaises(ops.StorageError):
                ops.start(self.profile)
            docker.assert_not_called()

    def test_mount_order_does_not_change_pinned_identity(self):
        original = self.containers['api']
        original['Mounts'].append({'Type': 'bind', 'Source': '/config', 'Destination': '/config', 'RW': False})
        reordered = copy.deepcopy(original)
        reordered['Mounts'].reverse()
        self.assertEqual(ops.pinned(original), ops.pinned(reordered))

    def test_redis_mismatch_is_refused(self):
        with patch.object(ops, 'docker', side_effect=['api-server', 'run_id:different-server\r\n']):
            with self.assertRaisesRegex(ops.OpsError, 'Redis'):
                ops.check_redis(self.containers)

    def test_capture_failure_does_not_overwrite_an_existing_file(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(ops, 'check_space'), patch.object(ops.subprocess, 'Popen') as popen:
            path = Path(tmp) / 'backup.sql'
            path.write_bytes(b'original')
            with self.assertRaises(FileExistsError):
                ops.capture(['docker', 'exec'], path, [])
            popen.assert_not_called()
            self.assertEqual(path.read_bytes(), b'original')

    def test_backup_refuses_repository_and_existing_target(self):
        with self.assertRaises(ops.OpsError):
            ops.backup(self.profile, ops.ROOT / 'backup')
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(FileExistsError):
                ops.private_directory(Path(tmp))

    def test_failed_capture_restores_only_previously_running_services(self):
        self.containers['grafana']['State']['Running'] = False
        stopped = copy.deepcopy(self.containers)
        for role, c in stopped.items():
            c['State']['Running'] = role == 'mysql'
        with tempfile.TemporaryDirectory() as tmp, patch.object(ops, 'ROOT', Path(tmp) / 'repo'), patch.object(ops, 'validate', side_effect=[(self.containers, []), (stopped, [])]), patch.object(ops, 'db_identity', return_value=self.profile['database']), patch.object(ops, 'check_redis'), patch.object(ops, 'preflight', return_value=[]), patch.object(ops, 'check_space'), patch.object(ops, 'stop'), patch.object(ops, 'start') as start, patch.object(ops, 'capture', side_effect=ops.OpsError('failed')):
            destination = Path(tmp) / 'new'
            with self.assertRaisesRegex(ops.OpsError, 'failed'):
                ops.backup(self.profile, destination)
            self.assertNotIn('grafana', start.call_args.args[1])
            self.assertFalse((destination / 'manifest.json').exists())
            self.assertTrue(destination.exists())

    def test_backup_hash_rejects_corruption_and_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').write_bytes(b'original')
            manifest = {'version': 1, 'files': [{'path': 'data', 'bytes': 8, 'sha256': ops.digest(root / 'data')}]}
            (root / 'manifest.json').write_text(json.dumps(manifest))
            ops.verify(root)
            (root / 'data').write_bytes(b'corrupt!')
            with self.assertRaises(ops.OpsError):
                ops.verify(root)
            manifest['files'][0]['path'] = '../outside'
            (root / 'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaises(ops.BackupError):
                ops.verify(root)


if __name__ == '__main__':
    unittest.main()
