"""审计事件 Schema，镜像 contracts audit.ts 的 AppendAuditEventRequest / AuditEventRecord。"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AppendAuditEventRequest(BaseModel):
    """contracts AppendAuditEventRequest。actor/target/payload 宽松接收为 dict。"""
    type: str
    severity: str | None = "INFO"
    source: str
    actor: dict
    target: dict
    payload: dict | None = None
    requestId: str | None = None
    idempotencyKey: str | None = None
    checksum: str | None = None


class AuditEventRecordResponse(BaseModel):
    """contracts AuditEventRecord。"""
    id: str
    type: str
    severity: str
    source: str
    actor: dict
    target: dict
    payload: dict | None = None
    requestId: str | None = None
    idempotencyKey: str | None = None
    checksum: str | None = None
    createdAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, e: Any) -> "AuditEventRecordResponse":
        return cls(
            id=e.id, type=e.type, severity=e.severity, source=e.source,
            actor=e.actor_json, target=e.target_json, payload=e.payload_json,
            requestId=e.request_id, idempotencyKey=e.idempotency_key,
            checksum=e.checksum, createdAt=e.created_at,
        )


class AppendAuditEventResponse(BaseModel):
    """POST /audit-events 响应：外层包 event（对齐前端 mock）。"""
    event: AuditEventRecordResponse


class QueryAuditEventsResponse(BaseModel):
    """GET /audit-events 响应（对齐契约 api.ts：events + 可选 nextCursor）。"""
    events: list[AuditEventRecordResponse] = Field(default_factory=list)
    nextCursor: str | None = None
