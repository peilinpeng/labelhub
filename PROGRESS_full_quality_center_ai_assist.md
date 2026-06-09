# PROGRESS — Full Quality Center + AI Assist 一键采纳闭环

> 实验分支：`experiment/full-quality-center-ai-assist`
> 防宕机上下文文件。每阶段更新：当前阶段 / 已完成 / 改动文件 / 测试结果 / 当前风险 / 下一步。

---

## 当前阶段
阶段 7（全量验证收口）已完成。全部 7 阶段闭环完成。

### 阶段 7 已完成（全量验证）
- 根 `npm run typecheck`：全部 6 包通过。
- 测试：contracts 84 / schema-core 142 / schema-compiler 31 / schema-renderer 67 / workflow-core 29 全部通过；schema-designer 5 failed（基线既有，与本次无关）。
- `apps/web`：typecheck + build 成功。
- 后端 `pytest -m "not integration"`：165 passed。
- `git diff --check`：无空白错误。
- **浏览器端到端冒烟（MSW，端口 5180）**：
  1. 审核员登录 → `/reviewer/items/sub_1003`，AI Assist 面板渲染 2 条待处理建议（severity/置信度/字段级 diff/按钮）。
  2. 点击「一键采纳」→ 该建议变「已采纳」、按钮区变「已处理：已采纳」、待处理计数 2→1，无法重复采纳。
  3. `GET /api/v1/audit-events?submissionId=sub_1003` 实时返回 `AI_ASSIST_ACCEPTED` + `AI_ASSIST_PATCH_APPLIED`（actor=REVIEWER，人话 summary）。
  4. 任务负责人登录 → `/owner/quality`，质量中心总览 10 项真实统计（待人工审核=4 来自队列、AI 建议采纳=1 来自审计事件），6 大看板齐全；AI 看板行展示「AI 建议已采纳 | 已采纳 | 标注员 · 时间 | 任务 …」，无原始 event code / payload / raw JSON 泄漏。
  5. 控制台无 error。

### 已知/遗留
- `schema-designer` 5 个测试在 base 分支即失败（上游既有，不在本实验目标，未改）。
- 后端 `test_concurrency.py`（`@pytest.mark.integration`）需运行中的后端 + 真实 MySQL，本机无 → 环境依赖，非本次引入。
- 本机 `apps/api/.venv311`（uv 建的 3.11 环境，已 gitignore）仅用于本地跑测试，不提交。

### 阶段 6 已完成
- 重写 `apps/web/src/features/owner/OwnerQualityCenterPage.tsx` 为页内看板（非跳转入口）：
  - **总览**：任务总数 / 发布中 / 草稿 / 待人工审核（来自 review queue）/ 打回需修订（审计事件计数）/ AI 采纳 / AI 编辑后采纳 / AI 忽略 / 最近审计事件 / 最近风险信号 —— 全部实时计数，不写死。
  - **AI 预审 / AI Assist 看板**：富事件行（人话事件名 + 状态人话化 + 角色 + 时间 + severity + 摘要 + 关联实体）。
  - **审核与打回看板**、**数据修订 / Patch 看板**（修改字段 + 来源 AI/审核员/系统）、**导出与质量护照看板**（含 Passport 文案，空态不假下载）、**审计与追溯**（最近 12 条）。
  - 仅展示 curated 人话摘要 / 引用 id，绝不渲染原始 event code / raw JSON / payload；未知事件回退「审计记录」；actor role 人话化映射。
- `apps/web/src/styles.css`：新增总览 + 富事件看板样式。

### 阶段 6 测试结果
- `cd apps/web && npm run typecheck`：通过。
- `cd apps/web && npm run build`：成功。

### 阶段 5 已完成
- 新增 `apps/web/src/api/ai-assist.ts`：`listAiAssistSuggestions` / `submitAiAssistAction`。
- 新增 `apps/web/src/features/reviewer/AiAssistPanel.tsx`：
  - 加载建议、展示 severity/confidence/摘要/字段级 diff/状态。
  - 按钮文案严格对齐：「一键采纳」「编辑后采纳」「忽略建议」；状态 chip「已采纳/已忽略/编辑后采纳/应用失败/待处理」。
  - 真实调用后端接口；成功后建议状态更新、按钮区切换为「已处理」文案；`status !== PENDING` 时不可再操作（杜绝重复采纳）。
  - 失败统一显示「操作失败，请稍后重试」。
  - 「编辑后采纳」：内联 textarea 编辑各字段 → 确认采纳走 `edit_accept`（无补丁时禁用）。
  - 不展示原始 event code / payload / raw JSON。
