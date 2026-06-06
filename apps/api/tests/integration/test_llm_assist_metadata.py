"""集成测试：llm-assist 响应补 5 字段（Quality Layer E1），用桩替换 OpenAI 调用。"""
from tests.helpers import setup_published_task


class _FakeUsage:
    prompt_tokens = 10
    completion_tokens = 5
    total_tokens = 15


class _FakeMsg:
    content = "AI 生成的辅助建议"


class _FakeChoice:
    message = _FakeMsg()


class _FakeResp:
    choices = [_FakeChoice()]
    usage = _FakeUsage()


class _FakeCompletions:
    def create(self, *a, **k):
        return _FakeResp()


class _FakeChat:
    completions = _FakeCompletions()


class _FakeOpenAI:
    def __init__(self, *a, **k):
        self.chat = _FakeChat()


_LLM_SCHEMA = {"nodes": [
    {"id": "node-text-1", "type": "input.text", "name": "summary", "label": "摘要"},
    {"id": "node-llm-1", "type": "llm.assist", "promptTemplate": "生成摘要",
     "promptTemplateId": "pt_demo_v3", "modelPolicyId": "mp_demo", "assistType": "SUMMARY",
     "outputBindings": [{"toFieldName": "summary", "from": "$", "mode": "REPLACE", "requireUserConfirm": True}]},
]}


def test_llm_assist_returns_quality_metadata(client, auth, db_session, monkeypatch):
    monkeypatch.setattr("openai.OpenAI", _FakeOpenAI)
    ctx = setup_published_task(client, db_session, auth["OWNER"], schema=_LLM_SCHEMA)
    asn = client.post(f"/api/v1/tasks/{ctx['task_id']}/claim", json={}, headers=auth["LABELER"]).json()["context"]["assignment"]["id"]

    resp = client.post(
        f"/api/v1/assignments/{asn}/llm-assist",
        json={"nodeId": "node-llm-1", "answers": {"summary": "draft"}},
        headers=auth["LABELER"],
    )
    assert resp.status_code == 200, resp.text
    d = resp.json()
    # 既有字段
    assert d["output"] == "AI 生成的辅助建议"
    assert d["callId"].startswith("llm_")
    assert isinstance(d["latencyMs"], int)
    # 新增 5 字段
    assert d["promptVersionId"] == "pt_demo_v3"
    assert d["modelId"] == "mp_demo"
    assert d["assistType"] == "SUMMARY"
    assert len(d["promptSnapshotHash"]) == 64       # 后端生成的 sha256
    assert len(d["outputHash"]) == 64
    # suggestedPatch 由 outputBindings 生成
    assert d["suggestedPatch"] == {"summary": "AI 生成的辅助建议"}


def test_llm_assist_outputhash_is_canonical(client, auth, db_session, monkeypatch):
    """outputHash 由后端用 canonical-json 生成，可复算验证。"""
    from app.utils.hashing import hash_canonical_json
    monkeypatch.setattr("openai.OpenAI", _FakeOpenAI)
    ctx = setup_published_task(client, db_session, auth["OWNER"], schema=_LLM_SCHEMA)
    asn = client.post(f"/api/v1/tasks/{ctx['task_id']}/claim", json={}, headers=auth["LABELER"]).json()["context"]["assignment"]["id"]
    d = client.post(
        f"/api/v1/assignments/{asn}/llm-assist",
        json={"nodeId": "node-llm-1", "answers": {}},
        headers=auth["LABELER"],
    ).json()
    expected = hash_canonical_json({"output": d["output"], "suggestedPatch": d["suggestedPatch"]})
    assert d["outputHash"] == expected
