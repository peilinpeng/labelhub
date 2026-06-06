# tasks/RD-2.md — REVIEW_DIFF_GENERATED 最小实现（前端浅层）

> 统一编号：Phase B2（= 设计文档 QL-4 第二步 = RD-2）
> 前置：Phase B1（RD-1）已完成——Reviewer corrected answers + 真实 patches 已能在 PASS/RETURN 提交时带入 decideReview request。
> 状态以 `HANDOFF.md` 为准。本文件是任务规格，不记进度。

## 语言与风格约定

1. 工作语言统一为中文。
2. 文档、代码注释、README、错误提示、测试描述、UI 文案使用中文。
3. TypeScript 类型名、接口名、变量名、函数名、枚举值、API 路径使用英文。
4. 不要在同一个文件中混用中英文注释。

## 任务背景

RD-1 已经让 Reviewer 在提交审核时基于 `submission.answers` 与 `correctedAnswers` 生成结构化 `patches`（contracts 的 `ReviewPatch[]`，字段为 `previousValue` / `nextValue`），并带入 decideReview request。当前 `patches` 只作为 review decision 数据传输，**还没有写入任何 audit 事件**。

本次任务 RD-2：基于 RD-1 已经算好的真实 patches，写入 `REVIEW_DIFF_GENERATED` 审计事件，让 Reviewer 的修改沉淀为可溯源的质量信号（供后续 Data Quality Passport / 训练数据筛选使用）。

## 目标

在 Reviewer 提交审核（有实际修改时）后，写入一条 `REVIEW_DIFF_GENERATED` audit 事件，payload 只包含**摘要 + hash + 索引字段**，不包含完整 answers。

---

## 本轮范围边界（最重要，先读）

本轮**只做**前端浅层 diff（`diffMode: "FRONTEND_SHALLOW"`）那一层。设计文档第 12 节里描述的以下内容**全部不在本轮范围**：

- `REVIEW_DEEP_DIFF_GENERATED` / `diffMode: "SERVER_ASYNC_REQUIRED"` / `diffMode: "SERVER_DEEP"`（Level 2/3，后端 worker 的活）
- 超大 JSON / 富文本的 deep diff 触发逻辑（100KB / 20KB / 嵌套深度 > 5 那套阈值）
- `majorPatchCount` / `minorPatchCount`（patch 分级，本轮不分级）
- 训练数据级 diff（Level 4）
- Read Model / Snapshot / Data Quality Passport 本体

看到这些不要顺手实现。本轮就是「把 RD-1 已有的 patches，组装成一条 FRONTEND_SHALLOW 的 REVIEW_DIFF_GENERATED 事件并 append」。

本轮**不要**：
- 不修改 schema-core；
- 不修改 docs；
- 不影响 Owner / Labeler / Export / AI Assist 现有链路；
- 不影响 RD-1 已实现的 patches 提交逻辑（只在其后追加 audit，不改其行为）；
- 不生成 fake hash；
- 不把完整 answers / correctedAnswers / before/after answers 写入 audit payload。

---

## 0. 开始前检查

```bash
git status
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log --oneline --decorate -20
```

要求：分支必须是 `feature/schema-governance-upgrade`；工作区必须干净；存在意外的未提交修改或 untracked 文件则停止并报告；不要 commit；不要 push。

> 注：RD-1 的代码改动已由维护者 commit，最新一条 commit 应为 RD-1（reviewer corrected answers and shallow patches）。HEAD 比 HANDOFF.md 记录新属于正常情况。

---

## 1. 实施前审查（关键分叉，必须先做）

先阅读：

```txt
packages/contracts/src/audit.ts
packages/contracts/src/review.ts
apps/web/src/features/reviewer/reviewer-audit-events.ts
apps/web/src/features/reviewer/reviewer-diff.ts          # RD-1 新增的 helper
apps/web/src/features/reviewer/ReviewDetailPage.tsx
apps/web/src/mocks/hash-utils.ts                          # A-tail 实现的真实 SHA-256
apps/web/src/mocks/handlers.ts
apps/web/src/mocks/mock-db.ts
```

**必须先确认以下几点，输出简短审查结论后等维护者确认，再写代码：**

1. **contracts 是否已有 `REVIEW_DIFF_GENERATED` 事件类型**（在 `AuditEventType` 里）？
   - 如果**已有** → 走「路径 A」，复用现有类型，前端只组装 payload + append。
   - 如果**没有** → 这触发「必须改 contracts」红线。**停止并报告**，不要自行在 contracts 新增事件类型。等维护者决定（可能需要单开一个 contracts 扩展小任务）。
