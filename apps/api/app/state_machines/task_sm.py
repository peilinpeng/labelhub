# Task 状态机，对应契约第 18.1 节 Task 状态迁移表。
# 合法迁移：
#   createTask: 无 → DRAFT
#   publishTask: DRAFT → PUBLISHED（需要 schemaVersionId、dataset 已导入、reviewConfig 已配置）
#   pauseTask: PUBLISHED → PAUSED
#   resumeTask: PAUSED → PUBLISHED
#   endTask: PUBLISHED/PAUSED → ENDED
# 非法迁移必须返回 409 INVALID_STATE_TRANSITION，不得改变业务状态。
from app.middleware.error_handler import InvalidStateTransitionException


# 合法迁移表：(当前状态, 命令) → 目标状态
# createTask 不在此表中（创建时无"当前状态"，由 task_domain 直接构造 DRAFT）
_ALLOWED: dict[tuple[str, str], str] = {
    ("DRAFT",     "publishTask"): "PUBLISHED",
    ("PUBLISHED", "pauseTask"):   "PAUSED",
    ("PAUSED",    "resumeTask"):  "PUBLISHED",
    ("PUBLISHED", "endTask"):     "ENDED",
    ("PAUSED",    "endTask"):     "ENDED",
    ("ENDED",     "archiveTask"): "ARCHIVED",
}


def apply_transition(current_status: str, command: str) -> str:
    """
    校验状态迁移合法性，返回目标状态。
    非法迁移抛出 InvalidStateTransitionException（契约 §18.1）。
    ARCHIVED 为终态：不得从 DRAFT/PUBLISHED/PAUSED 直接归档。
    """
    new_status = _ALLOWED.get((current_status, command))
    if new_status is None:
        raise InvalidStateTransitionException(
            f"任务当前状态 {current_status!r} 不支持 {command!r} 命令，"
            f"合法迁移：{[k for k in _ALLOWED if k[1] == command]}"
        )
    return new_status


def get_allowed_commands(current_status: str) -> list[str]:
    """返回当前状态下所有合法命令（用于 API 响应的 allowedActions 字段）。"""
    return [cmd for (st, cmd) in _ALLOWED if st == current_status]
