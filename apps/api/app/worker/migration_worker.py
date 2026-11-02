"""数据库 outbox + 可重复投递的迁移任务。消息只包含任务 ID。"""
from app.database import SessionLocal
from app.models.governance import MigrationJob
from app.worker.celery_app import celery_app


def enqueue(job_id):
    try:
        run_migration.apply_async(args=[job_id], retry=False)
    except Exception:
        # 状态已持久化；不写 broker 异常文本，避免泄漏连接凭据。
        return False
    return True


@celery_app.task(name="app.worker.migration_worker.run_migration", ignore_result=True)
def run_migration(job_id):
    from app.services.migration_domain import execute_job
    with SessionLocal() as db:
        execute_job(db, job_id)


@celery_app.task(name="app.worker.migration_worker.dispatch_pending", ignore_result=True)
def dispatch_pending():
    with SessionLocal() as db:
        ids = [row.id for row in db.query(MigrationJob.id).filter_by(status="QUEUED").limit(100).all()]
    for job_id in ids:
        enqueue(job_id)
