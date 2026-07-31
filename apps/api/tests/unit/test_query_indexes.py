"""OPT-10 hot-query indexes and SQLite query-plan smoke tests."""
from sqlalchemy import inspect, text


def _index_names(db_session, table_name: str) -> set[str]:
    return {
        index["name"]
        for index in inspect(db_session.get_bind()).get_indexes(table_name)
    }


def _explain_detail(db_session, statement: str) -> str:
    rows = db_session.execute(text(f"EXPLAIN QUERY PLAN {statement}")).all()
    return " ".join(str(value) for row in rows for value in row).lower()


def test_hot_query_indexes_exist_and_are_selected(db_session):
    expected = {
        "assignments": {
            "ix_assignments_labeler_created",
            "ix_assignments_task_labeler_status",
        },
        "submissions": {
            "ix_submissions_status_created",
            "ix_submissions_task_status",
        },
        "audit_events": {
            "ix_audit_events_task_created",
            "ix_audit_events_entity_created",
            "ix_audit_events_submission_created",
            "ix_audit_events_type_created",
            "ix_audit_events_actor_created",
        },
    }
    for table_name, names in expected.items():
        assert names <= _index_names(db_session, table_name)

    plans = {
        "ix_assignments_labeler_created": (
            "SELECT id FROM assignments "
            "WHERE labeler_id = 'usr_x' ORDER BY created_at DESC LIMIT 20"
        ),
        "ix_assignments_task_labeler_status": (
            "SELECT id FROM assignments WHERE task_id = 'task_x' "
            "AND labeler_id = 'usr_x' AND status IN ('CLAIMED', 'DRAFTING')"
        ),
        "ix_submissions_status_created": (
            "SELECT id FROM submissions WHERE status = 'ACCEPTED' "
            "ORDER BY created_at LIMIT 20"
        ),
        "ix_submissions_task_status": (
            "SELECT id FROM submissions "
            "WHERE task_id = 'task_x' AND status = 'ACCEPTED'"
        ),
        "ix_audit_events_task_created": (
            "SELECT id FROM audit_events WHERE task_id = 'task_x' "
            "ORDER BY created_at DESC LIMIT 100"
        ),
    }
    for index_name, statement in plans.items():
        assert index_name in _explain_detail(db_session, statement)


def test_assignment_submission_lookup_reuses_unique_prefix(db_session):
    """(assignment_id, attempt_no) 唯一索引已覆盖 assignment_id，拒绝重复索引。"""
    unique_constraints = inspect(db_session.get_bind()).get_unique_constraints(
        "submissions"
    )
    assert any(
        constraint["name"] == "uq_submissions_assignment_attempt"
        and constraint["column_names"] == ["assignment_id", "attempt_no"]
        for constraint in unique_constraints
    )
    assert "ix_submissions_assignment_id" not in _index_names(
        db_session, "submissions"
    )
