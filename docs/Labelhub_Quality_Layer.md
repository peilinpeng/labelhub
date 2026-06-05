# LabelHub Quality Layer：动态表单审计与数据质量治理方案

## 1. 模块定位

LabelHub 的核心目标不是简单地完成标注、审核和导出，而是持续生产高质量、可追溯、可评估、可交付给 AI 训练链路的数据。

在传统标注系统中，数据生产流程通常只记录最终结果：

```txt
Labeler 提交答案
Reviewer 审核
Owner 导出数据
```

但真实业务中，更重要的问题是：

1. 这条数据是由谁生产的；
2. 标注过程是否可信；
3. AI 辅助有没有真正提升效率；
4. Reviewer 修改了哪些内容；
5. 哪些字段最容易出错；
6. 哪些 Prompt 版本真正有效；
7. 哪些数据适合进入模型训练；
8. 出现质量问题时能否追溯责任链；
9. 导出的数据是否带有质量证明，而不是裸答案。

因此，LabelHub 需要一个横跨 Labeler、Reviewer、Owner、AI Review、Schema Governance、Migration 和 Export 的隐形质量治理层。

这个模块命名为：

```txt
LabelHub Quality Layer
```

其核心资产是：

```txt
Quality Ledger
```

即围绕数据生产全过程建立的质量账本。

---

## 2. 核心理念

### 2.1 一句话定位

```txt
我们不是只生产数据，而是生产带质量证据链的数据。
```

### 2.2 核心原则

```txt
行为全留痕，风险可拦截，质量可回溯，指标可沉淀。
```

### 2.3 产品哲学

```txt
Invisible Governance, Visible Trust.
```

中文解释：

```txt
治理是隐形的，信任是可见的。
```

也就是说：

1. 对 Labeler，不增加复杂操作；
2. 对 Reviewer，不增加额外负担；
3. 对 Owner，只在需要决策时展示摘要；
4. 对系统，所有关键行为自动沉淀为质量证据；
5. 对数据使用方，最终数据可携带质量证明。

Quality Layer 不应变成一个到处弹窗、到处监控的前端功能，而应像基础设施一样存在：

```txt
正常流程中尽量无感；
异常风险时及时显性；
复盘追责时证据完整；
数据导出时质量可解释。
```

---

## 3. 整体架构

LabelHub 可以拆成四层：

```txt
Schema Layer：动态表单结构与版本治理
Workflow Layer：标注、审核、发布、迁移、导出流程
AI Layer：LLM Assist / AI Review
Quality Layer：质量账本、行为审计、质量护照、指标反馈
```

Quality Layer 横跨所有角色和流程：

```txt
Labeler 前端
  → 行为摘要、提交质量、AI 辅助使用情况

Reviewer 前端
  → 审核决策、修改 diff、AI 建议采纳情况

Owner / Admin 前端
  → Schema 发布风险、任务进度、导出质量、审计 Timeline

AI Review / Worker
  → AI 输出、AI 建议、置信度、延迟、采纳结果

Export / Migration / Schema Governance
  → 版本变更、数据迁移、导出质量、治理链路
```

这些事件最终进入统一的：

```txt
Quality Ledger
```

再被不同下游系统消费：

```txt
数据分析师
  → 效率、成本、质量、AI ROI 分析

实时质检系统
  → 异常行为、低信任数据、派单风险控制

模型训练团队
  → Reviewer Diff 纠错数据、AI Reviewer 训练样本、数据筛选
```

---

## 4. Quality Ledger 统一设计

### 4.1 单一 Ledger，分域命名空间

Quality Ledger 是全系统统一的质量事件账本，不按角色或模块拆分为多个互不关联的 Ledger。

分拆 Ledger 的问题：

1. 跨域关联查询成本高，例如某条 submission 从 Schema 设计到最终导出的完整链路需要跨多张表 join；
2. 不同 Ledger 的时钟和排序不统一，事件顺序难以复原；
3. Schema Governance 事件和 Labeling 事件天然需要关联，例如 Schema 发布阻断会影响进行中的任务；
4. Data Quality Passport 需要综合 Labeling、Review、AI、Schema、Export 多个域的信息。

因此，所有质量事件进入同一个 Ledger，通过 `domain` 字段区分来源域。

```ts
type QualityLedgerDomain =
  | "LABELING"
  | "REVIEW"
  | "AI_ASSIST"
  | "AI_REVIEW"
  | "SCHEMA_GOVERNANCE"
  | "EXPORT";
```

注意：

```txt
Migration 不单独设立 MIGRATION domain。
Migration 是 Schema Governance 生命周期的一部分。
MIGRATION_PLAN_CREATED / MIGRATION_DRY_RUN_COMPLETED / MIGRATION_EXECUTED
统一归入 domain: "SCHEMA_GOVERNANCE"。
```

### 4.2 Quality Ledger 的边界

Quality Ledger 是质量事件的事实层，用于记录不可变的审计事件、追责证据和数据质量链路。

但 Quality Ledger 不直接承担所有高频查询职责。当前状态、指标看板、Trust Level、Prompt 效果统计和 Data Quality Passport 等内容，应由后续 Read Model / Snapshot 层生成。

也就是说：

```txt
Quality Ledger 负责记录事实；
Read Model / Snapshot 负责快速查询。
```

具体的 CQRS、状态快照、冷热分层和生命周期管理设计见第 14、15、16 节。

---

## 5. 统一事件基础结构

### 5.1 QualityLedgerEvent

```ts
type QualityLedgerEvent<T = unknown> = {
  eventId: string;             // 服务端 append 成功后生成的 Ledger record id
  idempotencyKey?: string;     // 业务层幂等键，用于网络重试去重

  domain: QualityLedgerDomain;
  eventType: string;

  occurredAt: string;          // 服务端可信审计时间，用于排序和追责
  clientOccurredAt?: string;   // 客户端上报的事件发生时间，仅用于行为分析
  serverReceivedAt?: string;   // 服务端接收时间，可用于延迟分析

  schemaId?: string;           // Schema 模板本体 ID
  schemaVersionId?: string;    // 已发布的不可变 Schema 版本 ID

  taskId?: string;
  assignmentId?: string;
  submissionId?: string;
  reviewId?: string;
  exportId?: string;
  userId?: string;

  payload: T;
};
```

### 5.2 eventId 与 idempotencyKey 的区别

`eventId` 和 `idempotencyKey` 不能混用。

