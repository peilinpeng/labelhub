"""幂等记录生命周期治理。"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.idempotency import IdempotencyRecord


def delete_expired_records(
    db: Session,
    *,
    now: datetime | None = None,
    batch_size: int = 5000,
) -> int:
    """按 expires_at 索引分批删除，避免单次长事务锁住整张表。"""
    cutoff = now or datetime.now(timezone.utc).replace(tzinfo=None)
    scope_keys = [
        row[0]
        for row in (
            db.query(IdempotencyRecord.scope_key)
            .filter(IdempotencyRecord.expires_at <= cutoff)
            .order_by(IdempotencyRecord.expires_at.asc())
            .limit(batch_size)
            .all()
        )
    ]
    if not scope_keys:
        return 0
    deleted = (
        db.query(IdempotencyRecord)
        .filter(IdempotencyRecord.scope_key.in_(scope_keys))
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(deleted)