- `ReviewDetailPage.tsx`：挂载面板，`onActionApplied` 通过 `refreshTick` 重新拉取审核详情 + 审计时间线（采纳后答案/审计实时刷新）。
- `styles.css`：新增 `.review-ai-assist*` 样式。

### 阶段 5 测试结果
- `cd apps/web && npm run typecheck`：通过。
- `cd apps/web && npm run build`：成功（仅既有 vendor circular chunk 警告，非错误）。

### 阶段 4 已完成
- `apps/web/src/mocks/data/reviews.mock.ts`：为 4 条 AI 预审结果的 fieldIssues 补 `suggestion`（复用 contracts 既有可选字段），使派生建议带真实结构化补丁，便于演示一键采纳真正改写答案。
- `apps/web/src/mocks/mock-db.ts`：
  - MockState 增加 `aiAssistActions: AiAssistActionRecord[]`。
  - `deriveAiAssistSuggestions(submissionId)` / `applyAiAssistAction(submissionId, suggestionId, request)`，逻辑与后端一致（确定性 id、终态冻结 → APPLY_FAILED、主事件 + PATCH_APPLIED/FAILED 审计事件，经 `appendAuditEvent` 写入，幂等键防重复）。
- `apps/web/src/mocks/handlers.ts`：新增 MSW 路由
  - `GET  /api/v1/review/submissions/:submissionId/ai-assist/suggestions`
  - `POST /api/v1/review/submissions/:submissionId/ai-assist/:suggestionId/actions`（带幂等、非法 action → 422、未找到 → 404）。
- mock 文案未写进 UI；KPI 不写死（Quality Center 从审计事件实时计数）；mock 结构与 contracts/后端一致。
- 本地点击一键采纳后，写入的 AI_ASSIST_* 审计事件可被 `queryAuditEvents` 读取 → Quality Center AI 看板可见。

### 阶段 4 测试结果
- `cd apps/web && npm run typecheck`：通过。

### 阶段 3 已完成
- 新增后端表 `apps/api/app/models/ai_assist.py`（`ai_assist_actions`），记录 action + 状态 + patch 应用结果（追加只写）。
- 新增 `apps/api/app/schemas/ai_assist.py`：镜像 contracts，`action` 用 `Literal` → 非法值自动 422。
- 新增 `apps/api/app/services/ai_assist_domain.py`：
  - `derive_suggestions()`：从 AI 预审结果 `fieldIssues` 派生确定性 id 建议（`aas_{submission_id}_{idx}`），状态取自最近一条 action。
  - `apply_action()`：校验 submission/suggestion/action → 保存动作 → accept/edit_accept 带补丁时应用到 `submission.answers_json`（终态冻结则抛错转 APPLY_FAILED，绝不静默）→ emit 主审计事件 + PATCH_APPLIED/FAILED 审计事件 → 返回更新后 suggestion/action。
- 新增路由 `apps/api/app/routers/ai_assist.py`，并在 `main.py` 注册：
  - `GET  /api/v1/review/submissions/{submission_id}/ai-assist/suggestions`
  - `POST /api/v1/review/submissions/{submission_id}/ai-assist/{suggestion_id}/actions`
- `tests/conftest.py` 注册新模型。
- 新增集成测试 `tests/integration/test_ai_assist_actions.py`（7 例，覆盖 accept/edit_accept/dismiss、补丁应用、终态失败、404、422）。

### 阶段 3 测试结果
- 本机 `.venv`（Python 3.9.6）过旧，无法运行后端（项目目标 3.11；现有 `audit_event.py` 等也用 `X|None` 裸语法）。用 `uv venv --python 3.11 apps/api/.venv311` 建 3.11 环境装 requirements。
- `pytest tests/integration/test_ai_assist_actions.py`：7 passed。
- 全量 `pytest -m "not integration"`：165 passed, 1 deselected。
- 全量 `pytest`：165 passed, 1 failed —— 失败项 `test_concurrency.py::test_concurrent_claim_no_oversell` 标记 `pytest.mark.integration`，需运行中的后端 + 真实 MySQL（`localhost:3000`），本机无 → 环境依赖，非本次引入。
- 注：`.venv311` 已被 gitignore，不会提交。

### 阶段 2 已完成
- 新增 `packages/contracts/src/ai-assist.ts`：`AiAssistActionType` / `AiAssistSuggestionStatus` / `AiAssistPatchOperation` / `AiAssistStructuredPatch` / `AiAssistSuggestion` / `AiAssistActionRecord` / `AiAssistActionRequest` / `AiAssistActionResponse` / `ListAiAssistSuggestionsResponse`。复用 `AuditActor` / `AiAssistType` / `AuditEventType`，未重复造类型。
- `audit.ts` 追加事件类型 `AI_ASSIST_PATCH_APPLIED` / `AI_ASSIST_PATCH_FAILED` + `AiAssistPatchAuditPayload`（并入 `AuditEventPayload` 联合）。覆盖五类事件：采纳 / 编辑后采纳(AI_ASSIST_EDITED) / 忽略 / 修订已应用 / 修订应用失败。
- `index.ts` 导出 `ai-assist`。
- 新增测试 `__tests__/ai-assist-actions.test.ts`（9 例）。
- raw payload 未被设计成前端必须展示字段（structuredPatch 仅字段级 diff）。

