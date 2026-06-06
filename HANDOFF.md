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
| **Phase D** | QL-7 | Read Model / Snapshot / risk fast path | ⬜ 暂缓（待 FE 轨道完成后评估） |
| **FE-1** | Phase 1a | 安装 Formily + ComponentRegistry + FormilyRuntimeRenderer shell | ✅ 已完成（待 commit） |
| **FE-2** | Phase 1b | 7 个 input adapter + feature flag 接入 SchemaRenderer | ✅ 已完成（待 commit） |
| **FE-3** | Phase 1c | Formily answers 双向同步策略（debounce + flush on submit）+ 新增测试 | ⬜ **当前下一步** |

> 维护规则：新任务追加到本表，**不要再引入新的编号体系**。

---

## 1. 当前 Git 基线（每次开班核对，每次收班更新）

```txt
分支：    feature/schema-governance-upgrade
commit：  00491e4   feat(schema-renderer): add Formily shell and ComponentRegistry (FE-1)
工作区：  dirty（FE-1 + FE-2 未 commit：9 个新文件 + 3 个修改文件）
更新时间：2026-06-06（Claude Code FE-2 更新）
更新者：  Claude Code
```

> 开班时：`git rev-parse HEAD` 应得到 00491e4；工作区有 FE-1 + FE-2 待 commit 的改动（正常，等维护者 commit）。
> 说明：FE-1 commit 为 00491e4；维护者可选择分两次 commit（分别 FE-1/FE-2）或合并一次。

---

## 2. 当前任务（本轮范围，唯一权威）

**Schema Runtime Engine FE 轨道：FE-1 + FE-2 均已完成（待 commit），下一步为 FE-3。**

> Quality Layer 主体（Phase A / A-tail / B1 / B2 / C）已全部完成。Phase D 暂缓，先完成 FE 轨道。

**FE-3 目标（Phase 1c）：**
- 在 FormilyRuntimeRenderer 中实现 answers 双向同步：Formily form values → onAnswersChange（含 debounce 策略）；
- 在 SchemaRenderer.tsx feature flag 路径中添加 onSubmit flush（提交时立刻同步最新值）；
- 新增针对 formily-v2 路径的测试（FE-1/FE-2 对应的测试补充）。

**接手时明确不做（除非维护者另行指定）：**
- 不改 LLMAssistRenderer patch 逻辑（Phase 3 FE-8）；
- 不修改 contracts 破坏性变更；
- 不在 schema-renderer 引入 dnd-kit；
- 不 commit，不 push。

> FE-3 详细规格见 `FORMILY_ARCH_DECISIONS.md` 任务列表节。

---

## 3. 状态看板

**已完成：**
- FE-2（Phase 1b）：7 个 input adapter + feature flag 接入 SchemaRenderer（待 commit）
  - 新增 `packages/schema-renderer/src/adapters/` 目录（7 个 FormilyXxxAdapter.tsx + index.ts）
  - 修改 `packages/schema-renderer/src/types.ts`（新增 `engine?: "legacy" | "formily-v2"` 到 SchemaRendererProps）
  - 修改 `packages/schema-renderer/src/SchemaRenderer.tsx`（feature flag 分叉 + import FormilyRuntimeRenderer + DEFAULT_FORMILY_REGISTRY）
  - 修改 `packages/schema-renderer/src/index.ts`（追加 `export * from "./adapters"`）
  - 修改 `packages/schema-renderer/src/FormilyRuntimeRenderer.tsx`（完整 schema 遍历 + Field 渲染 + containerType fix）
  - 验证：schema-renderer typecheck ✅；test ✅(13/13)；apps/web typecheck ✅；git diff --check ✅
- FE-1（Phase 1a）：Formily 安装 + ComponentRegistry + FormilyRuntimeRenderer shell（待 commit）
  - 新增 `packages/schema-renderer/src/ComponentRegistry.ts`（类型定义 + createRegistry + COMPONENT_NAMES）
  - 新增 `packages/schema-renderer/src/FormilyRuntimeRenderer.tsx`（FormProvider shell，无 adapter）
  - 修改 `packages/schema-renderer/package.json`（新增 @formily/core@^2 + @formily/react@^2）
  - 修改 `packages/schema-renderer/src/index.ts`（新增两个导出）
  - 验证：schema-renderer typecheck ✅；test ✅(13/13)；apps/web typecheck ✅；git diff --check ✅
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
- FE-3（Phase 1c）：answers 双向同步 debounce + flush on submit + 新测试（下一班执行）

**暂缓 / 推迟：**
- canonical-json-v1 + SHA-256 的前后端一致 test vectors（真实后端阶段再补）
- mock-db.ts seed 审计记录中残留的 `sha256:mock-*` 佔位符（6 处，非 live 路径，非阻断性）
- Phase D（QL-7 Read Model / Snapshot / risk fast path）—— FE 轨道优先
- Vitest <4.1.0 critical CVE（GHSA-5xrq-8626-4rwp）—— 修复需 breaking change 升级 v4，由维护者决定时机

---

## 4. 上一班工作日志（收班时追加，最新在上）

> 格式：日期时间 | 工具 | 改了哪些文件 | 是否触碰边界 | 验证结果 | 遗留问题

