# HANDOFF.md — 轮班交接状态（动态表单架构）

> 本文件是 Claude Code / Codex / 维护者轮班时的实时状态来源。
> 接手第一件事：读本文件 + `SCHEMA_ARCH_AGENT.md`，再读真实代码核对。
> 交班最后一件事：更新本文件。
> 本文件记录客观事实，不写“应该差不多了”这类模糊结论。
>
> 纪律：除非当前任务明确要求，否则 AI 不要 commit / push。维护者可以自行提交已经审查通过的交接文档或任务文件。

---

## 0. 当前 Git 基线

```txt
分支：feature/schema-governance-upgrade
HEAD：fcbccb4852acf7d340a94ad635ec6d02228003ad
HEAD 提交：web: show data quality passport summary
工作区：dirty，仅 HANDOFF.md 待提交
更新时间：2026-06-06
更新者：Codex
```

真实代码和 `git diff` 是唯一真相。后续接手时仍需先执行：

```bash
git status
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log --oneline --decorate -25
```

---

## 1. 状态总览

```txt
Schema Governance：已完成，可 demo
Quality Layer：已完成全链路代码回归，可 demo
Prompt Feedback Loop：已完成 Labeler + Reviewer 双侧闭环
Reviewer Diff：已完成 FRONTEND_SHALLOW diff audit
Data Quality Passport：已完成 contracts / mock generator / artifact query / Owner summary UI
```

当前建议：停止继续扩展 Quality Layer 新功能，转入最终 demo 固化与答辩材料准备。若浏览器手动 QA 发现问题，再开独立 bugfix batch。

---

## 2. 已完成模块清单

### 2.1 Owner Schema Governance

- 已完成 Publish Preview。
- 已完成 compatibility / deprecation / migration preview。
- breaking / blocking changes 会阻断发布。
- warnings / requiresApproval / requiresMigration 会要求管理员确认。
- Owner Audit Timeline 已接入并可展示 schema publish audit events。
- Schema Governance demo data 已固化。
- 受影响答卷数量仍使用“后端统计暂未接入”fallback，没有伪造数字。
- old schema 获取失败时降级为当前草稿本地检查。
- 发布失败不会再误提示成功或跳转。

核心文件：

```txt
apps/web/src/features/owner/OwnerSchemaPage.tsx
apps/web/src/features/owner/PublishPreviewDialog.tsx
apps/web/src/features/owner/AuditTimelinePanel.tsx
apps/web/src/features/owner/audit-events.ts
apps/web/src/mocks/demo-schema-governance.ts
```

### 2.2 Labeler telemetry

- 提交时写入 `LABELING_SESSION_SUMMARY`。
- 页面隐藏 / 离开时写入 `FORM_ABANDONED`。
- 统计 active time / idle time / blur / focus loss / paste / changedFieldCount / fieldEditCount / riskSignals。
- payload 不保存完整 answers。
- audit 写入失败只 `console.warn`，不阻断保存或提交。

核心文件：

```txt
apps/web/src/features/labeler/AssignmentPage.tsx
apps/web/src/features/labeler/useLabelingTelemetry.ts
```

### 2.3 Prompt Feedback Loop

AI assist metadata 已由 mock/API 返回：

```txt
promptVersionId
modelId
assistType
latencyMs
promptSnapshotHash
outputHash
```

renderer outcome callback 已完成：

```txt
SHOWN
ACCEPTED
DISMISSED
```

Labeler audit events 已完成：

```txt
AI_ASSIST_TRIGGERED
AI_ASSIST_SHOWN
AI_ASSIST_ACCEPTED
AI_ASSIST_DISMISSED
AI_ASSIST_EDITED
```

`AI_ASSIST_EDITED` 语义固定为：

```txt
用户先应用 AI patch，随后在提交前再次修改 AI patch 涉及字段。
```

Reviewer AI feedback 已完成：

```txt
AI_REVIEW_CONFIRMED_BY_REVIEWER
AI_REVIEW_REJECTED_BY_REVIEWER
```

重要边界：

- PASS / RETURN 不自动推断 AI feedback。
- `未参考` 不写 confirmed / rejected。
- 不保存完整 output。
- 不保存完整 suggestedPatch。
- 不保存 prompt / rawPrompt / raw output。
- 不生成 fake hash。

核心文件：

```txt
apps/web/src/features/labeler/ai-assist-audit-events.ts
packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx
packages/schema-renderer/src/SchemaRenderer.tsx
packages/schema-renderer/src/types.ts
apps/web/src/mocks/ai-prompt-registry.ts
apps/web/src/mocks/hash-utils.ts
apps/web/src/features/reviewer/ReviewDetailPage.tsx
apps/web/src/features/reviewer/reviewer-audit-events.ts
```

### 2.4 Reviewer Diff

- Reviewer corrected answers 已完成。
- shallow patches 已完成。
- `REVIEW_STARTED` 已完成。
- `REVIEW_SUBMITTED` 已完成。
- `REVIEW_DIFF_GENERATED` 已完成。
- `diffMode = "FRONTEND_SHALLOW"`。
- hash 字段已完成：

```txt
beforeAnswerHash
afterAnswerHash
diffSummaryHash
```

安全边界：

- 只在 `decideReview` 成功后写 `REVIEW_DIFF_GENERATED`。
- `patches.length === 0` 不写 `REVIEW_DIFF_GENERATED`。
- JSON parse 失败时显示中文错误，不提交。
- payload 不保存完整 answers / correctedAnswers / patch values。
- `patchedFieldNames` 只保存字段名。

