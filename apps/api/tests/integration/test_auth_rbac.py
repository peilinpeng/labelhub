"""集成测试：认证与 RBAC（TC-SEC-01 越权隔离）。"""

import bcrypt

from app.config import settings
from app.models.user import User
from app.passwords import DUMMY_PASSWORD_HASH


def _legacy_bcrypt_hash(password: str) -> str:
    return bcrypt.hashpw(
        password.encode("utf-8")[:72],
        bcrypt.gensalt(rounds=4),
    ).decode("utf-8")


def test_login_success(client, users):
    resp = client.post("/api/v1/auth/login", json={
        "email": users["OWNER"].email, "password": "password123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["token"]
    assert data["actor"]["role"] == "OWNER"


def test_login_migrates_legacy_bcrypt_to_argon2id(client, users, db_session):
    user = users["OWNER"]
    legacy_hash = _legacy_bcrypt_hash("password123")
    user.hashed_password = legacy_hash
    db_session.commit()

    resp = client.post("/api/v1/auth/login", json={
        "email": user.email, "password": "password123",
    })

    assert resp.status_code == 200
    db_session.expire_all()
    migrated = db_session.get(User, user.id)
    assert migrated is not None
    assert migrated.hashed_password.startswith("$argon2id$")
    assert migrated.hashed_password != legacy_hash


def test_wrong_password_does_not_migrate_legacy_hash(client, users, db_session):
    user = users["OWNER"]
    legacy_hash = _legacy_bcrypt_hash("password123")
    user.hashed_password = legacy_hash
    db_session.commit()

    resp = client.post("/api/v1/auth/login", json={
        "email": user.email, "password": "wrong",
    })

    assert resp.status_code == 401
    db_session.expire_all()
    stored = db_session.get(User, user.id)
    assert stored is not None
    assert stored.hashed_password == legacy_hash


def test_inactive_account_does_not_migrate_legacy_hash(client, users, db_session):
    user = users["OWNER"]
    legacy_hash = _legacy_bcrypt_hash("password123")
    user.hashed_password = legacy_hash
    user.status = "INACTIVE"
    db_session.commit()

    resp = client.post("/api/v1/auth/login", json={
        "email": user.email, "password": "password123",
    })

    assert resp.status_code == 401
    db_session.expire_all()
    stored = db_session.get(User, user.id)
    assert stored is not None
    assert stored.hashed_password == legacy_hash


def test_malformed_stored_hash_returns_401_instead_of_500(client, users, db_session):
    user = users["OWNER"]
    user.hashed_password = "not-a-password-hash"
    db_session.commit()

    resp = client.post("/api/v1/auth/login", json={
        "email": user.email, "password": "password123",
    })

    assert resp.status_code == 401


def test_login_wrong_password_401(client, users):
    resp = client.post("/api/v1/auth/login", json={
        "email": users["OWNER"].email, "password": "wrong",
    })
    assert resp.status_code == 401


def test_login_unknown_email_401(client, users):
    resp = client.post("/api/v1/auth/login", json={
        "email": "ghost@test.local", "password": "password123",
    })
    assert resp.status_code == 401


def test_unknown_email_still_performs_dummy_hash_verification(
    client,
    monkeypatch,
):
    calls: list[tuple[str, str]] = []

    def _record_verification(password: str, hashed_password: str):
        calls.append((password, hashed_password))
        return False, None

    monkeypatch.setattr(
        "app.routers.auth.verify_password_and_update",
        _record_verification,
    )

    resp = client.post(
        "/api/v1/auth/login",
        json={"email": "missing@test.local", "password": "attempted-password"},
    )

    assert resp.status_code == 401
    assert calls == [("attempted-password", DUMMY_PASSWORD_HASH)]


def test_login_rejects_empty_or_unreasonably_large_password(client, users):
    email = users["OWNER"].email

    assert client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": ""},
    ).status_code == 422
    assert client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "x" * 1025},
    ).status_code == 422


def test_login_rate_limit_returns_429_and_retry_after(client, users):
    body = {"email": users["OWNER"].email, "password": "wrong"}
    responses = [
        client.post("/api/v1/auth/login", json=body)
        for _ in range(5)
    ]
    assert [response.status_code for response in responses[:4]] == [401] * 4
    assert responses[-1].status_code == 429
    assert int(responses[-1].headers["Retry-After"]) >= 1
    assert responses[-1].json()["code"] == "PERMISSION_DENIED"


def test_successful_login_resets_failure_counter(client, users):
    email = users["OWNER"].email
    for _ in range(4):
        assert client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": "wrong"},
        ).status_code == 401

    assert client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "password123"},
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "wrong"},
    ).status_code == 401


def test_security_headers_are_present(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"


def test_untrusted_host_is_rejected_with_security_headers(client):
    response = client.get(
        "/api/v1/health",
        headers={"Host": "attacker.example"},
    )
    assert response.status_code == 400
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"


def test_hsts_can_be_enabled_explicitly(client, monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_HSTS", True)
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.headers["Strict-Transport-Security"].startswith(
        "max-age=31536000"
    )


def test_no_token_401(client):
    resp = client.get("/api/v1/tasks")
    assert resp.status_code == 401


def test_labeler_cannot_create_task_403(client, auth):
    """TC-SEC-01：Labeler 调用 Owner 专属接口必须 403。"""
    resp = client.post("/api/v1/tasks", json={
        "title": "x", "description": "d",
        "quota": {"total": 1},
        "distributionStrategy": {"type": "FIRST_COME_FIRST_SERVED"},
        "reviewPolicy": {"type": "SINGLE_REVIEW"},
    }, headers=auth["LABELER"])
    assert resp.status_code == 403


def test_labeler_cannot_list_owner_tasks_403(client, auth):
    resp = client.get("/api/v1/tasks", headers=auth["LABELER"])
    assert resp.status_code == 403


def test_reviewer_cannot_claim_task_403(client, auth):
    resp = client.post("/api/v1/tasks/task_x/claim", json={}, headers=auth["REVIEWER"])
    assert resp.status_code == 403


def test_owner_can_list_tasks(client, auth):
    resp = client.get("/api/v1/tasks", headers=auth["OWNER"])
    assert resp.status_code == 200
