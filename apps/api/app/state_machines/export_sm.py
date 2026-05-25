# ExportJob 状态机，对应契约第 18.3 节 Export 状态迁移表。
# 合法迁移：
#   createExportJob: → PENDING
#   startExportJob: PENDING → RUNNING
#   markExportSucceeded: RUNNING → SUCCEEDED（需要 fileId）
#   markExportFailed: PENDING/RUNNING → FAILED（需要 errorMessage）
#   cancelExportJob: PENDING/RUNNING → CANCELED（OWNER 角色触发）
