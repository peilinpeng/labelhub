# HANDOFF.md — 轮班交接状态（动态表单架构）

> 本文件是两个 AI 工具（Claude Code / Codex）轮班时的**唯一实时状态来源**。
> 接手第一件事：读本文件 + `SCHEMA_ARCH_AGENT.md`，再读真实代码核对。
> 交班最后一件事：更新本文件。
> **本文件记录客观事实，不写「应该差不多了」这类模糊结论。**
>
> **关于 commit 的说明（给接手的 AI）：** 「不要 commit / push」的纪律针对的是**任务代码改动**。
> 项目维护者本人可能会为「交接文档 / 任务文件」（本文件、SCHEMA_ARCH_AGENT.md、AGENTS.md、tasks/*.md）做基础设施 commit，这是正常的，不违反纪律。
> 你（AI）在执行任务时，除非当前任务明确要求，否则仍然不要 commit 任何东西。

---

## 0. 统一编号对照表（消除三套编号混乱）

历史上出现过三套编号，现统一为单一轨道。以后**只用统一编号**。

| 统一编号 | 旧称（设计文档 / prompt / 审阅） | 内容 | 状态 |
|---|---|---|---|
| Phase A | QL-6 / AI-1~AI-6 | Prompt Feedback Loop（metadata、renderer callback、Labeler 事件、AI_ASSIST_EDITED、Reviewer AI feedback） | ✅ 已完成 |
| A-tail | AI-7 | mock prompt registry / 真实 SHA-256 `promptSnapshotHash` / `outputHash` | ✅ 已完成（commit 73ec0bc） |
| Phase B1 | QL-4 第一步 / RD-1 | Reviewer corrected answers + shallow patches（不写 audit） | ✅ 已完成（commit 31e4bac） |
| Phase B2 | QL-4 第二步 / RD-2 | `REVIEW_DIFF_GENERATED` audit | ✅ 已完成（commit 436886f） |
| Phase C | QL-5 | Export / Data Quality Passport contracts 与 mock | ✅ 已完成（contracts 6993e3b / web fcbccb4） |
| **Phase D** | QL-7 | Read Model / Snapshot / risk fast path | ⬜ **当前下一步**（工业化阶段） |

> 维护规则：新任务追加到本表，**不要再引入新的编号体系**。

---

## 1. 当前 Git 基线（每次开班核对，每次收班更新）

```txt
分支：    feature/schema-governance-upgrade
commit：  1e9ed33   docs: finalize quality layer handoff
工作区：  clean
更新时间：2026-06-06（Claude Code Handoff Audit 更新）
更新者：  Claude Code
```

> 开班时：`git rev-parse HEAD` 应得到 1e9ed33；工作区应为 clean。

---

## 2. 当前任务（本轮范围，唯一权威）

**Quality Layer 主体已全部完成（Phase A / A-tail / B1 / B2 / C）。下一步为 Phase D。**

> 本轮无进行中任务。接手后直接阅读 Phase D 规格（待创建 `tasks/PD-1.md`）。

**Phase D 目标（工业化阶段，尚未开始）：**
- Read Model / Snapshot：将审计事件投影为可查询的质量快照，供 Export 和后端风控读取；
- risk fast path：基于 Labeler 风险信号（`LabelerTrustLevel`、`riskSignals`）的前端快速路径提示。

**接手时明确不做（除非维护者另行指定）：**
- 不修改 B1/B2/Phase C 已完成实现；
- 不修改 contracts 破坏性变更；
- 不实现 `REVIEW_DEEP_DIFF_GENERATED` / `SERVER_*` diffMode（超出前端浅层范围）；
- 不生成 fake hash。

> Phase D 详细规格见未来的 `tasks/PD-1.md`。本文件只记状态，不重复全文。

---

## 3. 状态看板

**已完成：**
- Phase A：Prompt Feedback Loop 全链路
- A-tail：mock prompt registry + 真实 SHA-256 `promptSnapshotHash` / `outputHash`（commit 73ec0bc）
  - 新增 `apps/web/src/mocks/ai-prompt-registry.ts`、`apps/web/src/mocks/hash-utils.ts`
  - 无 fake hash，response 不返回完整 prompt
- Phase B1（RD-1）：Reviewer corrected answers / shallow patches（commit 31e4bac）
  - 新增 `apps/web/src/features/reviewer/reviewer-diff.ts`（`computeReviewPatches`）
  - 复用 contracts `ReviewPatch`（`previousValue`/`nextValue`），无新增类型
  - `ReviewDetailPage.tsx` 加 correctedAnswers JSON textarea UI，handleDecision 提交时带 patches
  - `reviewer-audit-events.ts` `appendReviewSubmittedAuditSafely` 加 `patchCount` 参数
  - 验证：web typecheck ✅ build ✅；contracts typecheck ✅ test ✅(74)；git diff --check ✅
- Phase B2（RD-2）：`REVIEW_DIFF_GENERATED` audit（commit 436886f）
  - 新增 `appendReviewDiffGeneratedAuditSafely`，async IIFE fire-and-forget
  - payload 只含 patchedFieldNames（字段名）+ patchCount + hash + 索引字段，无完整 answers
  - `beforeAnswerHash` / `afterAnswerHash` / `diffSummaryHash` 复用 `hashCanonicalJson`（真实 SHA-256）
  - `mapDecisionForDiffAudit`：PASS → APPROVED_WITH_CHANGES，RETURN → REJECTED
  - patches.length === 0 时不写 diff audit
  - 验证：web typecheck ✅ build ✅；contracts typecheck ✅ test ✅(74)；git diff --check ✅
- Phase C（QL-5）：Data Quality Passport contracts 与 mock（commits 6993e3b–fcbccb4）
  - contracts `export.ts` 新增 `DataQualityPassport` interface 及关联类型
  - `mock-db.ts` `generateExportArtifact` 生成 passport、`finalAnswerHash`（真实 SHA-256）、`passportBatchHash`
  - `OwnerExportPage.tsx` 展示 passport 摘要
  - `DATA_QUALITY_PASSPORT_GENERATED` audit 事件写入（passportBatchHash 为真实 SHA-256）
- Reviewer demo seed 稳定化（commit adae1ab）
  - sub_1001–1004 迁移到 `apps/web/src/mocks/data/` 独立文件，固定 id / answers / timestamps

**进行中：**
- 无

**暂缓 / 推迟：**
- canonical-json-v1 + SHA-256 的前后端一致 test vectors（真实后端阶段再补）
- mock-db.ts seed 审计记录中残留的 `sha256:mock-*` 佔位符（6 处，非 live 路径，非阻断性）
- Phase D 全部

---

## 4. 上一班工作日志（收班时追加，最新在上）

> 格式：日期时间 | 工具 | 改了哪些文件 | 是否触碰边界 | 验证结果 | 遗留问题

```txt
### 2026-06-06 | Claude Code（Handoff Audit）
- 任务：独立审查 handoff 状态一致性（只读，不改代码）
- 审查结论：
  - B2 代码实现正确，payload 安全边界满足，hash 真实
  - Phase C passport 实现完整，passportBatchHash 为真实 SHA-256
  - 全部验证通过：web ✅ contracts test ✅(74) schema-core ✅(132) schema-renderer ✅(13)
  - 发现并记录 3 项非阻断性问题（见状态看板「暂缓」列）
  - 更新本文件 Section 0/1/2/3/4/5 以反映实际完成状态

### 2026-06-06 | 维护者（项目推进）
- 任务：Phase B2（RD-2）REVIEW_DIFF_GENERATED + Phase C Data Quality Passport + seed 稳定化
- 改动文件（B2）：
  - apps/web/src/features/reviewer/reviewer-audit-events.ts（新增 appendReviewDiffGeneratedAuditSafely）
  - apps/web/src/features/reviewer/ReviewDetailPage.tsx（handleDecision 调用 diff audit）
- 改动文件（Phase C）：
  - packages/contracts/src/export.ts（新增 DataQualityPassport 及关联类型）
  - packages/contracts/src/audit.ts（新增 DataQualityPassportGeneratedAuditPayload）
  - apps/web/src/mocks/mock-db.ts（generateExportArtifact + passport 生成 + audit 写入）
  - apps/web/src/features/owner/OwnerExportPage.tsx（passport 摘要展示）
  - apps/web/src/styles.css（passport 相关样式）
- 改动文件（seed 稳定化）：
  - apps/web/src/mocks/data/assignments.mock.ts（新增）
  - apps/web/src/mocks/data/dataset-items.mock.ts（修改）
  - apps/web/src/mocks/data/reviews.mock.ts（新增，sub_1001–1004 AI review results）
  - apps/web/src/mocks/data/submissions.mock.ts（新增，sub_1001–1004 固定种子）
- 是否触碰边界：否（contracts 为最小新增，无破坏性变更；禁改文件未碰）
- 验证：web typecheck ✅ build ✅；contracts typecheck ✅ test ✅(74)；git diff --check ✅
- 遗留问题 / 卡点：
  - mock-db.ts 中 REVIEW_DIFF_GENERATED / LABELING_SESSION_SUMMARY / EXPORT_GENERATED
    的静态种子审计记录仍含 sha256:mock-* 佔位符（6 处），非 live 路径，非阻断
  - 手动 QA 需维护者在浏览器验证 MSW 链路

### 2026-06-06 | Claude Code
- 任务：Phase B1（RD-1）Reviewer corrected answers / shallow patches
- 改动文件：
  - apps/web/src/features/reviewer/reviewer-diff.ts（新增）
  - apps/web/src/features/reviewer/ReviewDetailPage.tsx（修改）
  - apps/web/src/features/reviewer/reviewer-audit-events.ts（修改）
  - apps/web/src/styles.css（修改）
- 是否触碰边界：否
  - contracts：未改，`ReviewPatch` / `ReviewDecisionRequest.patches` / `ReviewSubmittedAuditPayload.patchCount` 均已存在
  - mock-db / handlers：未改，patches 已被支持
  - schema-core / docs / labeler / owner：未碰
- 验证：web typecheck ✅ build ✅；contracts typecheck ✅ test ✅(65)；git diff --check ✅
  - `.contract-test-dist` 生成产物已 `git checkout --` 恢复
- 遗留问题 / 卡点：无 blocker
  - 本轮为 JSON textarea 单一编辑器（非字段级 inline 编辑），符合 RD-1.md 第一版要求
  - 手动 QA 未跑（需浏览器验证 MSW 链路）

### <填写时间> | Codex
- 任务：A-tail（AI-7）mock prompt registry + 真实 SHA-256
- 改动文件：
  - apps/web/src/mocks/mock-db.ts（修改）
  - apps/web/src/mocks/handlers.ts（修改，支持 async response）
  - apps/web/src/mocks/ai-prompt-registry.ts（新增）
  - apps/web/src/mocks/hash-utils.ts（新增，hashCanonicalJson + crypto.subtle SHA-256）
- 是否触碰边界：否，只动 apps/web/src/mocks/**
- 验证：apps/web typecheck ✅ build ✅；contracts typecheck ✅ test ✅(65)；schema-core typecheck ✅ test ✅(132)；git diff --check ✅
- 遗留问题 / 卡点：
  - 浏览器工具未能直读 Network response 详情，hash 字段通过代码路径 + build/typecheck 间接确认（非阻塞）
  - 顺手移除了 Quality Layer seed 中 AI assist 旧的 sha256:mock-* 字段
```

---

## 5. 交接给下一班的明确指令

> 上一班在收班时填写，给接手方一句话讲清「下一步立刻该做什么 + 有什么坑」。

```txt
下一步：Phase D（QL-7）Read Model / Snapshot / risk fast path。
        规格尚未创建，维护者需先补 tasks/PD-1.md。

准备工作（接手前先确认）：
  1) 工作区应为 clean，HEAD 应为 1e9ed33；
  2) 阅读 docs/Labelhub_Quality_Layer.md 第 13 节（Read Model）和第 14 节（risk fast path）
     了解目标态，但只实现维护者在 PD-1.md 指定的最小范围；
  3) Phase D 是工业化阶段，涉及 snapshot 投影和风控逻辑，改动面可能较大；
     接手前务必先做实施前审查并等维护者确认再动代码。

已知非阻断性技术债（不影响 Phase D，但可在 Phase D 前顺手修复）：
  - mock-db.ts 中 3 条静态 seed 审计记录的 sha256:mock-* 佔位符（6 处）
    可用 hashCanonicalJson 预计算结果替换，参考 DATA_QUALITY_PASSPORT_GENERATED seed 的做法。

不要做的事：
  - 不要实现 REVIEW_DEEP_DIFF_GENERATED / SERVER_* diffMode；
  - 不要修改 B1/B2/Phase C 已完成实现；
  - 不要 commit，不要 push。
```

---

## 6. 开班检查清单（接手时逐项确认）

- [ ] 已完整读 `SCHEMA_ARCH_AGENT.md`
- [ ] 已完整读本文件（含第 0 节编号表、第 2 节当前任务）
- [ ] 已跑 `git status` / `git rev-parse HEAD`，与第 1 节基线一致
- [ ] 工作区 clean（若 dirty，已理解第 4 节记录的原因）
- [ ] 已读当前任务涉及的真实代码文件
- [ ] 已确认本轮范围，不超出第 2 节「明确不做」

---

## 7. 收班检查清单（交班前逐项确认）

- [ ] 工作区可编译，typecheck 通过（或已明确标注「未完成，卡在 X」）
- [ ] 已更新第 1 节 Git 基线（commit / 工作区状态 / 时间 / 更新者）
- [ ] 已更新第 3 节状态看板
- [ ] 已在第 4 节追加本班工作日志
- [ ] 已填写第 5 节给下一班的指令
- [ ] 未把跑不起来的半成品静默交接