### 阶段 2 测试结果
- `npm run -w @labelhub/contracts typecheck`：通过。
- `npm run -w @labelhub/contracts test`：84 passed（基线 75 + 新增 9）/ 0 failed。
- 根 `npm run typecheck`：全部通过。
- 根 `npm test`：contracts 84 / schema-core 142 / schema-compiler 31 / schema-renderer 通过；**schema-designer 5 failed（基线已存在，与本次改动无关，已 git stash 验证）**。

### 已知基线问题（非本次引入）
- `@labelhub/schema-designer` `SchemaDesigner.test.tsx` 5 例失败，在 stash 掉本分支改动后仍失败 → 属上游既有问题，不在本实验目标内，不修复也不删测试。

---

## 阶段 1：架构盘点结论（只读，未改代码）

### 1. AI Assist Panel 当前在哪？
- **Labeler 侧**：`packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx`。这是真实可用的「检查质量 / 一键采纳」面板，作用于标注作答页（`apps/web/src/features/labeler/AssignmentPage.tsx`）。
- **Reviewer 侧**：`apps/web/src/features/reviewer/ReviewDetailPage.tsx` 目前**没有** AI Assist 一键采纳面板，只展示只读的 AI 预审评语（`aiResult.summary` / `fieldIssues`）和「是否有帮助」反馈单选。**这是阶段 5 要补的核心。**

### 2. AI 建议当前数据结构
- 运行期响应：`LLMRuntimeResponse`（`packages/contracts/src/schema.ts:324`）：`{ output, suggestedPatch?: AnswerPayload, callId, promptVersionId?, modelId?, assistType?, latencyMs?, outputHash?, promptSnapshotHash? }`。
- AI 预审结果：`AIReviewResult`（`packages/contracts/src/review.ts:175`）：`fieldIssues: [{ fieldName?, severity, message, suggestion? }]`、`dimensionScores`、`summary`、`confidence`。
- **缺口**：没有"带 id / 状态 / 结构化 patch 的可操作建议"类型。阶段 2 需新增 `AiAssistSuggestion` / `AiAssistAction*`。

### 3. Reviewer 当前如何查看 AI 建议？
ReviewDetailPage 通过 `getReviewDetail()` 拿到 `detail.aiResult.aiResult`，渲染维度评分 + summary，只读。无采纳/忽略动作。

### 4. 当前是否已有 accept / dismiss / edited accept？
- Labeler 侧 LLMAssistRenderer 有「一键采纳」(ACCEPTED) 与 SHOWN，通过 `onAssistOutcome` 回调 → `apps/web/src/features/labeler/ai-assist-audit-events.ts` 写审计。**没有 dismiss / edit_accept UI。**
- `LLMAssistOutcome.action` 仅 `"SHOWN" | "ACCEPTED" | "DISMISSED"`（schema-renderer types）。
- Reviewer 侧完全没有 accept/dismiss 概念。

### 5. audit event 在哪里定义？
`packages/contracts/src/audit.ts`：
- `AuditEventType` 联合类型已含 `AI_ASSIST_ACCEPTED` / `AI_ASSIST_DISMISSED` / `AI_ASSIST_EDITED` / `REVIEW_PATCH_APPLIED` 等。
- **缺口**：没有「AI 修订已应用 / AI 修订应用失败」专用类型 → 阶段 2 新增 `AI_ASSIST_PATCH_APPLIED` / `AI_ASSIST_PATCH_FAILED`。
- `AuditEventRecord` / `AppendAuditEventRequest` / `AuditEventQuery` 都已定义齐全。

### 6. audit event 在哪里写入？
- 前端：`apps/web/src/api/audit.ts` → `appendAuditEvent()` POST `/api/v1/audit-events`。封装见 `features/labeler/ai-assist-audit-events.ts`、`features/reviewer/reviewer-audit-events.ts`。
- Mock：`apps/web/src/mocks/mock-db.ts` `appendAuditEvent()`（带幂等）/ `queryAuditEvents()`，`handlers.ts` 暴露 POST/GET `/api/v1/audit-events`。
- 后端：`apps/api/app/routers/audit_events.py` + `services/audit_event_domain.py`（`append_audit_event` 幂等 + `emit_audit_event` 内部写 + `query_audit_events`）。

