"""
集成测试：高并发抢单幂等 / 无超卖（TC-QA-04）。

⚠️ 标记 @pytest.mark.integration —— CI 默认跳过（pytest -m "not integration"）。
SQLite in-memory 不支持真正的行锁，本测试必须连真实 MySQL。

运行方式（需后端 + MySQL 在跑）：
    docker compose up -d
    docker compose exec -w /workspace/apps/api api pytest -m integration -v

实现：对只有 1 道题的 FIRST_COME_FIRST_SERVED 任务并发发起 N 次领取，
断言「恰好一次成功」，验证 with_for_update(skip_locked=True) 防止同题超卖。

注：本测试经 HTTP 打到运行中的后端（真实 MySQL），题目通过真实 DATABASE_URL
直插（容器内 os.environ['DATABASE_URL'] 仍指向 MySQL —— conftest 用 setdefault，
不会覆盖已存在的环境变量）。
"""
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models.dataset import DatasetItem

pytestmark = pytest.mark.integration

BASE = os.environ.get("E2E_BASE", "http://localhost:3000/api/v1")


def _real_db():
    url = os.environ["DATABASE_URL"]
    if url.startswith("mysql://"):
        url = "mysql+pymysql://" + url[len("mysql://"):]
    if url.startswith("sqlite"):
        pytest.skip("DATABASE_URL 指向 SQLite，需真实 MySQL 才能验证行锁")
    engine = create_engine(url)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)()


def _login(email, password="Seed@1234"):
    r = httpx.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=10)
    r.raise_for_status()
    return r.json()["token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def live_api():
    try:
        httpx.get(f"{BASE}/health", timeout=3)
    except Exception:
        pytest.skip("需要运行中的后端 + MySQL（docker compose up -d）")


def test_concurrent_claim_no_oversell(live_api):
    owner = _login("owner@labelhub.test")
    labeler = _login("labeler@labelhub.test")

    # 1) 建任务 + 发 Schema + 发布
    tid = httpx.post(f"{BASE}/tasks", headers=_h(owner), timeout=10, json={
        "title": f"并发测试_{uuid4().hex[:6]}", "description": "x",
        "quota": {"total": 1},
        "distributionStrategy": {"type": "FIRST_COME_FIRST_SERVED"},
        "reviewPolicy": {"type": "SINGLE_REVIEW"},
    }).json()["task"]["id"]

    rev = httpx.put(f"{BASE}/tasks/{tid}/schema/draft", headers=_h(owner), timeout=10, json={
        "schema": {"nodes": [{"id": "n1", "type": "input.text", "name": "summary", "label": "摘要"}]}
    }).json()["schemaDraftRevision"]
    sv = httpx.post(f"{BASE}/tasks/{tid}/schema/publish", headers=_h(owner), timeout=10,
                    json={"schemaDraftRevision": rev}).json()["schemaVersion"]["id"]

    # 2) 直插 1 道题（真实 MySQL）
    db = _real_db()
    try:
        db.add(DatasetItem(
            id="item_" + uuid4().hex[:10], task_id=tid,
            external_key="k_" + uuid4().hex[:6],
            source_payload={"t": "x"}, status="AVAILABLE",
        ))
        db.commit()
    finally:
        db.close()

    httpx.post(f"{BASE}/tasks/{tid}/publish", headers=_h(owner), timeout=10,
               json={"schemaVersionId": sv, "reviewDisabledExplicitly": True})

    # 3) 并发抢同一道题（同一 labeler 多次并发）
    def _claim(_):
        return httpx.post(f"{BASE}/tasks/{tid}/claim", headers=_h(labeler), json={}, timeout=10).status_code

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(_claim, range(8)))

    success = [s for s in results if s == 201]
    assert len(success) == 1, f"应恰好 1 次成功（无超卖），实际 {len(success)}：{results}"
