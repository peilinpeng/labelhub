"""集成测试公共流程辅助函数。"""
from uuid import uuid4

from app.models.dataset import DatasetItem

MINIMAL_SCHEMA = {
    "nodes": [
        {
            "id": "node-text-1",
            "type": "input.text",
            "name": "summary",
            "label": "摘要",
            "required": False,
            "validationRules": [],
        }
    ]
}


def create_task(client, auth_owner, *, title="集成测试任务", **overrides) -> dict:
    """创建任务，返回 task dict（DRAFT）。"""
    body = {
        "title": title,
        "description": "desc",
        "quota": {"total": 10},
        "distributionStrategy": {"type": "FIRST_COME_FIRST_SERVED"},
        "reviewPolicy": {"type": "SINGLE_REVIEW"},
    }
    body.update(overrides)
    resp = client.post("/api/v1/tasks", json=body, headers=auth_owner)
    assert resp.status_code == 201, resp.text
    return resp.json()["task"]


def publish_schema(client, auth_owner, task_id, schema=None) -> str:
    """保存草稿并发布 Schema，返回 schemaVersionId。"""
    schema = schema or MINIMAL_SCHEMA
    r1 = client.put(
        f"/api/v1/tasks/{task_id}/schema/draft",
        json={"schema": schema},
        headers=auth_owner,
    )
    assert r1.status_code == 200, r1.text
    rev = r1.json()["schemaDraftRevision"]
    r2 = client.post(
        f"/api/v1/tasks/{task_id}/schema/publish",
        json={"schemaDraftRevision": rev},
        headers=auth_owner,
    )
    assert r2.status_code == 201, r2.text
    return r2.json()["schemaVersion"]["id"]


def add_item(db_session, task_id, *, payload=None) -> str:
    """直接向 DB 插入一条可领取题目，返回 item_id。"""
    item = DatasetItem(
        id="item_" + uuid4().hex[:10],
        task_id=task_id,
        external_key="k_" + uuid4().hex[:6],
        source_payload=payload or {"text": "测试题目内容"},
        status="AVAILABLE",
    )
    db_session.add(item)
    db_session.commit()
    return item.id


def publish_task(client, auth_owner, task_id, schema_version_id) -> dict:
    """发布任务，返回 task dict（PUBLISHED）。"""
    resp = client.post(
        f"/api/v1/tasks/{task_id}/publish",
        json={"schemaVersionId": schema_version_id, "reviewDisabledExplicitly": False},
        headers=auth_owner,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["task"]


def setup_published_task(client, db_session, auth_owner, *, schema=None, items=1) -> dict:
    """一站式：建任务→发 Schema→插题目→发布任务。返回 {task_id, schema_version_id, item_ids}。"""
    task = create_task(client, auth_owner)
    task_id = task["id"]
    sv_id = publish_schema(client, auth_owner, task_id, schema)
    item_ids = [add_item(db_session, task_id) for _ in range(items)]
    publish_task(client, auth_owner, task_id, sv_id)
    return {"task_id": task_id, "schema_version_id": sv_id, "item_ids": item_ids}
