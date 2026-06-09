"""集成测试：任务生命周期（TC-TASK-01~06）。"""
from tests.helpers import create_task, publish_schema, add_item, publish_task


def test_create_task_is_draft(client, auth):
    task = create_task(client, auth["OWNER"])
    assert task["status"] == "DRAFT"
    assert task["id"].startswith("task_")


def test_list_tasks_returns_created(client, auth):
    create_task(client, auth["OWNER"], title="任务A")
    create_task(client, auth["OWNER"], title="任务B")
    resp = client.get("/api/v1/tasks", headers=auth["OWNER"])
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 2
    titles = {t["title"] for t in data["tasks"]}
    assert {"任务A", "任务B"} <= titles


def test_publish_task_transitions_to_published(client, auth, db_session):
    task = create_task(client, auth["OWNER"])
    sv = publish_schema(client, auth["OWNER"], task["id"])
    add_item(db_session, task["id"])
    published = publish_task(client, auth["OWNER"], task["id"], sv)
    assert published["status"] == "PUBLISHED"


def test_pause_resume_end_flow(client, auth, db_session):
    task = create_task(client, auth["OWNER"])
    sv = publish_schema(client, auth["OWNER"], task["id"])
    add_item(db_session, task["id"])
    publish_task(client, auth["OWNER"], task["id"], sv)
    tid = task["id"]

    r_pause = client.post(f"/api/v1/tasks/{tid}/pause", json={}, headers=auth["OWNER"])
    assert r_pause.status_code == 200
    assert r_pause.json()["task"]["status"] == "PAUSED"

    r_resume = client.post(f"/api/v1/tasks/{tid}/resume", json={}, headers=auth["OWNER"])
    assert r_resume.status_code == 200
    assert r_resume.json()["task"]["status"] == "PUBLISHED"

    r_end = client.post(f"/api/v1/tasks/{tid}/end", json={}, headers=auth["OWNER"])
    assert r_end.status_code == 200
    assert r_end.json()["task"]["status"] == "ENDED"


def test_paused_task_blocks_claim(client, auth, db_session):
    """TC-TASK-05：暂停后标注员无法领取新题目。"""
    task = create_task(client, auth["OWNER"])
    sv = publish_schema(client, auth["OWNER"], task["id"])
    add_item(db_session, task["id"])
    publish_task(client, auth["OWNER"], task["id"], sv)
    client.post(f"/api/v1/tasks/{task['id']}/pause", json={}, headers=auth["OWNER"])

    resp = client.post(f"/api/v1/tasks/{task['id']}/claim", json={}, headers=auth["LABELER"])
    assert resp.status_code == 422  # 任务未发布，无法领取


def test_publish_with_foreign_schema_version_404(client, auth):
    """用不属于该任务的 schemaVersionId 发布应失败。"""
    task = create_task(client, auth["OWNER"])
    resp = client.post(
        f"/api/v1/tasks/{task['id']}/publish",
        json={"schemaVersionId": "sv_nonexistent", "reviewDisabledExplicitly": False},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 404


# —— P2-E：发布前置校验（数据集已导入 + AI审核已配置/显式禁用）——

def test_publish_without_items_rejected(client, auth):
    """无可领取题目 → 发布被拒 422。"""
    task = create_task(client, auth["OWNER"])
    sv = publish_schema(client, auth["OWNER"], task["id"])
    resp = client.post(
        f"/api/v1/tasks/{task['id']}/publish",
        json={"schemaVersionId": sv, "reviewDisabledExplicitly": True},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 422
    assert "数据集" in resp.json()["message"]


def test_publish_without_reviewconfig_not_disabled_rejected(client, auth, db_session):
    """有题目但未配 ReviewConfig 且未显式禁用 → 422。"""
    task = create_task(client, auth["OWNER"])
    sv = publish_schema(client, auth["OWNER"], task["id"])
    add_item(db_session, task["id"])
    resp = client.post(
        f"/api/v1/tasks/{task['id']}/publish",
        json={"schemaVersionId": sv, "reviewDisabledExplicitly": False},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 422
    assert "AI 审核" in resp.json()["message"]


def test_publish_with_review_disabled_ok(client, auth, db_session):
    """有题目 + 显式禁用审核 → 发布成功。"""
    task = create_task(client, auth["OWNER"])
    sv = publish_schema(client, auth["OWNER"], task["id"])
    add_item(db_session, task["id"])
    resp = client.post(
        f"/api/v1/tasks/{task['id']}/publish",
        json={"schemaVersionId": sv, "reviewDisabledExplicitly": True},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 200
    assert resp.json()["task"]["status"] == "PUBLISHED"


def test_publish_with_reviewconfig_ok(client, auth, db_session):
    """有题目 + 已配 ReviewConfig（不显式禁用）→ 发布成功。"""
    from app.models.review import ReviewConfig
    from uuid import uuid4
    task = create_task(client, auth["OWNER"])
    sv = publish_schema(client, auth["OWNER"], task["id"])
    add_item(db_session, task["id"])
    db_session.add(ReviewConfig(
        id="cfg_" + uuid4().hex, task_id=task["id"], enabled=True,
        model_policy_id="ep-x", prompt_template="t",
        dimensions_json=[], thresholds_json={}, conclusion_mapping_json={}, max_retries=3,
    ))
    db_session.commit()
    resp = client.post(
        f"/api/v1/tasks/{task['id']}/publish",
        json={"schemaVersionId": sv, "reviewDisabledExplicitly": False},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 200
    assert resp.json()["task"]["status"] == "PUBLISHED"


def test_task_stats_counts(client, auth, db_session):
    """任务统计：数据集总数、进行中（已领取未提交）、剩余配额。"""
    from tests.helpers import setup_published_task

    ctx = setup_published_task(client, db_session, auth["OWNER"], items=3)
    task_id = ctx["task_id"]

    # 初始：3 题，无领取
    r0 = client.get(f"/api/v1/tasks/{task_id}/stats", headers=auth["OWNER"])
    assert r0.status_code == 200, r0.text
    s0 = r0.json()
    assert s0["datasetTotal"] == 3
    assert s0["inProgress"] == 0
    assert s0["accepted"] == 0
    assert s0["progressPercent"] == 0

    # 领取一题 → 进行中 +1，剩余配额 -1
    client.post(f"/api/v1/tasks/{task_id}/claim", json={}, headers=auth["LABELER"])
    s1 = client.get(f"/api/v1/tasks/{task_id}/stats", headers=auth["OWNER"]).json()
    assert s1["inProgress"] == 1
    if s1["quotaTotal"] is not None:
        assert s1["quotaRemaining"] == s1["quotaTotal"] - 1


def test_task_stats_requires_owner(client, auth, db_session):
    from tests.helpers import setup_published_task

    ctx = setup_published_task(client, db_session, auth["OWNER"])
    resp = client.get(f"/api/v1/tasks/{ctx['task_id']}/stats", headers=auth["LABELER"])
    assert resp.status_code == 403
