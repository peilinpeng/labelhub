"""集成测试：Schema 版本管理（TC-DES-09 草稿保存 / TC-DES-10 发布冻结 / TC-DES-11 旧版本渲染兼容）。

对应 docs/backend-optimization-plan.md Part D3 计划表的 test_schema_version.py。
覆盖后端 schema 端点：
  PUT  /api/v1/tasks/{id}/schema/draft   （save_schema_draft，revision 自增 + 并发冲突）
  POST /api/v1/tasks/{id}/schema/publish （publish_schema_version，发布为不可变快照）
  GET  /api/v1/schema-versions/{id}      （get_schema_version，旧版本可取回）
"""
from tests.helpers import create_task


# ── 测试用 Schema：V1 含两个字段，V2 删除其中一个字段 ──────────────────────
SCHEMA_V1 = {
    "nodes": [
        {
            "id": "node-summary",
            "type": "input.text",
            "name": "summary",
            "label": "摘要",
            "required": True,
            "validationRules": [],
        },
        {
            "id": "node-category",
            "type": "choice.radio",
            "name": "category",
            "label": "分类",
            "required": False,
            "validationRules": [],
        },
    ]
}

# V2：删除 category 字段（模拟模板演进）
SCHEMA_V2 = {
    "nodes": [
        {
            "id": "node-summary",
            "type": "input.text",
            "name": "summary",
            "label": "摘要（V2 改名）",
            "required": True,
            "validationRules": [],
        }
    ]
}


def _save_draft(client, auth_owner, task_id, schema, base_revision=None):
    body = {"schema": schema}
    if base_revision is not None:
        body["baseSchemaDraftRevision"] = base_revision
    return client.put(
        f"/api/v1/tasks/{task_id}/schema/draft", json=body, headers=auth_owner
    )


def _publish(client, auth_owner, task_id, revision):
    return client.post(
        f"/api/v1/tasks/{task_id}/schema/publish",
        json={"schemaDraftRevision": revision},
        headers=auth_owner,
    )


# ── TC-DES-09：Schema 草稿保存，schemaDraftRevision 自增 ────────────────────

def test_save_draft_increments_revision(client, auth):
    """TC-DES-09：每次保存草稿，schemaDraftRevision 自动 +1。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]

    r1 = _save_draft(client, auth["OWNER"], tid, SCHEMA_V1)
    assert r1.status_code == 200, r1.text
    assert r1.json()["schemaDraftRevision"] == 1
    assert r1.json()["validation"]["valid"] is True

    r2 = _save_draft(client, auth["OWNER"], tid, SCHEMA_V2)
    assert r2.status_code == 200, r2.text
    assert r2.json()["schemaDraftRevision"] == 2
    # 草稿内容已被覆盖为最新提交
    assert r2.json()["schema"] == SCHEMA_V2


def test_get_draft_returns_latest(client, auth):
    """TC-DES-09：GET 草稿返回最新内容与修订号。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]
    _save_draft(client, auth["OWNER"], tid, SCHEMA_V1)
    _save_draft(client, auth["OWNER"], tid, SCHEMA_V2)

    resp = client.get(f"/api/v1/tasks/{tid}/schema/draft", headers=auth["OWNER"])
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["schemaDraftRevision"] == 2
    assert data["schema"] == SCHEMA_V2


def test_save_draft_stale_base_revision_conflict_409(client, auth):
    """TC-DES-09：传入过期的 baseSchemaDraftRevision 触发并发冲突 409。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]
    _save_draft(client, auth["OWNER"], tid, SCHEMA_V1)  # revision -> 1

    # 基于过期修订号（0）再次保存，应被并发控制拦截
    resp = _save_draft(client, auth["OWNER"], tid, SCHEMA_V2, base_revision=0)
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "SCHEMA_DRAFT_CONFLICT"


# ── TC-DES-10：已发布模板冻结（发布快照不可变）────────────────────────────

def test_publish_creates_immutable_snapshot(client, auth):
    """TC-DES-10：发布后继续编辑草稿，已发布版本快照保持冻结、不受影响。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]

    r_draft = _save_draft(client, auth["OWNER"], tid, SCHEMA_V1)
    rev = r_draft.json()["schemaDraftRevision"]
    r_pub = _publish(client, auth["OWNER"], tid, rev)
    assert r_pub.status_code == 201, r_pub.text
    sv_id = r_pub.json()["schemaVersion"]["id"]
    assert r_pub.json()["schemaVersion"]["schemaVersionNo"] == 1

    # 发布后继续修改草稿（模拟“创建新版本”的编辑），草稿 revision 递增
    _save_draft(client, auth["OWNER"], tid, SCHEMA_V2)

    # 已发布版本快照仍是 V1，未被后续草稿编辑污染（冻结）
    resp = client.get(f"/api/v1/schema-versions/{sv_id}", headers=auth["OWNER"])
    assert resp.status_code == 200, resp.text
    assert resp.json()["schema"] == SCHEMA_V1


