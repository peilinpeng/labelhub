# LabelHub 最终交付说明

> 版本：2026-06-10
> 适用分支：`integration/joint-test`
> 当前基线：`7ff8d8a feat(web): add normalized ai review weight sliders`
> 稳定参考点：`stable-after-owner-ai-config-polish-0610` -> `7ff8d8a`

本文档是 LabelHub 答辩和交付的总入口，面向评审、维护者和现场演示人员。它只描述当前可交付能力、启动方式、演示路线、验证方式和已知边界；更细的架构设计见文末相关文档。

---

## 1. 交付范围

LabelHub 是面向 AI 数据生产的全栈标注平台，覆盖：

- Owner：创建任务、搭建动态 Schema、导入数据集、发布任务、配置 AI 预审、查看质量中心和导出。
- Labeler：领取任务、动态表单作答、草稿自动保存、AI 辅助建议、提交标注。
- AI Review Agent：按任务配置执行结构化预审，给出维度评分、处理建议和人工兜底。
- Reviewer：查看 AI 预审结果、人工复审/终审、字段级修订、批量审核、写入审计。
- Export：生成 JSON / JSONL / CSV / Excel 导出，并附带 Data Quality Passport。

当前交付重点不是“静态表单页面”，而是完整的数据质量链路：

```txt
Schema Governance -> Labeler Runtime -> AI Preflight -> Human Review Diff -> Export Passport
```

---

## 2. 当前稳定状态

### 2.1 已完成增量

| 提交 | 内容 | 状态 |
|---|---|---|
| `57c724e` | BLOCKED AI 建议支持忽略，复用 DISMISSED action | 已推送 |
| `1e9338a` | Reviewer 队列布局优化 | 已推送 |
| `84c6b2b` | Owner 任务配置流程引导 | 已推送 |
| `71cab37` | Owner 数据与分发流程对齐 | 已推送 |
| `64a39ab` | Reviewer 队列与终审流程完善 | 已推送 |
| `625f301` | Labeler 工作台布局优化 | 已推送 |
| `7f9958b` | Owner Schema 版本管理前端显化 | 已推送 |
| `b8963d4` | AI config 规则预览卡片贴顶对齐 | 已推送 |
| `7ff8d8a` | AI 预审权重 slider + 自动归一化为 1 | 已推送 |

### 2.2 本地工作区

当前工作区无未提交的源码改动，`HEAD` 已对齐稳定 tag `stable-after-owner-ai-config-polish-0610`（`7ff8d8a`），并与 `origin/integration/joint-test` 同步。

---

## 3. 推荐启动方式

### 3.1 真实后端全栈演示

真实后端模式用于最终答辩、联调验收和端到端演示。

```bash
git checkout integration/joint-test
git pull --rebase
cp .env.example .env

docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
```

访问：

```txt
http://localhost:5173/
```

演示账号：

| 角色 | 账号 | 密码 |
|---|---|---|
| Owner | `owner@labelhub.com` | `password123` |
| Labeler | `labeler@labelhub.com` | `password123` |
| Reviewer | `reviewer@labelhub.com` | `password123` |

说明：

- Docker web 默认通过 `/api` 代理到 api 服务。
- 真实 LLM 预审需要 `.env` 中配置 `DOUBAO_API_KEY`、`DOUBAO_BASE_URL`、`DOUBAO_MODEL`。
- 不要把真实 `.env`、真实 key 或 raw LLM output 写入文档、审计 payload 或提交记录。

### 3.2 前端 Mock 演示

Mock 模式适合展示 Schema Governance、AI Assist preflight、Reviewer diff 等前端闭环，不依赖真实后端。

Windows PowerShell：

```powershell
$env:VITE_ENABLE_MSW="true"
npm.cmd --prefix apps/web run dev -- --host 127.0.0.1 --port 5180
```

macOS / Linux：

```bash
VITE_ENABLE_MSW=true npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5180
```

访问：

```txt
http://127.0.0.1:5180/
```

Mock 账号：

| 角色 | 账号 | 密码 |
|---|---|---|
| Owner | `owner@labelhub.test` | `Seed@1234` |
| Labeler | `labeler@labelhub.test` | `Seed@1234` |
| Reviewer | `reviewer@labelhub.test` | `Seed@1234` |

也可以使用首页快捷入口进入对应角色。

---

## 4. 推荐演示路线

### 4.1 15 分钟完整路线

| 顺序 | 页面 | 讲解重点 |
|---|---|---|
| 1 | Owner Schema 页面 | Breaking Change 阻断、发布前兼容性检查、Schema Audit Timeline |
| 2 | Labeler 作答页 | 动态 Schema Runtime、`qualityScore=1/2` 触发 `factCheckNote` 显示且必填 |
| 3 | Labeler AI 辅助 | AI suggestedPatch 先过 preflight，BLOCKED 时不能一键采纳但可以忽略 |
| 4 | Reviewer 队列/详情 | AI 预审转人工、人工修订生成 Review Diff、审核事件进入 audit |
| 5 | Owner 导出页 | 导出不是裸数据，附带 Data Quality Passport 和批次 hash |

### 4.2 8 分钟精简路线

```txt
Schema Governance -> AI Assist Preflight -> Export Passport
```

精简讲法：

