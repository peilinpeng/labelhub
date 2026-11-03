from celery import Celery
from app.config import settings

celery_app = Celery(
    "labelhub",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    # 必须显式 include 任务模块，否则 worker 启动时 @celery_app.task 不会注册，
    # 导致 "Received unregistered task ... run_ai_review"（AI 预审 / 导出任务无法执行）
    include=[
        "app.worker.ai_review_worker",
        "app.worker.export_worker",
        "app.worker.maintenance",
        "app.worker.migration_worker",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "app.worker.migration_worker.*": {"queue": "maintenance"},
        "app.worker.ai_review_worker.run_ai_review": {"queue": "ai_review"},
        "app.worker.export_worker.*": {"queue": "export"},
        "app.worker.maintenance.*": {"queue": "maintenance"},
    },
    beat_schedule={
        "dispatch-pending-migrations": {"task": "app.worker.migration_worker.dispatch_pending", "schedule": 60.0},
        "cleanup-expired-idempotency-records-hourly": {
            "task": "app.worker.maintenance.cleanup_expired_idempotency_records",
            "schedule": 3600.0,
        },
    },
)
