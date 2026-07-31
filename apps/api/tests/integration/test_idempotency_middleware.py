"""OPT-05：幂等中间件的重复、冲突、处理中、过期与清理回归。"""

import hashlib
import json
from datetime import datetime, timedelta

import pytest

from app.models.idempotency import IdempotencyRecord
from app.models.task import Task
from app.services.idempotency_domain import delete_expired_records


def _task_body(title: str = "幂等任务") -> dict:
    return {
        "title": title,
        "description": "idempotency",
        "quota": {"total": 1},
        "distributionStrategy": {"type": "FIRST_COME_FIRST_SERVED"},
        "reviewPolicy": {"type": "SINGLE_REVIEW"},
    }


def _headers(auth_owner: dict, key: str) -> dict:
    return {**auth_owner, "Idempotency-Key": key}


def test_same_request_replays_without_duplicate_resource(
    client, auth, db_session
):
    headers = _headers(auth["OWNER"], "same-request")
    first = client.post("/api/v1/tasks", json=_task_body(), headers=headers)
    second = client.post("/api/v1/tasks", json=_task_body(), headers=headers)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.headers["X-Idempotent-Replayed"] == "true"
    assert second.json() == first.json()
    assert db_session.query(Task).filter_by(title="幂等任务").count() == 1


def test_same_key_with_different_body_returns_conflict(client, auth, db_session):
    headers = _headers(auth["OWNER"], "body-conflict")
    assert client.post(
        "/api/v1/tasks", json=_task_body("body-a"), headers=headers
    ).status_code == 201

    conflict = client.post(
        "/api/v1/tasks", json=_task_body("body-b"), headers=headers
    )
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "IDEMPOTENCY_CONFLICT"
    assert db_session.query(Task).count() == 1


def test_processing_request_is_not_executed_again(
    client, auth, users, db_session
):
    raw_body = json.dumps(
        _task_body("processing"),
        separators=(",", ":"),
    ).encode()
    key = "processing-key"
    scope_key = f"{users['OWNER'].id}:POST:/api/v1/tasks:{key}"
    db_session.add(
        IdempotencyRecord(
            scope_key=scope_key,
            request_hash=hashlib.sha256(raw_body).hexdigest(),
            response_snapshot_json=None,
            expires_at=datetime.utcnow() + timedelta(hours=1),
        )
    )
    db_session.commit()

    response = client.post(
        "/api/v1/tasks",
        content=raw_body,
        headers={
            **_headers(auth["OWNER"], key),
            "Content-Type": "application/json",
        },
    )
    assert response.status_code == 409
    assert response.headers["Retry-After"] == "1"
    assert response.json()["details"]["state"] == "PROCESSING"
    assert db_session.query(Task).count() == 0


def test_expired_key_can_be_reused(client, auth, users, db_session):
    key = "expired-key"
    headers = _headers(auth["OWNER"], key)
    first = client.post(
        "/api/v1/tasks", json=_task_body("expired-reuse"), headers=headers
    )
    assert first.status_code == 201

    scope_key = f"{users['OWNER'].id}:POST:/api/v1/tasks:{key}"
    record = db_session.get(IdempotencyRecord, scope_key)
    record.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db_session.commit()

    second = client.post(
        "/api/v1/tasks", json=_task_body("expired-reuse"), headers=headers
    )
    assert second.status_code == 201
    assert "X-Idempotent-Replayed" not in second.headers
    assert second.json()["task"]["id"] != first.json()["task"]["id"]
    assert db_session.query(Task).filter_by(title="expired-reuse").count() == 2


def test_deterministic_4xx_is_replayed(client, auth):
    raw_body = b"{}"
    headers = {
        **_headers(auth["OWNER"], "validation-error"),
        "Content-Type": "application/json",
    }
    first = client.post("/api/v1/tasks", content=raw_body, headers=headers)
    second = client.post("/api/v1/tasks", content=raw_body, headers=headers)

    assert first.status_code == 422
    assert second.status_code == 422
    assert second.headers["X-Idempotent-Replayed"] == "true"
    assert second.json() == first.json()


def test_5xx_releases_reservation_for_safe_retry(
    client, auth, db_session, monkeypatch
):
    from app.services import task_domain

    headers = _headers(auth["OWNER"], "retry-after-500")
    with monkeypatch.context() as patch:
        patch.setattr(
            task_domain,
            "create_task",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(
                RuntimeError("simulated failure")
            ),
        )
        # TestClient 默认会重新抛出应用异常；这里关注中间件是否释放预约，
        # 而不是 Starlette 测试客户端是否把异常转换成 500 响应。
        with pytest.raises(RuntimeError, match="simulated failure"):
            client.post(
                "/api/v1/tasks",
                json=_task_body("retry-after-500"),
                headers=headers,
            )
    assert db_session.query(IdempotencyRecord).count() == 0

    retried = client.post(
        "/api/v1/tasks",
        json=_task_body("retry-after-500"),
        headers=headers,
    )
    assert retried.status_code == 201
    assert db_session.query(Task).filter_by(title="retry-after-500").count() == 1


def test_cleanup_deletes_only_expired_records(db_session):
    now = datetime.utcnow()
    db_session.add_all(
        [
            IdempotencyRecord(
                scope_key="expired",
                request_hash="a",
                expires_at=now - timedelta(seconds=1),
            ),
            IdempotencyRecord(
                scope_key="active",
                request_hash="b",
                expires_at=now + timedelta(hours=1),
            ),
        ]
    )
    db_session.commit()

    assert delete_expired_records(db_session, now=now) == 1
    assert db_session.get(IdempotencyRecord, "expired") is None
    assert db_session.get(IdempotencyRecord, "active") is not None
