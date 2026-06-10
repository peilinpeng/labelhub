# Schema draft 与 SchemaVersion 相关 Pydantic 模型，对齐契约第 7 节动态 Schema 契约与第 16 节发布流程。
# 包含：SaveSchemaDraftRequest/Response、PublishSchemaVersionRequest/Response、
# ValidateSchemaRequest/Response、GenerateSchemaRequest/Response。
# schemaDraftRevision（草稿修订号）、schemaVersionId（发布后不可变）必须严格区分，不得混用。
