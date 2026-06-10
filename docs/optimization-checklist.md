# LabelHub 优化清单（对照课题要求 v 2026-06-07）

> 来源：课题 PDF《LabelHub 数据标注平台·AI全栈课题实现要求》§4 功能 / §7 验收 / §8 提交物。
> 核对人：后端 + 合并负责人。本清单只列「还能优化」的点；已扎实的不重复。
> 图例：影响 = 对验收得分的影响；工作量 = 粗估人时。

## 0. 已确认扎实（不动）
- 动态表单：Designer/Renderer 解耦、可序列化 JSON schema、同 schema 预览/运行时、visibleWhen/校验/多 Tab（schema-core）。
- 状态机：task/assignment/submission/export 全状态 + 双轨审计（audit_logs + audit_events）。
- AI Agent：异步队列 + function_calling 结构化输出 + 重试 + 幂等 + 人工兜底 + token/prompt 可追溯。
- 导出：JSON/JSONL/CSV/Excel + 字段映射 + 异步 + passport。
- 工程：前端 `any`=0；后端 125 测试 + E2E 20/20；packages/前端共 ~34 测试文件；README/部署/多设计文档齐全。

---

## P0 —（已处理）实时 AI 注入管道
- 现状：根 `.env`（gitignore）已建，compose 注入 api+worker 已验证；占位 `REPLACE_ME` 容器可读到。
- **待你做**：把根 `.env` 两个 `REPLACE_ME` 换真值 → `docker compose up -d api worker`。
- 验证：`docker compose exec -w /workspace/apps/api api python -c "from openai import OpenAI; ..."` 或浏览器走一次 llm.assist 不再 502。

---

## P1 — 功能完备性缺口（影响 60% 功能分）

### P1-A 数据集导入 UI（4.1 题目导入 JSON/JSONL/Excel + 预览 + 批量编辑）
- 需求：Owner 在界面导入数据集、预览题目、批量编辑。
- 现状：**后端就绪**（`POST /tasks/{id}/dataset/import` 支持 JSON/JSONL/Excel；`GET /tasks/{id}/items`；`PATCH /items/{id}`），但**前端完全缺**：
  - `apps/web/src/api/` 无 dataset 导入/题目列表/批量编辑函数（只在 mock）。
  - `apps/web/src/features/owner/` 无数据集管理页（只有 schema/export/AI/detail/workspace）。
  - 目前只能靠 `scripts/seed_*.py` 插数据。
- 改动点：
  - 新增 `apps/web/src/api/dataset.ts`：`importDataset(taskId, {fileId/format})`、`listItems(taskId)`、`updateItem(itemId, patch)`。
  - 文件上传走已有 `POST /files/upload-url` → `POST /files/{id}/upload` → `confirm`，再 import。
  - 新增 `apps/web/src/features/owner/OwnerDatasetPage.tsx`：上传区 + 题目表格（预览 sourcePayload）+ 行内/批量编辑 + 删除/禁用。
  - 路由 `routes.tsx` 加 `/owner/tasks/:taskId/dataset`；任务详情页加入口。
- 影响：高（4.1 明确要求，当前演示链路靠脚本，评委看不到 Owner 自助导入）。工作量：**6–10h**。风险：中（文件上传链路联调）。

### P1-B Designer 真实拖拽（4.2 ⭐⭐⭐「拖拽放置」）
- 需求：左侧物料 → 中间画布**拖拽放置**。
- 现状：`packages/schema-designer` 是**点击添加**（`MaterialPanel`「点击添加到当前 schema」+ `addMaterialNode`），有上移/下移按钮但非拖拽；无 dnd-kit/react-dnd 依赖。
- 改动点：
  - 引入 `@dnd-kit/core` + `@dnd-kit/sortable`。
  - `MaterialPanel` 物料项设为可拖；`DesignerCanvas` 设为放置区 + 节点可排序拖拽。
  - 复用现有 `addMaterialNode` / `moveSelectedNode` 作为 drop/reorder 的落地动作（逻辑已具备，只换交互层）。
