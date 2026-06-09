# PROGRESS — Full Quality Center + AI Assist 一键采纳闭环

> 实验分支：`experiment/full-quality-center-ai-assist`
> 防宕机上下文文件。每阶段更新：当前阶段 / 已完成 / 改动文件 / 测试结果 / 当前风险 / 下一步。

---

## 当前阶段
阶段 3（后端 API）已完成，准备进入阶段 4（Mock）。

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