### 7. Quality Center 读取哪些数据？
`apps/web/src/features/owner/OwnerQualityCenterPage.tsx`：`listTasks()` + `queryAuditEvents({ limit: 30 })`，按 type 前缀分流到 AI / Review / Export / Audit 四块看板。统计 = 任务数 + severity≠INFO 风险数。**目前没有 AI 采纳/忽略/编辑分项计数，没有待审/打回计数，看板偏「最近事件列表」而非完整看板** → 阶段 6 扩展。

### 8. mock 数据在哪维护？
`apps/web/src/mocks/`：`mock-db.ts`（主，含 seed 审计事件、review、AI review 模拟）、`handlers.ts`（MSW 路由）、`data/*.mock.ts`（reviews / submissions / schemas 等）。

### 9. 后端 API 路由风格？
FastAPI `APIRouter`，前缀在挂载处统一加 `/api/v1`。依赖注入 `Depends(get_db)` + `require_roles(...)`。domain service 在 `app/services/*_domain.py`，Pydantic schema 在 `app/schemas/*`，审计用 `audit_event_domain.emit_audit_event(...)`。路由如 `/review/submissions/{submission_id}/decision`。

### 10. contracts 测试风格？
`node:test` + `node:assert/strict`，纯类型构造断言（`satisfies` + 字段 equal）。运行：`npm run -w @labelhub/contracts test`（tsc 编译到 `.contract-test-dist` 后 node --test）。基线 75 passed。

---

## 实施计划（分阶段）

- **阶段 2 — Contracts**：新增 `packages/contracts/src/ai-assist.ts`：
  - `AiAssistActionType = "accept" | "edit_accept" | "dismiss"`
  - `AiAssistSuggestionStatus = "PENDING" | "ACCEPTED" | "EDIT_ACCEPTED" | "DISMISSED" | "APPLY_FAILED"`
  - `AiAssistPatchOperation { fieldName; previousValue?; nextValue }` + `AiAssistStructuredPatch = AiAssistPatchOperation[]`
  - `AiAssistSuggestion`（id/submissionId/itemId?/nodeId?/fieldName?/assistType?/severity/confidence?/summary/structuredPatch?/status/createdAt）
  - `AiAssistActionRecord`（id/suggestionId/submissionId/action/resultingStatus/appliedPatchFieldNames?/patchApplied?/patchFailureReason?/comment?/actor/createdAt）
  - `AiAssistActionRequest { action; editedPatch?; comment? }` + `AiAssistActionResponse { suggestion; action; auditEventType }`
  - audit.ts 追加 `AI_ASSIST_PATCH_APPLIED` / `AI_ASSIST_PATCH_FAILED` 两个事件类型 + payload。
  - index.ts 导出。补 `__tests__/ai-assist-actions.test.ts`。不破坏现有 75 测试。
- **阶段 3 — 后端**：`POST /api/v1/review/submissions/{submission_id}/ai-assist/{suggestion_id}/actions`。校验 submission/suggestion/action → 保存 action → accept+structuredPatch 时尝试 apply patch（成功记 PATCH_APPLIED，失败记 PATCH_FAILED，绝不静默）→ emit 审计事件 → 返回更新后 suggestion/action。新增 model + domain + schema + 测试。
- **阶段 4 — Mock**：handlers + mock-db 实现同路由，action 状态更新，审计追加，Quality Center 可读到记录。
- **阶段 5 — 前端 Reviewer AI Assist**：ReviewDetailPage 增加可操作 AI Assist 建议面板（一键采纳 / 编辑后采纳 / 忽略建议 + 已采纳/已忽略/失败态）。真实调接口，不重复采纳，人话错误。
- **阶段 6 — Full Quality Center**：OwnerQualityCenterPage 扩成总览 + AI Assist 看板 + 审核打回 + Patch 看板 + 导出/护照 + 审计追溯。统计来自真实/结构化数据，不写死。
- **阶段 7 — 全量验证收口**：typecheck + test + web build。

---

## 改动文件（阶段 1）
- 新增 `PROGRESS_full_quality_center_ai_assist.md`（本文件）。

## 测试结果（阶段 1）
- 基线 `npm run -w @labelhub/contracts test`：75 passed / 0 failed。

## 当前风险
- Reviewer 侧无现成「可操作建议」数据源：需从 `AIReviewResult.fieldIssues`（含 `suggestion`）派生 `AiAssistSuggestion`，结构化 patch 在 demo 中可能为空 → 需保证空 patch 也能记录 accept（最低闭环）。
- 后端真实数据库存在但 web demo 走 MSW；阶段 3 与阶段 4 都要实现，保证「不是只改 mock」。

## 下一步
进入阶段 2：设计 contracts 类型 + 测试。
