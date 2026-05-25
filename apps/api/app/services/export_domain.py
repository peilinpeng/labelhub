# Export 领域服务：导出任务创建（generateExportJob command）、ExportMapping 合法性校验
# （sourcePath 命名空间、answerSource 权限、CSV/Excel 对象值必须有 transform）、
# 字段映射执行（JsonPath 解析 RuntimeContext、TransformSpec 格式化）、
# 异步文件生成（JSON/JSONL/CSV/Excel）委托给 export_worker。
# 默认只导出 ACCEPTED submission。
