# LabelHub Schema Version Management 实施规格文档

## 1. 模块定位

Schema Version Management 是 LabelHub 动态表单系统的核心可靠性模块。它解决的不是“如何给 Schema 存一个版本号”，而是动态表单模板在长期演化过程中如何保证历史数据安全、变更可控、迁移可追踪。

本模块的核心原则是：

> 默认不迁移，变更必知情，迁移留痕迹。

对应机制：

1. 默认不迁移：旧任务和旧答卷永远绑定创建时的 `schemaVersionId`，不被新 Schema 污染。
2. 变更必知情：发布新版本前自动检测 Breaking Changes，让管理员知道哪些改动会破坏已有数据。
3. 迁移留痕迹：确实需要迁移历史数据时，必须经过 Dry Run、审批、执行、审计记录四步流程。

本模块分为四层：

1. Version Freeze：版本冻结
2. Breaking Change Detection：破坏性变更检测
3. Deprecation：字段废弃与软过渡机制
4. Migration Pipeline：显式数据迁移管道

---

## 2. 当前代码基础

### 2.1 Schema 生命周期基础

当前 Schema 已经包含：

- `contractVersion`
- `schemaId`
- `schemaVersionId?`
- `schemaVersionNo?`
- `schemaDraftRevision`
- `status`
- `meta`
- `root`

其中 `status: "DRAFT"` 和 `schemaDraftRevision` 已经为草稿编辑、发布版本、版本冻结提供了基础结构。

### 2.2 RuntimeContext 中已有版本概念

当前 `LabelHubRuntimeContext` 中已经出现：

- `task.activeSchemaVersionId`
- `schema.schemaVersionId`
- `schema.schemaVersionNo`
- `schema.contractVersion`

这说明系统已经具备“任务绑定 Schema 版本”的雏形。

### 2.3 Schema Guards 已有发布前检查基础

当前 `schema-guards.ts` 已经支持：

- `node.id` 全局唯一检查
- `FieldNode.name` 全局唯一检查
- `node.type` 是否来自 server registry
- `FieldNode.name` 是否存在
- `ShowItem.sourcePath` 是否使用合法 RuntimeContext namespace
- Expression 中 JsonPath 是否安全
- LLM outputBinding 是否指向真实 `FieldNode.name`
- LLM outputBinding 的 `requireUserConfirm` 是否为 true

这些能力可以扩展成 Breaking Change Detection 和 Deprecation 检查的基础。

### 2.4 Runtime Validation 已有答案校验基础

当前 `validation.ts` / `normalization.ts` 已经支持：

- 根据 FieldNode 收集可提交字段
- 移除 unknown field
- 根据 visible / hidden / disabled 规则决定字段是否提交
- 校验 `choice.radio` / `choice.select` 必须提交 string
- 校验 `choice.checkbox` / `choice.tags` 必须提交 string[]
- 校验选项值必须来自 `schema.options`
- 校验 required / minLength / maxLength / regex / file / conditional 等规则

这些能力可以复用于 Migration Pipeline 中的迁移后校验。

---

## 3. 总体目标

Schema Version Management 模块需要实现以下目标：

1. 旧答卷永远可以用创建时绑定的旧 Schema 正确渲染、校验、审核和导出。
2. 已发布 SchemaVersion snapshot 不可被原地修改。
3. 发布新 Schema 前自动识别安全变更、需确认变更、破坏性变更和需要迁移的变更。
4. 为危险字段变更提供 Deprecation 软过渡机制。
5. 为管理员提供受控 Migration Pipeline。
6. 为每次迁移生成可审计、可追踪、可校验的 Migration Record。
7. schema-core 保持为纯 TypeScript 规则内核，不直接访问数据库，不直接控制后端状态机。
8. 导出行为必须遵守版本冻结原则，不得在无明确 mapping 的情况下用新 Schema 自动解释旧 answers。

---

## 4. 架构边界

### 4.1 schema-core 负责

schema-core 只负责确定性规则计算和纯函数逻辑：

- 检查 Published Schema 是否被非法修改
- 检查 Submission 绑定的 `schemaVersionId` 是否与加载的 Schema 匹配
- 对比 oldSchema 和 newSchema 的字段变化
- 判断 Schema 变更风险等级
- 检查 deprecated 字段配置是否合法
- 生成 Migration Plan
- 执行 Dry Run Migration
- 对 answers 执行纯函数式迁移
- 输出 Migration Report / Migration Record Draft
- 提供 `stableStringify` 或 checksum 输入材料
- 输出 conflict / skipped records，但不处理数据库写入冲突
- 输出 Manual Mapping Slots，但不负责管理员交互
- 引用并使用 @labelhub/contracts 中的 Export 相关共享类型，但不负责真实文件导出

schema-core 不负责：

- 数据库读写
- 后端 API 调用
- 管理员审批状态机
- audit log 持久化
- 批量更新真实 submissions
- 权威 SHA-256 checksum 生成
- 真正的并发写入控制
- 执行外部 custom transform
- 执行 export 文件生成

### 4.2 后端负责

后端负责持久化、状态、权限和事务：

- 保存 SchemaVersion 快照
- 保证 Published Schema 不可被更新
- 创建和保存 Migration Plan
- 管理 Dry Run → Approval → Execution 状态机
- 管理管理员审批权限
- 真正批量更新数据库中的 submissions
- 执行 migration 时对每条 submission 做乐观锁检查
- 保存 archivedAnswers 独立归档记录
- 写入不可变 audit log
- 生成权威 SHA-256 checksum
- 返回 migration history
- 控制并发发布与版本号唯一性
- 管理 custom transform allowlist / registry
- 管理 export API、export audit record 和导出文件生成

### 4.3 前端负责

前端负责展示和交互：

- 展示 Breaking Change 检测结果
- 展示 Deprecation warning
- 展示 Dry Run Report
- 提供 `renameMap` / `defaultValues` / `optionValueMap` 等人工映射入口
- 展示 Manual Mapping Slots，并允许管理员补全
- 提供管理员审批确认界面
- 展示 Migration Timeline / Audit Log
- 阻止用户误以为迁移是自动发生的
- 提供 Export Mode 选择入口
- 展示 Unified Export warnings

---

## 5. Implementation Decisions

### Decision 1：Published Schema 的不可变粒度

Published SchemaVersion snapshot 完全不可变。以下内容一旦发布，不允许原地修改：

- `root`
- `children`
- `fields`
- `validations`
- `visibleWhen`
- `disabledWhen`
- `options`
- `outputBindings`
- `contractVersion`
- `schemaVersionId`
- `schemaVersionNo`

如果只是展示层错别字，例如 schema 展示名称、描述、标签等，应存储在外部 metadata patch 中，而不是修改不可变 SchemaVersion snapshot。

建议后端单独维护：

```ts
type SchemaVersionDisplayMetadata = {
  schemaVersionId: string;
  displayName?: string;
  displayDescription?: string;
  tags?: string[];
  updatedBy: string;
  updatedAt: string;
};
```

`assertPublishedSchemaImmutable` 只检查 immutable SchemaVersion snapshot，不检查外部 display metadata patch。

### Decision 2：`required: false → true` 的风险等级

在静态 compatibility 检查中，`required: false → true` 统一归类为：

```txt
NEEDS_APPROVAL
```

它不默认归类为 BREAKING，因为历史 Task 和 Submission 仍然绑定旧 `schemaVersionId`，不会自动拿新 Schema 校验。

只有当管理员显式迁移或重新校验历史 submissions 时，它才成为 migration / dry run 阶段需要报告的影响项。

### Decision 3：Deprecation 与 Breaking Change Detection 的关系

Deprecation 不等于删除。

如果字段仍然存在，只是标记为 deprecated：

```txt
oldComment: normal field
→
oldComment: deprecated field
```

这不是 breaking change，而是：

```txt
DEPRECATED_FIELD_MARKED
level: NEEDS_APPROVAL / WARNING
```

如果字段 `deprecated + hideForNewSubmissions: true`，也不算删除，因为字段仍然存在，历史回放和审核仍可读取。

真正删除字段时才进入 Breaking Change / Migration 判断：

- 未经过 deprecation 直接删除：`BREAKING`
- 已 deprecated 后删除，并提供 archive / migration 策略：`MIGRATION_REQUIRED`

### Decision 4：Dry Run 的 sampleBeforeAfter 取样规则

`sampleBeforeAfter` 必须使用 deterministic prioritized sampling，不使用随机取样。

默认：

```txt
sampleLimit = 10
```

优先级：

1. 有 blocking issue 的 submissions
2. migration 后 validation failed 的 submissions
3. 包含 `archivedAnswers` 的 submissions
4. 包含 `RENAME_FIELD` 的 submissions
5. 包含 `CAST_VALUE` 的 submissions
6. 包含 `ADD_DEFAULT` 的 submissions
7. 其他 affected submissions

同一优先级内按 `submissionId` 排序，保证报告稳定。

### Decision 5：archivedAnswers 的存储位置

`archivedAnswers` 是独立归档结构，不属于迁移后的 `answers`。

迁移后的结构应区分：

