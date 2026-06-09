# Task 相关 Pydantic 请求/响应模型，对齐契约第 6.1 节 Task 领域模型与第 16 节发布流程。
# 包含：CreateTaskRequest、UpdateTaskRequest、PublishTaskRequest/Response、
# PauseTaskRequest、ResumeTaskRequest、EndTaskRequest、TaskResponse。
# TaskStatus 取值：DRAFT | PUBLISHED | PAUSED | ENDED | ARCHIVED。

from typing import Literal
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# 契约 §13 ServerComponentRegistryItem（组件注册表 API 响应模型）
# ---------------------------------------------------------------------------

class ServerComponentRegistryItem(BaseModel):
    """服务端权威组件注册表条目，对应契约 §13 ServerComponentRegistryItem。"""
    type: str
    # 节点分类：INPUT=文本输入 CHOICE=选择 UPLOAD=上传 DATA=结构化数据
    #          SHOW=展示 AI=AI辅助 LAYOUT=布局容器
    category: Literal["INPUT", "CHOICE", "UPLOAD", "DATA", "SHOW", "AI", "LAYOUT"]
    # 答案值类型：NONE=不产生答案值 STRING=字符串 STRING_ARRAY=字符串数组
    #            FILE_ARRAY=文件引用数组 JSON=任意JSON RICH_TEXT=富文本AST
    valueKind: Literal["NONE", "STRING", "STRING_ARRAY", "FILE_ARRAY", "JSON", "RICH_TEXT"]
    # 后端归一化器 key（格式 normalizers.xxx），供提交校验时调用
    normalizer: str
    # 后端校验器 key 列表（格式 validators.xxx），供 schema validate 时调用
    validators: list[str]
    # 导出时的值类型
    exportValueType: Literal["TEXT", "NUMBER", "BOOLEAN", "JSON", "FILE_URLS"]
    # 允许在此 node type 上使用的 ValidationRule 类型（契约 §15 ValidationRuleType）
    allowedValidationRules: list[
        Literal[
            "required", "minLength", "maxLength", "regex",
            "minItems", "maxItems", "jsonSchema", "file",
            "custom", "conditional",
        ]
    ]
    # 是否默认参与提交（FieldNode=True，ShowItem/Container/LLMAssist=False）
    defaultSubmitEnabled: bool
    # 是否默认参与导出
    defaultExportEnabled: bool
    # 是否默认纳入 AI Review 上下文
    defaultAiReviewEnabled: bool


# ---------------------------------------------------------------------------
# 以下为 Task CRUD 与状态迁移相关的 Pydantic 请求/响应模型（契约 §6.1 / §16 / §18.1 / §23.1）
# ---------------------------------------------------------------------------

from datetime import datetime
from typing import Annotated, Any  # Literal 已在上方导入，不重复
from pydantic import ConfigDict, Field  # BaseModel 已在上方导入，不重复


# ── 子结构体 ────────────────────────────────────────────────────────────────

class QuotaSchema(BaseModel):
    """契约 Task.quota"""
    total: int = Field(..., ge=1, description="总配额")
    perLabeler: int | None = Field(None, ge=1, description="单 Labeler 最大领取数")


class RewardRuleSchema(BaseModel):
    """契约 Task.rewardRule（可选）"""
    unit: Literal["PER_ACCEPTED_ITEM", "PER_SUBMISSION", "FIXED"]
    amount: float = Field(..., ge=0)
    currency: str | None = None


# DistributionStrategy discriminated union
class FirstComeFirstServedStrategy(BaseModel):
    type: Literal["FIRST_COME_FIRST_SERVED"]

class AssignmentStrategy(BaseModel):
    type: Literal["ASSIGNMENT"]
    assigneeIds: list[str] = Field(..., min_length=1)

class QuotaClaimStrategy(BaseModel):
    type: Literal["QUOTA_CLAIM"]
    claimBatchSize: int = Field(..., ge=1)

DistributionStrategySchema = Annotated[
    FirstComeFirstServedStrategy | AssignmentStrategy | QuotaClaimStrategy,
    Field(discriminator="type"),
]


# ReviewPolicy discriminated union
class SingleReviewPolicy(BaseModel):
    type: Literal["SINGLE_REVIEW"]