```txt
eventId：
  服务端 append 成功后生成的 Ledger 记录 ID。
  用于唯一标识已经写入的事件。

idempotencyKey：
  业务层幂等键。
  用于网络重试、重复提交、sendBeacon 重发时去重。
```

如果请求携带 `idempotencyKey`：

```txt
后端先查是否已有相同 idempotencyKey 的 event；
如果已有，返回已有 event；
如果没有，生成新的 eventId 并 append。
```

推荐幂等键格式：

```txt
domain:entityId:eventType:sessionToken
```

示例：

```txt
LABELING:assignment_001:LABELING_SESSION_SUMMARY:sess_abc
SCHEMA_GOVERNANCE:schema_001:SCHEMA_PUBLISH_BLOCKED:revision_12
REVIEW:submission_001:REVIEW_DIFF_GENERATED:review_001
```

### 5.3 时间字段可信度

客户端时间不作为唯一可信依据。

```txt
occurredAt：
  服务端生成的可信审计时间。
  用于事件排序、追责和审计。

clientOccurredAt：
  客户端上报时间。
  仅用于行为分析、延迟分析、前端遥测一致性检查。

serverReceivedAt：
  服务端接收时间。
  如与 occurredAt 分开记录，可用于网络延迟、sendBeacon 延迟分析。
```

Labeler 风险判断中，可以使用前端上报的 `totalWallTimeMs` / `activeTimeMs`，但必须结合服务端时间锚点校验。

新增风险信号：

```txt
CLIENT_TIME_DRIFT
```

触发条件第一版建议：

```txt
abs(serverElapsedMs - totalWallTimeMs) > max(30 秒, serverElapsedMs × 30%)
```

其中：

```txt
serverElapsedMs = serverReceivedAt - serverAssignedAt
```

如果前端时间与服务端时间差异过大，应记录为风险信号，但不应基于单一信号直接惩罚用户。

---

## 6. 各 Domain 的强制字段

`schemaId` 与 `schemaVersionId` 不能混用：

```txt
schemaId：
  Schema 模板本体 ID，表示同一个动态表单模板。

schemaVersionId：
  某一次发布后的不可变版本 ID，表示具体的 Schema 快照。
```

推荐字段要求：

| Domain | 强制 / 强推荐字段 | 说明 |
|---|---|---|
| LABELING | `taskId`, `assignmentId`, `userId`, `schemaVersionId` | 标注行为必须绑定任务、分配记录、标注员和表单版本 |
| REVIEW | `taskId`, `submissionId`, `reviewId`, `userId`, `schemaVersionId` | 审核 diff 必须能追溯 submission 和 reviewer |
| AI_ASSIST | `taskId`, `assignmentId`, `schemaVersionId`, `nodeId / fieldName` | AI 辅助必须能定位到具体 schema node |
| AI_REVIEW | `taskId`, `submissionId`, `schemaVersionId`, `aiReviewJobId` | AI Review 必须能追溯到审核任务 |
| SCHEMA_GOVERNANCE | `schemaId`, `schemaVersionId?`, `taskId?` | Draft 阶段可能没有 schemaVersionId，发布后必须有 |
| EXPORT | `exportId`, `taskId`, `targetSchemaVersionId?`, `includedSchemaVersionIds` | 导出必须记录目标版本和包含的版本集合 |

---

## 7. 各域事件类型

### 7.1 LABELING 域

```txt
ASSIGNMENT_OPENED
LABELING_SESSION_SUMMARY
SUBMISSION_CREATED
FORM_ABANDONED
LABELER_RISK_SIGNAL_GENERATED
LABELER_TRUST_LEVEL_CHANGED
LABELER_DISPATCH_SUSPENDED
```

### 7.2 REVIEW 域

```txt
REVIEW_STARTED
REVIEW_DIFF_GENERATED
REVIEW_SUBMITTED
REVIEW_PATCH_APPLIED
REVIEW_DEEP_DIFF_GENERATED
```

### 7.3 AI_ASSIST 域

```txt
AI_ASSIST_TRIGGERED
AI_ASSIST_SHOWN
AI_ASSIST_ACCEPTED
AI_ASSIST_DISMISSED
AI_ASSIST_EDITED
```

### 7.4 AI_REVIEW 域

```txt
AI_REVIEW_TRIGGERED
AI_REVIEW_OUTPUT_GENERATED
AI_REVIEW_CONFIRMED_BY_REVIEWER
AI_REVIEW_REJECTED_BY_REVIEWER
```

### 7.5 SCHEMA_GOVERNANCE 域

```txt
SCHEMA_COMPATIBILITY_CHECKED
DEPRECATION_WARNING_GENERATED
SCHEMA_PUBLISH_BLOCKED
SCHEMA_PUBLISH_REQUESTED
SCHEMA_VERSION_PUBLISHED
SCHEMA_PUBLISH_FAILED
MIGRATION_PLAN_CREATED
MIGRATION_DRY_RUN_COMPLETED
MIGRATION_EXECUTED
```

### 7.6 EXPORT 域

```txt
EXPORT_GENERATED
EXPORT_WARNING_RECORDED
DATA_QUALITY_PASSPORT_GENERATED
```

---

## 8. 四个核心机制

## 8.1 Quality Ledger：质量账本

Quality Ledger 是质量事件事实层。

设计原则：

1. 只追加，不直接更新已有事件；
2. 不保存完整敏感内容；
3. 不阻塞主业务流程；
4. 支持幂等写入；
5. 支持按 domain / taskId / schemaVersionId / submissionId / userId / eventType 查询；
6. 后续可异步聚合为质量指标、风控状态和 Data Quality Passport。

禁止保存：

```txt
完整 answers
完整 sourcePayload
完整 prompt
完整 LLM raw output
完整 export content
完整 before / after answers
```

允许保存：

```txt
hash
count
codes
fieldNames
schemaVersionId
submissionId
reviewId
exportId
summary
```

字段名默认可以进入审计摘要，例如 `summary`、`qualityRating`。如果项目存在特殊隐私要求，可以配置为使用 `fieldId` 或 `fieldAlias` 替代真实 fieldName。

---

## 8.2 Event Budget：事件预算

Quality Layer 不能变成日志洪水。

错误做法：

```txt
每次点击都发请求
每次按键都发请求
每次字段聚焦都写日志
```

正确做法：

```txt
高频行为在前端聚合；
后端只接收少量高价值事件。
```

一个 assignment 的默认事件预算：

