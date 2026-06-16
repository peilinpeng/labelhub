# llm_call_logs 表 ORM 模型，对应契约 §12 LLMCallLog 与 §24 存储契约。
# 所有 LLM 调用（LLM Assist、AI Review、AI Schema 生成）都必须写入本表，确保可追溯。
# 本表为追加只写日志，状态流转通过 finished_at 体现，无 updated_at 字段。
# purpose 合法值（契约 §12 LLMCallLog.purpose）：
#   LLM_ASSIST / AI_REVIEW / SCHEMA_GENERATION
# status 合法值（契约 §12 LLMCallStatus）：
#   PENDING / RUNNING / SUCCEEDED / FAILED
from sqlalchemy import Column, String, Text, DateTime, Integer, ForeignKey, func

from app.database import Base


class LLMCallLog(Base):
    __tablename__ = "llm_call_logs"

    # ID 由应用层生成，前缀 llm_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 契约 LLMCallLog.purpose：LLM_ASSIST / AI_REVIEW / SCHEMA_GENERATION
    purpose = Column(String(30), nullable=False)

    # 契约 LLMCallLog.actorId，FK → users.id
    actor_id = Column(String(64), ForeignKey("users.id"), nullable=False)

    # 契约 LLMCallLog.assignmentId，purpose=LLM_ASSIST 时填写，其余为 NULL
    # FK → assignments.id
    assignment_id = Column(
        String(64), ForeignKey("assignments.id"), nullable=True
    )

    # 契约 LLMCallLog.submissionId，purpose=AI_REVIEW 时填写，其余为 NULL
    # FK → submissions.id
    submission_id = Column(
        String(64), ForeignKey("submissions.id"), nullable=True
    )

    # 契约 LLMCallLog.nodeId，触发 LLM 的 schema 节点 ID，purpose=LLM_ASSIST 时填写
    node_id = Column(String(255), nullable=True)

    # 契约 LLMCallLog.modelPolicyId
    model_policy_id = Column(String(255), nullable=False)

    # 契约 LLMCallLog.promptSnapshotHash，Prompt 内容哈希
    prompt_snapshot_hash = Column(String(255), nullable=False)

    # 契约 LLMCallLog.inputHash，输入内容哈希
    input_hash = Column(String(255), nullable=False)

    # 契约 LLMCallLog.outputHash，调用成功后由应用层填写，可空
    output_hash = Column(String(255), nullable=True)

    # 契约 LLMCallStatus：PENDING / RUNNING / SUCCEEDED / FAILED
    status = Column(String(20), nullable=False, default="PENDING")

    # 契约 LLMCallLog.errorMessage，失败时填写
    error_message = Column(Text, nullable=True)

    # Token 用量与耗时（TC-AI-07 可追溯）：调用成功后由应用层写入，可空
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)
    total_tokens = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)

    created_at = Column(DateTime, nullable=False, server_default=func.now())

    # 契约 LLMCallLog.finishedAt，由应用层在完成或失败时显式写入；无 updated_at
    finished_at = Column(DateTime, nullable=True)
