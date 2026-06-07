# LabelHub 数据标注平台

LabelHub 是一个面向 AI 数据生产的全栈标注平台，覆盖「数据生产 → AI 预审 → 人工审核 → 多格式导出」完整生命周期。前端（React + TypeScript）、后端（FastAPI + SQLAlchemy + Celery + MySQL + Redis）、AI 审核 Agent 三端均已端到端实现并跑通真实链路。

> Monorepo 结构：`apps/web`（前端）、`apps/api`（后端 + Celery worker）、`packages/*`（contracts / schema-core / schema-renderer / schema-designer / schema-compiler 共享库）。
>
> 一键体验见下方「快速启动」。完整答辩交付物索引见 [`submission/README.md`](./submission/README.md)。

## 快速启动（真实后端演示）

```bash
# 0) 准备环境变量（含 DOUBAO LLM key；模型用官方提供的 ep-...）
cp .env.example .env          # 按需填 DOUBAO_API_KEY / DOUBAO_MODEL / DOUBAO_BASE_URL

# 1) 构建并启动全部服务（web / api / worker / mysql / redis）
docker compose up -d --build

# 2) 数据库迁移（迁移链 head: b2c3d4e5f6a7）
docker compose exec -w /workspace/apps/api api alembic upgrade head

# 3) 灌入演示数据（演示账号 + 举办方真实数据集两个任务）
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
```

- 前端访问 `http://localhost:5173/`，账号 `owner@labelhub.com` / `labeler@labelhub.com` / `reviewer@labelhub.com`，密码 `password123`。
- web 默认走真实后端（`VITE_ENABLE_MSW=false`，Vite `/api` 代理至 `api:3000`）；如需纯前端 mock 演示见下方 MSW 章节。
- 完整录屏剧本见 [`docs/LabelHub_Demo_Guide.md`](./docs/LabelHub_Demo_Guide.md)。

## 项目定位

LabelHub 的核心能力包括：

- Owner 创建任务、搭建动态 schema、导入数据集、发布任务、配置审核与导出。
- Labeler 领取任务、在线作答、自动保存草稿、提交数据、查看打回原因。
- AI Review Agent 对提交数据进行结构化预审。
- Reviewer 进行人工审核、打回、通过、终审和批量操作。
- Export 服务按字段映射导出 JSON、JSONL、CSV、Excel。

## 架构契约

核心架构契约位于：

- [labelhub-architecture-contract.md](./labelhub-architecture-contract.md)

该文档是前端 Designer、前端 Renderer、后端 API、AI Review Agent、导出服务、数据库建模和自动化测试的共同依据。

重要原则：

- 不允许在业务模块重新定义契约类型。
- 不允许绕过 schema versioning、RuntimeContext、audit logs、command-driven state transitions。
- 不允许在 schema 中引入任意 JavaScript 函数。
- 所有接口、状态、错误码、审计动作必须与契约一致。

## AI Coding 规则

本项目允许使用 AI Coding 工具协作，但所有工具必须先阅读：

- [AI_CODING_RULES.md](./AI_CODING_RULES.md)

核心要求：

- 采用 contract-driven 开发。
- 最高契约是 `labelhub-architecture-contract.md v1.1`。
- 共享类型唯一来源是 `packages/contracts`。
- 所有实现必须引用 `@labelhub/contracts`。
- 禁止重新定义契约类型。
- 禁止使用 `any`，灵活数据使用 `unknown`。
- AI 修改代码前必须先输出实现计划，修改后必须总结修改文件、实现内容、运行检查和未解决风险。

## packages/contracts

共享 TypeScript contracts package 位于：

- [packages/contracts](./packages/contracts)

它包含：

- 全局类型、错误码、审计日志。
- 动态 schema、组件注册表、Designer / Renderer 契约。
- 工作流、审核、AI Review、导出、文件上传契约。
- API request / response 类型。
- 契约工具函数和 33 个契约测试。

运行类型检查：

```bash
cd packages/contracts
npm run typecheck
```

运行契约测试：

```bash
cd packages/contracts
npm run test
```

测试会生成 `packages/contracts/.contract-test-dist`，该目录已被 `.gitignore` 忽略。

## packages/schema-core

动态 Schema 纯 TypeScript 运行时内核位于：

- [packages/schema-core](./packages/schema-core)

它只引用 `@labelhub/contracts`，负责 schema tree 遍历、JsonPath 命名空间校验、Expression 求值、可见性解析、答案归一化、答案校验、schema guard 和演示 schema factory，不包含 React UI、浏览器依赖或后端 service。

运行检查：

```bash
cd packages/schema-core
npm run typecheck
npm run test
```

## packages/schema-renderer

动态 Schema React 渲染层位于：

- [packages/schema-renderer](./packages/schema-renderer)

它引用 `@labelhub/contracts` 和 `@labelhub/schema-core`，负责把 `LabelHubSchema` 渲染为 Labeler 作答、Reviewer 只读、Reviewer diff 和 Designer 预览界面，不包含 Designer 拖拽、后端 service 或 Mock 状态流转。

运行检查：

```bash
cd packages/schema-renderer
npm run typecheck
npm run test
```

## packages/schema-designer

动态 Schema 设计器位于：

- [packages/schema-designer](./packages/schema-designer)

它引用 `@labelhub/contracts`、`@labelhub/schema-core` 和 `@labelhub/schema-renderer`，负责 Owner 侧模板物料、schema tree 编辑、属性配置、校验面板和实时预览。支持**物料拖拽到画布 + 画布节点拖拽重排**（原生 HTML5 DnD），点击添加同时保留。

运行检查：

```bash
cd packages/schema-designer
npm run typecheck
npm run test
```

## MSW Mock

