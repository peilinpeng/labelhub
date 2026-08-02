"""审计事件路由：POST/GET /api/v1/audit-events（Quality Layer 富审计）。"""
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import Actor, require_roles
from app.services import audit_event_domain
from app.schemas.audit_event import (
    AppendAuditEventRequest,
    AppendAuditEventResponse,
    AuditEventRecordResponse,
    QueryAuditEventsResponse,
)

router = APIRouter(tags=["audit-events"])


@router.post(
    "/audit-events",
    response_model=AppendAuditEventResponse,
    status_code=201,
    summary="写入审计事件（前端 fire-and-forget）",
)
def append_audit_event(
    body: AppendAuditEventRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("LABELER", "REVIEWER", "OWNER", "ADMIN")),
) -> AppendAuditEventResponse:
    event = audit_event_domain.append_audit_event(db, body)
    return AppendAuditEventResponse(event=AuditEventRecordResponse.from_orm(event))


@router.get(
    "/audit-events",
    response_model=QueryAuditEventsResponse,
    summary="查询审计事件（审计时间线）",
)
def query_audit_events(
    type: str | None = Query(None),
    types: list[str] | None = Query(None),
    severities: list[str] | None = Query(None),
    source: str | None = Query(None),
    taskId: str | None = Query(None),
    entityType: str | None = Query(None),
    submissionId: str | None = Query(None),
    reviewId: str | None = Query(None),
    exportId: str | None = Query(None),
    assignmentId: str | None = Query(None),
    schemaVersionId: str | None = Query(None),
    entityId: str | None = Query(None),
    migrationPlanId: str | None = Query(None),
    actorId: str | None = Query(None),
    createdFrom: datetime | None = Query(None),
    createdTo: datetime | None = Query(None),
    cursor: str | None = Query(None, max_length=512),
    limit: int = Query(100, ge=1, le=200),
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("REVIEWER", "OWNER", "ADMIN")),
) -> QueryAuditEventsResponse:
    items, total, next_cursor = audit_event_domain.query_audit_events(
        db,
        type=type,
        types=types,
        severities=severities,
        source=source,
        target_filters={
            "taskId": taskId, "entityType": entityType, "submissionId": submissionId, "reviewId": reviewId,
            "exportId": exportId, "assignmentId": assignmentId,
            "schemaVersionId": schemaVersionId, "entityId": entityId,
            "migrationPlanId": migrationPlanId,
        },
        actor_id=actorId,
        created_from=createdFrom,
        created_to=createdTo,
        cursor=cursor,
        limit=limit,
    )
    return QueryAuditEventsResponse(
        events=[AuditEventRecordResponse.from_orm(e) for e in items],
        total=total,
        nextCursor=next_cursor,
    )
