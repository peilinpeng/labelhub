"""集成测试：题目批量编辑（§4.1 数据集管理·批量编辑，O4）。

覆盖 POST /api/v1/tasks/{task_id}/items/batch-update：
  - 批量改 status / sourcePayload
  - 越权（LABELER）→ 403
  - 跨任务 / 不存在 item → 404（整体拒绝，不部分提交）
"""
from tests.helpers import create_task, publish_schema, add_item, publish_task


def _published_task_with_items(client, db_session, auth_owner, n=3):
    task = create_task(client, auth_owner)
    sv = publish_schema(client, auth_owner, task["id"])
    item_ids = [add_item(db_session, task["id"]) for _ in range(n)]
    publish_task(client, auth_owner, task["id"], sv)
    return task["id"], item_ids


def test_batch_update_status(client, auth, db_session):
    task_id, item_ids = _published_task_with_items(client, db_session, auth["OWNER"])
    resp = client.post(
        f"/api/v1/tasks/{task_id}/items/batch-update",
        json={"itemIds": item_ids, "status": "DISABLED"},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["updatedCount"] == len(item_ids)
    assert all(it["status"] == "DISABLED" for it in data["items"])


def test_batch_update_source_payload(client, auth, db_session):
    task_id, item_ids = _published_task_with_items(client, db_session, auth["OWNER"], n=2)
    resp = client.post(
        f"/api/v1/tasks/{task_id}/items/batch-update",
        json={"itemIds": item_ids, "sourcePayload": {"text": "批量覆盖"}},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 200, resp.text
    assert all(it["sourcePayload"] == {"text": "批量覆盖"} for it in resp.json()["items"])


def test_batch_update_requires_owner(client, auth, db_session):
    task_id, item_ids = _published_task_with_items(client, db_session, auth["OWNER"], n=1)
    resp = client.post(
        f"/api/v1/tasks/{task_id}/items/batch-update",
        json={"itemIds": item_ids, "status": "DISABLED"},
        headers=auth["LABELER"],
    )
    assert resp.status_code == 403


def test_batch_update_rejects_foreign_item(client, auth, db_session):
    """itemIds 含不属于该任务的 item → 整体 404，不部分提交。"""
    task_a, items_a = _published_task_with_items(client, db_session, auth["OWNER"], n=2)
    task_b, items_b = _published_task_with_items(client, db_session, auth["OWNER"], n=1)

    resp = client.post(
        f"/api/v1/tasks/{task_a}/items/batch-update",
        json={"itemIds": items_a + items_b, "status": "DISABLED"},  # 混入 task_b 的 item
        headers=auth["OWNER"],
    )
    assert resp.status_code == 404, resp.text

    # 整体拒绝：task_a 的 item 不应被改动
    check = client.get(f"/api/v1/tasks/{task_a}/items", headers=auth["OWNER"]).json()
    assert all(it["status"] == "AVAILABLE" for it in check["items"])


def test_batch_update_empty_item_ids_rejected(client, auth, db_session):
    task_id, _ = _published_task_with_items(client, db_session, auth["OWNER"], n=1)
    resp = client.post(
        f"/api/v1/tasks/{task_id}/items/batch-update",
        json={"itemIds": [], "status": "DISABLED"},
        headers=auth["OWNER"],
    )
    assert resp.status_code == 422  # min_length=1 校验
