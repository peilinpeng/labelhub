"""对应共享 governance.ts；额外字段拒绝接收，防止伪造审批与执行结果。"""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

TaskPermission = Literal[
    "task.read", "task.manage", "schema.write", "dataset.manage", "export.create", "analytics.read",
    "migration.read", "migration.plan", "migration.approve", "migration.execute", "permissions.manage",
    "review.work", "labeling.work",
]


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateTaskPermissionRequest(StrictRequest):
    userId: str = Field(min_length=5, max_length=64, pattern=r"^usr_")
    actions: list[TaskPermission] = Field(min_length=1, max_length=13)
    effect: Literal["ALLOW", "DENY"]
    expiresAt: datetime | None = None


class CreateMigrationJobRequest(StrictRequest):
    fromSchemaVersionId: str = Field(max_length=64, pattern=r"^sv_")
    toSchemaVersionId: str = Field(max_length=64, pattern=r"^sv_")
    submissionIds: list[str] = Field(min_length=1, max_length=500)
    renameMap: dict[str, str] = Field(default_factory=dict)
    defaults: dict[str, object] = Field(default_factory=dict)
    optionValueMap: dict[str, dict[str, str]] = Field(default_factory=dict)
    archiveRemovedFields: bool = False

    @field_validator("submissionIds")
    @classmethod
    def unique_ids(cls, values):
        if len(set(values)) != len(values) or any(not value.startswith("sub_") or len(value) > 64 for value in values):
            raise ValueError("提交 ID 必须合法且不重复")
        return sorted(values)


class MigrationDecisionRequest(StrictRequest):
    checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def nonempty_reason(cls, value):
        if not value.strip():
            raise ValueError("审批原因不能为空")
        return value.strip()
