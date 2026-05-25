# Task 状态机，对应契约第 18.1 节 Task 状态迁移表。
# 合法迁移：
#   createTask: 无 → DRAFT
#   publishTask: DRAFT → PUBLISHED（需要 schemaVersionId、dataset 已导入、reviewConfig 已配置）
#   pauseTask: PUBLISHED → PAUSED
#   resumeTask: PAUSED → PUBLISHED
#   endTask: PUBLISHED/PAUSED → ENDED
# 非法迁移必须返回 409 INVALID_STATE_TRANSITION，不得改变业务状态。
