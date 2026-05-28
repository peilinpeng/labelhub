import uuid

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.middleware.error_handler import (
    InvalidStateTransitionException,
    PermissionDeniedException,
    ResourceNotFoundException,
)
from app.models.assignment import Assignment
from app.models.schema import SchemaVersion
from app.models.submission import Submission
from app.services.assignment_domain import _validate_answers
from app.services.audit_domain import write_audit_log
from app.state_machines.submission_sm import apply_transition


def _enqueue_ai_review(db: Session, submission: Submission, actor_id: str) -> tuple:
    apply_transition(submission.status, "enqueueAIReview")
    submission.status = "AI_REVIEWING"
    log = write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action="AI_REVIEW_ENQUEUED",
        actor_id=actor_id,
    )
    # TODO: celery_app.send_task("tasks.ai_review", args=[submission.id])
    return (submission, log)


def submit_assignment(db: Session, assignment_id: str, actor: object, req: object) -> tuple:
    assignment = db.query(Assignment).filter_by(id=assignment_id).first()
    if not assignment:
        raise ResourceNotFoundException(f"Assignment {assignment_id!r} 不存在")

    if assignment.labeler_id != actor.id:
        raise PermissionDeniedException("无权提交该作答")

    if assignment.status not in ("CLAIMED", "DRAFTING", "RETURNED"):
        raise InvalidStateTransitionException(
            f"Assignment 当前状态 {assignment.status!r} 不允许提交"
        )

    schema_version = db.query(SchemaVersion).filter_by(id=assignment.schema_version_id).first()
    validation = _validate_answers(schema_version.schema_json, req.answers)

    max_no = (
        db.query(func.max(Submission.attempt_no))
        .filter(Submission.assignment_id == assignment_id)
        .scalar()
    )
    attempt_no = (max_no or 0) + 1

    submission = Submission(
        id="sub_" + uuid.uuid4().hex,
        assignment_id=assignment_id,
        task_id=assignment.task_id,
        item_id=assignment.item_id,
        labeler_id=actor.id,
        schema_version_id=assignment.schema_version_id,
        attempt_no=attempt_no,
        answers_json=req.answers,
        status="SUBMITTED",
        validation_json=validation,
    )
    db.add(submission)
    db.flush()

    assignment.status = "SUBMITTED"
    assignment.latest_submission_id = submission.id

    submit_log = write_audit_log(
        db,
        entity_type="SUBMISSION",
        entity_id=submission.id,
        action="SUBMISSION_CREATED",
        actor_id=actor.id,
        after={"attemptNo": attempt_no, "validationValid": validation["valid"]},
    )

    submission, _ = _enqueue_ai_review(db, submission, actor.id)

    db.commit()
    db.refresh(submission)
    db.refresh(assignment)
    db.refresh(submit_log)
    return (submission, assignment, submit_log)


def get_my_assignments(db: Session, actor: object, page: int, page_size: int) -> dict:
    base_q = db.query(Assignment).filter(Assignment.labeler_id == actor.id)
    total = base_q.count()
    items = (
        base_q.order_by(Assignment.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"items": items, "page": page, "page_size": page_size, "total": total}
