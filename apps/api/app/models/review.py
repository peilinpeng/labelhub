# review_configs / ai_review_jobs / review_results 三张表的 ORM 模型，
# 对应契约 §19 ReviewResult discriminated union、§20 AI Review Agent 契约与 §24 存储契约。
# review_results 为追加只写的不可变审计记录，无 updated_at 字段。
from sqlalchemy import (
    Column,
    String,
    Integer,
    Text,
    DateTime,
    JSON,
    Boolean,
    ForeignKey,
    UniqueConstraint,
    func,
)

from app.database import Base


class ReviewConfig(Base):
    __tablename__ = "review_configs"

    # ID 由应用层生成，前缀 cfg_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # FK → tasks.id，每个任务最多一份审核配置（UniqueConstraint 见 __table_args__）
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)

    # 契约 ReviewConfig.enabled，是否启用 AI 审核
    enabled = Column(Boolean, nullable=False, default=True)

    # 契约 ReviewConfig.modelPolicyId，LLM 模型策略标识
    model_policy_id = Column(String(255), nullable=False)

    # 契约 ReviewConfig.promptTemplate，Prompt 模板内容较长，使用 Text
    prompt_template = Column(Text, nullable=False)

    # 契约 ReviewConfig.dimensions: ReviewDimension[]
    # 每项含 {key, label, description, weight, scoreRange}
    dimensions_json = Column(JSON, nullable=False)

    # 契约 ReviewConfig.thresholds: {passScore, returnScore}
    thresholds_json = Column(JSON, nullable=False)

    # 契约 ReviewConfig.conclusionMapping: {passWhen, returnWhen, humanReviewOtherwise}
    # §20 ReviewConfig 接口明确包含此字段，不可省略
    conclusion_mapping_json = Column(JSON, nullable=False)

    # 契约 ReviewConfig.maxRetries
    max_retries = Column(Integer, nullable=False, default=3)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        # 每个任务最多一份 ReviewConfig
        UniqueConstraint("task_id", name="uq_review_configs_task_id"),
    )


class AIReviewJob(Base):
    __tablename__ = "ai_review_jobs"

    # ID 由应用层生成，前缀 job_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 契约 AIReviewJob.submissionId，FK → submissions.id
    submission_id = Column(String(64), ForeignKey("submissions.id"), nullable=False)

    # 契约 AIReviewJob.attemptNo，与 Submission.attemptNo 对应
    attempt_no = Column(Integer, nullable=False)

    # 契约 AIReviewJob.schemaVersionId，FK → schema_versions.id
    schema_version_id = Column(
        String(64), ForeignKey("schema_versions.id"), nullable=False
    )

    # 契约 AIReviewJobStatus（最长值 FAILED_TO_HUMAN_REVIEW = 22 字符，使用 String(30)）：
    #   PENDING / RUNNING / SUCCEEDED / FAILED / RETRYING / FAILED_TO_HUMAN_REVIEW
    status = Column(String(30), nullable=False, default="PENDING")

    # 契约 AIReviewJob.retryCount，已重试次数
    retry_count = Column(Integer, nullable=False, default=0)

    # 契约 AIReviewJob.maxRetries，从 ReviewConfig 复制的最大重试上限快照
    max_retries = Column(Integer, nullable=False)

    # 契约 AIReviewJob.idempotencyKey，业务幂等键格式："{submission_id}:{attempt_no}"
    # 列级 UNIQUE，确保同一幂等键不重复创建
    idempotency_key = Column(String(255), nullable=False, unique=True)

    # 契约 AIReviewJob.promptSnapshotHash，Prompt 内容的哈希
    prompt_snapshot_hash = Column(String(255), nullable=False)

    # 契约 AIReviewJob.promptSnapshotRef，可追溯的 Prompt 快照引用 ID，可空
    prompt_snapshot_ref = Column(String(64), nullable=True)

    # 契约 AIReviewJob.modelSnapshot: ModelSnapshot {provider, model, temperature?, responseFormat}
    model_snapshot_json = Column(JSON, nullable=False)

    # 契约 AIReviewJob.rawOutputRef，LLM 原始输出的文件/日志引用，契约要求必须可追溯
    raw_output_ref = Column(String(64), nullable=True)

    # 契约 AIReviewJob.failureReason，失败原因可能较长，使用 Text
    failure_reason = Column(Text, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        # 同一提交的同一次尝试只能有一个 Job
        UniqueConstraint(
            "submission_id",
            "attempt_no",
            name="uq_ai_review_jobs_submission_attempt",
        ),
    )


class ReviewResult(Base):
    __tablename__ = "review_results"

    # ID 由应用层生成，前缀 rev_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 契约 BaseReviewResultRecord.submissionId，FK → submissions.id
    submission_id = Column(String(64), ForeignKey("submissions.id"), nullable=False)

    # 契约 BaseReviewResultRecord.schemaVersionId，FK → schema_versions.id
    schema_version_id = Column(
        String(64), ForeignKey("schema_versions.id"), nullable=False
    )

    # 契约 ReviewStage，discriminant 字段区分三种记录类型：
    #   AI_PRECHECK / HUMAN_REVIEW / FINAL_REVIEW
    stage = Column(String(20), nullable=False)

    # 契约 ReviewDecision（最长 NEED_HUMAN_REVIEW = 17 字符，String(20) 足够）：
    #   AI_PRECHECK 阶段：PASS / RETURN / NEED_HUMAN_REVIEW
    #   HUMAN_REVIEW 阶段：PASS / RETURN / REJECT
    #   FINAL_REVIEW 阶段：PASS / RETURN / REJECT
    decision = Column(String(20), nullable=False)

    # 契约 §24：存储 stage 相关内容
    #   AI_PRECHECK：AIReviewResult（totalScore, dimensionScores, fieldIssues, summary, confidence）
    #   HUMAN_REVIEW / FINAL_REVIEW：patches（ReviewPatch[]）、comments（ReviewComment[]）、reason
    result_json = Column(JSON, nullable=False)

    # 契约 BaseReviewResultRecord.actor 中的 actor.id，FK → users.id
    # AI 审核时对应 SYSTEM 角色用户
    actor_id = Column(String(64), ForeignKey("users.id"), nullable=False)

    # 契约 BaseReviewResultRecord.createdAt
    # 无 updated_at：审核结果是追加只写的不可变记录，禁止修改
    created_at = Column(DateTime, nullable=False, server_default=func.now())
