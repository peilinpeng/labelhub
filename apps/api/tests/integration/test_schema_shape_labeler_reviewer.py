"""集成测试：Labeler / Reviewer 侧返回的 schema 也归一化为 canonical 形态。

锁定 fix(api) normalize assignment/review schema payload：
即便已发布版本快照是历史简化 {nodes} 形态，claim / get assignment / review detail
这些给前端（SchemaRenderer / collectFieldNodes / schema.root）消费的接口，
也必须返回 canonical {root.children, meta.taskId, contractVersion}，不再吐 legacy {nodes}。
"""
from tests.helpers import setup_published_task


def _assert_canonical(schema: dict, task_id: str):
    """断言响应 schema 为 canonical PublishedLabelHubSchema，且字段不丢失。"""
    assert "nodes" not in schema, "顶层 legacy nodes 不应再出现"
    assert isinstance(schema.get("root"), dict), "缺少 canonical root"
    assert schema["meta"]["taskId"] == task_id, "meta.taskId 未补齐（前端崩溃根因）"
    assert schema["contractVersion"] == "1.1"
    assert schema["status"] == "PUBLISHED"
    names = {n.get("name") for n in schema["root"]["children"] if n.get("name")}
    assert "summary" in names, "原 {nodes} 字段（summary）在归一化后丢失"


def _claim(client, auth, task_id) -> str:
    resp = client.post(f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"])
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_claim_returns_canonical_schema(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])  # 用 legacy {nodes} 发布
    body = _claim(client, auth, ctx["task_id"])
    _assert_canonical(body["context"]["schema"], ctx["task_id"])
    # 发布快照版本号随 canonical 一并暴露
    assert body["context"]["schema"]["schemaVersionNo"] >= 1


def test_get_assignment_returns_canonical_schema(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])["context"]["assignment"]["id"]
    resp = client.get(f"/api/v1/assignments/{asn_id}", headers=auth["LABELER"])
    assert resp.status_code == 200, resp.text
    _assert_canonical(resp.json()["schema"], ctx["task_id"])


def test_review_detail_returns_canonical_schema(client, auth, db_session):
    ctx = setup_published_task(client, db_session, auth["OWNER"])
    asn_id = _claim(client, auth, ctx["task_id"])["context"]["assignment"]["id"]
    sub = client.post(
        f"/api/v1/assignments/{asn_id}/submit",
        json={"answers": {"summary": "最终答案"}},
        headers=auth["LABELER"],
    )
    assert sub.status_code == 201, sub.text
    submission_id = sub.json()["submission"]["id"]

    resp = client.get(f"/api/v1/review/submissions/{submission_id}", headers=auth["OWNER"])
    assert resp.status_code == 200, resp.text
    data = resp.json()
    # schema 与 schemaJson 两个字段都应是 canonical 形态
    _assert_canonical(data["schema"], ctx["task_id"])
    _assert_canonical(data["schemaJson"], ctx["task_id"])