```txt
### 2026-06-06 | Claude Code（FE-2 Phase 1b）
- 任务：7 个 input adapter + feature flag 接入 SchemaRenderer
- 改动文件：
  - packages/schema-renderer/src/adapters/FormilyTextInputAdapter.tsx（新增）
  - packages/schema-renderer/src/adapters/FormilyTextareaAdapter.tsx（新增）
  - packages/schema-renderer/src/adapters/FormilyJsonEditorAdapter.tsx（新增）
  - packages/schema-renderer/src/adapters/FormilyRadioAdapter.tsx（新增）
  - packages/schema-renderer/src/adapters/FormilyCheckboxAdapter.tsx（新增）
  - packages/schema-renderer/src/adapters/FormilySelectAdapter.tsx（新增）
  - packages/schema-renderer/src/adapters/FormilyTagsAdapter.tsx（新增）
  - packages/schema-renderer/src/adapters/index.ts（新增，含 DEFAULT_FORMILY_REGISTRY）
  - packages/schema-renderer/src/types.ts（新增 engine prop）
  - packages/schema-renderer/src/SchemaRenderer.tsx（feature flag 分叉 + imports）
  - packages/schema-renderer/src/index.ts（追加 adapters export）
  - packages/schema-renderer/src/FormilyRuntimeRenderer.tsx（完整 schema 遍历实现，fix containerType→type）
- 是否触碰边界：否
  - LLMAssistRenderer 未动（Phase 3 FE-8）
  - contracts 未动
  - 现有 13 个测试全部保持通过（feature flag 默认 legacy，现有路径不变）
  - dnd-kit 未引入
- 修复问题：
  - ContainerNode 不存在 containerType 属性（实为 type），FormilyRuntimeRenderer.tsx 第 94 行修正
  - adapter 采用手动 props 传递（而非 @formily/react connect + mapProps），规避 FieldComponentProps 索引签名与 connect 泛型的兼容性问题
- 验证：schema-renderer typecheck ✅；test ✅(13/13)；apps/web typecheck ✅；git diff --check ✅
- commit：待维护者 commit 后回填
- 遗留问题 / 卡点：
  - FormilyRuntimeRenderer answers 双向同步已在 FE-2 实现（form.subscribe），但 debounce + flush on submit 在 FE-3 补充
  - Vitest CVE 暂缓（同 FE-1 记录）

### 2026-06-06 | Claude Code（FE-1 Phase 1a）
- 任务：安装 @formily/core + @formily/react，新建 ComponentRegistry，建立 FormilyRuntimeRenderer shell
- 改动文件：
  - packages/schema-renderer/package.json（新增 @formily/core@^2, @formily/react@^2 到 dependencies）
  - packages/schema-renderer/src/ComponentRegistry.ts（新增）
  - packages/schema-renderer/src/FormilyRuntimeRenderer.tsx（新增）
  - packages/schema-renderer/src/index.ts（追加 2 条 export）
  - package-lock.json（npm install 更新，18 个新包）
- 是否触碰边界：否
  - SchemaRenderer.tsx 未动（feature flag 在 FE-2）
  - types.ts 未动（engine prop 在 FE-2 加）
  - 现有 renderers / components 全部未动
  - contracts 未动
  - apps/web 未动
- 验证：schema-renderer typecheck ✅；test ✅(13/13 全部通过)；apps/web typecheck ✅；git diff --check ✅
- commit：待维护者 commit 后回填
- 遗留问题 / 卡点：
  - Vitest <4.1.0 critical CVE（GHSA-5xrq-8626-4rwp）已记录至状态看板「暂缓」，非本次引入，非阻断
  - FormilyRuntimeRenderer 目前只是 FormProvider shell，无 answers 双向同步（FE-3 实现）
  - FormilyRuntimeRenderer 目前无 SchemaField 渲染（FE-2 接入 adapter 后完整激活）

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
下一步：FE-3（Phase 1c）—— answers 双向同步 debounce + flush on submit + 新测试。

准备工作（接手前先确认）：
  1) 工作区有 FE-1 + FE-2 未 commit 的改动（正常），HEAD 应为 00491e4；
  2) 先读 docs/FORMILY_ARCH_DECISIONS.md 全文（FE-3 策略约束在里面）；
  3) 先做实施前审查：读 FormilyRuntimeRenderer.tsx，确认现有 form.subscribe 实现，
     决定 debounce 方案（useRef + setTimeout vs lodash debounce）。

FE-3 核心改动：
  - FormilyRuntimeRenderer.tsx：answers subscribe 加 debounce（建议 ~300ms）
  - SchemaRenderer.tsx 的 formily-v2 路径：onSubmit 时 flush 最新 form.values（绕过 debounce 等待）
  - src/__tests__/ 新增针对 formily-v2 路径的测试（至少覆盖：初始值渲染、值变更触发 onAnswersChange）

注意事项：
  - 不要改 LLMAssistRenderer（Phase 3b FE-8 才动）
  - 不要在 schema-renderer 引入 dnd-kit
  - 不要 commit，不要 push
  - 现有 13 个测试必须继续全部通过

已知技术债（不阻断 FE-3）：
  - Vitest <4.1.0 critical CVE，由维护者决定是否升级 v4
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
