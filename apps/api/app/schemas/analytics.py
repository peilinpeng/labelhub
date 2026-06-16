"""
绩效看板（Analytics Dashboard）只读响应模型。

镜像 GET /api/v1/analytics/dashboard 的返回结构。本模块不引入新存储、不改契约，
仅对现有 llm_call_logs / submissions / review_results 做聚合后序列化。

字段命名为 API 内部口径（英文 key），前端负责翻译成中文人话，不直接展示裸字段名。
"""
from pydantic import BaseModel


class AnalyticsScope(BaseModel):
    # taskId 为空表示全局口径；非空表示按该任务过滤（SCHEMA_GENERATION 例外，见下）。
    taskId: str | None = None
    taskTitle: str | None = None


class AiCostByPurpose(BaseModel):
    purpose: str          # AI_REVIEW / LLM_ASSIST / SCHEMA_GENERATION
    scope: str            # "task" 或 "global"（SCHEMA_GENERATION 恒为 global）
    calls: int
    succeeded: int
    failed: int
    failureRate: float | None         # failed / calls，calls=0 时为 None
    totalTokens: int
    tokenCoverage: float | None       # 有 token 用量的调用占比（网关可能不返回 usage）
    avgLatencyMs: int | None


class AiCostSection(BaseModel):
    byPurpose: list[AiCostByPurpose]
    totalCalls: int
    totalTokens: int
    # taskId 非空时，SCHEMA_GENERATION 无法按任务归属，恒按全局统计；前端据此注明。
    schemaGenerationTaskScoped: bool


class LabelerRow(BaseModel):
    labelerId: str
    displayName: str
    submitted: int
    accepted: int
    returned: int
    rejected: int
    inReview: int
    acceptRate: float | None          # accepted / (accepted+returned+rejected)
    returnRate: float | None          # (returned+rejected) / (同上分母)
    avgAiScore: float | None          # 该标注员提交的 AI 预审 totalScore 均值（0-100）
    reviewerPatchedFields: int        # 审核员对其提交累计改动的字段数（返工量）


class AiQualitySection(BaseModel):
    aiRawTotal: int                   # 有 AI 原始预审结论的提交数
    byRawDecision: dict[str, int]     # {PASS, RETURN, NEED_HUMAN_REVIEW}
    humanReviewRate: float | None     # 转人工率：NEED_HUMAN_REVIEW / aiRawTotal
    evaluated: int                    # 同时有 AI 原判(PASS/RETURN)与人工终判的提交数
    agreements: int
    agreementRate: float | None       # agreements / evaluated（AI-人工一致率）


class AnalyticsDashboardResponse(BaseModel):
    scope: AnalyticsScope
    aiCost: AiCostSection
    labelers: list[LabelerRow]
    aiQuality: AiQualitySection