- 影响：中高（核心难点字面要求；功能等价但答辩演示「拖」更直观）。工作量：**4–8h**。风险：中（dnd 与现有 state 协调 + 测试更新）。
- 备注：`apps/web/src/features/owner/OwnerSchemaPage.tsx` 已有少量 `draggable` 痕迹，确认是否画布节点重排，避免重复。

---

## P2 — 体验 / 工程化打磨（影响 25% + 15%）

### P2-A 任务富文本说明（4.1「富文本说明」）
- 现状：后端 `Task.instruction_rich_text_json` 列已存在；前端任务创建/详情**无富文本编辑器**（富文本仅作为 schema 物料 input.richtext）。
- 改动点：`OwnerNewTaskPage` / `OwnerTaskDetailPage` 加富文本编辑（可用轻量 contentEditable 或已有富文本物料组件复用）；提交 `instructionRichText` 字段；Labeler 作答页只读展示。
- 影响：中。工作量：**3–5h**。风险：低。

### P2-B 数据集批量编辑（并入 P1-A）
- 若做 P1-A，批量编辑作为题目表格的多选 + 批量改 status/payload 一并实现。单独算 **+2h**。

### P2-C 响应式实测（验收 §7「1280×800 与 1920×1080」）
- 现状：未实测两分辨率。
- 改动点：用浏览器在两分辨率下逐页检查 Owner/Labeler/Reviewer 关键页，修溢出/错位（多在表格、三栏工作台、Designer 三栏）。
- 影响：中（占产品体验 15%）。工作量：**2–4h**。风险：低。

### P2-D 清理演示 DB 杂项
- 现状：任务市场残留 `E2E测试任务` / `并发测试_*`，影响观感。
- 改动点：写一次性脚本 `scripts/clean_demo.py` 删除测试任务（按 title 前缀），或答辩前重置 DB 只跑 seed_demo + seed_competition。
- 影响：中（演示观感）。工作量：**1h**。风险：低。

### P2-E 后端 2 个 TODO（`publish_task` 发布校验）
- 现状：`app/services/task_domain.py:156-157` TODO —— 发布任务时未校验「dataset 已导入 / reviewConfig 已配置或显式禁用」。
- 改动点：发布前校验任务至少有 1 条 AVAILABLE 题目；reviewConfig 已配置或 `reviewDisabledExplicitly=true`。补对应集成测试。
- 影响：中（健壮性 + 工程质量分；避免发布空任务）。工作量：**2–3h**。风险：低。

---

## P3 — 提交物清单（§8，非代码）
- [ ] 演示视频 5–10min（建任务→搭模板→发布→作答→提交→AI 预审→人工审核→导出）。脚本可参考 `docs/LabelHub_Demo_Guide.md`。
- [ ] AI Coding 过程记录（prompt 日志 / 关键决策 / 截图）。
- [ ] 可访问演示环境部署说明（任意云平台）。`docs/deployment.md` 已有本地版，需补云部署。
- [ ] API 文档：`apps/api/openapi.json` 已生成（39 路径），导入 Postman/Apifox 即可，建议在 README 链接说明。

---

## 建议执行顺序
1. 你填真 key（P0 收尾）。
2. **P2-D 清杂项**（1h，立刻改善演示）。
3. **P1-A 数据集导入 UI**（最大完备性缺口）。
4. **P2-E publish 校验**（顺手补健壮性 + 测试）。
5. **P1-B 拖拽** + **P2-A 富文本** + **P2-C 响应式**（体验冲刺）。
6. P3 提交物（视频/文档）放最后。

## 受影响文件速查
- 前端新增：`apps/web/src/api/dataset.ts`、`features/owner/OwnerDatasetPage.tsx`、`app/routes.tsx`
- 前端改：`features/owner/OwnerNewTaskPage.tsx` / `OwnerTaskDetailPage.tsx`（富文本）、`packages/schema-designer/`（拖拽）
- 后端改：`app/services/task_domain.py`（publish 校验）、新增 `scripts/clean_demo.py`
- 已就绪后端（前端对接即可）：`routers/dataset.py`、`routers/files.py`
