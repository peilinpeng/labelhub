# LabelHub 数据标注平台

LabelHub 是一个面向 AI 数据生产的全栈标注平台课题，目标是覆盖「数据生产 → AI 预审 → 人工审核 → 多格式导出」完整生命周期。

当前仓库优先完成了架构契约、共享类型、契约测试、MSW Mock 层和 Docker 开发环境，为前端、后端、AI Agent、异步 worker 和测试并行开发打底。

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

- `web`：前端 Vite / React，占位时暴露 5173。
- `api`：后端 API，占位时暴露 3000。
- `worker`：AI Review / Export 异步任务 worker。
- `mysql`：MySQL 8。
- `redis`：Redis 7。

部署和排查说明见：

- [docs/deployment.md](./docs/deployment.md)

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

## 当前状态

已完成：

- 架构契约 v1.1。
- `packages/contracts` 共享类型包。
- contracts typecheck。
- 33 个契约测试。
- MSW Mock 层。
- Docker Compose 开发/演示环境。

待接入：

- 完整 `apps/web` Vite / React 应用。
- 完整 `apps/api` 后端服务。
- 真实数据库迁移。
- 真实 AI Review / Export worker。
