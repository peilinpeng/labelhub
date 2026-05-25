# Task 领域服务：任务状态机迁移（createTask/publishTask/pauseTask/resumeTask/endTask）、
# 配额管理（quota.total/quota.perLabeler）、分发策略解析、截止时间校验。
# 每次成功状态迁移必须调用 audit_domain 写入 audit log，不得静默迁移。
