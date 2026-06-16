"""集成测试：审计事件 POST/GET（Quality Layer E2）。"""

def _event_body(**over):
    body = {
        "type": "REVIEW_DIFF_GENERATED",
        "severity": "INFO",
        "source": "WEB_FRONTEND",
        "actor": {"id": "usr_reviewer_1", "role": "REVIEWER"},
        "target": {"entityType": "SUBMISSION", "entityId": "sub_x", "submissionId": "sub_x", "taskId": "task_x"},
        "payload": {"patchCount": 2},
    }
    body.update(over)
    return body


def test_append_audit_event_201_wrapped(client, auth):
    resp = client.post("/api/v1/audit-events", json=_event_body(), headers=auth["REVIEWER"])
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert "event" in data                       # 外层包 event
    assert data["event"]["type"] == "REVIEW_DIFF_GENERATED"
    assert data["event"]["id"].startswith("ae_")


def test_append_audit_event_idempotent(client, auth):
    body = _event_body(idempotencyKey="evt-key-1")
    r1 = client.post("/api/v1/audit-events", json=body, headers=auth["REVIEWER"])
    r2 = client.post("/api/v1/audit-events", json=body, headers=auth["REVIEWER"])
    assert r1.status_code == 201 and r2.status_code == 201
    assert r1.json()["event"]["id"] == r2.json()["event"]["id"]  # 幂等返回同一条


def test_query_audit_events_filter_by_submission(client, auth):
    client.post("/api/v1/audit-events", json=_event_body(target={"submissionId": "sub_AAA"}), headers=auth["REVIEWER"])
    client.post("/api/v1/audit-events", json=_event_body(target={"submissionId": "sub_BBB"}), headers=auth["REVIEWER"])
    resp = client.get("/api/v1/audit-events?submissionId=sub_AAA", headers=auth["OWNER"])
    assert resp.status_code == 200
    items = resp.json()["events"]
    assert len(items) == 1
    assert items[0]["target"]["submissionId"] == "sub_AAA"


def test_query_audit_events_filter_by_type(client, auth):
    client.post("/api/v1/audit-events", json=_event_body(type="REVIEW_DIFF_GENERATED"), headers=auth["REVIEWER"])
    client.post("/api/v1/audit-events", json=_event_body(type="AI_ASSIST_ACCEPTED"), headers=auth["REVIEWER"])
    resp = client.get("/api/v1/audit-events?type=AI_ASSIST_ACCEPTED", headers=auth["OWNER"])
    assert resp.status_code == 200
    assert len(resp.json()["events"]) == 1


def test_labeler_can_write_but_not_query(client, auth):
    # 写允许 LABELER
    assert client.post("/api/v1/audit-events", json=_event_body(), headers=auth["LABELER"]).status_code == 201
    # 查询限 REVIEWER/OWNER/ADMIN
    assert client.get("/api/v1/audit-events", headers=auth["LABELER"]).status_code == 403
