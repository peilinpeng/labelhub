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