```ts
{
  answers: {
    // 只包含 target schema 能解释的字段
  },
  archivedAnswers: {
    // 被删除字段的旧值
  }
}
```

`archivedAnswers` 不参与常规 `normalizeAnswers` / `validateAnswers` 流程，只用于历史回放、审计和 migration record。

后端应以独立 archive record 存储：

```ts
type SubmissionAnswerArchive = {
  archiveId: string;
  submissionId: string;
  migrationId: string;
  fromSchemaVersionId: string;
  toSchemaVersionId: string;
  archivedAnswers: Record<string, unknown>;
  createdAt: string;
};
```

### Decision 6：Migration 执行阶段必须支持逐条并发冲突检测

Migration Plan / Dry Run 阶段应记录每条 submission 的 `version` 或 `updatedAt`。

Execute 阶段写入时，后端必须再次检查 submission 的 `version` / `updatedAt`。如果不一致，该条 submission 不允许被覆盖，应跳过并标记为 `CONFLICT`。

schema-core 可以输出冲突结构，但真正的 CAS 写入由后端完成。

建议后端更新逻辑：

```sql
UPDATE submissions
SET answers = ?, schema_version_id = ?, version = version + 1
WHERE submission_id = ?
  AND version = ?
```

如果 affected rows = 0，则该条 migration 写入失败，标记为 `CONFLICT`。

### Decision 7：Manual Mapping 必须作为可补全 Slot 暴露给前端

`REQUIRE_MANUAL_MAPPING` 不只是错误提示，而是一个可补全的 mapping slot。

流程：

```txt
createMigrationPlan
  → 发现无法自动判断
  → 输出 manualMappingSlots
  → 前端展示下拉框 / 连线图
  → 管理员补全 mapping
  → 重新生成 MigrationPlan
  → 再 Dry Run
  → 再审批执行
```

管理员补全 mapping 后，不允许直接 execute，必须重新 Dry Run。

### Decision 8：Export 不能破坏版本冻结原则

导出不能在没有明确 mapping 或 migration result 的情况下，用新 Schema 自动解释旧 answers。

导出模块必须支持多种 export mode。默认模式应保留 schema version 语义。

### Decision 9：stableStringify 与 checksum 必须有明确边界

schema-core 负责提供 canonical serialization，即 `stableStringify`。后端负责生成权威 SHA-256 checksum。

如果后端和 schema-core 同为 TypeScript / Node.js，可以直接复用 schema-core 的 `stableStringify`。如果后端使用其他语言，则必须实现同一套 `canonical-json-v1` 规则，并通过跨实现测试保证输出一致。

所有 checksum input 必须记录：

```txt
canonicalSerializationVersion
checksumAlgorithm
checksumInput
```

如果暂时无法完成跨语言 canonical serialization 实现，后端应直接基于 schema-core 输出的 canonical string 生成 checksum，避免不同语言序列化差异造成 checksum 不一致。

### Decision 10：CUSTOM_TRANSFORM 必须由后端 allowlist 控制

`CUSTOM_TRANSFORM` 是扩展预留能力，不允许执行任意动态代码。

`transformFnId` 不是动态代码，必须来自后端预定义 allowlist / enum。前端和 schema 不得传入函数体，不得传入任意脚本，不允许使用 `eval` / `new Function`，schema-core 不执行 `CUSTOM_TRANSFORM`。

后端执行 `CUSTOM_TRANSFORM` 前必须校验 transform 是否在 allowlist 中。

### Decision 11：Unified Export mapping 必须有确定性查找顺序

Unified Export 使用 target schema 作为统一表头时，必须按照固定优先级查找字段值。

禁止使用字段名相似度、语义猜测、LLM 推断或类型相似度自动回填字段。

查找顺序必须固定：

1. 如果 submission 已经属于 `targetSchemaVersionId`，直接读取自身 answers。
2. 如果指定了 `migrationId`，优先查找该 migration result。
3. 如果没有指定 `migrationId`，查找已审批的 MigrationRecord。
4. 没有 MigrationRecord 时，允许同名字段兼容回填，但必须字段 type 兼容。
5. 只有存在明确 archive mapping 时，才能从 `archivedAnswers` 回填。
6. 以上都不满足时，留空并输出 `ExportWarning`。

---

## 6. 需要扩展的 @labelhub/contracts 类型

Schema Version Management 不应只在 schema-core 内部新增类型。由于 Compatibility Report、Deprecation 配置、Migration Plan、Dry Run Report、Manual Mapping Slots、Export Options 都需要被 schema-core、后端 API、Designer UI 共同使用，因此共享类型应优先定义在 `@labelhub/contracts` 中。

### 6.1 FieldNode 扩展

```ts
export interface FieldDeprecationConfig {
  deprecated: boolean;
  reason?: string;
  replacementFieldName?: string;
  hideForNewSubmissions?: boolean;
  readonlyForNewSubmissions?: boolean;
  plannedRemovalSchemaVersionNo?: number;
}

export interface FieldNode {
  // ... existing fields
  deprecation?: FieldDeprecationConfig;
}
```

### 6.2 Schema Version 元数据扩展

当前 contracts 中已经存在 `SchemaVersion` 和 `SchemaVersionRef`。Batch 1 不应直接新增一个与现有类型职责重叠的版本信息类型。

Batch 1 的处理规则：

1. 先审查并复用现有 `SchemaVersion` / `SchemaVersionRef`。
2. 如果现有类型已经可以表达 immutable snapshot metadata，则只做最小字段扩展。
3. 只有当现有类型无法表达发布快照的不可变元数据时，才新增辅助类型。
4. 不允许在 schema-core、schema-designer 或 apps/web 中私自定义重复版本类型。

发布后的 SchemaVersion 快照必须能追溯：

```txt
schemaId
schemaVersionId
schemaVersionNo
previousVersionId, if supported
snapshot immutability metadata
```

### 6.3 Visibility Mode

当前 contracts 中已经存在 `RendererMode`：

```ts
export type RendererMode =
  | "LABELING"
  | "REVIEW_READONLY"
  | "REVIEW_DIFF"
  | "PREVIEW";
```

`RendererMode` 是 renderer 的 UI 渲染模式，不应被复用为 schema-core 的语义可见性模式。

Batch 1 应新增独立的 `SchemaVisibilityMode`：

```ts
export type SchemaVisibilityMode =
  | "CREATE"
  | "EDIT"
  | "REVIEW"
  | "READONLY"
  | "HISTORICAL";
```

职责边界：

1. `RendererMode` 决定 UI 用 Labeler、Reviewer、Diff 还是 Preview 方式渲染。
2. `SchemaVisibilityMode` 决定 schema-core 在 visibility / deprecation 判断中使用哪种业务语义。
3. schema-renderer / schema-designer 调用 schema-core 时负责把 `RendererMode` 映射成 `SchemaVisibilityMode`。

建议映射：

```txt
PREVIEW -> CREATE
LABELING -> CREATE / EDIT，由页面或 assignment 状态决定
REVIEW_READONLY -> REVIEW
REVIEW_DIFF -> REVIEW
```

### 6.4 RuntimeContext 扩展

当前 `LabelHubRuntimeContext` 位于：

```txt
packages/contracts/src/global.ts
```

当前 `RuntimeContextWithOutput` 位于：

```txt
packages/schema-core/src/json-path.ts
```

Batch 1 应将 `RuntimeContextWithOutput` 或等价类型提升到 `packages/contracts/src/global.ts`，schema-core 后续从 `@labelhub/contracts` 引用。

不允许在 schema-core 和 contracts 中长期保留两个同名但不同源的类型。迁移 import 应单独进行，不要夹在无关功能里。

建议扩展：

```ts
export interface RuntimeContextWithOutput extends LabelHubRuntimeContext {
  output?: unknown;
  visibilityMode?: SchemaVisibilityMode;
}
```

`resolveNodeVisibility` 后续应支持显式 options：

```ts
resolveNodeVisibility(node, context, {
  visibilityMode?: SchemaVisibilityMode;
})
```

优先级：

```txt
options.visibilityMode > context.visibilityMode > default visibility mode
```

### 6.5 Compatibility 类型

```ts
export type CompatibilityLevel =
  | "SAFE"
  | "NEEDS_APPROVAL"
  | "BREAKING"
  | "MIGRATION_REQUIRED";

export type SchemaChange = {
  code: string;
  level: CompatibilityLevel;
  fieldName?: string;
  nodeId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  message: string;
  recommendation?: string;
};

export type CompatibilityReport = {
  compatible: boolean;
  publishAllowed: boolean;
  requiresApproval: boolean;
  requiresMigration: boolean;
  changes: SchemaChange[];
  blockingChanges: SchemaChange[];
  warnings: SchemaChange[];
  recommendations: string[];
};
```

### 6.6 Migration 类型