前端 Mock 层位于：

- [apps/web/src/mocks](./apps/web/src/mocks)

用途：

- 在真实后端完成前，支持 Owner、Labeler、Reviewer 页面并行开发。
- 使用 `@labelhub/contracts` 类型，不重新定义契约。
- 模拟 claim、draft、submit、AI review、review decision、export、file upload 等主链路状态流转。

启用方式：

```ts
if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === "true") {
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}
```

Mock 模式：

```bash
VITE_ENABLE_MSW=true
```

真实 API 模式：

```bash
VITE_ENABLE_MSW=false
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

## Docker 启动

复制环境变量：

```bash
cp .env.example .env
```

启动本地开发/演示环境：

```bash
docker compose up --build
```

服务：

- `web`：前端 Vite / React，宿主 `5173`（容器内 Vite 5180）。
- `api`：后端 FastAPI，宿主 `3000`。
- `worker`：Celery，承载 AI Review / Export 异步任务。
- `mysql`：MySQL 8。
- `redis`：Redis 7（Celery broker/backend）。

本地与云部署说明见：

- [docs/deployment.md](./docs/deployment.md)

## API 文档

- 静态 OpenAPI（41 路径）：[`apps/api/openapi.json`](./apps/api/openapi.json) —— 可直接导入 Postman / Apifox（Import → File → 选该文件）。
- 在线 Swagger UI：服务启动后访问 `http://localhost:3000/docs`（ReDoc：`/redoc`）。
- 重新生成：`docker compose exec -w /workspace/apps/api api python scripts/export_openapi.py`。

## 测试与验证

```bash
# 后端单元 + 集成（SQLite in-memory，无需 MySQL）
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q     # 153 passed
# 并发/行锁（需真实 MySQL）
docker compose exec -w /workspace/apps/api api pytest -m integration -q            # 1 passed
# 端到端全链路（建任务→作答→AI 预审→复审→导出带质量护照）
bash apps/api/scripts/e2e_test.sh                                                  # 21/21
# 前后端 hash 一致性 test vectors
docker compose exec -w /workspace/apps/api api pytest tests/unit/test_hash_vectors.py -q  # 后端 11
node --test packages/schema-core/src/__tests__/canonical-hash-vectors.test.ts            # 前端 10
# 前端 / 共享库
npm run typecheck && npm run test && npm --prefix apps/web run typecheck && npm --prefix apps/web run build
```

## 三人协作规则

- 前端负责人：`apps/web`、Designer、Renderer、Owner / Labeler / Reviewer 页面。
- 后端负责人：`apps/api`、数据库、API、状态机、审计、文件上传。
- Agent / Worker 负责人：AI Review、LLM 调用、Export worker、异步队列。

协作约定：

- 禁止直接 push `main`。
- 所有开发从 `dev` 拉 feature 分支。
- PR 合并前必须通过 contracts typecheck 和 contracts test。
- 涉及契约变更时，必须先更新 `labelhub-architecture-contract.md` 和 `packages/contracts`，再改业务模块。
- 前端、后端、worker 不得重新定义 contracts 类型。

详细 Git 流程见：

- [docs/git-workflow.md](./docs/git-workflow.md)

## 已实现能力（对照课题 §4）

- **§4.1 任务管理**：状态机（草稿/发布中/已暂停/已结束）、基础信息（标题/描述/富文本说明/标签/奖励/截止/配额）、数据集导入（JSON/JSONL/Excel）+ 题目预览 + 单条/批量编辑、分发策略（先到先得 + 配额抢单，幂等并发）。
- **§4.2 动态表单（核心难点）**：Designer/Renderer 解耦、可序列化 canonical JSON Schema、物料拖拽放置 + 节点重排、全部物料（文本/选择/富文本/上传/JSON/LLM/ShowItem）、分组容器 + 多 Tab、字段联动（visibleWhen）+ 运行时校验（必填/长度/正则/conditional）。
- **§4.3 标注台**：任务广场搜索筛选、上下题/跳题、草稿自动保存、提交校验、题目级 LLM 辅助（真实大模型）、我的贡献统计。
- **§4.4 AI 预审（核心难点）**：可配置 Prompt + 评分维度 + 阈值、异步入队、真实 LLM 结构化打分、通过/打回/人工复核、失败重试 + 幂等、token/模型/Prompt 可追溯。
- **§4.5 多角色审核**：状态机 + 双轨审计（audit_logs + audit_events）、初审/复审/终审 stage、批量操作、打回附理由 + 上一轮意见。
- **§4.6 多格式导出**：JSON/JSONL/CSV/Excel、异步 + 下载历史、字段映射（重命名 / 含审核记录）、导出附 Data Quality Passport。

## 关键设计取舍

- **Designer/Renderer 解耦**：LabelHub 自有 canonical Schema（`root` 树 + `kind`）为唯一事实源，前端用统一 schema 同时驱动 Designer 预览与 Labeler 运行时；不把第三方表单库协议暴露进契约。
- **命令驱动状态机 + 审计**：task/assignment/submission/export 全状态迁移可追溯，审计与业务同事务。
- **AI 异步预审**：Celery + 真实 LLM（temperature=0 提升评分稳定）+ 结构化 JSON 解析容错 + 人工兜底。
- **前后端 hash 一致**：`canonical-json-v1 + SHA-256`，后端 `app/utils/hashing.py` 与前端 `packages/schema-core` 用同一组 test vectors 验证逐字节一致。
- **Schema 版本管理**：已发布版本不可变快照，旧答卷绑定创建时 `schemaVersionId`，默认不迁移。
- **Quality Layer**：标注/审核/AI/导出统一建模为质量事件，导出数据附带质量证据链（Data Quality Passport）。