def test_publish_with_stale_revision_conflict_409(client, auth):
    """TC-DES-10：发布时 schemaDraftRevision 与当前草稿不一致 → 409。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]
    _save_draft(client, auth["OWNER"], tid, SCHEMA_V1)  # 当前 revision = 1

    resp = _publish(client, auth["OWNER"], tid, 99)  # 错误的修订号
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "SCHEMA_DRAFT_CONFLICT"


def test_publish_invalid_schema_rejected_422(client, auth):
    """TC-DES-10：结构非法的草稿不可发布 → 422 SCHEMA_INVALID。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]
    # FieldNode 缺少 name → 校验失败
    bad_schema = {"nodes": [{"id": "n1", "type": "input.text"}]}
    r_draft = _save_draft(client, auth["OWNER"], tid, bad_schema)
    assert r_draft.status_code == 200
    assert r_draft.json()["validation"]["valid"] is False  # 草稿可存，但不可发布
    rev = r_draft.json()["schemaDraftRevision"]

    resp = _publish(client, auth["OWNER"], tid, rev)
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "SCHEMA_INVALID"


# ── TC-DES-11：旧版本渲染兼容性（历史版本可取回，字段不丢失）──────────────

def test_old_version_retrievable_after_new_publish(client, auth):
    """TC-DES-11：发布 V2（删字段）后，基于 V1 的旧版本仍可完整取回、旧字段不丢失。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]

    # 发布 V1（含 summary + category）
    rev1 = _save_draft(client, auth["OWNER"], tid, SCHEMA_V1).json()["schemaDraftRevision"]
    v1 = _publish(client, auth["OWNER"], tid, rev1).json()["schemaVersion"]
    assert v1["schemaVersionNo"] == 1

    # 演进到 V2（删除 category），再次发布
    rev2 = _save_draft(client, auth["OWNER"], tid, SCHEMA_V2).json()["schemaDraftRevision"]
    v2 = _publish(client, auth["OWNER"], tid, rev2).json()["schemaVersion"]
    assert v2["schemaVersionNo"] == 2

    # V1 快照仍含两个字段（旧答卷可按 V1 渲染，category 不丢失）
    r_v1 = client.get(f"/api/v1/schema-versions/{v1['id']}", headers=auth["OWNER"])
    assert r_v1.status_code == 200, r_v1.text
    v1_names = {n.get("name") for n in r_v1.json()["schema"]["nodes"]}
    assert v1_names == {"summary", "category"}

    # V2 快照只含 summary
    r_v2 = client.get(f"/api/v1/schema-versions/{v2['id']}", headers=auth["OWNER"])
    assert r_v2.status_code == 200, r_v2.text
    v2_names = {n.get("name") for n in r_v2.json()["schema"]["nodes"]}
    assert v2_names == {"summary"}


def test_schema_version_accessible_by_labeler_and_reviewer(client, auth):
    """TC-DES-11：LABELER / REVIEWER 均可读取 Schema 版本快照（用于渲染历史答卷）。"""
    task = create_task(client, auth["OWNER"])
    tid = task["id"]
    rev = _save_draft(client, auth["OWNER"], tid, SCHEMA_V1).json()["schemaDraftRevision"]
    sv_id = _publish(client, auth["OWNER"], tid, rev).json()["schemaVersion"]["id"]

    for role in ("LABELER", "REVIEWER"):
        resp = client.get(f"/api/v1/schema-versions/{sv_id}", headers=auth[role])
        assert resp.status_code == 200, f"{role}: {resp.text}"
        assert resp.json()["id"] == sv_id


def test_get_nonexistent_schema_version_404(client, auth):
    """TC-DES-11 边界：取不存在的版本 → 404。"""
    resp = client.get("/api/v1/schema-versions/sv_does_not_exist", headers=auth["OWNER"])
    assert resp.status_code == 404


# ── AI 生成 Schema 草稿（POST /tasks/{id}/schema/ai-generate）──────────────
# 用桩替换 OpenAI 调用（参考 test_llm_assist_metadata.py 的做法）。

import json as _json
from app.models.llm import LLMCallLog


class _FakeUsage:
    prompt_tokens = 30
    completion_tokens = 20
    total_tokens = 50


def _make_fake_openai(content: str):
    class _FakeMsg:
        def __init__(self):
            self.content = content

    class _FakeChoice:
        def __init__(self):
            self.message = _FakeMsg()

    class _FakeResp:
        def __init__(self):
            self.choices = [_FakeChoice()]
            self.usage = _FakeUsage()

    class _FakeCompletions:
        def create(self, *a, **k):
            return _FakeResp()

    class _FakeChat:
        def __init__(self):
            self.completions = _FakeCompletions()

    class _FakeOpenAI:
        def __init__(self, *a, **k):
            self.chat = _FakeChat()

    return _FakeOpenAI


# 一段合法的 LabelHubSchema JSON（模型“生成”的返回内容）
_GENERATED_SCHEMA_JSON = _json.dumps({
    "nodes": [
        {"id": "n-title", "type": "show.text", "label": "原文"},
        {"id": "n-summary", "type": "input.textarea", "name": "summary", "label": "摘要", "required": True},
        {"id": "n-sentiment", "type": "choice.radio", "name": "sentiment", "label": "情感"},
    ]
}, ensure_ascii=False)


def test_ai_generate_returns_schema_and_trace(client, auth, db_session, monkeypatch):
    """前端 owner.ts generateSchema：返回 schemaDraft + validation + generatedBy 追溯信息。"""
    monkeypatch.setattr("openai.OpenAI", _make_fake_openai(_GENERATED_SCHEMA_JSON))
    task = create_task(client, auth["OWNER"])

    resp = client.post(
        f"/api/v1/tasks/{task['id']}/schema/ai-generate",
        json={"taskDescription": "对新闻做摘要并标注情感", "preferredNodeTypes": ["input.textarea", "choice.radio"]},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 200, resp.text
    d = resp.json()
    # 生成的 schema 草稿
    names = {n.get("name") for n in d["schemaDraft"]["nodes"]}
    assert {"summary", "sentiment"} <= names
    assert d["validation"]["valid"] is True
    # 可追溯信息（TC-AI-07）
    assert len(d["generatedBy"]["promptSnapshotHash"]) == 64
    assert d["generatedBy"]["llmCallId"].startswith("llm_")
    # modelPolicyId 取自 settings.DOUBAO_MODEL（测试环境可能为空），只校验类型
    assert isinstance(d["generatedBy"]["modelPolicyId"], str)

    # DB 落一条成功的 SCHEMA_GENERATION 日志
    log = db_session.query(LLMCallLog).filter_by(id=d["generatedBy"]["llmCallId"]).first()
    assert log is not None
    assert log.purpose == "SCHEMA_GENERATION"
    assert log.status == "SUCCEEDED"
    assert log.total_tokens == 50


def test_ai_generate_invalid_json_marks_failed(client, auth, db_session, monkeypatch):
    """模型返回非 JSON → 502 LLM_ASSIST_FAILED，且 LLMCallLog 标记 FAILED。"""
    monkeypatch.setattr("openai.OpenAI", _make_fake_openai("抱歉，我无法生成。"))
    task = create_task(client, auth["OWNER"])

    resp = client.post(
        f"/api/v1/tasks/{task['id']}/schema/ai-generate",
        json={"taskDescription": "随便"},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 502, resp.text
    assert resp.json()["code"] == "LLM_ASSIST_FAILED"

    log = db_session.query(LLMCallLog).filter_by(purpose="SCHEMA_GENERATION").first()
    assert log is not None
    assert log.status == "FAILED"


def test_ai_generate_requires_owner(client, auth, monkeypatch):
    """越权：LABELER 调用 AI 生成 Schema → 403。"""
    monkeypatch.setattr("openai.OpenAI", _make_fake_openai(_GENERATED_SCHEMA_JSON))
    task = create_task(client, auth["OWNER"])

    resp = client.post(
        f"/api/v1/tasks/{task['id']}/schema/ai-generate",
        json={"taskDescription": "x"},
        headers=auth["LABELER"],
    )
    assert resp.status_code == 403


# ── Schema Runtime Engine 兼容：BaseFieldNode.linkageRules 可选字段 ──────────
# 搭档 feature/schema-governance-upgrade 在 contracts 给 BaseFieldNode 新增了可选
# linkageRules（LabelHub runtime 联动 DSL，target = FieldNode.name）。后端 schema
# 校验/发布/取回必须容忍该字段、不丢弃、不报错。本组测试锁定这一兼容契约，
# 防止后续后端改动意外破坏对 linkageRules 的容忍。

# canonical schema：一个字段携带 linkageRules（when 复用 Expression，target=name）
_SCHEMA_WITH_LINKAGE = {
    "contractVersion": "1.1",
    "schemaId": "schema_linkage",
    "schemaDraftRevision": 1,
    "status": "DRAFT",
    "meta": {"name": "联动测试", "taskId": "t", "authorId": "u"},
    "root": {
        "id": "root", "kind": "CONTAINER", "type": "container.section", "title": "根",
        "children": [
            {"id": "f-review", "kind": "FIELD", "type": "choice.radio", "name": "review_result",
             "title": "审核结论", "required": True, "options": [
                 {"value": "approve", "label": "通过"},
                 {"value": "reject", "label": "打回"},
             ]},
            {"id": "f-reason", "kind": "FIELD", "type": "input.textarea", "name": "reject_reason",
             "title": "打回理由",
             # —— 关键：linkageRules（后端应原样保留，不解析、不校验内部结构）——
             "linkageRules": [
                 {"id": "R-reject-reason",
                  "when": {"op": "eq",
                           "left": {"kind": "path", "path": "$.answers.review_result"},
                           "right": {"kind": "literal", "value": "reject"}},
                  "effects": [
                      {"target": "reject_reason", "action": "setVisible", "value": True},
                      {"target": "reject_reason", "action": "setRequired", "value": True},
                  ]}
             ]},
        ],
    },
}


def test_linkage_rules_schema_validates(client, auth):
    """带 linkageRules 的 canonical schema 应通过后端校验（额外字段被容忍）。"""
    task = create_task(client, auth["OWNER"])
    r = client.put(
        f"/api/v1/tasks/{task['id']}/schema/draft",
        json={"schema": _SCHEMA_WITH_LINKAGE},
        headers=auth["OWNER"],
    )
    assert r.status_code == 200, r.text
    assert r.json()["validation"]["valid"] is True


def test_linkage_rules_preserved_through_publish(client, auth):
    """发布后取回版本快照，linkageRules 原样保留、target=FieldNode.name 不丢失。"""
    task = create_task(client, auth["OWNER"])
    rev = client.put(
        f"/api/v1/tasks/{task['id']}/schema/draft",
        json={"schema": _SCHEMA_WITH_LINKAGE},
        headers=auth["OWNER"],
    ).json()["schemaDraftRevision"]
    sv_id = client.post(
        f"/api/v1/tasks/{task['id']}/schema/publish",
        json={"schemaDraftRevision": rev},
        headers=auth["OWNER"],
    ).json()["schemaVersion"]["id"]

    resp = client.get(f"/api/v1/schema-versions/{sv_id}", headers=auth["OWNER"])
    assert resp.status_code == 200, resp.text
    nodes = resp.json()["schema"]["root"]["children"]
    reason = next(n for n in nodes if n.get("name") == "reject_reason")
    assert "linkageRules" in reason, "linkageRules 被后端丢弃了"
    rule = reason["linkageRules"][0]
    assert rule["effects"][0]["target"] == "reject_reason"  # target = FieldNode.name
