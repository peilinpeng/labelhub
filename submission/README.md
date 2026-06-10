# LabelHub · 答辩提交物索引（submission/）

> 本目录是课题《LabelHub 数据标注平台 · AI 全栈课题实现要求》**§八 提交物清单**的统一入口。
> 交付固定点：tag **`final-delivery-0610`**；代码与文档均在本 monorepo 内，凭证已屏蔽（无明文 key / 接入点，`.env` 未入库）。

**一句话**：LabelHub 是一套覆盖「数据生产 → AI 预审 → 人工审核 → 多格式导出」全生命周期的 Web 标注平台，含 Owner / Labeler / Reviewer 三角色 + AI 审核 Agent。逐条功能完备性对照见根 [`README.md`](../README.md) §0「课题要求对照」。

## 提交物速查（§八 1–6）

| § | 提交物 | 入口 | 状态 |
|---|---|---|---|
| 1 | 源码仓库（Monorepo：前端 + 后端 + Agent） | `apps/web`、`apps/api`、`apps/api/app/worker`、`packages/` | ✅ |
| 2 | README（架构 / 模块 / 启动 / 取舍） | 根 [`README.md`](../README.md) | ✅ |
| 3 | 演示视频（5–10 分钟，三角色全链路） | 百度网盘（见 §3） | ✅ |
| 4 | 相关文档（架构图 / 技术点 / 截图 / AI Coding 记录） | 本目录 + `docs/` | ✅ |
| 5 | 可访问演示环境说明 | 本地 Docker 复现 + [`docs/deployment.md`](../docs/deployment.md) | ✅ |
| 6 | API 文档 | [`apps/api/openapi.json`](../apps/api/openapi.json)（45 路径）+ Swagger `/docs` | ✅ |

---

## 1. 源码仓库（前端 + 后端 + Agent，Monorepo）

- 前端：[`apps/web`](../apps/web)（React + TypeScript + Vite）
- 后端：[`apps/api`](../apps/api)（FastAPI + SQLAlchemy + Alembic）
- AI 审核 Agent / 异步任务：[`apps/api/app/worker`](../apps/api/app/worker)（Celery：AI 预审 + 导出）
- 共享库：[`packages/`](../packages)（contracts / schema-core / schema-compiler / schema-renderer / schema-designer / workflow-core）

## 2. README（架构 / 模块划分 / 启动 / 取舍）

- 根 [`README.md`](../README.md)：课题要求对照表（§0）、架构全景、快速启动、关键设计取舍、测试与验证、API 文档入口。
- 最终交付说明：[`docs/LabelHub_Final_Delivery.md`](../docs/LabelHub_Final_Delivery.md)：交付范围、演示路线、验收点、已知边界。
- 现场运行手册：[`docs/LabelHub_Delivery_Runbook.md`](../docs/LabelHub_Delivery_Runbook.md)：启动命令、账号、演示操作卡、故障排查。
- 后端说明：[`apps/api/README.md`](../apps/api/README.md)。

## 3. 演示视频（5–10 分钟，覆盖三角色完整链路）

- 视频（百度网盘）：<https://pan.baidu.com/s/1ry55Bgb1j0AuaVhqx6wi8Q>　提取码：`9eev`
- 录屏剧本与演示路线：
  - 真实后端全链路：[`docs/LabelHub_Demo_Guide.md`](../docs/LabelHub_Demo_Guide.md)
  - 最终交付主线摘要：[`docs/LabelHub_Final_Delivery.md`](../docs/LabelHub_Final_Delivery.md) →「推荐演示路线」
  - 现场操作卡：[`docs/LabelHub_Delivery_Runbook.md`](../docs/LabelHub_Delivery_Runbook.md) →「演示操作卡」

## 4. 相关文档（架构图 / 关键技术点 / 截图 / AI Coding 记录）

- **架构图**：[`architecture.png`](./architecture.png)（系统架构）+ [`data-quality-flow.png`](./data-quality-flow.png)（数据质量主线）；Mermaid 源 `architecture.mmd` / `data-quality-flow.mmd`，可在 <https://mermaid.live> 重新导出。
- **AI Coding 过程记录**：[`ai-coding-log.md`](./ai-coding-log.md)（开发脉络 / 关键决策 / 工具使用约束）；完整版见 [`docs/AI_CODING_PROCESS.md`](../docs/AI_CODING_PROCESS.md)。
- **Demo 截图**：[`screenshots/`](./screenshots/)（三角色 6 张关键页 + 索引）。
- **架构契约与关键技术设计**：
  - [`labelhub-architecture-contract.md`](../labelhub-architecture-contract.md)（顶层架构契约 v1.1）
  - [`docs/labelhub_schema_runtime_engine.md`](../docs/labelhub_schema_runtime_engine.md)（Schema Runtime Engine）
  - [`docs/LabelHub_Schema_Version_Management.md`](../docs/LabelHub_Schema_Version_Management.md)（Schema 版本管理）
  - [`docs/Labelhub_Quality_Layer.md`](../docs/Labelhub_Quality_Layer.md)（质量治理层）
  - [`docs/backend-optimization-plan.md`](../docs/backend-optimization-plan.md)（后端优化与测试方案）
  - [`docs/final-iteration-plan.md`](../docs/final-iteration-plan.md)、[`docs/dataset-test-scenario-plan.md`](../docs/dataset-test-scenario-plan.md)（迭代规划 / 数据接入方案）

## 5. 可访问的演示环境说明

- **本地 Docker 全栈一键复现**（无需云账号，评委可本地起栈，含真实后端 + Celery + MySQL + Redis）：见 [`docs/LabelHub_Delivery_Runbook.md`](../docs/LabelHub_Delivery_Runbook.md) 与下方「答辩前一键自查」。
- **云部署说明**：[`docs/deployment.md`](../docs/deployment.md) →§10（系统已 Docker 化，可部署到任意容器云平台）。
- **演示账号**：owner / labeler / reviewer `@labelhub.com` / `password123`（真实后端，端口 5173）。
- 说明：本次交付以「本地 Docker 可复现环境 + 云部署说明文档」为准，未提供长期公网托管地址。

## 6. API 文档

- 静态 OpenAPI（45 路径）：[`apps/api/openapi.json`](../apps/api/openapi.json) —— 可直接导入 Postman / Apifox。
- 在线 Swagger UI：服务启动后访问 `http://<host>:3000/docs`。

---

## 答辩前一键自查

```bash
docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q   # 170 passed
bash apps/api/scripts/e2e_test.sh                                               # 21 / 21
```

## 交付完成确认

§八 提交物清单已全部就位（见顶部速查表）：

- ✅ 源码仓库：Monorepo（前端 + 后端 + Agent/Worker + 共享库）
- ✅ README：根 `README.md`（含课题要求对照表）+ 交付/运行手册
- ✅ 演示视频：百度网盘，提取码 `9eev`（§3）
- ✅ 相关文档：架构图 2 张 + AI Coding 过程记录 + Demo 截图 6 张 + 关键技术设计
- ✅ 可访问演示环境说明：本地 Docker 一键复现 + 云部署说明（未提供长期公网托管）
- ✅ API 文档：`openapi.json`（45 路径）+ 在线 Swagger
- ✅ 凭证屏蔽：无明文 key / 接入点，`.env` 未入库
