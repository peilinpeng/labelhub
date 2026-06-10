# ORM 模型包：聚合所有 SQLAlchemy 模型，便于 alembic env.py 统一导入元数据。
#
# ⚠️ 这里集中 import 全部模型，确保「导入任意一个 app.models.X 时，整包模型都被注册」。
# 否则 SQLAlchemy 在解析跨表外键（如 llm_call_logs.assignment_id → assignments.id）时
# 会因目标表未注册而抛 NoReferencedTableError —— 典型出现在 Celery worker / 独立脚本中，
# 它们往往只 import 了部分模型。
from app.models.user import User  # noqa: F401
from app.models.task import Task  # noqa: F401
from app.models.schema import SchemaDraft, SchemaVersion  # noqa: F401
from app.models.dataset import DatasetItem  # noqa: F401
from app.models.assignment import Assignment, Draft  # noqa: F401
from app.models.submission import Submission  # noqa: F401
from app.models.review import ReviewConfig, AIReviewJob, ReviewResult  # noqa: F401
from app.models.audit import AuditLog  # noqa: F401
from app.models.audit_event import AuditEvent  # noqa: F401
from app.models.export import ExportJob  # noqa: F401
from app.models.export_record import ExportRecord  # noqa: F401
from app.models.file import FileObject  # noqa: F401
from app.models.llm import LLMCallLog  # noqa: F401
from app.models.idempotency import IdempotencyRecord  # noqa: F401