```txt
1 个 LABELING_SESSION_SUMMARY
1 个 SUBMISSION_CREATED
最多 1 个 FORM_ABANDONED
AI assist 每次调用记录 1 个 outcome event
Reviewer 提交时记录 1 个 REVIEW_DIFF_SUMMARY
```

这意味着：

```txt
用户可以在前端操作几百次；
但最终上报的审计事件可能只有 1–3 条。
```

---

## 8.3 Data Quality Passport：数据质量护照

Data Quality Passport 是每条最终数据在导出时生成的质量摘要。

传统导出数据只有答案本身：

```json
{
  "summary": "...",
  "category": "...",
  "qualityRating": "pass"
}
```

LabelHub 的目标是让导出的数据附带质量证明：

```ts
type DataQualityPassport = {
  submissionId: string;
  schemaVersionId: string;

  finalAnswerHash: string;
  answerHashAlgorithm: "canonical-json-v1+SHA-256";

  labelerTrustLevel: "HIGH" | "MEDIUM" | "LOW" | "UNDER_REVIEW";
  trustLevelSnapshotAt: string;

  reviewStatus:
    | "UNREVIEWED"
    | "APPROVED"
    | "APPROVED_WITH_CHANGES"
    | "REJECTED";

  reviewerPatchCount: number;
  majorPatchCount?: number;
  changedFieldNames?: string[];

  aiAssistUsed: boolean;
  aiAcceptedCount: number;
  aiDismissedCount: number;
  aiEditedAcceptedCount?: number;

  riskCodes: RiskSignalCode[];
  auditEventCount: number;

  qualityLedgerRef: {
    labelingEventId?: string;
    reviewEventId?: string;
    exportEventId?: string;

    // 只保留与该 submission 直接相关的关键 Schema Governance 事件。
    // 第一版最多展开 10 条关键事件 ID。
    schemaGovernanceEventIds?: string[];

    // 与该 submission 直接相关的 Schema Governance 事件总数。
    // 注意：这是相关事件总数，不是被截断的数量。
    // schemaGovernanceEventIds 最多只展开前 10 条关键事件 ID。
    schemaGovernanceEventCount?: number;
  };
};
```

### Passport 生成时机

Passport 采用导出时快照策略：

```txt
Passport 不在 submission 阶段预存；
Passport 在 export 触发时实时生成；
Passport 反映的是导出那一刻的质量状态快照；
生成后作为该次 ExportRecord / export artifact 的一部分固化保存。
```

这意味着：

1. 同一条 submission 在不同时间导出，Passport 内容可能不同；
2. 每次导出的 Passport 携带 `trustLevelSnapshotAt`；
3. 一旦某次 export 生成完成，该次导出的 Passport snapshot 不再被后续 Trust Level 变化改写；
4. 这样可以保证同一次导出结果可复现、可审计。

选择导出时快照的理由：

1. `labelerTrustLevel` 是动态值，提前固化会导致历史导出数据的 Trust Level 失真；
2. 迁移发生后 `schemaVersionId` 可能更新，提前生成的 Passport 需要二次修改，违反 append-only 原则；
3. 导出本身是明确的数据交付行为，在这个时间点生成摘要语义最清晰。

### Passport 与 Quality Ledger 的存储边界

Quality Ledger 不存储完整 Passport 全文。

当 Export 触发时：

1. 后端根据 Quality Ledger、submission、review、AI assist、schema version 等信息生成 Data Quality Passport；
2. Passport 全文随 `ExportRecord` / export artifact 固化保存；
3. Quality Ledger 只记录 `DATA_QUALITY_PASSPORT_GENERATED` 事件；
4. 该事件携带 `exportId`、`passportCount`、`passportBatchHash` 和必要的 warning count；
5. 后续通过 `exportId` 查询完整 Passport 内容。

推荐事件 payload：

```ts
type DataQualityPassportGeneratedPayload = {
  exportId: string;
  passportCount: number;
  passportBatchHash: string; // canonical-json-v1 + SHA-256
  warningCount?: number;
};
```

这样既保证 Passport 可追溯，又避免把大体积 Passport 全文写入 Ledger。

### schemaGovernanceEventIds 的上限

`schemaGovernanceEventIds` 不穷举所有 Schema Governance 事件，只保留与该 submission 直接相关的关键事件 ID。

典型包括：

1. submission 创建时绑定的 `SCHEMA_VERSION_PUBLISHED`；
2. 影响该 submission 的 `MIGRATION_EXECUTED`；
3. 与导出版本治理直接相关的关键 warning / migration event。

第一版建议最多保留 10 条。  
如果相关事件超过 10 条，只保留最关键事件 ID，并通过 `schemaGovernanceEventCount` 记录相关事件总数。

完整治理链路仍可通过 `taskId`、`schemaVersionId`、`submissionId` 回查 Quality Ledger。

未来 Export 可以支持：

```txt
只导出 HIGH trust 数据
排除 FAST_SUBMIT 风险数据
只导出 reviewer approved 数据
导出含 AI assist 的数据
导出 reviewer 修改过的数据作为训练样本
```

---

## 8.4 Prompt Feedback Loop：Prompt 效果反馈闭环

LabelHub 中的 AI Assist / AI Review 不能只停留在“接了大模型”。

系统必须回答：

```txt
AI 到底有没有帮上忙？
Prompt 改了以后有没有变好？
哪些字段适合 AI 辅助？
哪些任务中 AI 反而拖慢了人？
```

因此，每一次 AI 辅助都应该进入 Prompt Feedback Loop。

建议记录：

```txt
AI_ASSIST_TRIGGERED
AI_ASSIST_SHOWN
AI_ASSIST_ACCEPTED
AI_ASSIST_DISMISSED
AI_ASSIST_EDITED
REVIEWER_CONFIRMED_AI_OUTPUT
REVIEWER_REJECTED_AI_OUTPUT
```

建议 payload：

```ts
type AiAssistOutcomePayload = {
  taskId: string;
  assignmentId: string;
  schemaVersionId?: string;

  nodeId: string;
  fieldName?: string;

  promptVersionId?: string;
  modelId?: string;
  assistType: "SUMMARY" | "REWRITE" | "CLASSIFICATION" | "QUALITY_CHECK";

  triggeredCount: number;
  acceptedCount: number;
  dismissedCount: number;
  editedCount: number;

  averageLatencyMs?: number;
  outputHash?: string;
  promptSnapshotHash?: string;
};
```

不记录：

```txt
完整 prompt
完整 raw LLM output
完整用户答案
```