```ts
export type MigrationOperation =
  | { op: "KEEP_FIELD"; fieldName: string }
  | { op: "RENAME_FIELD"; from: string; to: string }
  | { op: "CAST_VALUE"; fieldName: string; fromType: string; toType: string }
  | { op: "ARCHIVE_FIELD"; fieldName: string }
  | { op: "ADD_DEFAULT"; fieldName: string; defaultValue: unknown }
  | { op: "MAP_OPTION_VALUE"; fieldName: string; fromValue: string; toValue: string }
  | {
      op: "REQUIRE_MANUAL_MAPPING";
      fromFieldName: string;
      candidateFieldNames: string[];
      reason: string;
    }
  | {
      op: "CUSTOM_TRANSFORM";
      transformFnId: CustomTransformId | string;
      fieldNames: string[];
      reason: string;
    };
```

`CUSTOM_TRANSFORM` 只作为扩展预留，不在第一版中自动执行。它必须由后端注册安全的 `transformFnId`，不能在前端或 schema 中直接传入任意函数。

如果当前阶段不希望在 contracts 中固定 `CustomTransformId` 枚举，也可以先保留 `transformFnId: string`，但后端必须按 allowlist 校验。

### 6.7 Manual Mapping Slot 类型

```ts
export type ManualMappingSlotKind =
  | "FIELD_RENAME"
  | "OPTION_VALUE_MAP"
  | "CUSTOM_TRANSFORM";

export type ManualMappingSlot = {
  slotId: string;
  kind: ManualMappingSlotKind;
  fromFieldName?: string;
  candidateFieldNames?: string[];
  fromValue?: string;
  candidateValues?: string[];
  reason: string;
  required: true;
  resolved: boolean;
};
```

`MigrationPlan` 应包含：

```ts
manualMappingSlots: ManualMappingSlot[];
```

如果 `manualMappingSlots` 中存在 `resolved: false` 的项目，则 `MigrationPlan.executable` 必须为 `false`。

### 6.8 Migration Submission 输入类型

```ts
export type MigrationSubmissionInput = {
  submissionId: string;
  schemaVersionId: string;
  answers: AnswerPayload;
  version?: number;
  updatedAt?: string;
  submittedAt?: string;
};
```

`version` / `updatedAt` 用于后端执行阶段的乐观锁检测。

### 6.9 Migration Skipped Submission 类型

```ts
export type MigrationSkippedSubmission = {
  submissionId: string;
  reason: "CONFLICT" | "VALIDATION_FAILED" | "OUT_OF_SCOPE" | "BLOCKED";
  expectedVersion?: number;
  actualVersion?: number;
  expectedUpdatedAt?: string;
  actualUpdatedAt?: string;
  message: string;
};
```

### 6.10 Migration Plan 类型

```ts
export type MigrationPlan = {
  migrationPlanId?: string;
  fromSchemaVersionId?: string;
  toSchemaVersionId?: string;
  operations: MigrationOperation[];
  manualMappingSlots: ManualMappingSlot[];
  executable: boolean;
  blockingIssues: string[];
  warnings: string[];
  checksumInput: unknown;
  canonicalSerializationVersion?: CanonicalSerializationVersion;
  cutoffSubmittedAt?: string;
  includedSubmissionIds?: string[];
};
```

### 6.11 Migration Dry Run Report 类型

```ts
export type MigrationDryRunReport = {
  totalSubmissions: number;
  affectedSubmissions: number;
  executable: boolean;
  operationStats: Array<{
    op: string;
    count: number;
    fieldName?: string;
  }>;
  archivedFieldStats: Array<{
    fieldName: string;
    count: number;
  }>;
  validationErrors: Array<{
    submissionId: string;
    fieldName?: string;
    message: string;
  }>;
  sampleBeforeAfter: Array<{
    submissionId: string;
    before: AnswerPayload;
    after: AnswerPayload;
    archivedAnswers?: AnswerPayload;
  }>;
  skippedSubmissions: MigrationSkippedSubmission[];
  blockingIssues: string[];
  samplingPolicy: {
    sampleLimit: number;
    strategy: "PRIORITIZED_DETERMINISTIC";
    priorityOrder: string[];
  };
};
```

### 6.12 Migration Execution Result 类型

```ts
export type MigrationExecutionResult = {
  migratedSubmissions: Array<{
    submissionId: string;
    fromSchemaVersionId?: string;
    toSchemaVersionId?: string;
    answers: AnswerPayload;
    archivedAnswers?: AnswerPayload;
    expectedVersion?: number;
    expectedUpdatedAt?: string;
  }>;
  skippedSubmissions: MigrationSkippedSubmission[];
  conflictCount: number;
  recordDraft: {
    operationCount: number;
    migratedCount: number;
    skippedCount: number;
    conflictCount: number;
    generatedAt: string;
    checksumInput: unknown;
    canonicalSerializationVersion?: CanonicalSerializationVersion;
  };
};
```

### 6.13 Export 类型

```ts
export type ExportMode =
  | "VERSIONED"
  | "UNIFIED"
  | "MIGRATION_RESULT";

export type ExportFieldMapping = {
  fromSchemaVersionId: string;
  toSchemaVersionId: string;
  fromFieldName?: string;
  fromArchivedField?: string;
  toFieldName: string;
  operation: "DIRECT" | "RENAME_FIELD" | "CAST_VALUE" | "MAP_OPTION_VALUE" | "ARCHIVE_RESTORE";
};
```

当前 contracts 中已经存在：

```txt
ExportMapping
ExportAnswerSource
CreateExportJobRequest
```

因此 Batch 1 不应直接新增一个与现有导出请求职责重叠的新 request 类型。

优先策略：

1. 优先扩展现有 `CreateExportJobRequest`、`ExportMapping`、`ExportAnswerSource`。
2. 新增 `ExportMode`、`ExportFieldMapping`、`ExportWarning`、`ExportRecordMetadata` 等辅助类型。
3. 只有当 Batch 1 审查确认现有 request 类型无法扩展时，才允许新增新的 request 类型。
4. 不允许在 apps/web、apps/api 或 mock 中私自定义导出请求类型。

建议由 `ExportMapping` 承载版本治理相关配置：

```ts
export interface ExportMapping {
  // ... existing fields
  exportMode?: ExportMode;
  targetSchemaVersionId?: string;
  includedSchemaVersionIds?: string[];
  migrationId?: string;
  fieldMappings?: ExportFieldMapping[];
}
```

```ts
export type ExportWarning = {
  submissionId: string;
  schemaVersionId: string;
  targetSchemaVersionId: string;
  targetFieldName: string;
  reason:
    | "NO_MAPPING_FOUND"
    | "MIGRATION_NOT_EXECUTED"
    | "ARCHIVED_FIELD_NOT_MAPPED"
    | "MULTIPLE_MIGRATION_RECORDS"
    | "TYPE_INCOMPATIBLE";
  message: string;
};

export type ExportRecordMetadata = {
  exportId: string;
  exportMode: ExportMode;
  targetSchemaVersionId?: string;
  includedSchemaVersionIds: string[];
  migrationId?: string;
  exportedBy: string;
  exportedAt: string;
  rowCount: number;
  warningCount?: number;
  checksum?: string;
};
```

### 6.14 Canonical Serialization 类型

```ts
export type CanonicalSerializationVersion = "canonical-json-v1";

export type ChecksumInputEnvelope = {
  canonicalSerializationVersion: CanonicalSerializationVersion;
  checksumAlgorithm: "SHA-256";
  checksumInput: unknown;
};
```

### 6.15 Custom Transform 类型

```ts
export type CustomTransformId =
  | "splitFullName"
  | "mergeRiskFields"
  | "normalizeLegacyCategory";
```

如果当前阶段无法固定具体枚举，可以暂时不导出 `CustomTransformId`，但必须在后端实现 allowlist 校验。

---

## 7. Version Freeze

### 7.1 核心规则

已发布的 Schema 是不可变快照。Task 和 Submission 在创建时绑定当时的 `schemaVersionId`。后续渲染、校验、审核、导出都必须使用这个快照版本，而不是最新草稿或最新发布版本。

### 7.2 新增文件

```txt
packages/schema-core/src/schema-versioning.ts
```

### 7.3 新增函数

```ts
export function assertPublishedSchemaImmutable(
  previousSchema: LabelHubSchema,
  nextSchema: LabelHubSchema,
): void;
```

职责：

- 如果 `previousSchema.status` 是 PUBLISHED，则 `nextSchema` 不允许改变任何结构性内容。
- 不允许修改 root、children、fields、validations、visibleWhen、disabledWhen、options、outputBindings 等。
- 不负责 display metadata patch。

```ts
export function assertSchemaVersionMatched(
  schemaInfo: { schemaVersionId?: string },
  submission: { schemaVersionId?: string },
): void;
```

职责：

- 检查当前用于渲染 / 校验的 `schemaVersionId` 是否等于 `submission.schemaVersionId`。
- 如果不一致，直接抛出错误或返回 version mismatch error。

```ts
export function validateSubmissionSchemaBinding(
  schema: LabelHubSchema,
  submission: {
    schemaVersionId: string;
    answers: AnswerPayload;
  },
  context: RuntimeContextWithOutput,
): {
  valid: boolean;
  normalizedAnswers?: AnswerPayload;
  errors: ValidationError[];
};
```

职责：

- 作为更高层的提交校验入口。
- 先检查 `schemaVersionId` 是否一致。
- 再执行 `normalizeAnswers`。
- 最后执行 `validateAnswers`。

