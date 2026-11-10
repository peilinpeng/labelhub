"""仅用于隔离工程验收的确定性 HTTP 模型；不调用外部服务，不记录请求正文。"""
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import threading
import time

MODES = {'valid', 'assist-invalid', 'review-invalid', 'review-low-confidence', 'review-contradiction', 'review-return'}
SUGGESTION = '受控建议：材料完整且标注清晰。'


class ModelServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, token, run_id):
        if not token or not run_id:
            raise ValueError('必须由隔离验收入口提供控制凭据和运行标识。')
        super().__init__(address, Handler)
        self.token, self.run_id = token, run_id
        self.lock = threading.Lock()
        self.mode = 'valid'
        self.requests = []
        self.release = threading.Event()
        self.release.set()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, payload):
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def authorized(self):
        return hmac.compare_digest(self.headers.get('X-Control-Token', ''), self.server.token)

    def do_GET(self):
        if self.path == '/health':
            self.respond(200, {'status': 'ok'})
        elif self.path == '/control' and self.authorized():
            with self.server.lock:
                self.respond(200, {'runId': self.server.run_id, 'requests': list(self.server.requests)})
        else:
            self.respond(403, {'error': '禁止访问'})

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 512 * 1024:
                raise ValueError()
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError()
        except (ValueError, json.JSONDecodeError):
            self.respond(400, {'error': '请求非法'})
            return
        if self.path == '/control':
            if not self.authorized():
                self.respond(403, {'error': '禁止访问'})
                return
            mode = body.get('mode', 'valid')
            if set(body) - {'mode', 'reset', 'holdReview'} or not isinstance(mode, str) or mode not in MODES:
                self.respond(400, {'error': '未知控制参数'})
                return
            if any(key in body and not isinstance(body[key], bool) for key in ('reset', 'holdReview')):
                self.respond(400, {'error': '控制参数类型错误'})
                return
            with self.server.lock:
                if body.get('reset'):
                    self.server.requests.clear()
                if 'mode' in body:
                    self.server.mode = body['mode']
                if 'holdReview' in body:
                    self.server.release.clear() if body['holdReview'] else self.server.release.set()
            self.respond(200, {'runId': self.server.run_id})
            return
        if self.path != '/v1/chat/completions' or self.headers.get('Authorization') != 'Bearer controlled-e2e-only':
            self.respond(403, {'error': '仅允许测试模型请求'})
            return
        # 严格识别当前结构化信封，输入协议漂移必须让测试失败。
        try:
            envelopes = []
            for message in body['messages']:
                content = message['content']
                if not isinstance(content, str):
                    raise ValueError()
                position = content.find('{')
                if position >= 0:
                    try:
                        value = json.loads(content[position:])
                    except ValueError:
                        continue
                    if isinstance(value, dict) and value.get('version') == 'ai-workflow-v1':
                        envelopes.append(value)
            if len(envelopes) != 1 or envelopes[0]['objective'] not in ('SUGGEST_ANNOTATION', 'VERIFY_ANNOTATION'):
                raise ValueError()
            envelope = envelopes[0]
        except (KeyError, TypeError, ValueError):
            self.respond(422, {'error': '缺少唯一结构化信封'})
            return
        assist = envelope['objective'] == 'SUGGEST_ANNOTATION'
        with self.server.lock:
            mode = self.server.mode
            self.server.requests.append({'kind': 'assist' if assist else 'review', 'envelope': envelope, 'mode': mode})
            self.server.requests = self.server.requests[-64:]
        if not assist and not self.server.release.wait(25):
            self.respond(504, {'error': '测试未释放预审屏障'})
            return
        if assist:
            result = {'output': 123 if mode == 'assist-invalid' else SUGGESTION}
        else:
            result = {'decision': 'PASS', 'totalScore': 95, 'dimensionScores': [
                {'key': 'correctness', 'score': 95, 'reason': '合成材料支持标注'}],
                'fieldIssues': [], 'summary': '确定性工程验收', 'confidence': .95}
            if mode == 'review-invalid':
                result['confidence'] = None
            elif mode == 'review-low-confidence':
                result['confidence'] = .1
            elif mode in ('review-contradiction', 'review-return'):
                result['totalScore'] = 1
                result['dimensionScores'][0]['score'] = 1
                if mode == 'review-return':
                    result['decision'] = 'RETURN'
        self.respond(200, {'id': 'controlled', 'object': 'chat.completion', 'created': int(time.time()),
            'model': 'controlled-e2e', 'choices': [{'index': 0, 'message': {'role': 'assistant',
            'content': json.dumps(result, ensure_ascii=False)}, 'finish_reason': 'stop'}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 10, 'total_tokens': 20}})


if __name__ == '__main__':
    ModelServer(('0.0.0.0', 8010), os.environ['CONTROLLED_MODEL_TOKEN'], os.environ['CONTROLLED_AI_RUN_ID']).serve_forever()
