# Task 与 Schema 路由，对应契约第 23.1 节。
# 端点：POST /tasks、GET /tasks/:taskId、PATCH /tasks/:taskId、
#   POST /tasks/:taskId/publish、POST /tasks/:taskId/pause、
#   POST /tasks/:taskId/resume、POST /tasks/:taskId/end、
#   GET /schema/component-registry、GET /tasks/:taskId/schema/draft、
#   PUT /tasks/:taskId/schema/draft、POST /schema/validate、
#   POST /tasks/:taskId/schema/publish、POST /tasks/:taskId/schema/ai-generate、
#   GET /schema-versions/:schemaVersionId。

from fastapi import APIRouter, Depends

from app.middleware.auth import Actor, require_roles
from app.schemas.task import ServerComponentRegistryItem

router = APIRouter(tags=["tasks", "schema"])


# ---------------------------------------------------------------------------
# 服务端权威组件注册表（静态配置，契约 §8 全部 19 种 NodeType）
# normalizer / validators 为后端实现时的查找 key，MVP 阶段为占位字符串。
# ---------------------------------------------------------------------------

_SERVER_REGISTRY: list[ServerComponentRegistryItem] = [

    # ── 输入类（INPUT）──────────────────────────────────────────────────────

    ServerComponentRegistryItem(
        type="input.text",
        category="INPUT",
        valueKind="STRING",
        normalizer="normalizers.string",
        validators=["validators.min_length", "validators.max_length", "validators.regex"],
        exportValueType="TEXT",
        allowedValidationRules=["required", "minLength", "maxLength", "regex", "conditional", "custom"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=True,
    ),
    ServerComponentRegistryItem(
        type="input.textarea",
        category="INPUT",
        valueKind="STRING",
        normalizer="normalizers.string",
        validators=["validators.min_length", "validators.max_length", "validators.regex"],
        exportValueType="TEXT",
        allowedValidationRules=["required", "minLength", "maxLength", "regex", "conditional", "custom"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=True,
    ),
    ServerComponentRegistryItem(
        type="input.richtext",
        category="INPUT",
        valueKind="RICH_TEXT",
        normalizer="normalizers.rich_text",
        validators=[],
        exportValueType="TEXT",
        # 富文本 AST 结构复杂，minLength/maxLength/regex 不适用
        allowedValidationRules=["required", "conditional"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=False,  # AI 审核暂不处理富文本 AST
    ),

    # ── 选择类（CHOICE）─────────────────────────────────────────────────────

    ServerComponentRegistryItem(
        type="choice.radio",
        category="CHOICE",
        valueKind="STRING",
        normalizer="normalizers.string",
        validators=[],
        exportValueType="TEXT",
        allowedValidationRules=["required", "conditional", "custom"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=True,
    ),
    ServerComponentRegistryItem(
        type="choice.checkbox",
        category="CHOICE",
        valueKind="STRING_ARRAY",
        normalizer="normalizers.string_array",
        validators=["validators.min_items", "validators.max_items"],
        exportValueType="JSON",
        allowedValidationRules=["required", "minItems", "maxItems", "conditional", "custom"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=True,
    ),
    ServerComponentRegistryItem(
        type="choice.select",
        category="CHOICE",
        # valueKind 随 multiple 动态变化；注册表以单选为基准（normalizer 内部处理 multiple 分支）
        valueKind="STRING",
        normalizer="normalizers.choice_select",
        validators=[],
        exportValueType="TEXT",
        allowedValidationRules=["required", "conditional", "custom"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=True,
    ),
    ServerComponentRegistryItem(
        type="choice.tags",
        category="CHOICE",
        valueKind="STRING_ARRAY",
        normalizer="normalizers.string_array",
        validators=["validators.min_items", "validators.max_items"],
        exportValueType="JSON",
        allowedValidationRules=["required", "minItems", "maxItems", "conditional", "custom"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=True,
    ),

    # ── 上传类（UPLOAD）─────────────────────────────────────────────────────

    ServerComponentRegistryItem(
        type="upload.file",
        category="UPLOAD",
        valueKind="FILE_ARRAY",
        normalizer="normalizers.file_array",
        validators=["validators.file"],
        exportValueType="FILE_URLS",
        allowedValidationRules=["required", "file", "minItems", "maxItems", "conditional"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=False,  # 文件内容需单独处理，默认不参与 AI Review
    ),
    ServerComponentRegistryItem(
        type="upload.image",
        category="UPLOAD",
        valueKind="FILE_ARRAY",
        normalizer="normalizers.file_array",
        validators=["validators.file"],
        exportValueType="FILE_URLS",
        allowedValidationRules=["required", "file", "minItems", "maxItems", "conditional"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=False,
    ),

    # ── 结构化数据（DATA）───────────────────────────────────────────────────

    ServerComponentRegistryItem(
        type="data.json",
        category="DATA",
        valueKind="JSON",
        normalizer="normalizers.json",
        validators=["validators.json_schema"],
        exportValueType="JSON",
        allowedValidationRules=["required", "jsonSchema", "conditional", "custom"],
        defaultSubmitEnabled=True,
        defaultExportEnabled=True,
        defaultAiReviewEnabled=True,
    ),

    # ── 展示类（SHOW）——不写入 answers，不参与提交和导出（契约 §9）──────────

    ServerComponentRegistryItem(
        type="show.text",
        category="SHOW",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="TEXT",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),
    ServerComponentRegistryItem(
        type="show.richtext",
        category="SHOW",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="TEXT",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),
    ServerComponentRegistryItem(
        type="show.image",
        category="SHOW",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="FILE_URLS",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),
    ServerComponentRegistryItem(
        type="show.file",
        category="SHOW",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="FILE_URLS",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),
    ServerComponentRegistryItem(
        type="show.json",
        category="SHOW",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="JSON",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),

    # ── AI 辅助（AI）————不写入 answers，后端 LLM Runtime 专用（契约 §9）──────

    ServerComponentRegistryItem(
        type="llm.assist",
        category="AI",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="JSON",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),

    # ── 布局容器（LAYOUT）——只负责组织，不写入 answers（契约 §9）──────────────

    ServerComponentRegistryItem(
        type="container.group",
        category="LAYOUT",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="JSON",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),
    ServerComponentRegistryItem(
        type="container.tabs",
        category="LAYOUT",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="JSON",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),
    ServerComponentRegistryItem(
        type="container.section",
        category="LAYOUT",
        valueKind="NONE",
        normalizer="normalizers.noop",
        validators=[],
        exportValueType="JSON",
        allowedValidationRules=[],
        defaultSubmitEnabled=False,
        defaultExportEnabled=False,
        defaultAiReviewEnabled=False,
    ),
]


# ---------------------------------------------------------------------------
# GET /api/v1/schema/component-registry
# ---------------------------------------------------------------------------

@router.get(
    "/schema/component-registry",
    response_model=list[ServerComponentRegistryItem],
    summary="获取服务端权威组件注册表",
)
def get_component_registry(
    actor: Actor = Depends(require_roles("OWNER")),
) -> list[ServerComponentRegistryItem]:
    """
    返回服务端允许使用的全部 NodeType 注册信息（契约 §13）。
    仅 OWNER 角色可访问（契约 §23.1），返回静态配置，无 DB 访问，共 19 种 NodeType。
    """
    return _SERVER_REGISTRY


# ---------------------------------------------------------------------------
# 以下为 Task CRUD 与状态迁移路由（契约 §23.1）
# ---------------------------------------------------------------------------

from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_actor  # require_roles 已导入，不重复
from app.services import task_domain
from app.schemas.task import (
    CreateTaskRequest, CreateTaskResponse,
    UpdateTaskRequest, TaskResponse,
    PublishTaskRequest, PublishTaskResponse,
    PauseTaskRequest, EndTaskRequest, ArchiveTaskRequest,
    TaskTransitionResponse, AuditLogSummaryResponse,
)


# ── POST /tasks（createTask）──────────────────────────────────────────────────

@router.post(
    "/tasks",
    response_model=CreateTaskResponse,
    status_code=201,
    summary="创建任务",
)
def create_task(
    body: CreateTaskRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> CreateTaskResponse:
    """createTask 命令（契约 §18.1）：创建 DRAFT 状态任务，写入 TASK_CREATED audit log。"""
    task, log = task_domain.create_task(db, actor, body)
    return CreateTaskResponse(
        task=TaskResponse.from_orm(task),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


# ── GET /tasks/{task_id}（getTask）───────────────────────────────────────────

@router.get(
    "/tasks/{task_id}",
    response_model=TaskResponse,
    summary="查询任务详情",
)
def get_task(
    task_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER", "REVIEWER", "LABELER")),
) -> TaskResponse:
    """获取任务详情（契约 §23.1：OWNER/REVIEWER/LABELER 均可访问）。"""
    task = task_domain.get_task(db, task_id, actor)
    return TaskResponse.from_orm(task)


# ── PATCH /tasks/{task_id}（updateTask，仅 DRAFT）────────────────────────────

@router.patch(
    "/tasks/{task_id}",
    response_model=TaskResponse,
    summary="更新任务（仅 DRAFT 状态）",
)
def update_task(
    task_id: str,
    body: UpdateTaskRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> TaskResponse:
    """更新 DRAFT 任务字段（契约 §23.1）。非 DRAFT 状态返回 409。"""
    task = task_domain.update_task(db, task_id, actor, body)
    return TaskResponse.from_orm(task)


# ── POST /tasks/{task_id}/publish（publishTask）──────────────────────────────

@router.post(
    "/tasks/{task_id}/publish",
    response_model=PublishTaskResponse,
    summary="发布任务",
)
def publish_task(
    task_id: str,
    body: PublishTaskRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> PublishTaskResponse:
    """publishTask 命令（契约 §16 / §18.1）：DRAFT → PUBLISHED，校验 schemaVersionId。"""
    task, log = task_domain.publish_task(db, task_id, actor, body)
    return PublishTaskResponse(
        task=TaskResponse.from_orm(task),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


# ── POST /tasks/{task_id}/pause（pauseTask）──────────────────────────────────

@router.post(
    "/tasks/{task_id}/pause",
    response_model=TaskTransitionResponse,
    summary="暂停任务",
)
def pause_task(
    task_id: str,
    body: PauseTaskRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> TaskTransitionResponse:
    """pauseTask 命令（契约 §18.1）：PUBLISHED → PAUSED。"""
    task, log = task_domain.pause_task(db, task_id, actor, body)
    return TaskTransitionResponse(
        task=TaskResponse.from_orm(task),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


# ── POST /tasks/{task_id}/resume（resumeTask）────────────────────────────────

@router.post(
    "/tasks/{task_id}/resume",
    response_model=TaskTransitionResponse,
    summary="恢复任务",
)
def resume_task(
    task_id: str,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> TaskTransitionResponse:
    """resumeTask 命令（契约 §18.1）：PAUSED → PUBLISHED。"""
    task, log = task_domain.resume_task(db, task_id, actor)
    return TaskTransitionResponse(
        task=TaskResponse.from_orm(task),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


# ── POST /tasks/{task_id}/end（endTask）──────────────────────────────────────

@router.post(
    "/tasks/{task_id}/end",
    response_model=TaskTransitionResponse,
    summary="结束任务",
)
def end_task(
    task_id: str,
    body: EndTaskRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> TaskTransitionResponse:
    """endTask 命令（契约 §18.1）：PUBLISHED/PAUSED → ENDED。"""
    task, log = task_domain.end_task(db, task_id, actor, body)
    return TaskTransitionResponse(
        task=TaskResponse.from_orm(task),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )


# ── POST /tasks/{task_id}/archive（archiveTask）──────────────────────────────
# 注意：§23.1 未列出此端点，但 §18.1 定义了 archiveTask 命令，此处提前实现备用

@router.post(
    "/tasks/{task_id}/archive",
    response_model=TaskTransitionResponse,
    summary="归档任务（终态）",
)
def archive_task(
    task_id: str,
    body: ArchiveTaskRequest,
    db: Session = Depends(get_db),
    actor: Actor = Depends(require_roles("OWNER")),
) -> TaskTransitionResponse:
    """
    archiveTask 命令（契约 §18.1）：ENDED → ARCHIVED（终态）。
    不得从 DRAFT/PUBLISHED/PAUSED 直接归档（状态机保证）。
    """
    task, log = task_domain.archive_task(db, task_id, actor, body)
    return TaskTransitionResponse(
        task=TaskResponse.from_orm(task),
        auditLog=AuditLogSummaryResponse.from_orm_obj(log),
    )