### 7.4 测试用例

必须覆盖：

1. DRAFT schema 修改字段 title：允许。
2. PUBLISHED schema 修改字段 title：拒绝。
3. PUBLISHED schema 新增 field：拒绝。
4. PUBLISHED schema 删除 field：拒绝。
5. PUBLISHED schema 修改 option value：拒绝。
6. PUBLISHED schema 修改 display metadata patch：不由该函数处理。
7. `submission.schemaVersionId` 与 `schema.schemaVersionId` 一致：通过。
8. `submission.schemaVersionId` 与 `schema.schemaVersionId` 不一致：报错。
9. `validateSubmissionSchemaBinding` 在版本不一致时不继续执行 normalize / validate。

---

## 8. Breaking Change Detection

### 8.1 核心规则

发布新版本前，系统必须自动识别哪些改动是安全的，哪些改动需要管理员确认，哪些改动会破坏已有数据，哪些改动必须配套 Migration Plan。

### 8.2 新增文件

```txt
packages/schema-core/src/compatibility.ts
```

### 8.3 新增函数

```ts
export function detectSchemaChanges(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
  options?: SchemaChangeDetectionOptions,
): SchemaChange[];
```

职责：

- 客观列出 oldSchema 到 newSchema 发生了什么变化。
- 只描述变化，不判断是否允许发布。

```ts
export function checkBackwardCompatibility(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
  options?: BackwardCompatibilityOptions,
): CompatibilityReport;
```

职责：

- 根据 `detectSchemaChanges` 的结果判断兼容性风险。
- 输出是否允许发布、是否需要管理员确认、是否需要 migration。

### 8.4 diffSchema 是新增能力

当前 `traverse.ts` 只能遍历单棵 Schema 树，不能直接对比两棵树。

`compatibility.ts` 需要新增内部能力：

```ts
function diffSchema(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
): SchemaDiff
```

其实现可以复用：

- `flattenNodes(oldSchema)`
- `flattenNodes(newSchema)`
- `collectFieldNodes(oldSchema)`
- `collectFieldNodes(newSchema)`

然后建立：

```txt
oldFieldsByName
newFieldsByName
oldNodesById
newNodesById
```

再进行字段新增、删除、类型变化、options 变化、validation 变化的对比。

### 8.5 风险等级规则

#### SAFE

包括：

- 字段 title 修改
- 字段 description 修改
- option label 修改但 value 不变
- 新增非必填字段
- `required: true → false`
- validation 变宽松，例如 minLength 变小、maxLength 变大
- placeholder / helpText 修改
- layout 修改

#### NEEDS_APPROVAL

包括：

- 新增必填字段
- `required: false → true`
- validation 变严格，例如 minLength 变大、maxLength 变小
- visibleWhen / disabledWhen 规则变化
- preserveWhenHidden / submitWhenDisabled / validateWhenHidden 规则变化
- deprecated 字段仍被新版本引用
- 新增字段没有 defaultValue，但可能参与导出或校验
- 字段被标记 deprecated 但仍保留

#### BREAKING

包括：

- `field.name` 删除
- `field.name` 改名但没有 renameMap
- 字段 type 不兼容变化
- choice option value 被删除
- LLM outputBinding.toFieldName 指向的字段被删除
- FieldNode.name 重复
- conditional validation 引用了不存在字段
- JsonPath 变成非法 namespace
- 未经 deprecation 直接删除字段

#### MIGRATION_REQUIRED

包括：

- `choice.radio → choice.checkbox`
- `input.text → input.textarea`
- 字段重命名且提供 renameMap
- 删除字段但保留 archivedAnswers
- 已 deprecated 字段被删除，并提供 migration / archive 策略
- 新增字段有 defaultValue
- option value 替换且提供 optionValueMap
- data.json 结构变化且提供 json transform

### 8.6 典型规则

#### 字段删除

```txt
oldSchema 有 summary
newSchema 没有 summary
```

结果：

```txt
FIELD_REMOVED
level: BREAKING
```

#### 字段改名

```txt
summary → newsSummary
```

无 renameMap：

```txt
FIELD_RENAMED_UNMAPPED
level: BREAKING
```

有 renameMap：

```txt
FIELD_RENAMED_WITH_MAPPING
level: MIGRATION_REQUIRED
```

#### 单选变多选

```txt
choice.radio → choice.checkbox
```

结果：

```txt
FIELD_TYPE_CAST_REQUIRED
level: MIGRATION_REQUIRED
```

#### option value 删除

```txt
options: ["pass", "needs_revision", "rejected"]
变成
options: ["pass", "needs_revision"]
```

结果：

```txt
OPTION_VALUE_REMOVED
level: BREAKING
```

#### option label 修改

```txt
{ label: "通过", value: "pass" }
变成
{ label: "合格", value: "pass" }
```

结果：

```txt
OPTION_LABEL_CHANGED
level: SAFE
```

#### deprecated + hideForNewSubmissions

字段仍然存在，只是新建提交时隐藏。

结果：

```txt
DEPRECATED_FIELD_HIDDEN_FOR_NEW_SUBMISSIONS
level: NEEDS_APPROVAL / WARNING
```

不应输出 `FIELD_REMOVED`。

### 8.7 测试用例

必须覆盖：

1. 新增非必填字段 → SAFE。
2. 新增必填字段 → NEEDS_APPROVAL。
3. 删除字段 → BREAKING。
4. 字段改名但无 renameMap → BREAKING。
5. 字段改名且有 renameMap → MIGRATION_REQUIRED。
6. `choice.radio → choice.checkbox` → MIGRATION_REQUIRED。
7. option value 删除 → BREAKING。
8. option label 修改但 value 不变 → SAFE。
9. `required true → false` → SAFE。
10. `required: false → true` → NEEDS_APPROVAL。
11. minLength 变大 → NEEDS_APPROVAL。
12. minLength 变小 → SAFE。
13. LLM outputBinding 指向被删除字段 → BREAKING。
14. deprecated 字段被标记但未删除 → NEEDS_APPROVAL / WARNING。
15. deprecated + hideForNewSubmissions 不等于 FIELD_REMOVED。

---

## 9. Deprecation

### 9.1 核心规则

Deprecation 不是删除字段，而是声明字段仍然存在，但已经不推荐继续使用。

字段下线流程：

```txt
不要直接删除字段
先标记 deprecated
提供替代字段
新旧字段双轨运行一个版本周期
之后再通过 migration 或下一版本删除
```

### 9.2 新增文件

```txt
packages/schema-core/src/deprecation.ts
```

### 9.3 新增函数

```ts
export function validateDeprecationRules(
  schema: LabelHubSchema,
): DeprecationValidationResult;
```

检查：

1. deprecated 字段不应该 `required: true`。
2. deprecated 字段最好提供 reason。
3. deprecated 字段最好提供 replacementFieldName。
4. replacementFieldName 必须指向存在的 `FieldNode.name`。
5. deprecated 字段不应该被 LLM outputBinding.toFieldName 写入。
6. deprecated 字段不应该被新增 required conditional validation 依赖。
7. plannedRemovalSchemaVersionNo 必须大于当前 schemaVersionNo。
8. deprecated 字段不应该作为新字段的唯一数据来源，除非明确配置 migration mapping。

### 9.4 Warning 与 Error 区分

#### ERROR

会阻止发布：

- replacementFieldName 指向不存在字段
- deprecated 字段被 LLM outputBinding 写入，并且没有 replacementFieldName
- plannedRemovalSchemaVersionNo 小于等于当前 schemaVersionNo
- deprecated 字段与新字段 name 冲突

#### WARNING

提醒管理员确认：

- deprecated + required: true
- deprecated 没有 reason
- deprecated 没有 replacementFieldName
- deprecated 字段仍被 visibleWhen / disabledWhen / conditional validation 引用
- deprecated 字段仍在新任务 `CREATE` visibility mode 显示

### 9.5 visibility 中的处理

扩展：

```ts
resolveNodeVisibility(node, context, options?: {
  visibilityMode?: SchemaVisibilityMode;
})
```

visibility mode 优先级：

```txt
options.visibilityMode > context.visibilityMode > default visibility mode
```

#### CREATE visibility mode

新建提交时：

- 如果 `hideForNewSubmissions = true`，则隐藏 deprecated 字段。
- 如果 `readonlyForNewSubmissions = true`，则显示但不可编辑。
- 显示 replacementFieldName 提示。

#### EDIT visibility mode

编辑已有提交时：

- 如果该 deprecated 字段已有旧值，应显示或只读显示。
- 如果没有旧值，可以隐藏。

#### REVIEW / READONLY / HISTORICAL visibility mode

历史回放、审核、只读场景下：

- deprecated 字段必须可以显示历史值。
- 不能因为字段 deprecated 而让历史答案消失。

### 9.6 测试用例

必须覆盖：