只记录：

```txt
promptVersionId
modelId
nodeId
accepted / dismissed / edited 统计
hash
latency
```

可计算指标：

```txt
AI acceptance rate
AI rejection rate
AI edited acceptance rate
AI average latency
AI issue confirmation rate
Prompt version improvement rate
Prompt effectiveness score
```

示例：

```txt
Prompt v1 在 rewriteSuggestion 字段的 accepted rate = 18%
Prompt v2 accepted rate = 42%
Prompt v2 reviewer rejection rate 下降 15%
```

这使得 Prompt 迭代不再依赖主观感觉，而是有量化反馈。

---

## 9. Answer Hash 设计

### 9.1 统一 Hash 规范

Quality Layer 中所有内容 hash 统一使用与 Schema Governance 一致的规范：

```txt
序列化：canonical-json-v1
算法：SHA-256
```

不允许不同模块随意使用不同 hash 算法或序列化方式，避免跨模块无法验证。

### 9.2 canonical-json-v1 规则

1. object key 按字典序排序；
2. array 保持原顺序；
3. string / number / boolean / null 按 JSON 语义序列化；
4. `Date` 必须转为 ISO string；
5. `undefined` 字段在 object 中删除，在 array 中转为 `null`；
6. 不允许函数、Symbol、BigInt、循环引用；
7. 遇到不支持的值必须抛出结构化错误。

### 9.3 各场景 Hash 定义

| 字段 | Hash 内容 | 用途 |
|---|---|---|
| `answerHash` | `stableStringify(submission.answers)` | 检测重复提交、答案完整性验证 |
| `beforeAnswerHash` | review 前的 `stableStringify(submission.answers)` | Review Diff 溯源 |
| `afterAnswerHash` | review 后的 `stableStringify(correctedAnswers)` | Review Diff 溯源 |
| `diffSummaryHash` | `stableStringify({ patchedFields, patchCount })` | Diff 事件轻量指纹 |
| `outputHash` | `stableStringify(aiOutput)` | AI 输出内容指纹，不保存完整内容 |
| `promptSnapshotHash` | `stableStringify(promptContent)` | Prompt 版本追踪，不保存完整内容 |
| `finalAnswerHash` | export 时最终答案的 `stableStringify(finalAnswers)` | 数据交付完整性验证 |
| `passportBatchHash` | `stableStringify(passports)` | 验证一次导出的 Passport 集合未被篡改 |

Hash 只用于指纹识别和完整性验证，不用于恢复原始内容。

---

## 10. 风险信号系统

### 10.1 风险信号不是惩罚依据

Quality Layer 不应把用户简单分成“作弊 / 不作弊”。

更成熟的方式是：

```txt
信任分层，而不是好坏二分。
```

系统不应基于单一行为直接惩罚用户，而应综合多个信号形成 Trust Score。

### 10.2 RiskSignalCode

```ts
type RiskSignalCode =
  | "FAST_SUBMIT"
  | "LOW_ACTIVE_TIME"
  | "HIGH_PASTE_COUNT"
  | "LOW_FIELD_CHANGE_COUNT"
  | "REPEATED_ANSWER_HASH"
  | "HIGH_FOCUS_LOSS_COUNT"
  | "SCRIPT_LIKE_SUBMISSION_PATTERN"
  | "CLIENT_TIME_DRIFT";
```

### 10.3 默认风险阈值

第一版使用保守默认值，可由系统配置覆盖。

| 风险信号 | 触发条件 | 说明 |
|---|---|---|
| `FAST_SUBMIT` | `activeTimeMs < 3000` | 3 秒内提交，通常不足以完成真实阅读和填写 |
| `LOW_ACTIVE_TIME` | `activeTimeMs < totalWallTimeMs × 0.1` | 有效操作时间不足总时长 10% |
| `HIGH_PASTE_COUNT` | `pasteCount >= 3 且 pasteCount / changedFieldCount > 0.5` | 粘贴次数占字段修改次数超 50%，且绝对值 ≥ 3 |
| `LOW_FIELD_CHANGE_COUNT` | `changedFieldCount <= 1 且 schema 中必填字段 > 3` | 必填字段较多但修改记录极少 |
| `REPEATED_ANSWER_HASH` | 同一 labeler 在同一 task 内连续 3 次提交 `answerHash` 完全相同 | 机械性重复提交 |
| `HIGH_FOCUS_LOSS_COUNT` | `focusLossCount >= 10` | 切屏或失焦次数异常高 |
| `SCRIPT_LIKE_SUBMISSION_PATTERN` | `activeTimeMs < 500 且 changedFieldCount >= schema 必填字段数` | 极短时间内完成所有字段填写，疑似脚本 |
| `CLIENT_TIME_DRIFT` | `abs(serverElapsedMs - totalWallTimeMs) > max(30 秒, serverElapsedMs × 30%)` | 客户端计时与服务端时间锚点差异过大 |

### 10.4 风险阈值的后续校准

默认阈值只是第一版保守规则，不应长期固定。

后续应按以下维度校准：

```txt
task complexity
requiredFieldCount
schema profile
field type distribution
historical median duration
reviewer patch rate
task difficulty
```

例如：

```txt
简单单选任务允许更短 activeTimeMs；
多字段文本任务应提高最小期望时长；
摘要 / 富文本任务应重点监控 pasteRatio 和 reviewer patch rate。
```

第一版不实现完整 complexity profile，只在文档中保留演进方向，避免把 Batch A 复杂度推高。

### 10.5 Trust Level

建议 Labeler Trust Level：

```txt
HIGH
MEDIUM
LOW
UNDER_REVIEW
```

对应系统动作：

| Trust Level | 系统动作 |
|---|---|
| HIGH | 可派发高价值任务，较低抽检比例 |
| MEDIUM | 正常派单，标准抽检 |
| LOW | 增加抽检比例，限制高价值任务 |
| UNDER_REVIEW | 暂停自动派单，等待人工复核 |

Trust Score 综合：

```txt
Labeling session telemetry
Reviewer diff rate
Golden task accuracy
AI Review low-quality flags
Historical consistency
Repeated answer hash
```

Trust Level 变更必须写入 Quality Ledger：

```txt
LABELER_TRUST_LEVEL_CHANGED
payload: { previousLevel, newLevel, triggerEventIds, reason }
```

---

## 11. 前端行为遥测与时钟设计

### 11.1 为什么需要前端时钟

