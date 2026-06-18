from celery import Celery
from app.config import settings

celery_app = Celery(
    "labelhub",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
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
        "app.worker.ai_review_worker.run_ai_review": {"queue": "ai_review"},
        "app.worker.export_worker.*": {"queue": "export"},
    },
)
