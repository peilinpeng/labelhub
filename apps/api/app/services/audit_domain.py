# Audit 领域服务：统一写入 audit_logs，记录 actor、entity_type、entity_id、action、
# before、after、reason、requestId、createdAt。
# audit log 禁止物理删除，所有成功状态迁移都必须调用此服务写入记录。
# 批量操作（如批量审核）必须逐条写入，不允许合并批量 log。
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def write_audit_log(
    db: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_id: str,
    before: object = None,
    after: object = None,
    reason: str | None = None,
    request_id: str | None = None,
) -> AuditLog:
    """
    向 audit_logs 写入一条不可变审计记录，由调用方负责 db.commit()。
    不在此处 commit，保证与业务操作在同一事务内原子完成。
    """
    log = AuditLog(
        id=f"audit_{uuid.uuid4().hex}",
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_id=actor_id,
        before_json=before,
        after_json=after,
        reason=reason,
        request_id=request_id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(log)
    return log