1. deprecated + required: true → warning。
2. deprecated 没有 reason → warning。
3. deprecated 没有 replacementFieldName → warning。
4. replacementFieldName 不存在 → error。
5. `CREATE` visibility mode 下 deprecated 字段可以隐藏。
6. `HISTORICAL` visibility mode 下 deprecated 字段仍然显示。
7. deprecated 字段被 LLM outputBinding 写入 → error 或 warning。
8. deprecated 字段 plannedRemovalSchemaVersionNo 不合法 → error。
9. `options.visibilityMode > context.visibilityMode > default visibility mode` 优先级正确。

---

## 10. Migration Pipeline

### 10.1 核心规则

Migration Pipeline 是管理员主动发起的历史数据升级工具。默认情况下，系统不迁移旧答卷。只有管理员明确需要将旧数据从 schema_v1 升级到 schema_v2 时，才进入 Migration Pipeline。

迁移必须严格线性执行：

```txt
Create Plan
  → Resolve Manual Mapping Slots, if any
  → Dry Run
  → Admin Approval
  → Execute
  → Immutable Migration Record
```

没有 Dry Run 和管理员审批，不允许执行真正迁移。

### 10.2 新增文件

```txt
packages/schema-core/src/migration.ts
packages/schema-core/src/stable-hash.ts
```

### 10.3 createMigrationPlan

```ts
export function createMigrationPlan(
  oldSchema: LabelHubSchema,
  newSchema: LabelHubSchema,
  options?: {
    renameMap?: Record<string, string>;
    defaults?: Record<string, unknown>;
    optionValueMap?: Record<string, Record<string, string>>;
    archiveRemovedFields?: boolean;
    cutoffSubmittedAt?: string;
    includedSubmissionIds?: string[];
  },
): MigrationPlan;
```

职责：

1. 对比 oldSchema 和 newSchema。
2. 生成 operations。
3. 生成 `manualMappingSlots`。
4. 判断是否 executable。
5. 标记 blockingIssues。
6. 生成 planChecksumInput。
7. 记录 `cutoffSubmittedAt` 或 `includedSubmissionIds`。

### 10.4 Manual Mapping Slot 处理规则

如果发现无法自动判断的映射，应输出 `manualMappingSlots`，而不是让系统自动猜测。

示例：

```txt
oldRisk → riskLevel?
summary → newsSummary?
option value "medium" → "normal"?
```

前端应渲染下拉框或连线图，让管理员补全。

管理员补全后：

```txt
Plan with slots
  → Admin resolves slots
  → Rebuild plan
  → Dry Run again
  → Approval
  → Execute
```

管理员补全 mapping 后，不允许直接 execute，必须重新 Dry Run。

### 10.5 dryRunMigration

```ts
export function dryRunMigration(
  plan: MigrationPlan,
  submissions: MigrationSubmissionInput[],
  newSchema: LabelHubSchema,
  options?: {
    sampleLimit?: number;
    contextFactory?: (submission: unknown) => RuntimeContextWithOutput;
  },
): MigrationDryRunReport;
```

职责：

1. 不修改任何数据。
2. 预估会影响多少 submissions。
3. 统计每个 operation 影响多少字段。
4. 生成 before / after 样例。
5. 检查迁移后的 answers 是否能通过 newSchema 的内置 validation。
6. 识别不可自动迁移的 blocking cases。
7. 使用 deterministic prioritized sampling 生成 `sampleBeforeAfter`。
8. 跳过不在 `cutoffSubmittedAt` 或 `includedSubmissionIds` 范围内的 submissions。

### 10.6 executeMigrationPlan

```ts
export function executeMigrationPlan(
  plan: MigrationPlan,
  submissions: MigrationSubmissionInput[],
): MigrationExecutionResult;
```

职责：

1. 如果 `plan.executable === false`，拒绝执行。
2. 对每份 `submission.answers` 执行操作。
3. 输出 `migratedSubmissions`。
4. 输出 `archivedAnswers`。
5. 生成 Migration Record Draft。
6. 输出 `skippedSubmissions`。
7. 不直接写数据库。
8. 不真正解决数据库并发冲突，只携带 expected version / updatedAt 供后端 CAS 使用。

### 10.7 Migration 执行并发冲突

执行迁移时，输入 submissions 应包含：

```ts
{
  submissionId: string;
  schemaVersionId: string;
  answers: AnswerPayload;
  version?: number;
  updatedAt?: string;
}
```

schema-core 输出的 migratedSubmissions 应携带：

```ts
expectedVersion?: number;
expectedUpdatedAt?: string;
```

后端写入时必须检查：

- 当前 submission.version 是否等于 expectedVersion
- 或当前 submission.updatedAt 是否等于 expectedUpdatedAt

如果不一致：

- 不覆盖该条记录
- 将该条记录标记为 `CONFLICT`
- 计入 `conflictCount`
- 写入 migration execution report

### 10.8 自动迁移规则

只允许自动处理确定性变更。

#### 可以自动处理

1. `input.text → input.textarea`
   保留 string。

2. `choice.radio → choice.checkbox`
   string 转 string[]。

3. `choice.checkbox → choice.radio`
   只有数组长度为 1 时可转 string；多个值则 blocking。

4. 字段删除
   如果 `archiveRemovedFields = true`，则进入 archivedAnswers。

5. 新增字段
   如果提供 defaultValue，则写入默认值。

6. 字段重命名
   只有 renameMap 明确提供时才迁移。

7. option value 替换
   只有 optionValueMap 明确提供时才替换。

#### 不允许自动猜测

1. summary 是否等于 newsSummary。
2. oldRisk 是否等于 riskLevel。
3. 删除的 option value 应该映射到哪个新 value。
4. 多选多个值如何变成单选。
5. text 如何变成 number。
6. json 结构如何重组。
7. 语义相近但字段名不同的字段映射。

遇到这些情况必须输出 `REQUIRE_MANUAL_MAPPING` 或 `ManualMappingSlot`。

### 10.9 Custom validation 不在第一版执行

Migration Pipeline 第一版只执行 schema-core 内置 validation：

- required
- minLength / maxLength
- regex
- option value
- file rule
- JSON structure
- conditional validation 中可纯函数计算的部分

不执行依赖外部服务或业务数据库的 custom validation。

custom validation 应在迁移后由业务层异步触发，或由后端在特定 migration job 中以插件形式执行。

### 10.10 stableStringify 与 checksum 边界

schema-core 提供：

```ts
stableStringify(value: unknown): string
```

`stableStringify` 只负责生成稳定、可复现的 canonical serialization string。

后端负责生成权威 SHA-256 checksum。

### 10.10.1 Canonical Serialization 版本

为避免不同语言或不同实现之间出现 checksum 不一致，必须定义序列化版本：

```ts
export type CanonicalSerializationVersion = "canonical-json-v1";
```

所有 migration plan、dry run report、execution record、export record 的 checksum input 都必须记录：

```ts
{
  canonicalSerializationVersion: "canonical-json-v1",
  checksumAlgorithm: "SHA-256",
  checksumInput: unknown
}
```

### 10.10.2 canonical-json-v1 规则

`canonical-json-v1` 规则如下：

1. object key 按字典序排序；
2. array 保持原顺序；
3. string / number / boolean / null 按 JSON 语义序列化；
4. `Date` 必须转为 ISO string；
5. `undefined` 字段必须统一处理，建议在 object 中删除，在 array 中转为 `null`；
6. 不允许函数、Symbol、BigInt、循环引用；
7. 遇到不支持的值必须抛出结构化错误，不允许静默转换；
8. 字符串必须使用标准 JSON escaping。

### 10.10.3 后端一致性要求

如果后端也是 TypeScript / Node.js，可以直接复用 `@labelhub/schema-core` 的 `stableStringify`。

如果后端不是 TypeScript，例如 Go、Python、Java，则必须在后端实现同一套 `canonical-json-v1` 规则，并通过集成测试验证输出一致。

如果后端暂时无法实现跨语言一致性测试，必须至少保存 schema-core 输出的 canonical string，并由后端直接基于该 canonical string 生成 checksum。

### 10.10.4 跨实现测试要求

必须新增 canonical serialization test vectors。

示例：

```ts
const inputA = {
  b: 2,
  a: 1,
  nested: {
    z: "last",
    m: "middle"
  }
};

const inputB = {
  nested: {
    m: "middle",
    z: "last"
  },
  a: 1,
  b: 2
};
```

`stableStringify(inputA)` 与 `stableStringify(inputB)` 必须输出完全一致。

后端 checksum 测试必须覆盖：

1. schema-core 输出 canonical string；
2. 后端使用同一 input 输出 canonical string；
3. 两者字符串完全一致；
4. 两者生成的 SHA-256 checksum 完全一致。

### 10.11 大规模迁移必须分批

后端不应一次性将百万级 submissions 全部加载到内存。

后端应支持分页 / 分批执行：

```txt
batchSize = 500 / 1000
```

每批调用 schema-core 纯函数，并汇总 dry run / execution report。

### 10.12 迁移执行期间的新提交

Migration Plan 必须包含明确的数据快照边界：

```ts
cutoffSubmittedAt?: string;
includedSubmissionIds?: string[];
```

推荐策略：

```txt
Migration only applies to submissions created or submitted before cutoffSubmittedAt.
```

