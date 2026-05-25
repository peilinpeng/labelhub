# Schema 领域服务：schema draft 自动保存（schema_draft_revision 递增、并发冲突检测）、
# schema 结构校验（节点类型、FieldNode.name 唯一性、JsonPath 命名空间、
# Expression 字段引用、LLM output binding、ValidationRule 合法性）、
# schema 版本发布（冻结为不可变 PublishedLabelHubSchema 快照、生成 schemaVersionId/schemaVersionNo）、
# AI 辅助生成 schema draft（调用 LLM、写入 llm_call_logs，purpose=SCHEMA_GENERATION）。