后端只能知道请求什么时候到达，无法知道用户在页面中的真实行为过程。

例如：

```txt
用户打开任务 5 分钟后提交
```

后端不知道这 5 分钟里用户是认真填写、离开页面、复制粘贴，还是挂着页面无操作。

因此 Labeler 前端需要维护轻量级 telemetry tracker。

### 11.2 前端时钟设计原则

```txt
前端计算摘要，后端接收结果。
```

不做：

```txt
每秒上报
每次按键上报
完整鼠标轨迹
完整粘贴文本
完整输入过程
```

只做：

```txt
提交时上报 session summary
页面关闭时 sendBeacon 兜底
必要时低频 heartbeat
```

### 11.3 Labeling Session Summary

```ts
type LabelingSessionSummaryPayload = {
  taskId: string;
  assignmentId: string;
  labelerId: string;
  schemaVersionId?: string;

  clientStartedAt: string;
  clientSubmittedAt: string;
  serverAssignedAt?: string;
  serverReceivedAt?: string;

  totalWallTimeMs: number;
  activeTimeMs: number;
  idleTimeMs: number;

  blurCount: number;
  focusLossCount: number;
  pasteCount: number;

  changedFieldCount: number;
  fieldEditCount: number;
  textareaPasteFieldNames?: string[];

  riskSignals: RiskSignalCode[];

  answerHash?: string;
};
```

### 11.4 前端 riskSignals 与后端验证

前端在生成 `LabelingSessionSummaryPayload` 时，可以根据默认阈值预计算 `riskSignals`。

但后端收到后必须独立再算一次。

规则：

```txt
如果 clientRiskSignals 与 serverRiskSignals 一致：
  直接写入 Ledger。

如果不一致：
  以后端计算结果为准；
  同时记录 clientRiskSignals 与 serverRiskSignals 的差异；
  差异本身可作为客户端可信度的额外信号。
```

### 11.5 Active / Idle 判断

建议规则：

```txt
用户输入、点击、聚焦字段、修改字段 → active
超过 60 秒无操作 → idle
window blur / visibility hidden → idle
恢复输入 → active
```

### 11.6 SendBeacon 兜底

页面关闭、刷新或隐藏时，普通 fetch 可能被浏览器中断。

对于小体积 summary，可以使用：

```txt
navigator.sendBeacon
```

适用：

```txt
FORM_ABANDONED
LABELING_SESSION_SUMMARY（页面意外关闭时）
AI_ASSIST_SUMMARY
```

不适用：

```txt
完整 answers
大文件
完整 migration report
```

sendBeacon payload 必须控制在浏览器限制以内，第一版建议远低于 64KB。

---

## 12. Reviewer Diff 审计

### 12.1 Diff 的语义

Reviewer 改了 Labeler 的答案，这个 `from → to` 的 Diff 是 Quality Layer 中最有训练价值的数据。

Diff 的语义边界：

```txt
Diff 只在质检环节产生。
Labeler 自己的中间修改过程不记录完整轨迹。
```

理由：

1. Labeler 的反复修改不一定说明错误，可能是认真斟酌；
2. 有歧义的题目更适合通过多 Labeler 分布检测；
3. Reviewer 的 Diff 有明确语义：专业判断认为原答案需要修正；
4. Reviewer Diff 可直接用于训练未来的 AI Reviewer。

### 12.2 ReviewDiffSummaryPayload

```ts
type ReviewDiffSummaryPayload = {
  submissionId: string;
  reviewId: string;
  reviewerId: string;
  labelerId?: string;
  schemaVersionId?: string;

  decision:
    | "APPROVED"
    | "APPROVED_WITH_CHANGES"
    | "REJECTED";

  patchedFieldNames: string[];
  patchCount: number;
  majorPatchCount?: number;
  minorPatchCount?: number;
  reasonCode?: string;

  beforeAnswerHash?: string;
  afterAnswerHash?: string;
  diffSummaryHash?: string;

  reviewDurationMs?: number;

  diffMode?: "FRONTEND_SHALLOW" | "SERVER_ASYNC_REQUIRED" | "SERVER_DEEP";
};
```

### 12.3 Diff 分层计算策略

Reviewer Diff 不应在前端硬算所有深度差异。

#### Level 1：前端浅 diff

默认由前端计算：

```txt
patchedFieldNames
patchCount
beforeAnswerHash
afterAnswerHash
isChanged
```

适用于：

```txt
普通动态表单
短文本
单选 / 多选
普通 JSON answers
```

对应：

```txt
diffMode: "FRONTEND_SHALLOW"
```

#### Level 2：后端异步 deep diff 请求

对于以下情况，前端不做深度 diff：

```txt
超大 JSON
富文本
长文本
嵌套动态表单
多段标注
```

触发条件第一版建议：

```txt
stableStringify(answers).length > 100KB
或任一文本字段长度 > 20KB
或嵌套深度 > 5
```

此时前端只记录：

```ts
{
  isChanged: true,
  beforeAnswerHash,
  afterAnswerHash,
  diffMode: "SERVER_ASYNC_REQUIRED"
}
```

`SERVER_ASYNC_REQUIRED` 是前端向后端表达“需要异步 deep diff”的信号。

#### Level 3：后端 deep diff 完成

后端 worker 完成异步 deep diff 后，写入：

```txt
REVIEW_DEEP_DIFF_GENERATED
```

该事件中携带：

```txt
diffMode: "SERVER_DEEP"
```

`SERVER_DEEP` 只由后端 worker 在 `REVIEW_DEEP_DIFF_GENERATED` 事件中设置，不由前端设置。

#### Level 4：训练数据级 diff

真正用于训练 AI Reviewer 的完整 before / after 数据，不从 audit payload 中读取。

训练团队通过：

```txt
submissionId
reviewId
beforeAnswerHash
afterAnswerHash
diffSummaryHash
```

回查正式 submission / review 数据库，生成训练样本。

---

## 13. 三类下游消费场景

### 13.1 数据分析师：效率、质量与 AI ROI 分析

数据分析师关心：

1. 哪类任务成本最高；
2. 哪类任务 Reviewer 修改最多；
3. 哪个 Prompt 版本效果最好；
4. AI 建议被采纳的比例；
5. AI 是否减少了人工审核成本；
6. 哪些 Labeler 的质量稳定；
7. 哪些字段最容易出错。

关键指标：

```txt
AI acceptance rate
AI rejection rate
AI edited acceptance rate
Reviewer patch rate
Labeler average correction count
Task quality score
Prompt effectiveness score
Schema version quality drift
```

