# Audit 领域服务：统一写入 audit_logs，记录 actor、entity_type、entity_id、action、
# before、after、reason、requestId、createdAt。
# audit log 禁止物理删除，所有成功状态迁移都必须调用此服务写入记录。
# 批量操作（如批量审核）必须逐条写入，不允许合并批量 log。
