"""集成测试：任务广场搜索筛选（TC-LBL-02，A4）。"""
from tests.helpers import setup_published_task, create_task, publish_schema, add_item, publish_task


def _publish(client, auth, db_session, title):
    task = create_task(client, auth["OWNER"], title=title)
    sv = publish_schema(client, auth["OWNER"], task["id"])
    add_item(db_session, task["id"])
    publish_task(client, auth["OWNER"], task["id"], sv)
    return task["id"]


def test_marketplace_lists_published_only(client, auth, db_session):
    _publish(client, auth, db_session, "已发布任务")
    create_task(client, auth["OWNER"], title="草稿任务")  # DRAFT，不应出现
    resp = client.get("/api/v1/marketplace/tasks", headers=auth["LABELER"])
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] == 1
    assert data["items"][0]["title"] == "已发布任务"


def test_marketplace_keyword_filter(client, auth, db_session):
    _publish(client, auth, db_session, "新闻质量标注")
    _publish(client, auth, db_session, "图像分类任务")

    r_hit = client.get("/api/v1/marketplace/tasks?keyword=新闻", headers=auth["LABELER"])
    assert r_hit.json()["total"] == 1
    assert r_hit.json()["items"][0]["title"] == "新闻质量标注"

    r_miss = client.get("/api/v1/marketplace/tasks?keyword=不存在XYZ", headers=auth["LABELER"])
    assert r_miss.json()["total"] == 0

    r_all = client.get("/api/v1/marketplace/tasks", headers=auth["LABELER"])
    assert r_all.json()["total"] == 2
