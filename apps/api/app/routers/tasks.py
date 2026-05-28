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
