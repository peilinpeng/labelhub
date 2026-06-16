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

class _DimensionMsg:
    content = """### 各维度打分佐证说明
1. 相关性3分：回答基本相关，但遗漏了关键事实。
2. 准确性2分：存在事实错误，需要人工复核。
3. 合规性4分：基本符合格式要求，但总结部分偏长。
4. 安全性5分：未发现明显安全风险。
### 一句话结论
建议人工复核后再提交。"""


class _DimensionChoice:
    message = _DimensionMsg()


class _DimensionResp:
    choices = [_DimensionChoice()]
    usage = _FakeUsage()


class _DimensionCompletions:
    def create(self, *a, **k):
        return _DimensionResp()


class _DimensionChat:
    completions = _DimensionCompletions()


class _DimensionOpenAI:
    def __init__(self, *a, **k):
        self.chat = _DimensionChat()


_LLM_SCHEMA = {"nodes": [
    {"id": "node-text-1", "type": "input.text", "name": "summary", "label": "摘要"},
    {"id": "node-llm-1", "type": "llm.assist", "promptTemplate": "生成摘要",
     "promptTemplateId": "pt_demo_v3", "modelPolicyId": "mp_demo", "assistType": "SUMMARY",
     "outputBindings": [{"toFieldName": "summary", "from": "$", "mode": "REPLACE", "requireUserConfirm": True}]},
]}

_DIMENSION_SCHEMA = {"nodes": [
    {"id": "node-rel", "type": "input.text", "name": "relevance", "label": "相关性"},
    {"id": "node-acc", "type": "input.text", "name": "accuracy", "label": "准确性"},
    {"id": "node-com", "type": "input.text", "name": "compliance", "label": "格式合规"},
    {"id": "node-safe", "type": "input.text", "name": "safety", "label": "安全性"},
    {"id": "node-llm-dimensions", "type": "llm.assist", "promptTemplate": "按维度检查",
     "promptTemplateId": "pt_dimensions_v1", "modelPolicyId": "mp_demo", "assistType": "QUALITY_CHECK",
     "outputBindings": [
         {"toFieldName": "relevance", "from": "$.relevance", "mode": "REPLACE", "requireUserConfirm": True},
         {"toFieldName": "accuracy", "from": "$.accuracy", "mode": "REPLACE", "requireUserConfirm": True},
         {"toFieldName": "compliance", "from": "$.compliance", "mode": "REPLACE", "requireUserConfirm": True},
         {"toFieldName": "safety", "from": "$.safety", "mode": "REPLACE", "requireUserConfirm": True},
     ]},
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


def test_llm_assist_splits_markdown_by_dimension(client, auth, db_session, monkeypatch):
    """多 outputBindings 时按维度拆分短评，不把整段 Markdown 总评重复塞进每个字段。"""
    monkeypatch.setattr("openai.OpenAI", _DimensionOpenAI)
    ctx = setup_published_task(client, db_session, auth["OWNER"], schema=_DIMENSION_SCHEMA)
    asn = client.post(f"/api/v1/tasks/{ctx['task_id']}/claim", json={}, headers=auth["LABELER"]).json()["context"]["assignment"]["id"]

    resp = client.post(
        f"/api/v1/assignments/{asn}/llm-assist",
        json={"nodeId": "node-llm-dimensions", "answers": {}},
        headers=auth["LABELER"],
    )
    assert resp.status_code == 200, resp.text
    d = resp.json()
    assert d["output"]["summary"] == "建议人工复核后再提交。"
    assert set(d["suggestedPatch"].keys()) == {"relevance", "accuracy", "compliance", "safety"}
    assert d["suggestedPatch"]["relevance"] == "回答基本相关，但遗漏了关键事实。"
    assert d["suggestedPatch"]["accuracy"] == "存在事实错误，需要人工复核。"
    assert d["suggestedPatch"]["compliance"] == "基本符合格式要求，但总结部分偏长。"
    assert d["suggestedPatch"]["safety"] == "未发现明显安全风险。"
    assert len(set(d["suggestedPatch"].values())) == 4
    assert all("###" not in value for value in d["suggestedPatch"].values())
