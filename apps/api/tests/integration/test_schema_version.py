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
