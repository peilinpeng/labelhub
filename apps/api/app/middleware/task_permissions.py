"""在幂等回放之前执行任务动作门禁，不能用旧响应绕过撤权。"""
from functools import lru_cache
from starlette.routing import compile_path
from app.models.assignment import Assignment
from app.models.dataset import DatasetItem
from app.models.export import ExportJob
from app.models.schema import SchemaVersion
from app.models.submission import Submission
from app.models.review import ReviewConfig
from app.services.permission_domain import require_permission
from app.middleware.error_handler import PermissionDeniedException


@lru_cache(maxsize=256)
def path_regex(template):
    return compile_path(template)[0]


def resolve_route(request):
    # OpenAPI 是公开路由契约，避免依赖 FastAPI 内部 IncludedRouter 的实现。
    for template, methods in request.app.openapi()["paths"].items():
        if request.method.lower() in methods:
            match = path_regex(template).match(request.url.path)
            if match:
                return template, match.groupdict()
    return "", {}


def check_request_permission(request, db, actor):
    template, params = resolve_route(request)
    if ("/assignments/" in template or template == "/api/v1/tasks/{task_id}/claim") and actor.role != "LABELER":
        raise PermissionDeniedException("此入口需要标注员角色")
    task_id = params.get("task_id")
    for key, model in [("assignment_id", Assignment), ("item_id", DatasetItem), ("export_job_id", ExportJob),
                       ("schema_version_id", SchemaVersion), ("submission_id", Submission), ("config_id", ReviewConfig)]:
        if key in params:
            record = db.get(model, params[key])
            if record is not None:
                task_id = record.task_id
    if "/analytics/" in template:
        task_id = request.query_params.get("taskId")
    if not task_id:
        return
    if "/permissions" in template:
        if not template.endswith("/me"):
            require_permission(db, task_id, actor, "permissions.manage")
        return
    if "/migrations" in template:
        suffix = template.rsplit("/", 1)[-1]
        action = {"dry-run": "plan", "submit": "plan", "cancel": "plan", "approve": "approve", "reject": "approve", "execute": "execute", "retry": "execute"}.get(suffix)
        require_permission(db, task_id, actor, f"migration.{action or ('plan' if request.method == 'POST' else 'read')}")
        return
    if "/exports" in template:
        action = "export.create"
    elif "/analytics/" in template or template.endswith("/stats"):
        action = "analytics.read"
    elif any(part in template for part in ["/schema/draft", "/schema/publish", "/schema/ai-generate"]):
        action = "schema.write"
    elif "/review-config" in template:
        action = "task.manage"
    elif "/review" in template or "/submissions/" in template:
        action = "review.work"
    elif "/assignments/" in template or template.endswith("/claim"):
        action = "labeling.work"
    elif "/dataset/" in template or ("/items" in template and (request.method != "GET" or actor.role == "OWNER")):
        action = "dataset.manage"
    else:
        action = "task.read" if request.method == "GET" else "task.manage"
    require_permission(db, task_id, actor, action)