迁移执行期间产生的新提交不自动纳入本次 migration，除非管理员重新创建新的 migration plan。

### 10.13 CUSTOM_TRANSFORM 注册与安全边界

`CUSTOM_TRANSFORM` 是扩展预留能力，不在第一版中自动执行。

#### 10.13.1 transformFnId 不是动态代码

`transformFnId` 不能是任意字符串，也不能来自前端输入的动态函数。

`transformFnId` 必须来自后端代码中预定义的有限 allowlist / enum。

示例：

```ts
export type CustomTransformId =
  | "splitFullName"
  | "mergeRiskFields"
  | "normalizeLegacyCategory";
```

如果当前阶段不希望在 contracts 中固定 `CustomTransformId` 枚举，也可以先保留 `transformFnId: string`，但必须在文档和后端实现中规定：

1. `transformFnId` 必须通过后端 allowlist 校验；
2. 不在 allowlist 中的 transformFnId 必须拒绝执行；
3. 前端不得提交任意 transform 代码；
4. schema-core 不执行 CUSTOM_TRANSFORM；
5. 后端执行前必须记录 transformFnId、输入字段、输出字段和执行结果摘要。

#### 10.13.2 注册机制

后端维护 transform registry：

```ts
type TransformRegistry = Record<
  CustomTransformId,
  {
    id: CustomTransformId;
    description: string;
    inputFields: string[];
    outputFields: string[];
    deterministic: true;
    apply: (input: Record<string, unknown>) => Record<string, unknown>;
  }
>;
```

第一版实现中，schema-core 只负责在 MigrationPlan 中标记需要 `CUSTOM_TRANSFORM` 的操作，不负责执行。

后端执行 `CUSTOM_TRANSFORM` 前必须检查：

1. `transformFnId` 是否存在于后端 allowlist；
2. inputFields 是否存在；
3. outputFields 是否属于目标 Schema；
4. transform 是否 deterministic；
5. transform 输出是否通过目标字段的内置 validation；
6. transform 执行过程是否写入 migration audit record。

#### 10.13.3 禁止事项

禁止：

1. 在 schema 中保存函数体；
2. 从前端传入 JavaScript 代码；
3. 使用 `eval` / `new Function`；
4. 动态加载未登记的 transform；
5. 在 schema-core 中执行外部 transform；
6. 让 CUSTOM_TRANSFORM 绕过 Dry Run 和管理员审批。

### 10.14 测试用例

必须覆盖：

1. createMigrationPlan 识别 KEEP_FIELD。
2. createMigrationPlan 识别 RENAME_FIELD。
3. createMigrationPlan 无 renameMap 时输出 REQUIRE_MANUAL_MAPPING / ManualMappingSlot。
4. 管理员补全 manual mapping 后必须重新生成 plan。
5. 未 resolved 的 manualMappingSlots 使 plan.executable = false。
6. `choice.radio → choice.checkbox` 生成 CAST_VALUE。
7. `choice.checkbox → choice.radio`，数组长度 1 时可执行。
8. `choice.checkbox → choice.radio`，数组长度大于 1 时 blocking。
9. 删除字段时 ARCHIVE_FIELD。
10. 新增字段有 defaultValue 时 ADD_DEFAULT。
11. dryRunMigration 不修改原 submissions。
12. dryRunMigration 输出 affectedSubmissions。
13. dryRunMigration 输出 sampleBeforeAfter。
14. dryRunMigration 对迁移后 answers 执行 newSchema 内置 validation。
15. executeMigrationPlan 遇到 executable false 时拒绝执行。
16. executeMigrationPlan 正确输出 migratedSubmissions。
17. executeMigrationPlan 输出 skippedSubmissions。
18. executeMigrationPlan 输出 conflictCount。
19. stableStringify 对 key 顺序不同的对象输出一致结果。
20. stableStringify 对不支持的值抛出结构化错误。
21. dryRunMigration sampleBeforeAfter 遵守 deterministic prioritized sampling。
22. archivedAnswers 不进入 migrated answers。
23. Migration 只处理 cutoffSubmittedAt / includedSubmissionIds 范围内的数据。
24. CUSTOM_TRANSFORM 不在 schema-core 中执行。
25. 未在 allowlist 的 transformFnId 必须被后端拒绝。

---

## 11. Export Behavior

Schema Version Management 必须明确数据导出行为。导出不能绕过版本冻结原则，也不能在没有明确 mapping 的情况下用新 Schema 解释旧答案。

### 11.1 Export Modes

系统支持三种导出模式。

#### 1. Versioned Export

默认安全模式。按照 `schemaVersionId` 分组导出，每个 schema version 使用自己的字段表头。

规则：

- schema_v1 的答卷按 schema_v1 表头导出。
- schema_v2 的答卷按 schema_v2 表头导出。
- 不对旧答卷做隐式字段推断。

适用于：

- 审计
- 历史回放
- 质量复盘
- 保留原始数据语义

#### 2. Unified Export

管理员选择一个 `targetSchemaVersionId` 作为统一表头。旧答卷只有在存在明确 mapping 或 migration result 时才回填。没有明确 mapping 的字段留空。

禁止使用字段名相似度、语义猜测、LLM 推断或类型相似度自动回填字段。

#### 3. Migration Result Export

只导出已经经过某个 `migrationId` 成功迁移的数据。表头使用 `toSchemaVersionId`。

导出结果应附带：

- `migrationId`
- `planChecksum`
- `executionChecksum`

### 11.2 archivedAnswers Export Rule

`archivedAnswers` 是历史归档数据，不属于 target schema 的正式 answers。

导出时可以作为：

- 单独 sheet
- 单独 JSON 字段
- 单独 archive file

但不得在没有明确 mapping 的情况下自动合并进 target schema 表头。

### 11.3 Export Audit

每次导出应记录：

```ts
type ExportAuditRecord = {
  exportId: string;
  exportMode: ExportMode;
  targetSchemaVersionId?: string;
  includedSchemaVersionIds: string[];
  migrationId?: string;
  exportedBy: string;
  exportedAt: string;
  rowCount: number;
  warningCount?: number;
  checksum?: string;
};
```

### 11.4 Unified Export mapping 查找顺序

Unified Export 使用管理员指定的 `targetSchemaVersionId` 作为统一表头，但不能在没有明确 mapping 的情况下用新 Schema 自动解释旧 answers。

#### 11.4.1 基本原则

Unified Export 只能使用确定性 mapping。禁止使用字段名相似度、语义猜测、LLM 推断或类型相似度自动回填字段。

`archivedAnswers` 只能在存在明确 mapping 时用于回填。否则只能作为独立 archive 数据导出，不得自动合并进 target schema 表头。

#### 11.4.2 单行导出的字段解析顺序

对于每一条 submission 和 target schema 中的每一个 target field，按以下顺序查找值。

##### Step 1：如果 submission 已经属于 targetSchemaVersionId

如果：

```ts
submission.schemaVersionId === targetSchemaVersionId
```

则直接读取：

```ts
submission.answers[targetFieldName]
```

不需要 mapping。

##### Step 2：如果导出配置指定了 migrationId

如果扩展后的 `CreateExportJobRequest` / `ExportMapping` 中存在 `migrationId`，则优先查找该 migrationId 对应的 migration result。

如果该 submission 已经通过该 migrationId 成功迁移，则读取迁移后的 answers。

如果该 submission 没有通过该 migrationId 迁移成功，则该字段留空，并在 export warning 中记录原因。

##### Step 3：查找已审批的 MigrationRecord

如果未指定 migrationId，系统可以查找从 `submission.schemaVersionId` 到 `targetSchemaVersionId` 的已审批 MigrationRecord。

允许使用以下 operation 进行字段回填：

- `RENAME_FIELD`
- `CAST_VALUE`
- `MAP_OPTION_VALUE`
- `ADD_DEFAULT`

如果存在多个可用 MigrationRecord，必须使用后端定义的确定性选择规则，例如：

1. 优先使用 `executedAt` 最新且状态为 succeeded 的 MigrationRecord；
2. 如果存在多条同等优先级记录，后端必须返回冲突错误，不允许前端自行选择。

##### Step 4：同名字段兼容回填

如果没有可用 MigrationRecord，可以使用同名字段回填，但必须同时满足：

1. old schema 和 target schema 中都存在同名 FieldNode；
2. 字段 type 完全相同，或属于文档明确允许的兼容类型；
3. 该字段不在 archivedAnswers 中；
4. 该字段没有被 target schema 标记为 deprecated replacement target 的冲突来源。

符合条件时读取：

```ts
submission.answers[targetFieldName]
```

##### Step 5：明确 archive mapping 回填

只有在 MigrationRecord 或导出配置中明确声明某个 archived field 可以映射到 target field 时，才允许从 `archivedAnswers` 回填。

示例：

```ts
{
  fromArchivedField: "oldComment",
  toField: "reviewComment",
  sourceMigrationId: "migration_001"
}
```

没有明确 archive mapping 时，`archivedAnswers` 不得进入 target schema 表头。

##### Step 6：留空并记录 warning

如果以上规则均无法找到确定性值，则该字段导出为空。

同时记录 export warning：

