"""集成测试：审计事件 POST/GET（Quality Layer E2）。"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

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


def test_query_audit_events_filters_sort_total_and_cursor_in_database(
    client, auth, db_session
):
    """OPT-09：组合过滤、总数、稳定排序和游标分页均由 SQL 完成。"""
    created_ids = []
    for index, (event_type, severity) in enumerate(
        [
            ("AI_ASSIST_ACCEPTED", "INFO"),
            ("AI_ASSIST_ACCEPTED", "WARNING"),
            ("AI_ASSIST_REJECTED", "ERROR"),
            ("AI_ASSIST_ACCEPTED", "INFO"),
        ]
    ):
        resp = client.post(
            "/api/v1/audit-events",
            json=_event_body(
                type=event_type,
                severity=severity,
                actor={"id": "usr_filter_target", "role": "REVIEWER"},
                target={
                    "entityType": "SUBMISSION",
                    "entityId": f"sub_filter_{index}",
                    "submissionId": f"sub_filter_{index}",
                    "taskId": "task_filter",
                },
            ),
            headers=auth["REVIEWER"],
        )
        created_ids.append(resp.json()["event"]["id"])

    statements: list[str] = []

    def capture_sql(_conn, _cursor, statement, _parameters, _context, _many):
        statements.append(" ".join(statement.lower().split()))

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture_sql)
    try:
        first = client.get(
            "/api/v1/audit-events",
            params=[
                ("taskId", "task_filter"),
                ("entityType", "SUBMISSION"),
                ("actorId", "usr_filter_target"),
                ("types", "AI_ASSIST_ACCEPTED"),
                ("severities", "INFO"),
                ("severities", "WARNING"),
                ("limit", "2"),
            ],
            headers=auth["OWNER"],
        )
    finally:
        event.remove(engine, "before_cursor_execute", capture_sql)

    assert first.status_code == 200, first.text
    page_one = first.json()
    assert page_one["total"] == 3
    assert len(page_one["events"]) == 2
    assert page_one["nextCursor"]
    assert all(
        item["target"]["taskId"] == "task_filter"
        and item["actor"]["id"] == "usr_filter_target"
        for item in page_one["events"]
    )
    event_selects = [
        sql
        for sql in statements
        if sql.startswith("select") and "from audit_events" in sql
    ]
    assert len(event_selects) == 2  # COUNT + 有 LIMIT 的当前页
    assert " limit " in event_selects[-1]
    assert "task_id" in event_selects[-1]
    assert "actor_id" in event_selects[-1]

    second = client.get(
        "/api/v1/audit-events",
        params={
            "taskId": "task_filter",
            "actorId": "usr_filter_target",
            "types": "AI_ASSIST_ACCEPTED",
            "limit": 2,
            "cursor": page_one["nextCursor"],
        },
        headers=auth["OWNER"],
    )
    assert second.status_code == 200, second.text
    page_two = second.json()
    assert page_two["total"] == 3
    assert len(page_two["events"]) == 1
    assert page_two["nextCursor"] is None
    assert {
        item["id"] for item in page_one["events"]
    }.isdisjoint({item["id"] for item in page_two["events"]})
    assert set(created_ids[:2] + created_ids[3:]) == {
        item["id"] for item in page_one["events"] + page_two["events"]
    }


def test_query_audit_events_created_range_and_page_size_guard(client, auth):
    now = datetime.now(timezone.utc)
    client.post(
        "/api/v1/audit-events",
        json=_event_body(target={"taskId": "task_range"}),
        headers=auth["REVIEWER"],
    )
    response = client.get(
        "/api/v1/audit-events",
        params={
            "taskId": "task_range",
            "createdFrom": (now - timedelta(minutes=1)).isoformat(),
            "createdTo": (now + timedelta(minutes=1)).isoformat(),
        },
        headers=auth["OWNER"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1

    assert client.get(
        "/api/v1/audit-events?limit=201",
        headers=auth["OWNER"],
    ).status_code == 422
    assert client.get(
        "/api/v1/audit-events?cursor=not-a-valid-cursor",
        headers=auth["OWNER"],
    ).status_code == 422


def test_labeler_can_write_but_not_query(client, auth):
    # 写允许 LABELER
    assert client.post("/api/v1/audit-events", json=_event_body(), headers=auth["LABELER"]).status_code == 201
    # 查询限 REVIEWER/OWNER/ADMIN
    assert client.get("/api/v1/audit-events", headers=auth["LABELER"]).status_code == 403