2. **contracts 是否已有 `REVIEW_DIFF_GENERATED` 对应的 payload 类型**（类似 `ReviewDiffSummaryPayload`）？同样：有则复用，没有则报告，不要在 apps/web 里新建局部 payload 类型来绕过。
3. RD-1 里 `reviewer-diff.ts` 的 `computeReviewPatches` 返回的 `ReviewPatch[]` 结构（字段 `fieldName` / `previousValue` / `nextValue` / `reason`）——RD-2 直接复用它的输出，不要重算。
4. `ReviewDetailPage.tsx` 的 `handleDecision` 里，RD-1 在哪里算出 patches、在哪里调用 decideReview、在哪里调用 `appendReviewSubmittedAuditSafely`——RD-2 的 diff audit 应追加在审核**提交成功之后**。
5. `hash-utils.ts` 里 `hashCanonicalJson`（或等价函数）的签名——RD-2 的 `beforeAnswerHash` / `afterAnswerHash` 必须复用它（canonical-json-v1 + SHA-256），**不要新造 hash 函数，不要生成 fake hash**。
6. mock 的 `decideReview` / audit append endpoint 是否需要扩展才能接收 `REVIEW_DIFF_GENERATED`——优先最小改动。

---

## 2. REVIEW_DIFF_GENERATED payload 字段要求（路径 A：contracts 已有类型时）

本轮只填**前端浅层**能可信得到的字段。以设计文档第 12.2 节 `ReviewDiffSummaryPayload` 为参照，但**以 contracts 真实类型为准**（字段名不一致时，用 contracts 的）：

必填 / 强推荐：

```txt
submissionId
reviewId
reviewerId
schemaVersionId?
decision            # 复用现有 review decision 映射（PASS/RETURN → contracts 的 decision 枚举）
patchedFieldNames   # 来自 RD-1 patches 的 fieldName 列表
patchCount          # patches.length
diffMode: "FRONTEND_SHALLOW"
```

hash 字段（必须真实，复用 hash-utils）：

```txt
beforeAnswerHash    # hashCanonicalJson(submission.answers)
afterAnswerHash     # hashCanonicalJson(correctedAnswers)
diffSummaryHash?    # 可选：hashCanonicalJson({ patchedFieldNames, patchCount })，若实现成本低可加，否则先省略
```

可选：

```txt
reviewDurationMs?   # 若 handleDecision 已有该值，复用；没有则不强求
```

**严禁写入 payload：**

```txt
完整 answers / correctedAnswers
完整 before/after answers
每个 patch 的 previousValue / nextValue 原始值   # 只写 fieldName，不写值
prompt / raw output / sourcePayload
```

> 关键：`patchedFieldNames` 只放字段名（如 `["qualityScore", "keywords"]`），**不放字段的具体值**。具体值通过 hash + 正式数据库回查，不进 audit。

---

## 3. 触发与写入时机

1. 仅在**有实际修改时**写 `REVIEW_DIFF_GENERATED`：即 RD-1 算出的 `patches.length > 0`。
2. 无修改（patches 为空）→ **不写** `REVIEW_DIFF_GENERATED`，按现有逻辑正常提交即可。
3. 写入时机：审核**提交成功之后**（与 `appendReviewSubmittedAuditSafely` 同级或紧随其后），不要在提交失败时写。
4. 审核提交失败 → 不写 diff audit，不显示成功。
5. diff audit 写入失败 → 只 `console.warn`，**不阻断**主审核流程（与现有 audit helper 的容错风格一致）。
6. idempotencyKey 建议格式（参照设计文档 5.2 与现有 reviewer audit 风格）：
   ```txt
   REVIEW:{submissionId}:REVIEW_DIFF_GENERATED:{reviewId}
   ```

---

## 4. 允许修改 / 新增的文件

优先修改：

```txt
apps/web/src/features/reviewer/reviewer-audit-events.ts   # 新增 appendReviewDiffGeneratedAuditSafely
apps/web/src/features/reviewer/ReviewDetailPage.tsx       # handleDecision 提交成功后调用
```

如需要：

```txt
apps/web/src/features/reviewer/reviewer-diff.ts           # 若需补一个「从 patches 提取 patchedFieldNames」的小工具，可加；不要重写 RD-1 逻辑
apps/web/src/mocks/handlers.ts                            # 仅当 audit append 不支持新事件类型时最小改
apps/web/src/mocks/mock-db.ts                             # 同上
```

---

## 5. 禁止修改的文件

```txt
packages/contracts/**        # 除非审查发现缺 REVIEW_DIFF_GENERATED 类型——那种情况停下报告，不要自行新增
packages/schema-core/**
packages/schema-renderer/**
packages/schema-designer/**
packages/workflow-core/**
packages/db/**
packages/worker/**
packages/export/**
apps/api/**
apps/web/src/features/labeler/**
apps/web/src/features/owner/**
apps/web/src/features/admin/**
docs/**
docs/CLAUDE.md
labelhub-architecture-contract.md
AI_CODING_RULES.md
.env
任何真实密钥文件
```