```ts
{
  submissionId: string;
  targetFieldName: string;
  reason: "NO_MAPPING_FOUND";
}
```

#### 11.4.3 Export mapping 扩展

如果需要支持管理员在导出时提供显式 mapping，应扩展：

```ts
export type ExportFieldMapping = {
  fromSchemaVersionId: string;
  toSchemaVersionId: string;
  fromFieldName?: string;
  fromArchivedField?: string;
  toFieldName: string;
  operation: "DIRECT" | "RENAME_FIELD" | "CAST_VALUE" | "MAP_OPTION_VALUE" | "ARCHIVE_RESTORE";
};
```

并优先在现有 `CreateExportJobRequest` / `ExportMapping` 链路中增加：

```ts
fieldMappings?: ExportFieldMapping[];
```

如果 `fieldMappings` 存在，后端必须先验证它们不会和已审批 MigrationRecord 冲突。冲突时返回 422，不允许静默覆盖。

#### 11.4.4 Export warning

Unified Export 应输出 warning summary：

```ts
export type ExportWarning = {
  submissionId: string;
  schemaVersionId: string;
  targetSchemaVersionId: string;
  targetFieldName: string;
  reason:
    | "NO_MAPPING_FOUND"
    | "MIGRATION_NOT_EXECUTED"
    | "ARCHIVED_FIELD_NOT_MAPPED"
    | "MULTIPLE_MIGRATION_RECORDS"
    | "TYPE_INCOMPATIBLE";
  message: string;
};
```

Export 完成后，后端应保存 export audit record，并记录 warning count。

---

## 12. Designer 发布前检测 UI

当前 Owner 侧发布入口仍是占位逻辑，因此需要新增发布预览流程。

### 12.1 PublishPreviewDialog

Designer 在管理员点击“发布”时，不应直接发布，而应先触发 Compatibility 检测。

流程：

```txt
点击发布
  → 运行 schema validation
  → 运行 checkBackwardCompatibility
  → 如果存在 BREAKING，阻断发布
  → 如果存在 NEEDS_APPROVAL，展示确认
  → 如果存在 MIGRATION_REQUIRED，提示创建 Migration Plan
  → 如果存在 ManualMappingSlots，要求管理员补全
  → 管理员确认后才提交 publish request
```

### 12.2 PublishRequestPayload

```ts
export type PublishRequestPayload = {
  schema: LabelHubSchema;
  compatibilityReport: CompatibilityReport;
  migrationPlan?: MigrationPlan;
};
```

`schema-designer` 的 `onPublishRequest` 应传递这个结构，而不是只传 schema。

### 12.3 UI 展示内容

PublishPreviewDialog 应展示：

- schema validation errors
- compatibility report
- breaking changes
- deprecation warnings
- migration required changes
- manual mapping slots
- affected submissions count，如果后端提供
- publish allowed / blocked 状态
- admin confirmation checkbox

---

## 13. 错误处理与后端响应约定

### 13.1 HTTP 状态码建议

```txt
400 Bad Request
  请求结构错误，例如 schema payload 缺字段。

403 Forbidden
  当前用户没有发布、迁移或审批权限。

409 Conflict
  并发冲突，例如 schemaDraftRevision 过期、schemaVersionNo 冲突、submission 使用了错误 schemaVersionId、migration CAS 写入冲突。

422 Unprocessable Entity
  Schema 本身合法 JSON，但无法通过业务规则，例如 Breaking Change 阻断发布、deprecated replacementFieldName 不存在、migration plan 不可执行、manual mapping 未补全。
```

### 13.2 前端展示策略

- 400：显示“请求数据格式错误”。
- 403：显示“当前账号无权限执行该操作”。
- 409：显示“版本已被其他人更新，请刷新后重试”。
- 422：展示具体 schema validation / compatibility / migration 错误列表。

### 13.3 schema-core 错误边界

schema-core 不应直接返回 HTTP 状态码。

schema-core 返回结构化错误，后端负责映射为 HTTP response。

---

## 14. 并发发布控制

如果两个管理员同时编辑或发布同一个 Schema Draft，后端必须避免 `schemaVersionNo` 冲突和草稿覆盖。

### 14.1 乐观锁机制

发布请求必须带上：

```ts
{
  schemaDraftRevision: number;
  previousVersionId?: string;
}
```

后端发布时检查：

```txt
request.schemaDraftRevision === current.schemaDraftRevision
request.previousVersionId === latestPublishedSchemaVersionId
```

如果不一致，返回：

```txt
409 Conflict
```

### 14.2 唯一约束

后端应保证：

```txt
(schemaId, schemaVersionNo) 唯一
schemaVersionId 全局唯一
```

### 14.3 发布事务

发布新版本时，应在同一事务中完成：

```txt
1. 校验 schemaDraftRevision
2. 生成 schemaVersionId
3. 写入 SchemaVersion 快照
4. 更新 task.activeSchemaVersionId 或 schema latest pointer
5. 写入 audit event
```

---

## 15. 推荐代码文件结构

### 15.1 contracts

建议新增或扩展：

```txt
packages/contracts/src/schema.ts
packages/contracts/src/global.ts
packages/contracts/src/schema-versioning.ts
packages/contracts/src/migration.ts
packages/contracts/src/export.ts
packages/contracts/src/index.ts
```

### 15.2 schema-core

建议新增：

```txt
packages/schema-core/src/schema-versioning.ts
packages/schema-core/src/compatibility.ts
packages/schema-core/src/deprecation.ts
packages/schema-core/src/migration.ts
packages/schema-core/src/stable-hash.ts
```

建议扩展：

```txt
packages/schema-core/src/visibility.ts
packages/schema-core/src/schema-guards.ts
packages/schema-core/src/index.ts
```

测试文件：

```txt
packages/schema-core/src/__tests__/schema-versioning.test.ts
packages/schema-core/src/__tests__/compatibility.test.ts
packages/schema-core/src/__tests__/deprecation.test.ts
packages/schema-core/src/__tests__/migration.test.ts
```

### 15.3 schema-designer

建议新增或扩展：

```txt
packages/schema-designer/src/PublishPreviewDialog.tsx
packages/schema-designer/src/SchemaDesigner.tsx
packages/schema-designer/src/types.ts
```

### 15.4 apps/web

建议扩展：

```txt
apps/web/src/features/owner/OwnerSchemaPage.tsx
apps/web/src/mocks/handlers.ts
apps/web/src/mocks/mock-db.ts
```

---

## 16. 与现有模块的关系

### 16.1 与 schema-guards.ts 的关系

`schema-guards.ts` 继续负责单个 Schema 自身是否合法。

`compatibility.ts` 负责两个 Schema 版本之间是否兼容。

区别：

```txt
schema-guards:
  这个 schema 自己是不是合法？

compatibility:
  从 oldSchema 到 newSchema 的变化会不会破坏旧数据？
```

### 16.2 与 validation.ts 的关系

`validation.ts` 负责检查 answers 是否符合某个具体 Schema。

`migration.ts` 在 dry run / execute 后可以调用 `validation.ts`，检查迁移后的 answers 是否符合 newSchema 的内置 validation。

不执行 custom validation。

### 16.3 与 normalization.ts 的关系

`normalization.ts` 负责清理 answers，比如移除 unknown field、处理 hidden / disabled 字段提交规则。

`migration.ts` 可以在迁移后调用 `normalization.ts`，清理 migratedAnswers。

`archivedAnswers` 不参与常规 normalization / validation。

### 16.4 与 visibility.ts 的关系

`visibility.ts` 当前负责 hidden / visibleWhen / disabledWhen。

Deprecation 机制需要扩展 visibility，使其支持不同 `SchemaVisibilityMode`：

- `CREATE`
- `EDIT`
- `REVIEW`
- `READONLY`
- `HISTORICAL`

这样 deprecated 字段可以在新建任务中隐藏，但在历史回放中仍然显示。

### 16.5 与 export module 的关系

Export module 不应绕过 schema version 规则。

导出时必须明确：

- exportMode
- targetSchemaVersionId
- includedSchemaVersionIds
- migrationId, if any
- export warnings, if any

---

## 17. 实施优先级

### Batch 1：扩展 @labelhub/contracts

新增或扩展：

- `FieldDeprecationConfig`
- 复用或最小扩展现有 `SchemaVersion` / `SchemaVersionRef`
- `SchemaVisibilityMode`
- `CompatibilityLevel`
- `SchemaChange`
- `CompatibilityReport`
- `MigrationOperation`
- `ManualMappingSlot`
- `MigrationSubmissionInput`
- `MigrationSkippedSubmission`
- `MigrationPlan`
- `MigrationDryRunReport`
- `MigrationExecutionResult`
- `CanonicalSerializationVersion`
- `ChecksumInputEnvelope`
- `CustomTransformId`，如果本阶段能固定枚举
- `ExportMode`
- `ExportFieldMapping`
- `ExportWarning`
- `ExportRecordMetadata`
- 将 `RuntimeContextWithOutput` 或等价类型提升到 `packages/contracts/src/global.ts`
- `RuntimeContextWithOutput.visibilityMode`

