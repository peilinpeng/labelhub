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
| **Phase B2** | QL-4 第二步 / **RD-2** | `REVIEW_DIFF_GENERATED` audit | ✅ 已完成（未 commit，待维护者提交） |
| Phase C | QL-5 | Export / Data Quality Passport contracts 与 mock | ⬜ 未开始 |
| Phase D | QL-7 | Read Model / Snapshot / risk fast path | ⬜ 未开始（工业化阶段） |

> 维护规则：新任务追加到本表，**不要再引入新的编号体系**。

---

## 1. 当前 Git 基线（每次开班核对，每次收班更新）

```txt
分支：    feature/schema-governance-upgrade
commit：  待维护者 commit 后回填
工作区：  dirty（Phase B2 改动未 commit，含下方 3 个文件）
          - HANDOFF.md（修改）
          - apps/web/src/features/reviewer/ReviewDetailPage.tsx（修改）
          - apps/web/src/features/reviewer/reviewer-audit-events.ts（修改）
更新时间：2026-06-06（本班 Codex 完成 Phase B2 审查与收尾）
更新者：  Codex
```

> 注：本班开班时真实 HEAD 为 5acdcfa（`docs: add RD-2 task spec (REVIEW_DIFF_GENERATED)`）。
> Phase B2 代码改动尚未 commit，维护者提交后再回填最终 commit。

---

## 2. 当前任务（本轮范围，唯一权威）

**当前任务：Phase B2（= RD-2）REVIEW_DIFF_GENERATED audit 审查与收尾**

本轮目标：
- 审查 Claude Code 已写的 RD-2 diff audit；
- 确认 `REVIEW_DIFF_GENERATED` 触发时机、payload 安全性和 hash 真实性；
- 如审查通过，恢复更新本文件。

**本轮明确不做：**
- 不写 `REVIEW_DEEP_DIFF_GENERATED`；
- 不实现 SERVER deep diff / patch 分级；
- 不修改 contracts；
- 不修改 schema-core / docs；
- 不影响 Owner / Labeler / Export / AI Assist 现有链路。

> 详细任务规格见 `tasks/RD-2.md`。本文件只记状态，不重复全文。

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
  - `reviewer-audit-events.ts` `appendReviewSubmittedAuditSafely` 加 `patchCount` 参数（`ReviewSubmittedAuditPayload.patchCount` 已存在，未改 contracts）
  - 未写 `REVIEW_DIFF_GENERATED`，未生成 hash，未把完整 answers 写入 audit
  - 验证：web typecheck ✅ build ✅；contracts typecheck ✅ test ✅(65)；git diff --check ✅
- Phase B2（RD-2）：`REVIEW_DIFF_GENERATED` audit（未 commit，工作区 dirty）
  - 复用 contracts 现有 `ReviewDiffGeneratedAuditPayload`
  - 只在 `patches.length > 0` 且 `decideReview` 成功后写入
  - `diffMode = "FRONTEND_SHALLOW"`
  - `beforeAnswerHash` / `afterAnswerHash` / `diffSummaryHash` 复用 `hashCanonicalJson`
  - payload 只含摘要 + hash + 索引字段，`patchedFieldNames` 只含字段名
  - 未写 `REVIEW_DEEP_DIFF_GENERATED`
  - 未触碰 contracts / schema-core / docs

**进行中：**
- 无

**暂缓 / 推迟：**
- canonical-json-v1 + SHA-256 的前后端一致 test vectors（真实后端阶段再补）
- Phase C / D 全部

---

## 4. 上一班工作日志（收班时追加，最新在上）

> 格式：日期时间 | 工具 | 改了哪些文件 | 是否触碰边界 | 验证结果 | 遗留问题

```txt
### 2026-06-06 | Codex
- 任务：Phase B2（RD-2）REVIEW_DIFF_GENERATED audit 审查与收尾
- 改动文件：
  - HANDOFF.md（修改）
  - apps/web/src/features/reviewer/ReviewDetailPage.tsx（Claude Code 已改）
  - apps/web/src/features/reviewer/reviewer-audit-events.ts（Claude Code 已改）
- 是否触碰边界：
  - contracts：未改
  - schema-core：未改
  - docs：未改
  - apps/web/src/features/owner / labeler / admin：未改
- 验证：
  - apps/web typecheck ✅
  - apps/web build ✅
  - contracts typecheck ✅
  - contracts test ✅
  - git diff --check ✅
  - `.contract-test-dist` 生成产物已 `git checkout --` 恢复
- 手动 QA：
  - 需维护者手动 QA
- 遗留问题：
  - 无 blocker

### 2026-06-06 | Claude Code
- 任务：Phase B1（RD-1）Reviewer corrected answers / shallow patches
- 改动文件：
  - apps/web/src/features/reviewer/reviewer-diff.ts（新增）
  - apps/web/src/features/reviewer/ReviewDetailPage.tsx（修改）
  - apps/web/src/features/reviewer/reviewer-audit-events.ts（修改）
  - apps/web/src/styles.css（修改）
- 是否触碰边界：否
  - contracts：未改，`ReviewPatch` / `ReviewDecisionRequest.patches` / `ReviewSubmittedAuditPayload.patchCount` 均已存在
  - mock-db / handlers：未改，patches 已被支持（mock-db:882）
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
下一步：维护者先 review 当前 diff，手动 QA Reviewer 修改答案后是否写入 REVIEW_DIFF_GENERATED；
        确认无误后 commit Phase B2。
        之后进入 Phase C：Export / Data Quality Passport contracts 与 mock。

注意坑：
  1) Phase B2 改动尚未 commit，不要误以为 HEAD 已包含 RD-2；
  2) 手动 QA 重点看 audit payload 不含完整 answers / correctedAnswers / patch values；
  3) 无修改提交时不应写 REVIEW_DIFF_GENERATED；
  4) 提交失败时不应写 REVIEW_DIFF_GENERATED；
  5) 不影响 Owner / Labeler / Export / AI Assist 链路。
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