示例分析：

```txt
某个 schema node 的 AI rewrite 建议 90% 被用户拒绝
→ 该字段的 Prompt v1 不适合
→ 应降低该字段的 AI 调用频率或重新设计 Prompt
→ Prompt v2 上线后 accepted rate 从 18% 升至 42%
→ 量化验证 Prompt 改进效果
```

---

### 13.2 实时质检系统：异常行为与低信任数据识别

实时质检系统关心：

1. 是否存在秒交；
2. 是否存在大量复制粘贴；
3. 是否存在脚本化提交；
4. 是否存在重复答案；
5. 是否存在低活跃时长；
6. 是否需要提高抽检比例；
7. 是否需要限制高价值任务派发。

关键事件：

```txt
LABELING_SESSION_SUMMARY
SUBMISSION_CREATED
LABELER_RISK_SIGNAL_GENERATED
LABELER_TRUST_LEVEL_CHANGED
LABELER_DISPATCH_SUSPENDED
```

---

### 13.3 模型训练团队：Reviewer Diff 纠错数据集

模型训练团队关心：

1. Labeler 原答案是什么；
2. Reviewer 改了哪些字段；
3. 为什么改；
4. 哪些字段最容易出错；
5. 哪些 diff 可以训练未来 AI Reviewer；
6. 哪些数据适合进入训练集。

Reviewer 的每一次修改都是一个监督信号。

Quality Ledger 的 `REVIEW_DIFF_GENERATED` 事件不保存完整 diff 内容，但提供索引和 hash：

```txt
submissionId
reviewId
patchedFieldNames
beforeAnswerHash
afterAnswerHash
diffSummaryHash
```

模型训练团队通过以上索引，从正式 submission / review 数据库中拉取完整 before / after，构建纠错数据集。

这样设计的好处：

```txt
Ledger 保持轻量，不成为大数据存储瓶颈；
训练数据的生成是按需的；
hash 可以验证从 Ledger 索引到的训练数据未被篡改。
```

---

## 14. 写入、查询与状态快照

### 14.1 不采用原教旨主义 Append-only

纯粹的 append-only 有明显弱点：

```txt
数据膨胀快；
读性能随时间下降；
查询当前状态需要反复重放历史事件；
不适合直接支撑高频前端页面。
```

因此，LabelHub 采用改良方案：

```txt
写入层保留 append-only 事实；
查询层使用可更新快照；
分析层使用异步聚合 read model。
```

### 14.2 CQRS + 状态快照

写入侧：

```txt
append QualityLedgerEvent
不在主链路做复杂统计
不更新历史事件
```

查询侧：

```txt
labeler_quality_snapshot
ai_review_metrics
reviewer_diff_metrics
task_audit_timeline
schema_governance_timeline
data_quality_passport_snapshot
```

这些 read model / snapshot 表可以 UPDATE，也可以定期重建。

示例：

```txt
Labeler 提交一次任务
→ 写入 LABELING_SESSION_SUMMARY
→ 异步更新 labeler_quality_snapshot.fastSubmitCount
→ 前端查询 Labeler 当前 Trust Level 时直接读 snapshot
```

这就是：

```txt
写日志，读快照。
```

### 14.3 为什么不每次查询都 replay Ledger

查询张三当前 Trust Score 时，不应重新计算他过去三年的所有事件。

正确方式：

```txt
近期风险：读 Redis / hot snapshot
当前质量：读 labeler_quality_snapshot
历史追溯：必要时回查 Ledger
长期分析：读数据仓库 / BI read model
```

---

## 15. Ledger 生命周期管理

### 15.1 Hot / Warm / Cold 分层

Quality Ledger 不应长期全部堆在在线关系型数据库里。

推荐分层：

| 层级 | 保存内容 | 保存周期 | 用途 |
|---|---|---:|---|
| Hot Ledger | 近期原始事件 | 7–30 天 | 实时风控、近期审计、Timeline |
| Warm Store | 聚合指标、可查询摘要 | 3–6 个月 | BI 报表、质量趋势、AI ROI |
| Cold Archive | 压缩原始事件或归档文件 | 6 个月以上 | 合规、事故复盘、长期追责 |
| Read Model | 当前状态快照 | 持续更新 | 前端页面、派单、dashboard |

### 15.2 TTL 与归档策略

第一版可以只保留 mock / 数据库事件。

工业化版本中，应支持：

```txt
Hot Ledger TTL
Warm aggregate snapshot
Cold object storage archive
按 taskId / exportId / userId 回查归档
```

示例策略：

```txt
近 30 天：audit_events 原始明细保留在在线库
30 天后：生成聚合快照，明细转入分析库或对象存储
半年后：压缩归档，仅事故复盘时回查
```

### 15.3 Temporal Tables 的定位

数据库时态表可以作为补充方案，但不作为 Quality Ledger 主体。

适合：

```txt
记录业务主表的历史版本；
低成本追踪 UPDATE / DELETE；
减少应用层维护历史表负担。
```

不适合替代 Quality Ledger：

```txt
无法表达 AI assist accepted / dismissed 这类业务事件；
无法表达 Labeling session summary；
无法表达 Prompt Feedback Loop；
无法表达跨域质量链路。
```

因此：

```txt
Temporal Tables 可用于业务主表历史追溯；
Quality Ledger 用于业务质量事件建模。
```

---

## 16. 实时风控快路径与质量评分慢路径

### 16.1 为什么需要双路径

完全依赖异步 CQRS 有延迟风险。

如果一个 Labeler 用脚本连续秒交，异步 read model 可能几分钟后才更新。这个延迟窗口内，高价值任务可能已经被大量低质量提交污染。

因此需要区分：

```txt
Risk Fast Path：实时风控快路径
Quality Slow Path：质量评分慢路径
```

### 16.2 Risk Fast Path

快路径只处理极高危、低成本、可快速判断的规则。

例如：

```txt
连续 3 次 activeTimeMs < 2000
连续 3 次 SCRIPT_LIKE_SUBMISSION_PATTERN
1 分钟内提交超过 N 个 assignment
CLIENT_TIME_DRIFT 连续出现
```

实现方式：

```txt
提交成功后写入事件；
同步或准同步更新 Redis 计数器；
派单前查询 risk state；
高风险用户进入 UNDER_REVIEW 或提高抽检比例。
```

示例 Redis key：