验收标准：

- contracts typecheck 通过。
- 不改 schema-core 逻辑。

### Batch 2：Version Freeze

新增：

- `schema-versioning.ts`
- `assertPublishedSchemaImmutable`
- `assertSchemaVersionMatched`
- `validateSubmissionSchemaBinding`
- `schema-versioning.test.ts`

验收标准：

- Published SchemaVersion snapshot 不可修改。
- Submission 与 Schema 版本不一致时报错。
- 不影响现有 test。

### Batch 3：Breaking Change Detection

新增：

- `compatibility.ts`
- `diffSchema`
- `detectSchemaChanges`
- `checkBackwardCompatibility`
- `compatibility.test.ts`

验收标准：

- 能识别新增、删除、改名、类型变化、option value 删除、required 变化、validation 变严格 / 变宽松。
- 能输出 SAFE / NEEDS_APPROVAL / BREAKING / MIGRATION_REQUIRED。
- 有 recommendation。
- deprecated + hideForNewSubmissions 不被误判为 FIELD_REMOVED。

### Batch 4：Deprecation

新增：

- `deprecation.ts`
- deprecation field policy
- `validateDeprecationRules`
- `deprecation.test.ts`

扩展：

- `visibility.ts` 支持 `visibilityMode` options。
- `schema-guards.ts` 可调用 deprecation rules。

验收标准：

- deprecated + required 能 warning。
- replacementFieldName 不存在能 error。
- `CREATE` visibility mode 与 `HISTORICAL` visibility mode 表现不同。
- 不破坏现有 visibility 测试。

### Batch 5：Migration Plan + Manual Mapping + Dry Run

新增：

- `migration.ts`
- `createMigrationPlan`
- `manualMappingSlots`
- `dryRunMigration`
- deterministic prioritized sampling
- `migration.test.ts`

验收标准：

- 能生成 Migration Plan。
- 能输出 Manual Mapping Slots。
- 未 resolved 的 manual mapping 使 plan.executable = false。
- 管理员补全 mapping 后需要重新生成 plan。
- 能输出 Dry Run Report。
- Dry Run 不修改原数据。
- 能统计影响范围和 before / after sample。
- custom validation 不在第一版执行。

### Batch 6：Execute Migration + Conflict Output + Record Draft + stableStringify

扩展：

- `executeMigrationPlan`
- `MigrationSkippedSubmission`
- `conflictCount`
- `recordDraft`
- `stable-hash.ts`
- canonical serialization test vectors

验收标准：

- executable false 时拒绝执行。
- executable true 时输出 migratedSubmissions。
- 能输出 skippedSubmissions。
- 能输出 conflictCount。
- 能生成 checksum input envelope。
- 能保留 archivedAnswers。
- archivedAnswers 不进入 migrated answers。
- migratedSubmissions 携带 expectedVersion / expectedUpdatedAt。
- stableStringify 遵守 canonical-json-v1。
- 不支持的值抛出结构化错误。

### Batch 7：Designer PublishPreviewDialog

新增或扩展：

- `PublishPreviewDialog`
- `PublishRequestPayload`
- `SchemaDesigner.onPublishRequest`

验收标准：

- 发布前展示 CompatibilityReport。
- BREAKING 阻断发布。
- NEEDS_APPROVAL 要求确认。
- MIGRATION_REQUIRED 提示创建 Migration Plan。
- Manual Mapping Slots 可被管理员补全。

### Batch 8：Export Behavior

新增或扩展：

- export contracts
- export mode selection
- versioned export
- unified export
- migration result export
- export warnings
- export audit metadata

验收标准：

- 默认 Versioned Export。
- Unified Export 不自动用新 Schema 解释旧 answers。
- Unified Export 使用固定 mapping 查找顺序。
- archivedAnswers 不在无 mapping 的情况下回填到 target schema。
- Migration Result Export 附带 migrationId / checksum。

### Batch 9：后端 API / Mock / Audit 接入

后端或 mock 需支持：

- publish API 的 optimistic locking
- schemaDraftRevision 检查
- previousVersionId CAS
- migration plan 保存
- dry run report 保存
- approval / execute 状态机
- archivedAnswers 存储
- migration conflict handling
- transform registry / allowlist
- audit event 写入
- export audit record

---

## 18. Demo Scenario

### 18.1 Demo Schema V1

```txt
qualityRating:
  type: choice.radio
  required: true
  options: pass / needs_revision / rejected

summary:
  type: input.text
  required: true

oldComment:
  type: input.text
```

### 18.2 Demo Schema V2

```txt
qualityRating:
  type: choice.checkbox
  required: true

newsSummary:
  type: input.textarea
  required: true

oldComment:
  type: input.text
  deprecation:
    deprecated: true
    reason: "Use reviewComment instead"
    replacementFieldName: "reviewComment"
    hideForNewSubmissions: true

reviewComment:
  type: input.textarea
```

### 18.3 Demo Submission V1

```json
{
  "qualityRating": "pass",
  "summary": "This is a valid summary.",
  "oldComment": "Legacy comment"
}
```

### 18.4 Expected Flow

1. 使用 schema_v1 创建 task 和 submission。
2. 发布 schema_v2 前运行 `checkBackwardCompatibility`。
3. 系统识别：
   - `qualityRating radio → checkbox`：MIGRATION_REQUIRED
   - `summary 删除 / newsSummary 新增`：BREAKING unless renameMap provided
   - `oldComment deprecated`：NEEDS_APPROVAL / WARNING
4. 管理员提供 renameMap：
   - `summary → newsSummary`
5. 系统生成 Migration Plan。
6. 如果存在 ManualMappingSlot，前端要求管理员补全。
7. 补全 mapping 后重新生成 Migration Plan。
8. Dry Run 输出：
   - `qualityRating: "pass" → ["pass"]`
   - `summary → newsSummary`
   - `oldComment` 保留或归档
   - 影响多少 submissions
   - before / after sample
9. 管理员审批。
10. Execute Migration 输出 migratedSubmissions / skippedSubmissions / conflictCount。
11. 后端保存 Migration Record。
12. Export 可选择 VERSIONED / UNIFIED / MIGRATION_RESULT 模式。

---

## 19. 验收标准

### 19.1 功能标准

- Published SchemaVersion snapshot 不可原地修改。
- Task / Submission 必须绑定 `schemaVersionId`。
- Submission 不能用错误 `schemaVersionId` 渲染或校验。
- 发布新版本前可以检测 Breaking Changes。
- 系统可以区分 SAFE / NEEDS_APPROVAL / BREAKING / MIGRATION_REQUIRED。
- deprecated 字段有明确 warning / error。
- deprecated 字段在新建和历史模式下可以有不同行为。
- Migration Plan 可以生成。
- Manual Mapping Slots 可以生成和补全。
- 未补全 Manual Mapping Slots 时 plan 不可执行。
- Dry Run 可以预览影响范围。
- Execute Migration 可以输出迁移后的 answers。
- Execute Migration 可以输出 skippedSubmissions / conflictCount。
- 删除字段可以进入 `archivedAnswers`。
- `archivedAnswers` 不进入 migrated answers。
- 迁移结果可以生成 checksum input。
- stableStringify 输出遵守 canonical-json-v1。
- CUSTOM_TRANSFORM 不执行动态代码。
- 语义不确定的变更不会被自动猜测。
- dry run sampling 稳定、可解释、可复现。
- custom validation 不在第一版 migration 中自动执行。
- Export 支持 VERSIONED / UNIFIED / MIGRATION_RESULT 三种模式。
- Unified Export 不在无 mapping 的情况下自动解释旧 answers。
- Unified Export 使用固定 mapping 查找顺序。
- Migration Result Export 附带 migrationId / checksum。

### 19.2 工程标准

- 所有新增函数保持纯函数。
- schema-core 不访问数据库。
- schema-core 不直接写 audit log。
- schema-core 不直接调用后端 API。
- schema-core 不执行 CUSTOM_TRANSFORM。
- shared types 优先定义在 @labelhub/contracts。
- 每个模块都有独立测试。
- `npm run typecheck` 通过。
- `npm test` 通过。
- 不破坏现有 schema-core 测试。

### 19.3 必须能解释的工程问题

1. 为什么旧答卷不会被新 Schema 污染？
2. 发布新模板前，系统如何知道改动是否危险？
3. 如果管理员确实要删除字段，系统如何平滑过渡？
4. 如果历史数据必须升级，系统如何保证迁移可控？
5. 为什么 Migration 不是默认自动发生？
6. 迁移过程如何审计和追溯？
7. 大规模迁移如何避免一次性加载全部数据？
8. 迁移期间产生的新提交如何处理？
9. 为什么 archivedAnswers 不进入 migrated answers？
10. 为什么 custom validation 不在第一版 migration 中执行？
11. migration 执行时如何避免脏写？
12. 无法自动映射的字段如何让管理员补全？
13. 混合 schemaVersion 的答卷如何导出？
14. stableStringify 和后端 checksum 如何保证一致？
15. 如何防止 CUSTOM_TRANSFORM 执行任意代码？
16. Unified Export 的 mapping 查找顺序是什么？
