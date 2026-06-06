# tasks/RD-1.md — Reviewer corrected answers / shallow diff 最小实现

> 统一编号：Phase B1（= 设计文档 QL-4 第一步 = RD-1）
> 状态以 `HANDOFF.md` 为准。本文件是任务规格，不记进度。

## 语言与风格约定

1. 工作语言统一为中文。
2. 文档、代码注释、README、错误提示、测试描述、UI 文案使用中文。
3. TypeScript 类型名、接口名、变量名、函数名、枚举值、API 路径使用英文。
4. 不要在同一个文件中混用中英文注释。

## 任务背景

LabelHub，contract-driven 开发。当前分支应为 `feature/schema-governance-upgrade`。

当前 Quality Layer 已完成：Owner Schema Governance audit；Owner Audit Timeline；Labeler telemetry audit；Reviewer basic audit；Export summary audit；Prompt Feedback Loop（AI assist response metadata、renderer `onAssistOutcome`、`AI_ASSIST_TRIGGERED / SHOWN / ACCEPTED / DISMISSED / EDITED`、Reviewer 显式 AI feedback、mock prompt registry、真实 SHA-256 `promptSnapshotHash / outputHash`）。

Reviewer 侧已完成：`REVIEW_STARTED`、`REVIEW_SUBMITTED`、显式 AI Review feedback。

尚未完成：Reviewer corrected answers；Reviewer patches；`REVIEW_DIFF_GENERATED`。

## 本次任务

RD-1：Reviewer corrected answers / shallow diff 最小实现。

目标：让 Reviewer 在审核详情页基于原始 submission answers 生成 reviewer-corrected answers，并在 PASS / RETURN 提交时带上结构化 patches。本轮只做 Reviewer patch 数据能力，不写 `REVIEW_DIFF_GENERATED` audit。

本轮不要：写 `REVIEW_DIFF_GENERATED`；写 `REVIEW_DEEP_DIFF_GENERATED`；生成 beforeAnswerHash / afterAnswerHash；生成 fake hash；修改 contracts（除非 `ReviewDecisionRequest.patches` 根本不存在，那种情况停止并报告）；修改 schema-core；修改 docs；影响 Owner / Labeler / Export / AI Assist 现有链路。

---

## 0. 开始前检查

```bash
git status
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log --oneline --decorate -20
```

要求：分支必须是 `feature/schema-governance-upgrade`；工作区必须干净；存在未提交修改或 untracked 文件则停止并报告；不要 commit；不要 push。

---

## 1. 本轮允许修改的文件

优先允许修改：

```txt
apps/web/src/features/reviewer/ReviewDetailPage.tsx
apps/web/src/features/reviewer/review-display.ts
apps/web/src/api/reviewer.ts
```

mock review decision endpoint 不支持 patches 时，可最小修改：

```txt
apps/web/src/mocks/handlers.ts
apps/web/src/mocks/mock-db.ts
```

需要新增 Reviewer diff helper 时，可新增：

```txt
apps/web/src/features/reviewer/reviewer-diff.ts
```

需要少量样式时，可修改 `apps/web/src/styles.css`。不要做大规模 UI 重构。

---

## 2. 本轮禁止修改的文件

```txt
packages/contracts/**
packages/schema-core/**
packages/schema-renderer/**
packages/schema-designer/**
apps/web/src/features/labeler/**
apps/web/src/features/owner/**
apps/web/src/features/admin/**
docs/**
labelhub-architecture-contract.md
AI_CODING_RULES.md
.env
任何真实密钥文件
```

发现必须修改 contracts 时停止并报告，不要自行扩大范围。

---

## 3. 实施前审查

先阅读：

```txt
apps/web/src/features/reviewer/ReviewDetailPage.tsx
apps/web/src/features/reviewer/review-display.ts
apps/web/src/api/reviewer.ts
apps/web/src/mocks/handlers.ts
apps/web/src/mocks/mock-db.ts
packages/contracts/src/api.ts
packages/contracts/src/audit.ts
```

重点确认：
1. `ReviewDetailPage` 当前如何展示 submission answers；
2. 是否已有 answers 编辑 UI；
3. `decideReview` request 是否支持 `patches`；
4. mock endpoint 是否读取 / 保存 `patches`；
5. PASS / RETURN 提交流程在哪里；
6. `REVIEW_SUBMITTED` 如何写入；
7. reviewer AI feedback 如何写入；
8. 是否可在不破坏审核流程的前提下增加 corrected answers state；
9. answers 结构是否是简单 `Record<string, unknown>`；
10. 是否可做 shallow field-level diff。

**先输出简短审查结论，再进行实现。**

---

## 4. corrected answers UI 要求

保留原始 submission answers 展示，同时新增轻量 corrected answers 区域。推荐文案：

```txt
审核修正答案
Reviewer 可以在这里修改标注答案；系统会在提交审核时生成字段级 patches。
```