class DoubleReviewPolicy(BaseModel):
    type: Literal["DOUBLE_REVIEW"]
    requireFinalReview: Literal[True]

ReviewPolicySchema = Annotated[
    SingleReviewPolicy | DoubleReviewPolicy,
    Field(discriminator="type"),
]


# ── 审计日志摘要（契约 §25 AuditLogSummary）──────────────────────────────────

class AuditLogSummaryResponse(BaseModel):
    """契约 §25 AuditLogSummary（响应时使用）"""
    id: str
    action: str
    createdAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm_obj(cls, log: Any) -> "AuditLogSummaryResponse":
        return cls(id=log.id, action=log.action, createdAt=log.created_at)


# ── Task 响应体（契约 §6.1 Task）─────────────────────────────────────────────

class TaskResponse(BaseModel):
    """契约 §6.1 Task 完整响应，JSON 字段以原始 dict 透传，camelCase 与契约对齐。"""
    id: str
    title: str
    description: str
    instructionRichText: dict | None = None
    tags: list[str]
    rewardRule: dict | None = None
    quota: dict
    deadlineAt: datetime | None = None
    distributionStrategy: dict
    reviewPolicy: dict
    status: str
    activeSchemaVersionId: str | None = None
    ownerId: str
    createdAt: datetime
    updatedAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, t: Any) -> "TaskResponse":
        """从 Task ORM 对象构造响应，将 snake_case 映射到 camelCase。"""
        return cls(
            id=t.id,
            title=t.title,
            description=t.description,
            instructionRichText=t.instruction_rich_text_json,
            tags=t.tags_json or [],
            rewardRule=t.reward_rule_json,
            quota=t.quota_json,
            deadlineAt=t.deadline_at,
            distributionStrategy=t.distribution_strategy_json,
            reviewPolicy=t.review_policy_json,
            status=t.status,
            activeSchemaVersionId=t.active_schema_version_id,
            ownerId=t.owner_id,
            createdAt=t.created_at,
            updatedAt=t.updated_at,
        )


# ── 创建任务（POST /tasks）───────────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    """createTask 命令入参（契约 §18.1：required title）"""
    title: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    instructionRichText: dict | None = None
    tags: list[str] = []
    rewardRule: RewardRuleSchema | None = None
    quota: QuotaSchema
    deadlineAt: datetime | None = None
    distributionStrategy: DistributionStrategySchema
    reviewPolicy: ReviewPolicySchema

class CreateTaskResponse(BaseModel):
    task: TaskResponse
    auditLog: AuditLogSummaryResponse


# ── 更新任务（PATCH /tasks/:taskId，仅 DRAFT 状态允许）──────────────────────

class UpdateTaskRequest(BaseModel):
    """所有字段均可选，仅更新传入的字段，不传的字段保持不变。"""
    title: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    instructionRichText: dict | None = None
    tags: list[str] | None = None
    rewardRule: RewardRuleSchema | None = None
    quota: QuotaSchema | None = None
    deadlineAt: datetime | None = None
    distributionStrategy: DistributionStrategySchema | None = None
    reviewPolicy: ReviewPolicySchema | None = None


# ── 发布任务（POST /tasks/:taskId/publish）──────────────────────────────────

class PublishTaskRequest(BaseModel):
    """publishTask 命令入参（契约 §16 / §18.1）"""
    schemaVersionId: str = Field(..., description="待激活的 SchemaVersion ID")
    reviewConfigId: str | None = Field(None, description="AI 审核配置 ID，可选")
    reviewDisabledExplicitly: bool = Field(False, description="显式声明不使用 AI 审核")

class PublishTaskResponse(BaseModel):
    task: TaskResponse
    auditLog: AuditLogSummaryResponse


# ── 暂停/恢复/结束/归档任务（各状态迁移命令）────────────────────────────────

class PauseTaskRequest(BaseModel):
    reason: str | None = None

class ResumeTaskRequest(BaseModel):
    pass

class EndTaskRequest(BaseModel):
    reason: str | None = None

class ArchiveTaskRequest(BaseModel):
    reason: str | None = None

class TaskTransitionResponse(BaseModel):
    """pauseTask / resumeTask / endTask / archiveTask 统一响应结构"""
    task: TaskResponse
    auditLog: AuditLogSummaryResponse


