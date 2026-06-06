"""集成测试：标注作答流程（TC-ANS-01~06，含 A1 题目导航 / A2 LLM 辅助）。"""
from tests.helpers import setup_published_task


def _claim(client, auth, task_id):
    resp = client.post(f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"])
    assert resp.status_code == 201, resp.text
    return resp.json()["context"]["assignment"]["id"]


def test_claim_creates_assignment(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])
    assert asn_id.startswith("asn_")


def test_get_assignment_context(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])
    resp = client.get(f"/api/v1/assignments/{asn_id}", headers=auth["LABELER"])
    assert resp.status_code == 200
    assert resp.json()["assignment"]["id"] == asn_id


def test_save_draft_then_submit(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])

    r_draft = client.put(
        f"/api/v1/assignments/{asn_id}/draft",
        json={"answers": {"summary": "草稿内容"}, "clientRevision": 0},
        headers=auth["LABELER"],
    )
    assert r_draft.status_code == 200
    assert r_draft.json()["validation"]["valid"] is True

    r_submit = client.post(
        f"/api/v1/assignments/{asn_id}/submit",
        json={"answers": {"summary": "最终答案"}},
        headers=auth["LABELER"],
    )
    assert r_submit.status_code == 201
    # 无 ReviewConfig → 不入队 Celery，状态停在 AI_REVIEWING
    assert r_submit.json()["submission"]["status"] == "AI_REVIEWING"


def test_submit_invalid_field_rejected(client, auth, db_session):
    """提交未在 Schema 中的字段 → validation.valid=False。"""
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])
    r_submit = client.post(
        f"/api/v1/assignments/{asn_id}/submit",
        json={"answers": {"not_a_field": "x"}},
        headers=auth["LABELER"],
    )
    # 提交成功创建 submission，但校验快照标记 invalid
    assert r_submit.status_code == 201
    assert r_submit.json()["validation"]["valid"] is False


# ---------------------------------------------------------------------------
# A1：题目导航
# ---------------------------------------------------------------------------
def test_list_assignment_items(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"], items=3)
    asn_id = _claim(client, auth, ctx["task_id"])
    resp = client.get(f"/api/v1/assignments/{asn_id}/items", headers=auth["LABELER"])
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 3
    assert 0 <= data["currentIndex"] < 3
    assert len(data["items"]) == 3


def test_list_items_nonexistent_assignment_404(client, auth, db_session):
    setup_published_task(client, db_session, auth["OWNER"])
    resp = client.get("/api/v1/assignments/asn_ghost/items", headers=auth["LABELER"])
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# A2：LLM 辅助（无外部 LLM，验证分支与权限）
# ---------------------------------------------------------------------------
def test_llm_assist_rejects_non_llm_node(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])
    resp = client.post(
        f"/api/v1/assignments/{asn_id}/llm-assist",
        json={"nodeId": "node-text-1", "answers": {}},
        headers=auth["LABELER"],
    )
    assert resp.status_code == 422
    assert "llm.assist" in resp.json()["message"]


def test_llm_assist_unknown_node_422(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])
    resp = client.post(
        f"/api/v1/assignments/{asn_id}/llm-assist",
        json={"nodeId": "ghost", "answers": {}},
        headers=auth["LABELER"],
    )
    assert resp.status_code == 422


def test_llm_assist_calls_model_with_llm_node(client, auth, db_session):
    """带 llm.assist 节点：会走到模型调用，无有效 key → 502 LLM_ASSIST_FAILED。"""
    schema = {"nodes": [
        {"id": "node-text-1", "type": "input.text", "name": "summary", "label": "摘要"},
        {"id": "node-llm-1", "type": "llm.assist", "promptTemplate": "生成摘要",
         "modelPolicyId": "mp_demo",
         "outputBindings": [{"toFieldName": "summary", "from": "$", "mode": "REPLACE", "requireUserConfirm": True}]},
    ]}
    ctx = setup_published_task(client, db_session, auth["OWNER"], schema=schema)
    asn_id = _claim(client, auth, ctx["task_id"])
    resp = client.post(
        f"/api/v1/assignments/{asn_id}/llm-assist",
        json={"nodeId": "node-llm-1", "answers": {"summary": "draft"}},
        headers=auth["LABELER"],
    )
    assert resp.status_code == 502
    assert resp.json()["code"] == "LLM_ASSIST_FAILED"