```txt
labeler:{userId}:fastSubmitCount
labeler:{userId}:recentSubmitCount
labeler:{userId}:riskState
```

所有用于实时风控快路径的 Redis key 必须设置 TTL，避免历史行为永久污染当前状态。

第一版建议：

```txt
fastSubmitCount：滑动窗口 24 小时
recentSubmitCount：滑动窗口 1 小时
riskState：默认 24 小时，可被新的高风险事件续期
```

如果系统需要长期保留风险结论，应将其转化为正式的 `LABELER_TRUST_LEVEL_CHANGED` 事件和人工复核记录，而不是依赖 Redis key 永久存在。

Redis 快路径只用于短期派单门控和抽检调整，不作为永久惩罚依据。

### 16.3 Quality Slow Path

慢路径处理复杂质量评估：

```txt
Reviewer patch rate
AI low-quality flags
Golden task accuracy
Historical consistency
Prompt effectiveness
Task difficulty
```

这些指标通过异步 consumer / batch job 更新 read model。

### 16.4 风控不等于惩罚

同步快路径只用于：

```txt
派单门控
提高抽检比例
限制高价值任务派发
进入 UNDER_REVIEW
```

不直接用于：

```txt
扣工资
封号
最终作弊判定
结算熔断
```

最终处理必须结合人工复核和多维信号。

---

## 17. 与 Schema Governance 的关系

### 17.1 共享 Quality Ledger

Schema Governance 的审计事件进入同一个 Quality Ledger，通过：

```txt
domain: "SCHEMA_GOVERNANCE"
```

区分。

这使得以下跨域链路可以被还原：

```txt
Schema_v1 发布
→ Task 创建
→ Labeler 提交
→ Reviewer 修改
→ Schema_v2 发布
→ Migration 执行
→ Export 生成
→ Data Quality Passport 固化
```

### 17.2 共享 Hash 体系

Quality Layer 的所有 hash 字段统一使用：

```txt
canonical-json-v1 + SHA-256
```

与 Schema Governance 的 stableStringify / checksum 体系保持一致。

### 17.3 共享导出治理原则

Data Quality Passport 不应绕过 Schema Version Management 的导出规则。

尤其：

1. 旧 answers 不得被新 Schema 自动解释；
2. `archivedAnswers` 没有明确 mapping 时不得回填到 target schema 表头；
3. Unified Export 必须遵守确定性 mapping 查找顺序；
4. ExportRecord 中应保存 export mode、schemaVersionId、warning count、checksum 和 Passport snapshot。

---

## 18. 推荐实施顺序

### Batch A：Quality Ledger 基础设施 + Schema Governance 接入

目标：

```txt
建立 Quality Ledger 基础结构
将现有 Schema Governance 审计事件接入统一 Ledger
```

最小实现：

```txt
QualityLedgerEvent 基础类型
idempotencyKey 去重逻辑
按 domain / taskId 查询
SCHEMA_GOVERNANCE 域事件写入
Owner Timeline 展示 Schema 治理链路
```

### Batch B：Labeler 行为审计 + 前端 Session Timer

目标：

```txt
Labeler 前端记录 session summary
提交时 append LABELING_SESSION_SUMMARY
```

最小实现：

```txt
totalWallTimeMs / activeTimeMs / idleTimeMs
blurCount / focusLossCount / pasteCount
changedFieldCount / fieldEditCount
riskSignals 前端预计算，后端验证
CLIENT_TIME_DRIFT 检测
```

### Batch C：Reviewer Diff 审计

目标：

```txt
Reviewer 提交审核时记录 REVIEW_DIFF_GENERATED / REVIEW_SUBMITTED
```

最小实现：

```txt
decision
patchedFieldNames
patchCount
beforeAnswerHash / afterAnswerHash
reasonCode
reviewDurationMs
diffMode
```

### Batch D：AI Review / AI Assist 采纳率审计

目标：

```txt
记录 AI 建议是否被接受 / 拒绝 / 修改后采纳
```

最小实现：

```txt
AI_ASSIST_TRIGGERED
AI_ASSIST_ACCEPTED
AI_ASSIST_DISMISSED
AI_ASSIST_EDITED
promptVersionId / modelId / nodeId
outputHash / promptSnapshotHash
```

### Batch E：Quality Metrics Read Model

目标：

```txt
从 audit events 中聚合简单指标
```

第一版可在 mock / service 层实现：

```txt
AI acceptance rate
labeler patch rate
fast submit count
review correction rate
prompt effectiveness score
```

### Batch F：Data Quality Passport

目标：

```txt
为 submission / export 生成质量护照
```

生成时机：

```txt
Export 触发时实时生成；
生成后随 ExportRecord / export artifact 固化保存。
```

最小字段：

```txt
schemaVersionId
finalAnswerHash
answerHashAlgorithm
labelerTrustLevel + trustLevelSnapshotAt
reviewStatus
reviewerPatchCount
aiAssistUsed / aiAcceptedCount
riskCodes
qualityLedgerRef
passportBatchHash
```

### Batch G：Ledger 生命周期与工业化存储

目标：

```txt
将 Quality Ledger 从 demo / MVP 结构演进为可长期运行的存储体系。
```

内容：

```txt
Hot Ledger TTL
Warm aggregate snapshots
Cold archive
Read model tables
Redis risk state
```

---

## 19. Demo 叙事建议

最终 demo 不建议只是展示很多按钮，而应该讲一个完整的数据质量故事。

建议按以下顺序串联，形成一条从结构可信到数据可信的质量链路。

### 场景一：Schema 发布治理，结构质量

```txt
Owner 修改 Schema，删除字段
系统检测到 Breaking Change
发布被阻断
Quality Ledger 记录 SCHEMA_PUBLISH_BLOCKED
Owner Timeline 显示治理链路
```

叙事重点：

```txt
不是禁止改，而是让改动透明、可控。
```

### 场景二：Reviewer 修改沉淀为训练信号，数据质量 × 模型价值

```txt
Reviewer 把 qualityRating 从 pass 改成 needs_revision
系统记录 REVIEW_DIFF_GENERATED
beforeAnswerHash / afterAnswerHash 保证可溯源
该 diff 成为未来 AI Reviewer 的训练候选样本
```

叙事重点：

```txt
每一次人工纠错，都在让 AI 变得更聪明。
```

### 场景三：Labeler 低信任提交被识别，过程质量

