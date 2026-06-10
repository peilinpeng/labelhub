# LabelHub 提交物索引（答辩交付）

> 对照课题《LabelHub 数据标注平台·AI 全栈课题实现要求》§八 提交物清单。
> 本目录汇总答辩所需全部材料的入口；代码与文档均在本 monorepo 中。

## 1. 源码仓库（前端 + 后端 + Agent，Monorepo）

- 前端：[`apps/web`](../apps/web)（React + TypeScript + Vite）
- 后端：[`apps/api`](../apps/api)（FastAPI + SQLAlchemy + Alembic）
- AI 审核 Agent / 异步任务：[`apps/api/app/worker`](../apps/api/app/worker)（Celery：AI 预审 + 导出）
- 共享库：[`packages/`](../packages)（contracts / schema-core / schema-renderer / schema-designer / schema-compiler）

## 2. README（架构 / 模块划分 / 启动 / 取舍）

- 根 [`README.md`](../README.md)：架构全景、快速启动、已实现能力（对照 §4）、关键设计取舍、测试与验证、API 文档入口。
- 最终交付说明：[`docs/LabelHub_Final_Delivery.md`](../docs/LabelHub_Final_Delivery.md)：当前稳定状态、交付范围、演示路线、验收点、已知边界。
- 现场运行手册：[`docs/LabelHub_Delivery_Runbook.md`](../docs/LabelHub_Delivery_Runbook.md)：启动命令、账号、演示操作卡、故障排查。
- 后端 [`apps/api/README.md`](../apps/api/README.md)。

## 3. 演示视频（5–10 分钟，覆盖三角色完整链路）

- [x] 演示视频（百度网盘）：<https://pan.baidu.com/s/1ry55Bgb1j0AuaVhqx6wi8Q>　提取码：`9eev`
- 录屏剧本：
  - 真实后端全链路：[`docs/LabelHub_Demo_Guide.md`](../docs/LabelHub_Demo_Guide.md)
  - 最终交付主线摘要：[`docs/LabelHub_Final_Delivery.md`](../docs/LabelHub_Final_Delivery.md) → 「推荐演示路线」
  - 现场操作卡：[`docs/LabelHub_Delivery_Runbook.md`](../docs/LabelHub_Delivery_Runbook.md) → 「演示操作卡」

## 4. 相关文档（架构图 / 关键技术点 / 截图 / AI Coding 记录）

- 架构契约：[`labelhub-architecture-contract.md`](../labelhub-architecture-contract.md)（v1.1）
- 关键技术设计：
  - [`docs/LabelHub_Final_Delivery.md`](../docs/LabelHub_Final_Delivery.md)（最终交付总说明）
  - [`docs/LabelHub_Delivery_Runbook.md`](../docs/LabelHub_Delivery_Runbook.md)（现场运行手册）
  - [`docs/labelhub_schema_runtime_engine.md`](../docs/labelhub_schema_runtime_engine.md)（Schema Runtime Engine）
  - [`docs/LabelHub_Schema_Version_Management.md`](../docs/LabelHub_Schema_Version_Management.md)（Schema 版本管理）
  - [`docs/Labelhub_Quality_Layer.md`](../docs/Labelhub_Quality_Layer.md)（质量治理层）
  - [`docs/backend-optimization-plan.md`](../docs/backend-optimization-plan.md)（后端优化与测试方案）
  - [`docs/final-iteration-plan.md`](../docs/final-iteration-plan.md)（最终迭代规划）
  - [`docs/dataset-test-scenario-plan.md`](../docs/dataset-test-scenario-plan.md)（比赛数据接入方案）
- [x] 架构图：[`submission/architecture.png`](./architecture.png)（系统架构）+ [`submission/data-quality-flow.png`](./data-quality-flow.png)（数据质量主线）；Mermaid 源 `architecture.mmd` / `data-quality-flow.mmd`。
- [x] AI Coding 过程记录：[`submission/ai-coding-log.md`](./ai-coding-log.md)（开发思路 / 关键决策 / 工具使用约束）；完整过程记录见 [`docs/delivery-drafts/AI_CODING_PROCESS.md`](../docs/delivery-drafts/AI_CODING_PROCESS.md)（开发阶段 / AI Coding 使用方式 / 关键迭代记录 / 验证方式）。
- [x] Demo 截图：[`submission/screenshots/`](./screenshots/)（三角色 6 张关键页 + 索引）。

## 5. 可访问的演示环境说明

- 演示环境采用**本地 Docker 全栈一键复现**（无需云账号，评委可本地起栈，含真实后端 + Celery + MySQL + Redis）：
  见 [`docs/LabelHub_Delivery_Runbook.md`](../docs/LabelHub_Delivery_Runbook.md) 与本页「验证一键自查」。
- 云部署说明文档：[`docs/deployment.md`](../docs/deployment.md) → §10（系统已 Docker 化，可部署到任意容器云平台）。
- 演示账号：owner / labeler / reviewer `@labelhub.com` / `password123`（真实后端，端口 5173）。
- 说明：本次交付以「本地 Docker 可复现环境 + 云部署说明文档」为准，未提供长期公网托管地址。

## 6. API 文档

- 静态 OpenAPI（45 路径）：[`apps/api/openapi.json`](../apps/api/openapi.json) —— 可直接导入 Postman / Apifox。
- 在线 Swagger UI：服务启动后 `http://<host>:3000/docs`。

---

## 验证一键自查（答辩前）

```bash
docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q   # 170 passed
bash apps/api/scripts/e2e_test.sh                                               # 21/21
```

## 待办勾选（提交前补齐）

- [x] 演示视频（百度网盘，链接见 §3；提取码 9eev）
- [x] 架构图
- [x] AI Coding 过程记录（见 `docs/delivery-drafts/AI_CODING_PROCESS.md`）
- [x] Demo 截图
- [x] 可访问演示环境说明（本地 Docker 一键复现 + `docs/deployment.md` 云部署说明；演示账号见 §5；未提供公网托管地址）
