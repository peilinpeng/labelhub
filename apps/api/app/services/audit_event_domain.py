"""审计事件领域服务：append（幂等）+ 数据库过滤的游标分页 query。"""
import base64
import binascii
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.middleware.error_handler import ValidationFailedException
from app.models.audit_event import AuditEvent


_TARGET_COLUMN_MAP = {
    "entityType": "entity_type",
    "entityId": "entity_id",
    "taskId": "task_id",
    "schemaVersionId": "schema_version_id",
    "assignmentId": "assignment_id",
    "submissionId": "submission_id",
    "reviewId": "review_id",
    "exportId": "export_id",
    "migrationPlanId": "migration_plan_id",
}


def _string_value(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _indexed_fields(actor: dict, target: dict) -> dict[str, str | None]:
    fields = {
        column: _string_value(target.get(json_key))
        for json_key, column in _TARGET_COLUMN_MAP.items()
    }
    fields["actor_id"] = _string_value(actor.get("id"))
    return fields


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
        **_indexed_fields(req.actor, req.target),
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
        **_indexed_fields(actor, target),
    )
    db.add(event)
    if commit:
        db.commit()
        db.refresh(event)
    return event


def _encode_cursor(event: AuditEvent) -> str:
    payload = json.dumps(
        {"createdAt": event.created_at.isoformat(), "id": event.id},
        separators=(",", ":"),
    ).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        created_at = datetime.fromisoformat(payload["createdAt"])
        event_id = payload["id"]
        if not isinstance(event_id, str) or not event_id:
            raise ValueError
        # MySQL DATETIME 与 SQLite 测试库都以无时区 UTC 存储。
        if created_at.tzinfo is not None:
            created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
        return created_at, event_id
    except (
        binascii.Error,
        KeyError,
        TypeError,
        UnicodeDecodeError,
        ValueError,
        json.JSONDecodeError,
    ) as exc:
        raise ValidationFailedException("audit cursor 无效或已损坏") from exc


def _database_datetime(value: datetime) -> datetime:
    """统一为 MySQL DATETIME / SQLite 使用的无时区 UTC。"""
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def query_audit_events(
    db: Session,
    *,
    type: str | None = None,
    types: list[str] | None = None,
    severities: list[str] | None = None,
    source: str | None = None,
    target_filters: dict | None = None,
    actor_id: str | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    cursor: str | None = None,
    limit: int = 100,
) -> tuple[list[AuditEvent], int, str | None]:
    """
    所有过滤、总数、稳定排序与分页均在数据库内完成。

    total 表示游标条件之前的完整匹配数；分页按 (created_at, id) 倒序，
    相同时间戳也不会重复或漏项。
    """
    q = db.query(AuditEvent)
    if type:
        q = q.filter(AuditEvent.type == type)
    if types:
        q = q.filter(AuditEvent.type.in_(types))
    if severities:
        q = q.filter(AuditEvent.severity.in_(severities))
    if source:
        q = q.filter(AuditEvent.source == source)
    target_filters = {k: v for k, v in (target_filters or {}).items() if v is not None}
    for json_key, value in target_filters.items():
        column_name = _TARGET_COLUMN_MAP.get(json_key)
        if column_name is not None:
            q = q.filter(getattr(AuditEvent, column_name) == value)
    if actor_id:
        q = q.filter(AuditEvent.actor_id == actor_id)
    if created_from:
        q = q.filter(AuditEvent.created_at >= _database_datetime(created_from))
    if created_to:
        q = q.filter(AuditEvent.created_at <= _database_datetime(created_to))

    total = q.count()
    if cursor:
        cursor_created_at, cursor_id = _decode_cursor(cursor)
        q = q.filter(
            or_(
                AuditEvent.created_at < cursor_created_at,
                and_(
                    AuditEvent.created_at == cursor_created_at,
                    AuditEvent.id < cursor_id,
                ),
            )
        )
    rows = (
        q.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(limit + 1)
        .all()
    )
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = _encode_cursor(items[-1]) if has_more and items else None
    return items, total, next_cursor
