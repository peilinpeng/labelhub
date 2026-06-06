"""审计事件领域服务：append（幂等）+ query。"""
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.audit_event import AuditEvent


def append_audit_event(db: Session, req: Any) -> AuditEvent:
    """
    写入一条审计事件。若带 idempotencyKey 且已存在，返回已存在记录（幂等）。
    由调用方决定是否在更大事务内；此处自行 commit（前端 fire-and-forget 独立调用）。
    """
    if req.idempotencyKey:
        existing = db.query(AuditEvent).filter_by(idempotency_key=req.idempotencyKey).first()
        if existing is not None:
            return existing

    event = AuditEvent(
        id="ae_" + uuid.uuid4().hex,
        type=req.type,
        severity=req.severity or "INFO",
        source=req.source,
        actor_json=req.actor,
        target_json=req.target,
        payload_json=req.payload,
        request_id=req.requestId,
        idempotency_key=req.idempotencyKey,
        checksum=req.checksum,
        created_at=datetime.now(timezone.utc),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# 由后端内部（review diff / passport）直接构造并写入审计事件的便捷封装
def emit_audit_event(
    db: Session,
    *,
    type: str,
    source: str,
    actor: dict,
    target: dict,
    payload: dict | None = None,
    severity: str = "INFO",
    request_id: str | None = None,
    idempotency_key: str | None = None,
    commit: bool = True,
) -> AuditEvent:
    """后端内部写审计事件（不依赖 HTTP 请求体）。commit=False 时并入调用方事务。"""
    event = AuditEvent(
        id="ae_" + uuid.uuid4().hex,
        type=type, severity=severity, source=source,
        actor_json=actor, target_json=target, payload_json=payload,
        request_id=request_id, idempotency_key=idempotency_key,
        created_at=datetime.now(timezone.utc),
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    return event


_TARGET_ID_FIELDS = (
    "taskId", "submissionId", "reviewId", "exportId",
    "assignmentId", "schemaVersionId", "entityId",
)


def query_audit_events(
    db: Session,
    *,
    type: str | None = None,
    source: str | None = None,
    target_filters: dict | None = None,
    limit: int = 100,
) -> tuple[list[AuditEvent], int]:
    """
    查询审计事件。type/source 走 DB 列过滤；target.* 字段在 Python 内按 JSON 过滤（可移植）。
    返回 (items, total)；total 为过滤后总数，items 取最近 limit 条。
    """
    q = db.query(AuditEvent)
    if type:
        q = q.filter(AuditEvent.type == type)
    if source:
        q = q.filter(AuditEvent.source == source)
    rows = q.order_by(AuditEvent.created_at.desc()).all()

    target_filters = {k: v for k, v in (target_filters or {}).items() if v is not None}
    if target_filters:
        def _match(ev: AuditEvent) -> bool:
            tgt = ev.target_json or {}
            return all(tgt.get(k) == v for k, v in target_filters.items())
        rows = [ev for ev in rows if _match(ev)]

    total = len(rows)
    return rows[:limit], total
