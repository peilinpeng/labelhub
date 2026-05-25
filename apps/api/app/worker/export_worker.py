# 导出异步 Worker：消费 export 队列，执行以下流程：
# 1. 读取 ExportJob 及 ExportMapping（columns/filters/format/answerSource）。
# 2. 按 filters 查询 ACCEPTED Submission（默认）。
# 3. 组装 LabelHubRuntimeContext，按 ExportColumn.sourcePath 提取字段值并应用 TransformSpec。
# 4. 生成目标格式文件（JSON/JSONL/CSV/Excel），CSV/Excel 对象值必须显式 transform。
# 5. 写入 files 表（purpose=EXPORT_RESULT）并确认 status=READY。
# 6. 执行 markExportSucceeded，更新 ExportJob.fileId 和 status→SUCCEEDED。
# 7. 失败时执行 markExportFailed，写入 errorMessage。
