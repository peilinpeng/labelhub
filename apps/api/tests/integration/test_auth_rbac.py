"""集成测试：认证与 RBAC（TC-SEC-01 越权隔离）。"""


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