---

## 6. hash 规则（不可违反）

1. `beforeAnswerHash` / `afterAnswerHash` / `diffSummaryHash` 必须用 `hash-utils` 的 `hashCanonicalJson`（canonical-json-v1 + SHA-256），与 A-tail / Schema Governance 体系一致。
2. 若运行环境不支持 Web Crypto（与 hash-utils 现有行为一致）→ 省略该 hash 字段并 `console.warn`，**绝不生成 fake hash**。
3. 不要新造 hash 算法、不要用 `sha256:mock-*` 之类占位值。

---

## 7. 验证命令

```bash
cd apps/web && npm run typecheck
cd apps/web && npm run build
cd packages/contracts && npm run typecheck
cd packages/contracts && npm run test
git diff --check
```

> `git diff --check` 在仓库根目录运行。若测试生成临时产物（如 `.contract-test-dist`），用 `git checkout -- <path>` 恢复，不要保留生成文件改动。

---

## 8. 手动 QA 建议（由维护者执行，coder 如实标注「需维护者手动 QA」）

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

打开 Reviewer detail 页面，开浏览器 Network 面板：

1. 改一个字段 → PASS → 确认发出 `audit-events` 请求，且其中有一条 `type: "REVIEW_DIFF_GENERATED"`；
2. 检查该 diff audit 的 payload：含 `patchedFieldNames`（只有字段名）、`patchCount`、`beforeAnswerHash`、`afterAnswerHash`、`diffMode: "FRONTEND_SHALLOW"`；
3. 确认 payload **不含**完整 answers / 字段原始值 / prompt / raw output；
4. 不改任何字段直接提交 → 确认**不写** `REVIEW_DIFF_GENERATED`；
5. 提交失败时 → 确认不写 diff audit、不显示成功；
6. 确认 `REVIEW_SUBMITTED`（RD-1 已有）仍正常写入，没被破坏。

---

## 9. 输出格式

```txt
## 1. 当前 Git 基线
## 2. 实施前审查结论（重点：contracts 是否已有 REVIEW_DIFF_GENERATED 类型 + payload 类型 → 走路径 A 还是停下报告）
## 3. 修改了哪些文件
## 4. REVIEW_DIFF_GENERATED 何时触发、在哪里写入
## 5. payload 包含哪些字段（确认只有摘要+hash+索引，无完整 answers/原始值）
## 6. hash 如何生成（确认复用 hash-utils，无 fake hash）
## 7. 无修改时是否正确跳过 diff audit
## 8. mock / API 是否修改
## 9. 是否写了 REVIEW_DEEP_DIFF_GENERATED / SERVER_* （应为否，超范围）
## 10. 是否触碰 contracts / 禁止文件
## 11. 验证命令结果
## 12. git diff --check 结果
## 13. 手动 QA（如实写「需维护者手动 QA」）
## 14. 是否可以进入下一步（Phase C / QL-5：Export / Data Quality Passport）
```

最后明确回答：

1. contracts 是否已有 `REVIEW_DIFF_GENERATED` 类型与 payload（若无，是否已停下报告而非自行新增）；
2. 是否在有修改时正确写入 `REVIEW_DIFF_GENERATED`；
3. payload 是否只含摘要 + hash + 索引字段，无完整 answers / 原始值；
4. hash 是否复用 hash-utils 的真实 SHA-256，无 fake hash；
5. 无修改时是否跳过 diff audit；
6. 是否未写 `REVIEW_DEEP_DIFF_GENERATED` / 任何 SERVER_* diffMode；
7. 是否未触碰 contracts / schema-core / docs / 其他禁改文件；
8. 是否存在必须先修的 blocker。

---

**再次强调：本轮只做前端 FRONTEND_SHALLOW 的 REVIEW_DIFF_GENERATED。不写 deep diff。不改 contracts（缺类型就停下报告）。不生成 fake hash。不把完整 answers / 原始值写入 audit。不要 commit。不要 push。**

---

## 收尾：更新 HANDOFF（由 coder 负责）

完成本任务后，按 `SCHEMA_ARCH_AGENT.md` 第 9 节收班纪律更新 `HANDOFF.md`：
- 状态看板：Phase B2 状态；
- 工作日志：改了哪些文件、是否触碰边界、验证结果；
- 第 1 节 commit hash 一格：填「待维护者 commit 后回填」，**不要自己猜 hash，不要 commit**；
- 手动 QA：如实写「需维护者手动 QA」；
- 给下一班的指令：若验收通过，下一步为 Phase C（QL-5）Export / Data Quality Passport contracts 与 mock。
