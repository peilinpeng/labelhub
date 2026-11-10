"""拒绝误指向业务环境，并核实受控模型控制接口失败关闭。"""
import copy
import json
from pathlib import Path
import sys
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from controlled_ai import SERVICES, validate_inventory
from testing.controlled_model import ModelServer


class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.project = 'labelhub-ai-' + 'a' * 16
        self.containers = [{
            'Config': {'Labels': {'com.docker.compose.project': self.project, 'com.docker.compose.service': role}},
            'Mounts': [{'Type': 'volume', 'Name': self.project + '_data'}],
            'NetworkSettings': {'Networks': {self.project + '_default': {}, **({self.project + '_ingress': {}} if role == 'web' else {})}},
        } for role in SERVICES]

    def test_own_complete_inventory_is_accepted(self):
        validate_inventory(self.containers, self.project)

    def test_business_project_or_missing_services_are_refused(self):
        for containers, project in [(self.containers, 'labelhub'), (self.containers[:-1], self.project)]:
            with self.assertRaises(ValueError):
                validate_inventory(containers, project)

    def test_external_volume_network_and_writable_bind_are_refused(self):
        for change in ('volume', 'network', 'bind'):
            containers = copy.deepcopy(self.containers)
            if change == 'volume':
                containers[0]['Mounts'][0]['Name'] = 'business_data'
            elif change == 'network':
                containers[0]['NetworkSettings']['Networks'] = {'business': {}}
            else:
                containers[0]['Mounts'] = [{'Type': 'bind', 'Destination': '/controlled_model.py', 'RW': True}]
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_inventory(containers, self.project)


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.server = ModelServer(('127.0.0.1', 0), 'test-control', 'test-run')
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, path, body=None, headers=None):
        with urlopen(Request(self.base + path, data=None if body is None else json.dumps(body).encode(), headers=headers or {}), timeout=2) as response:
            return json.load(response)

    def test_control_requires_token_and_valid_mode(self):
        with self.assertRaises(HTTPError) as failure:
            self.request('/control', {'mode': 'valid'})
        self.assertEqual(failure.exception.code, 403)
        for mode in ['typo', [], {}]:
            with self.subTest(mode=mode), self.assertRaises(HTTPError) as failure:
                self.request('/control', {'mode': mode}, {'X-Control-Token': 'test-control'})
            self.assertEqual(failure.exception.code, 400)
        self.assertEqual(self.request('/control', headers={'X-Control-Token': 'test-control'})['requests'], [])

    def test_unknown_or_unstructured_model_requests_are_rejected(self):
        for body in [{}, {'messages': [{'content': 'unstructured'}]}, {'messages': [{'content': []}]}]:
            with self.assertRaises(HTTPError) as failure:
                self.request('/v1/chat/completions', body, {'Authorization': 'Bearer controlled-e2e-only'})
            self.assertEqual(failure.exception.code, 422)

    def test_invalid_fixture_is_not_silently_repaired_and_does_not_leave_gate_closed(self):
        self.request('/control', {'mode': 'assist-invalid', 'holdReview': True}, {'X-Control-Token': 'test-control'})
        result = self.request('/v1/chat/completions', {'messages': [{'content': json.dumps({
            'version': 'ai-workflow-v1', 'objective': 'SUGGEST_ANNOTATION', 'sourceMaterial': {'text': 'synthetic'},
        })}]}, {'Authorization': 'Bearer controlled-e2e-only'})
        self.assertEqual(json.loads(result['choices'][0]['message']['content']), {'output': 123})
        self.request('/control', {'reset': True, 'holdReview': False}, {'X-Control-Token': 'test-control'})
        self.assertTrue(self.server.release.is_set())
        self.assertEqual(self.server.requests, [])


if __name__ == '__main__':
    unittest.main()
