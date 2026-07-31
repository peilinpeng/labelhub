"""周期性数据维护任务。"""

from app.database import SessionLocal
from app.services.idempotency_domain import delete_expired_records
from app.worker.celery_app import celery_app


@celery_app.task(
    name="app.worker.maintenance.cleanup_expired_idempotency_records"
)
def cleanup_expired_idempotency_records() -> int:
    db = SessionLocal()
    try:
        total_deleted = 0
        batch_size = 5000
        while True:
            deleted = delete_expired_records(db, batch_size=batch_size)
            total_deleted += deleted
            if deleted < batch_size:
                return total_deleted
    finally:
        db.close()