核心文件：

```txt
apps/web/src/features/reviewer/ReviewDetailPage.tsx
apps/web/src/features/reviewer/reviewer-audit-events.ts
apps/web/src/features/reviewer/reviewer-diff.ts
```

### 2.5 Export / Data Quality Passport

- `EXPORT_GENERATED` summary audit 已完成。
- contracts 已新增：

```txt
DataQualityPassport
ExportRecord
ExportArtifactSummary
ExportJob.artifactSummary
GetExportArtifactRecordsResponse
```

- mock export 成功后生成 `ExportRecord[]`。
- 每条 `ExportRecord` 带 `DataQualityPassport`。
- 已生成真实 `finalAnswerHash`。
- 已生成真实 `passportBatchHash`。
- 已新增 API：

```txt
GET /api/v1/exports/:exportId/records
getExportArtifactRecords(exportId)
```

- mock export artifact 生成完成后写入 `DATA_QUALITY_PASSPORT_GENERATED` summary audit。
- Owner Export 页面已展示 Passport summary / records preview。

重要边界：

- `ExportRecord.data` 保存 final answers，但属于 export artifact，不属于 audit。
- Passport 全文存储在 mock export artifact，不写入 Quality Ledger。
- `DATA_QUALITY_PASSPORT_GENERATED` payload 只含 summary/hash/count。
- 不把 Passport 全文 / answers / records 写进 audit。

核心文件：

```txt
packages/contracts/src/export.ts
packages/contracts/src/api.ts
packages/contracts/src/audit.ts
apps/web/src/features/owner/OwnerExportPage.tsx
apps/web/src/features/owner/export-audit-events.ts
apps/web/src/api/owner.ts
apps/web/src/mocks/mock-db.ts
apps/web/src/mocks/handlers.ts
apps/web/src/mocks/hash-utils.ts
```

---

## 3. 验证记录（C-5 全链路代码回归）

最近一次 Quality Layer 全链路回归结果：

```txt
apps/web typecheck：通过
apps/web build：通过
packages/contracts typecheck：通过
packages/contracts test：通过，74 tests
packages/schema-renderer typecheck：通过
packages/schema-renderer test：通过，13 tests
packages/schema-core typecheck：通过
packages/schema-core test：通过，132 tests
git diff --check：通过
```

测试产物处理：

```txt
packages/contracts/.contract-test-dist 生成产物已恢复，不应出现在最终 diff 中。
```

### 浏览器手动 QA

维护者尚未在本轮给出逐项浏览器 QA 结果，因此记录为待手动验证：

```txt
Owner Schema Governance：待手动验证
Labeler AI Assist：待手动验证
Reviewer Diff：待手动验证
Reviewer AI Feedback：待手动验证
Export Passport：待手动验证
```

建议使用：

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

---

## 4. 安全边界记录

### 4.1 Hash 状态

- 当前 AI assist / Passport 主链路未发现 fake hash。
- `promptSnapshotHash` / `outputHash` / `finalAnswerHash` / `passportBatchHash` 使用真实 SHA-256 路径。
- mock 中仍有历史 `mock_prompt_ai_review` / `mock_prompt_schema_generation` 等旧字段，属于旧 AI Review / schema generation mock 路径，不阻塞 Quality Layer demo。
- 非阻塞 cleanup：后续可把旧 mock hash 文案清理为真实 SHA-256 形态或移除误导性字段。

### 4.2 Audit payload 禁止内容

audit payload 不应包含：

```txt
完整 answers
correctedAnswers
beforeAnswers
afterAnswers
prompt
rawPrompt
debugPrompt
rawOutput
rawResponse
suggestedPatch
ExportRecord.data
DataQualityPassport 全文
sourcePayload
review patch values
用户完整编辑轨迹
```

允许的 audit 字段包括：

```txt
hash
ids
counts
fieldNames
riskCodes
severity
source
actor
target
stage
message
```

### 4.3 Ledger 类型边界

- 不新增平行 `QualityLedgerEvent`。
- 继续复用 `AuditEventRecord.id` / `AuditEventRecord.createdAt` / `AuditEventRecord.type` / `AuditEventRecord.payload`。
- Passport 全文不进 audit；只在 export artifact / `ExportRecord` 中保存。

---

## 5. 下一步建议

```txt
1. 维护者完成浏览器手动 QA；
2. 若 QA 通过，停止 Quality Layer 功能开发；
3. 进入最终 demo 固化与答辩材料；
4. 之后再进入 Formily / schema renderer 升级；
5. 非阻塞 cleanup：清理旧 mock fake hash 文案。
```

不要继续扩展新的 Quality Layer 功能，除非手动 QA 发现必须修复的 bug。

---

## 6. 后续接手检查清单

- [ ] 已完整阅读 `SCHEMA_ARCH_AGENT.md`
- [ ] 已完整阅读本文件
- [ ] 已执行 Git 基线检查
- [ ] 已确认分支为 `feature/schema-governance-upgrade`
- [ ] 已确认工作区状态是否符合第 0 节
- [ ] 已按需阅读真实代码，而不是只依赖本文件
- [ ] 若继续开发，已确认任务边界并避免修改禁止文件

---

## 7. 收班检查清单

- [ ] 已运行本轮要求的验证命令
- [ ] 已恢复测试生成产物
- [ ] 已更新第 0 节 Git 基线
- [ ] 已更新第 1 节状态总览
- [ ] 已更新第 3 节验证记录
- [ ] 已更新第 5 节下一步建议
- [ ] 未把半成品或模糊状态交给下一班
