# submissions 表 ORM 模型，对应契约 §6.3 Submission 与 §24 存储契约。
# status 合法值（契约 §6.3 SubmissionStatus）：
#   SUBMITTED / AI_REVIEWING / AI_PASSED / NEEDS_HUMAN_REVIEW /
#   HUMAN_REVIEWING / FINAL_REVIEWING / RETURNED / ACCEPTED / REJECTED
# answers_json 为提交当时的完整答案快照，禁止覆盖历史提交。
# (assignment_id, attempt_no) 唯一约束确保同一 Assignment 的每次打回重提都生成新记录。
from sqlalchemy import Column, String, Integer, DateTime, JSON, ForeignKey, UniqueConstraint, func

from app.database import Base


class Submission(Base):
    __tablename__ = "submissions"

    # ID 由应用层生成，前缀 sub_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 契约 Submission.assignmentId，正向指针，不加 use_alter
    # FK → assignments.id
    assignment_id = Column(String(64), ForeignKey("assignments.id"), nullable=False)

    # FK → tasks.id
    task_id = Column(String(64), ForeignKey("tasks.id"), nullable=False)

    # FK → dataset_items.id
    item_id = Column(String(64), ForeignKey("dataset_items.id"), nullable=False)

    # FK → users.id，标注员
    labeler_id = Column(String(64), ForeignKey("users.id"), nullable=False)

    # 契约 Submission.schemaVersionId，FK → schema_versions.id
    schema_version_id = Column(
        String(64), ForeignKey("schema_versions.id"), nullable=False
    )

    # 契约 Submission.attemptNo，打回后重新提交时递增，从 1 开始
    attempt_no = Column(Integer, nullable=False, default=1)

    # 契约 Submission.answers：提交当时完整答案快照，禁止覆盖历史
    answers_json = Column(JSON, nullable=False)

    # 契约 SubmissionStatus（最长值 NEEDS_HUMAN_REVIEW = 18 字符，用 String(30) 留有余量）：
    #   SUBMITTED / AI_REVIEWING / AI_PASSED / NEEDS_HUMAN_REVIEW /
    #   HUMAN_REVIEWING / FINAL_REVIEWING / RETURNED / ACCEPTED / REJECTED
    status = Column(String(30), nullable=False, default="SUBMITTED")

    # 契约 Submission.validationSnapshot：提交时的 ValidationResult 快照
    validation_json = Column(JSON, nullable=False)

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    __table_args__ = (
        # 契约规则：每次打回后重新提交必须生成新的 attemptNo，禁止覆盖历史提交
        UniqueConstraint(
            "assignment_id",
            "attempt_no",
            name="uq_submissions_assignment_attempt",
        ),
    )