# ── Schema 相关请求/响应模型（契约 §7 / §16 / §23.1）──────────────────────────

class SchemaValidationResultResponse(BaseModel):
    """契约 §7 SchemaValidationResult"""
    valid: bool
    errors: list[str]


class SaveSchemaDraftRequest(BaseModel):
    """PUT /tasks/{taskId}/schema/draft 请求体"""
    schema: dict = Field(..., description="完整 LabelHubSchema JSON")
    baseSchemaDraftRevision: int | None = Field(
        None,
        description="并发控制：客户端持有的修订号，传入则校验冲突",
    )


class SaveSchemaDraftResponse(BaseModel):
    """PUT /tasks/{taskId}/schema/draft 响应体"""
    schema: dict
    schemaDraftRevision: int
    validation: SchemaValidationResultResponse
    auditLog: AuditLogSummaryResponse

    model_config = ConfigDict(from_attributes=True)


class SchemaDraftResponse(BaseModel):
    """GET /tasks/{taskId}/schema/draft 响应体"""
    taskId: str
    schema: dict
    schemaDraftRevision: int
    updatedBy: str
    updatedAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, d: Any) -> "SchemaDraftResponse":
        return cls(
            taskId=d.task_id,
            schema=d.schema_json,
            schemaDraftRevision=d.schema_draft_revision,
            updatedBy=d.updated_by,
            updatedAt=d.updated_at,
        )


class PublishSchemaVersionRequest(BaseModel):
    """POST /tasks/{taskId}/schema/publish 请求体"""
    schemaDraftRevision: int = Field(
        ...,
        description="发布时必须与当前 draft 修订号一致（并发控制）",
    )


class SchemaVersionResponse(BaseModel):
    """契约 §7 SchemaVersion 响应体（GET /schema-versions/{id} 使用）"""
    id: str
    taskId: str
    schemaId: str
    schemaVersionNo: int
    contractVersion: str
    schema: dict
    publishedAt: datetime

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm(cls, v: Any) -> "SchemaVersionResponse":
        return cls(
            id=v.id,
            taskId=v.task_id,
            schemaId=v.schema_id,
            schemaVersionNo=v.schema_version_no,
            contractVersion=v.contract_version,
            schema=v.schema_json,
            publishedAt=v.published_at,
        )


class ListSchemaVersionsResponse(BaseModel):
    """GET /tasks/{taskId}/schema-versions 响应体：某任务的版本历史（倒序）。"""
    schemaVersions: list[SchemaVersionResponse]


class PublishSchemaVersionResponse(BaseModel):
    """POST /tasks/{taskId}/schema/publish 响应体"""
    schemaVersion: SchemaVersionResponse
    auditLog: AuditLogSummaryResponse


class ValidateSchemaRequest(BaseModel):
    """POST /schema/validate 请求体"""
    schema: dict = Field(..., description="待校验的 LabelHubSchema JSON")


class ValidateSchemaResponse(BaseModel):
    """POST /schema/validate 响应体"""
    valid: bool
    errors: list[str]


# ---------------------------------------------------------------------------
# AI 生成 Schema 草稿（POST /tasks/{taskId}/schema/ai-generate）
# 对齐契约 §api.ts GenerateSchemaRequest / GenerateSchemaResponse
# ---------------------------------------------------------------------------

class GenerateSchemaRequest(BaseModel):
    """POST /tasks/{taskId}/schema/ai-generate 请求体"""
    taskDescription: str = Field(..., description="任务描述，作为生成 Schema 的主要上下文")
    sampleItems: list[dict] | None = Field(None, description="可选：样例题目，辅助模型理解数据结构")
    preferredNodeTypes: list[str] | None = Field(None, description="可选：期望使用的节点类型")


class GeneratedByResponse(BaseModel):
    """AI 生成可追溯信息（契约 GenerateSchemaResponse.generatedBy）"""
    modelPolicyId: str
    promptSnapshotHash: str
    llmCallId: str


class GenerateSchemaResponse(BaseModel):
    """POST /tasks/{taskId}/schema/ai-generate 响应体"""
    schemaDraft: dict
    validation: SchemaValidationResultResponse
    warnings: list[str] = []
    generatedBy: GeneratedByResponse