实现要求：
1. 初始 `correctedAnswers` = `detail.submission.answers` 的浅拷贝或安全克隆；
2. Reviewer 可编辑字段值；
3. 第一版支持简单字段：string / number / boolean；string[] / number[] 可用 JSON textarea 或逗号分隔，视组件方便程度决定；
4. 复杂 object / array 可用 JSON textarea；
5. 不接 schema-renderer，不要扩大成完整 reviewer form renderer；
6. 不影响原有只读展示；
7. 不影响 PASS / RETURN 业务按钮。

answers 结构复杂时，第一版允许用一个 JSON textarea 编辑完整 corrected answers，但必须：有中文提示；JSON parse 失败不能提交 patches；不把完整 corrected answers 写入 audit；只把 patches 传给 review decision API。

---

## 5. shallow diff / patches 规则

helper 形态：

```ts
type ReviewerPatch = {
  fieldName: string;
  from?: unknown;
  to?: unknown;
  op: "ADD" | "REMOVE" | "REPLACE";
};
```

**优先复用现有 contracts 中的 patch 类型。如果 contracts 已有 patch 类型，必须复用，不要新增重复类型。**

diff 规则：基于 `beforeAnswers = detail.submission.answers` 与 `afterAnswers = correctedAnswers`；只做顶层字段 shallow diff；新增 → `ADD`，删除 → `REMOVE`，值变化 → `REPLACE`；值比较用稳定 JSON 比较或保守 `JSON.stringify`，不要引入 schema-core；不生成 hash；不写 audit；patches 只用于 review decision request。

---

## 6. 提交审核时带 patches

PASS / RETURN 提交时：计算 patches；无修改则传空或不传，按现有逻辑继续；有修改则带入 `decideReview` request；`REVIEW_SUBMITTED` 按现有逻辑写入；可在其安全摘要中包含 `patchCount`，若引发类型问题则先不改；不写 `REVIEW_DIFF_GENERATED`（留给 RD-2）；提交失败不显示成功；patches 生成失败显示中文错误且不提交。

---

## 7. mock / API 处理

`decideReview` API client 已支持 patches：保持最小改动，确保 request 带 patches。

mock endpoint 未处理 patches：最小改 mock handler / mock-db；让 mock review result 保存或返回 patch count；不需实现复杂 patch apply；不要把完整 before / after answers 写入 audit；不要影响 Reviewer queue。

---

## 8. 不要写 REVIEW_DIFF_GENERATED

本轮禁止写入 `REVIEW_DIFF_GENERATED` / `REVIEW_DEEP_DIFF_GENERATED`。本轮只建立真实 patches 数据基础，RD-2 再基于真实 patches 写 review diff audit。

---

## 9. 不要保存敏感内容到 audit

禁止写入 audit payload：完整 answers、完整 correctedAnswers、完整 sourcePayload、完整 before/after answers、prompt、raw output。本轮理论上不需要新增 audit 事件。

---

## 10. 验证命令

```bash
cd apps/web && npm run typecheck
cd apps/web && npm run build
cd packages/contracts && npm run typecheck
cd packages/contracts && npm run test
git diff --check
```

> 注：`git diff --check` 在仓库根目录运行即可，不要写死本机绝对路径。
> 若 `npm` 不可用，使用本项目此前可用的 npm CLI 路径。
> 测试若生成临时产物，请恢复，不要保留生成文件改动。

---

## 11. 手动 QA 建议

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

打开 Reviewer detail 页面：查看原始 answers；修改 corrected answers 一个字段；点击 PASS 或 RETURN；确认审核提交成功；确认 request 带 patches；非法 JSON 时显示中文错误且不提交；未修改时仍可正常审核提交；确认没有写入 `REVIEW_DIFF_GENERATED`。

---

## 12. 输出格式

```txt
## 1. 当前 Git 基线
## 2. 实施前审查结论
## 3. 修改了哪些文件
## 4. corrected answers UI 如何实现
## 5. shallow diff / patches 如何生成
## 6. decideReview 如何携带 patches
## 7. mock / API 是否修改
## 8. 是否写入 REVIEW_DIFF_GENERATED
## 9. 是否保存完整 answers 到 audit
## 10. 验证命令结果
## 11. 手动 QA 结果
## 12. git diff --check 结果
## 13. 是否触碰禁止文件
## 14. 是否可以进入 RD-2
```

最后明确回答：是否实现了 reviewer corrected answers；是否能生成真实 patches；是否能在审核提交时带 patches；是否没有写 `REVIEW_DIFF_GENERATED`；是否没有生成 fake hash；是否没有把完整 answers 写入 audit；是否建议进入 RD-2（基于真实 patches 写 `REVIEW_DIFF_GENERATED`）；是否存在必须先修的 blocker。

---

**再次强调：本轮只做 Reviewer corrected answers / shallow patches。不要写 REVIEW_DIFF_GENERATED。不要修改 contracts。不要修改 docs。不要生成 fake hash。不要 commit。不要 push。**

---

## 收尾：更新 HANDOFF

完成本任务后，按 `SCHEMA_ARCH_AGENT.md` 第 9 节收班纪律更新 `HANDOFF.md`：状态看板、git 基线、本班工作日志、给下一班的指令（若验收通过，下一步为 Phase B2 / RD-2）。
