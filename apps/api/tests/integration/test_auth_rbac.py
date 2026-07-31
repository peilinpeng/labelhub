"""集成测试：认证与 RBAC（TC-SEC-01 越权隔离）。"""

from app.config import settings


def test_login_success(client, users):
    resp = client.post("/api/v1/auth/login", json={
        "email": users["OWNER"].email, "password": "password123",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["token"]
    assert data["actor"]["role"] == "OWNER"


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
