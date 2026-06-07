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
- 后端 [`apps/api/README.md`](../apps/api/README.md)。

## 3. 演示视频（5–10 分钟，覆盖三角色完整链路）

- [ ] 待录制并放置：`submission/demo-video.mp4`（或外链）。
- 录屏剧本：[`docs/LabelHub_Demo_Guide.md`](../docs/LabelHub_Demo_Guide.md) → 「真实后端全链路 Demo」一节（建任务→搭模板拖拽→发布→作答→AI 辅助→提交→AI 预审→人工审核→导出带质量护照）。

## 4. 相关文档（架构图 / 关键技术点 / 截图 / AI Coding 记录）

- 架构契约：[`labelhub-architecture-contract.md`](../labelhub-architecture-contract.md)（v1.1）
- 关键技术设计：
  - [`docs/labelhub_schema_runtime_engine.md`](../docs/labelhub_schema_runtime_engine.md)（Schema Runtime Engine）
  - [`docs/LabelHub_Schema_Version_Management.md`](../docs/LabelHub_Schema_Version_Management.md)（Schema 版本管理）
  - [`docs/Labelhub_Quality_Layer.md`](../docs/Labelhub_Quality_Layer.md)（质量治理层）
  - [`docs/backend-optimization-plan.md`](../docs/backend-optimization-plan.md)（后端优化与测试方案）
  - [`docs/final-iteration-plan.md`](../docs/final-iteration-plan.md)（最终迭代规划）
  - [`docs/dataset-test-scenario-plan.md`](../docs/dataset-test-scenario-plan.md)（比赛数据接入方案）
- [ ] 架构图：待补 `submission/architecture.png`。
- [ ] AI Coding 过程记录：待整理 `submission/ai-coding-log.md`（开发思路 / 关键决策 / 过程截图）。
- [ ] Demo 截图：待补 `submission/screenshots/`。

## 5. 可访问的演示环境说明

- 云部署指引：[`docs/deployment.md`](../docs/deployment.md) → §10 云部署。
- [ ] 待补：演示环境公网地址 + 演示账号（owner/labeler/reviewer @labelhub.com / password123）。

## 6. API 文档

- 静态 OpenAPI（41 路径）：[`apps/api/openapi.json`](../apps/api/openapi.json) —— 可直接导入 Postman / Apifox。
- 在线 Swagger UI：服务启动后 `http://<host>:3000/docs`。

---

## 验证一键自查（答辩前）

```bash
docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q   # 153 passed
bash apps/api/scripts/e2e_test.sh                                               # 21/21
```

## 待办勾选（提交前补齐）

- [ ] 演示视频
- [ ] 架构图
- [ ] AI Coding 过程记录
- [ ] Demo 截图
- [ ] 云演示环境地址 + 账号
