# 导出任务相关 Pydantic 模型，对齐契约第 21 节导出契约与第 23.6 节 Export API。
# 包含：CreateExportJobRequest/Response、GetExportJobResponse、DownloadExportResponse。
# ExportMapping 中 answerSource 取值：ORIGINAL_ANSWERS | PATCHED_ANSWERS。
# ExportColumn.sourcePath 必须使用统一 RuntimeContext 命名空间（$.task/$.item/$.answers 等）。