```txt
Labeler 2 秒提交，pasteCount 高，changedFieldCount 低
系统计算 riskSignals：FAST_SUBMIT + HIGH_PASTE_COUNT
Trust Level 从 MEDIUM 降为 LOW
LABELER_TRUST_LEVEL_CHANGED 写入 Ledger
该数据的 Quality Passport 中 labelerTrustLevel = LOW
```

叙事重点：

```txt
信任是综合的，变化是可追溯的，不是魔法值。
```

### 场景四：AI Prompt 效果不佳被量化，AI 质量

```txt
AI 给出 rewriteSuggestion
Labeler 拒绝，Reviewer 也未采纳
Prompt Feedback Loop 记录 accepted rate 偏低
分析师可以看到：Prompt v1 在该字段 accepted rate = 18%
Prompt v2 上线后升至 42%
```

叙事重点：

```txt
AI 的价值不是接入，而是可量化、可迭代。
```

### 场景五：导出数据带 Quality Passport，可信数据交付

```txt
Owner 导出数据
每条数据附带 Quality Passport
显示：HIGH trust 数据占比、风险数据数量、AI 参与比例、Reviewer 修改比例
支持筛选：只导出 HIGH trust + reviewer approved 数据
```

叙事重点：

```txt
LabelHub 导出的不是裸数据，而是带质量证据链的数据。
```

---

## 20. 答辩表达

可以这样描述：

```txt
LabelHub 的 Quality Layer 不是普通操作日志，而是一个面向数据质量生产的事件基础设施。

系统把标注行为、AI 辅助、人工审核、Schema 发布、数据迁移和导出统一建模为质量事件，进入同一个 Quality Ledger。不同业务域通过 domain 字段区分，支持跨域关联查询，让一条数据从 Schema 设计到最终导出的完整链路可以被还原。

同时，我们并不采用原教旨主义的 append-only。底层 Ledger 用于审计和追责，上层通过 CQRS 和状态快照支撑快速查询。风险控制采用快慢双路径：极高危行为进入实时风控快路径，复杂质量评分进入异步 read model。

所有内容 hash 统一使用 canonical-json-v1 + SHA-256，与 Schema Version Management 的 checksum 体系保持一致。

最终，LabelHub 导出的不是裸数据，而是带质量证据链的 Data Quality Passport。
```

一句话总结：

```txt
LabelHub 不只是让人完成标注，而是让整个数据生产链路可量化、可追溯、可优化。
```

---

## 21. 验收标准

### 21.1 功能标准

- Quality Ledger 支持 append-only 写入，不允许更新和删除原始事件。
- 幂等写入基于 idempotencyKey 去重，相同 key 不重复写入。
- 所有域事件进入同一 Ledger，通过 domain 区分。
- Migration 事件归入 SCHEMA_GOVERNANCE domain，不单独设 MIGRATION domain。
- `eventId` 是服务端生成的记录 ID，`idempotencyKey` 是业务幂等键。
- `occurredAt` 是服务端可信审计时间，`clientOccurredAt` 只用于行为分析。
- 风险信号基于第 10 节阈值触发，前端预计算，后端验证。
- Trust Level 变更必须写入 `LABELER_TRUST_LEVEL_CHANGED`。
- 所有 hash 字段统一使用 canonical-json-v1 + SHA-256。
- Data Quality Passport 在 Export 触发时生成，生成后随 ExportRecord / export artifact 固化保存。
- `DATA_QUALITY_PASSPORT_GENERATED` 事件只记录 exportId、passportCount、passportBatchHash、warningCount，不存储 Passport 全文。
- `schemaGovernanceEventIds` 最多保留 10 条关键事件 ID，`schemaGovernanceEventCount` 表示相关事件总数，完整链路通过 Ledger 查询。
- `reviewStatus` 支持 `UNREVIEWED`。
- Reviewer Diff audit event 不保存完整 answers，只保存 hash + 索引字段。
- 前端大 diff 超过阈值时不做 deep diff，交给后端异步 worker。
- `SERVER_DEEP` 只由后端 worker 在 `REVIEW_DEEP_DIFF_GENERATED` 事件中设置。
- 查询当前状态时优先使用 snapshot / read model，不反复 replay 全量 Ledger。

### 21.2 工程标准

- Quality Ledger 写入失败不阻塞主业务提交链路。
- sendBeacon payload 控制在浏览器限制以内。
- 前端不保存、不上报完整 answers / prompt / LLM raw output。
- 高危风控快路径只做派单门控和抽检调整，不直接惩罚用户。
- Read Model / Snapshot 可以 UPDATE，但原始 Ledger event 不可改写。
- Hot / Warm / Cold 存储生命周期明确。
- Redis fast path key 必须设置 TTL，避免历史行为永久污染当前状态。
- 新增类型定义在 `@labelhub/contracts`。
- 不破坏现有 Schema Governance 功能。

### 21.3 必须能解释的工程问题

1. 为什么所有域事件进入同一个 Ledger，而不是分多个日志系统？
2. 为什么不采用原教旨主义 append-only？
3. CQRS 和状态快照如何解决读性能问题？
4. 幂等写入如何保证网络重试不产生重复事件？
5. `eventId` 和 `idempotencyKey` 的区别是什么？
6. 为什么客户端时间不可信？
7. `CLIENT_TIME_DRIFT` 如何判断？
8. 风险信号为什么不直接惩罚用户，而是形成综合 Trust Score？
9. Data Quality Passport 为什么选择导出时快照？
10. Passport 生成后为什么要随 ExportRecord 固化保存？
11. 为什么 Ledger 只记录 `DATA_QUALITY_PASSPORT_GENERATED` 事件，而不保存 Passport 全文？
12. 为什么 `schemaGovernanceEventIds` 需要上限？
13. `schemaGovernanceEventCount` 表示什么？为什么它不是“被截断数量”？
14. 为什么 Reviewer Diff 不记录完整 before / after answers？
15. 大表单 / 富文本 diff 为什么不能全部在前端算？
16. `SERVER_ASYNC_REQUIRED` 和 `SERVER_DEEP` 的区别是什么？
17. Quality Layer 的 hash 体系如何与 Schema Governance 的 checksum 保持一致？
18. 工业化版本中，实时风控如何做到不阻塞主提交链路？
19. Redis fast path key 为什么必须设置 TTL？
20. 模型训练团队如何基于 Ledger 索引获取完整训练数据？
21. Trust Level 的历史变化如何追溯？
22. Hot / Warm / Cold Ledger 生命周期如何控制成本？
23. Temporal Tables 为什么不能替代 Quality Ledger？