- Schema Governance 说明“结构先可信”。
- AI Assist Preflight 说明“AI 建议不能绕过表单规则”。
- Data Quality Passport 说明“最终交付数据带质量证据链”。

---

## 5. 核心验收点

### 5.1 Schema Governance

验收路径：

```txt
/owner/tasks/task_demo_schema_breaking_change/designer
/owner/tasks/task_demo_schema_safe_publish/designer
/owner/tasks/task_demo_schema_deprecation/designer
/owner/tasks/task_demo_schema_migration_required/designer
```

预期：

- 删除字段触发 Breaking Change，发布被阻断。
- 安全变更可发布。
- Deprecated 字段需要确认。
- Migration Required 显示迁移提醒。
- Schema Audit Timeline 能看到 compatibility check、publish blocked、version published 等事件。

### 5.2 Labeler Runtime

验收路径：

```txt
/labeler/workspace/asn_1001
```

预期：

- 默认使用 Formily runtime。
- `qualityScore=1/2` 时 `factCheckNote` 显示并必填。
- `qualityScore=3/4/5` 时 `factCheckNote` 隐藏并清空。
- 提交校验不能被绕过。

### 5.3 AI Assist Preflight

预期：

- AI 建议不会直接写入答案。
- SAFE / WARNING / BLOCKED 三态可见。
- BLOCKED 场景下“一键采纳”禁用。
- BLOCKED 场景下“忽略建议”可用，并复用 `AI_ASSIST_DISMISSED`。
- UI 不展示完整 answers、完整 prompt、raw LLM output 或 sourcePayload。

### 5.4 Reviewer Review Diff

验收路径：

```txt
/reviewer/items
/reviewer/items/sub_1001
/reviewer/items/sub_1003
/reviewer/items/sub_1004
```

预期：

- 队列页可查看 AI 预审摘要并进入人工审核。
- 底部橙色提示区与“进入人工审核”按钮在窄宽度下不挤压。
- Reviewer 修改字段后提交，会生成字段级 diff。
- audit payload 记录 patchCount / patchedFieldNames，不记录完整答案。

### 5.5 Export Passport

验收路径：

```txt
/owner/tasks/task_news_quality/export
```

预期：

- 导出记录可见。
- Data Quality Passport 显示 recordCount、passportCount、warningCount、passportBatchHash。
- `passportBatchHash` 使用真实 SHA-256，不使用 `sha256:mock-*` 冒充 live 结果。

---

## 6. 自动化验证

前端与共享包：

```bash
npm run typecheck
npm run test
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run build
```

后端：

```bash
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q
docker compose exec -w /workspace/apps/api api pytest -m integration -q
bash apps/api/scripts/e2e_test.sh
```

本轮已执行：

```txt
npm.cmd --prefix apps/web run typecheck  通过
npm.cmd --prefix apps/web run build      通过，保留既有 circular chunk 提示
git diff --check                         通过，仅 LF/CRLF warning
```

---

## 7. 已知边界

| 模块 | 边界 | 影响 |
|---|---|---|
| Worker / Redis | 若本地未启动 Redis 或 worker，真实异步 AIReviewJob 不会执行 | 同步页面、Mock 演示、配置读取不受影响 |
| Mock Reviewer 状态流转 | 部分 mock 审核通过后 submission 状态不流转，可能导致 mock 导出 0 条 | 真实后端不受影响；QA 表中已有记录 |
| 文件上传 confirm | 后端 `confirm` 对未上传二进制文件的检查仍可加强 | 错误会延迟到 dataset import 暴露 |
| Vitest CVE | `vitest <4.1.0` 有非阻断安全提示 | 由维护者决定升级时机 |
| Vite chunk | build 仍提示 `vendor -> vendor-react -> vendor` circular chunk | 非阻断，构建产物正常生成 |

---

## 8. 交付物索引

| 交付物 | 路径 |
|---|---|
| 源码总览 | `README.md` |
| 提交物索引 | `submission/README.md` |
| 最终交付说明 | `docs/LabelHub_Final_Delivery.md` |
| 现场运行手册 | `docs/LabelHub_Delivery_Runbook.md` |
| 真实后端演示剧本 | `docs/LabelHub_Demo_Guide.md` |
| Mock / Schema Governance 演示剧本 | `docs/LabelHub_Final_Demo_Guide.md` |
| QA 记录 | `docs/QA_TEST_RECORD.md` |
| 部署说明 | `docs/deployment.md` |
| API 文档 | `apps/api/openapi.json`，运行时 `/docs` |
| 架构契约 | `labelhub-architecture-contract.md` |
| Schema Runtime 设计 | `docs/labelhub_schema_runtime_engine.md` |
| Schema 版本管理设计 | `docs/LabelHub_Schema_Version_Management.md` |
| Quality Layer 设计 | `docs/Labelhub_Quality_Layer.md` |

---

## 9. 交付结论

LabelHub 当前已具备可演示、可验收的端到端闭环：

```txt
任务配置 -> 动态表单 -> 标注作答 -> AI 辅助 -> AI 预审 -> 人工审核 -> 审计追踪 -> 导出质量护照
```

交付时建议优先展示“质量治理”主线，而不是逐个按钮走页面。评审需要看到的是：数据生产过程中每一次结构变更、AI 建议、人工修订和最终导出都有规则约束和证据链支撑。
