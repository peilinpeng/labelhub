# 交接说明 · 给 UI / 测试搭档团队

> 你们接手后负责：**UI 视觉调整 + 网页端手动测试 + 后续迭代优化（含前端、后端，或前后端统一调整）**。
> 本文件是给你们的「上手第一篇」。读完即可把项目跑起来、知道改哪里、知道现在还差什么。
> （另有两份给 AI 协作工具的内部交接：`HANDOFF.md` / `AGENTS.md`，你们不必细读，需要历史时再查。）

---

## 1. 项目一句话

LabelHub：覆盖「数据生产 → AI 预审 → 人工审核 → 多格式导出」全链路的数据标注平台。
前端 React+TS、后端 FastAPI、AI 审核 Agent（Celery 异步）三端都已端到端跑通真实链路。
**核心功能（课题 §四 4.1~4.6）已全部落地**，当前阶段是 UI 打磨 + 手动测试 + 答辩提交物补齐。

---

## 2. 怎么把它跑起来（两种模式，按需选）

### 模式 A（推荐给 UI 调整）：纯前端 Mock，不用起后端

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

- 访问 **http://localhost:5180/** ⚠️（本地 dev 端口是 **5180**，不是 5173）
- 不需要 docker、不需要数据库，所有 `/api` 由 MSW 拦截返回 mock 数据
- 适合：调样式、调布局、点页面看交互。**改完即时热更新**

### 模式 B（完整真实链路，给端到端手动测试）：docker 一键起全栈

```bash
cp .env.example .env        # 按需填 DOUBAO_API_KEY 等（举办方 key 见课题 PDF 第 7 页）
docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
```

- 访问 **http://localhost:5173/**（docker 下 web 端口是 5173）
- web 走真实后端（MSW 关闭，Vite `/api` 代理到 api 容器）
- 适合：测 AI 预审、审核流转、导出等需要真实后端的链路

> ⚠️ **端口提醒**：本地 `npm run dev` = **5180**；docker compose = **5173**。两者不一样，别找错。

---

## 3. 登录账号（两套，别混用）

| 用途 | 账号 | 密码 |
|---|---|---|
| **演示/手动测试**（模式 B seed_demo） | `owner@labelhub.com` / `labeler@labelhub.com` / `reviewer@labelhub.com` | `password123` |
| E2E 自动化测试（seed.py，勿手动用） | `*@labelhub.test` | `Seed@1234` |

三个角色对应三套工作台：Owner（建任务/搭模板/导出）、Labeler（领任务/作答/提交）、Reviewer（审核/打回/终审）。

---

## 4. 文件边界 / 契约纪律 ⭐ 全栈接手必读

你们是**全栈接手**，前端、后端、共享库原则上都可以改。但这套项目是 **contract-driven（契约驱动）**，有一条不可逾越的红线，理解它就不会把全栈改散。

### 各部分定位
| 目录 | 是什么 | 改动姿势 |
|---|---|---|
| `apps/web/src/` | 前端（页面/路由/壳） | ✅ 可改 |
| `apps/web/src/styles.css` | 全局样式（颜色/间距/布局大头） | ✅ UI 主战场 |
| `packages/schema-renderer/src/` | 表单物料渲染组件 | ✅ 可改 |
| `packages/schema-designer/src/` | 拖拽搭建器界面 | ✅ 可改 |
| `apps/api/` | 后端（FastAPI/SQLAlchemy/Celery） | ✅ 可改 |
| `apps/api/app/schemas/*.py` | 后端的契约**镜像**（Pydantic） | ⚠️ 见红线 |
| `packages/contracts/` | 全栈共享类型/错误码/审计动作的**唯一来源** | ⚠️ 见红线 |
| `labelhub-architecture-contract.md` | 最高架构契约（v1.1，设计准则） | ⚠️ 见红线 |

### 🚨 唯一红线：契约要改，必须三处同步
`packages/contracts`（TS 源头）↔ `apps/web`（前端消费）↔ `apps/api/app/schemas/*.py`（Python 镜像）
**描述的是同一套数据结构 / 错误码 / 审计动作。**

- 改 UI / 改后端逻辑但**数据结构不变** → 随便改，互不影响。
- 一旦要**动字段名、加错误码、加审计动作、改接口形状**：
  1. 先改 `packages/contracts`（源头）
  2. 同步 `apps/api/app/schemas/*.py`（Python 侧，文件头写明「字段命名必须与契约 v1.1 一致」）
  3. 同步 `apps/web` 消费处
  4. 若是设计级改动，更新 `labelhub-architecture-contract.md`
- **禁止**：在某个业务模块里「就地重新定义」一份契约类型、或只改一侧不改另一侧 —— 这会让前后端悄悄对不上，是最难查的 bug。

> 一句话：**改长相、改逻辑随意；改"前后端共享的数据约定"必须成套改、别只改一半。**

---

## 5. 手动测试怎么测

- 完整链路剧本：[`docs/LabelHub_Demo_Guide.md`](docs/LabelHub_Demo_Guide.md)（建任务→搭模板拖拽→发布→作答→AI 辅助→提交→AI 预审→人工审核→导出）
- 测试用例清单：[`docs/test-cases.md`](docs/test-cases.md)、[`docs/QA_TEST_RECORD.md`](docs/QA_TEST_RECORD.md)（**测试结果请填这里**）
- 验收点名两种分辨率要表现良好：**1280×800** 与 **1920×1080**，调 UI 时两种都看一眼
- 截图统一放 `docs/qa-assets/`（目前为空，待补）

---

## 6. 现在还差什么（待迭代清单，按答辩价值排序）

**A. 提交物缺口（课题 §八，直接影响评分）**
- [ ] 演示视频 5–10 分钟（覆盖三角色，剧本已备好）
- [ ] 架构图（`submission/architecture.png`）
- [ ] AI Coding 过程记录（`submission/ai-coding-log.md`）
- [ ] Demo 截图（`submission/screenshots/` 或 `docs/qa-assets/`）
- [ ] 云演示环境公网地址 + 账号（`.env.example` 已就位，待部署）

**B. 工程/体验打磨（你们主战场）**
- [ ] 视觉规范统一（颜色/字号/间距/组件风格一致性）—— UI 团队核心任务
- [ ] 两种分辨率（1280×800 / 1920×1080）逐页走查
- [ ] 错误提示友好度、空状态、加载态打磨
- [ ] 移动端适配（课题里是「可选加分项」，有余力再做）

**C. 已知小项（非阻断）**
- mock-db.ts 残留 `sha256:mock-*` 占位符（仅 MSW 静态数据，不影响真实链路）
- Vitest 版本 CVE（dev-only 依赖，非阻断，维护者决定升级时机）

> 已完成、无需再碰的：核心功能 4.1~4.6、登录健壮性、bundle 代码分割、Schema 版本治理、质量层、Formily 联动运行时。详见 `HANDOFF.md`。

---

## 7. 协作纪律

- **分支**：主线是 `integration/joint-test`。做 UI 迭代请开自己的 feature 分支（如 `feature/ui-polish`），改完提 PR / 合并前对齐，别直接往主线推半成品。
- **改完自检（按你改了哪侧跑对应的）**：
  ```bash
  # 前端 / 共享库改动
  cd apps/web && npm run typecheck && npm run build              # 必须通过

  # 后端改动（在 api 容器内，或本地 venv）
  docker compose exec -w /workspace/apps/api api alembic upgrade head      # 改了模型要建迁移
  docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q   # 预期 153 passed
  docker compose exec -w /workspace/apps/api api pytest -m integration             # 需真实 MySQL（行锁/并发）

  # 端到端（前后端一起改完，强烈建议跑）
  bash apps/api/scripts/e2e_test.sh                              # 预期 21/21
  ```
- **改了契约（contracts / schemas / 接口形状）→ 三处同步后，前端 typecheck + 后端 pytest + e2e 都要过**，确认没把前后端改散。
- **数据库模型改了** → 用 alembic 生成迁移（别手改库），保证别人 `alembic upgrade head` 能复现。
- **commit 信息**用中文+前缀（参考现有：`fix(web): ...` / `feat(api): ...` / `feat(labeler): ...` / `chore(web): ...`）。

---

## 8. 关键文档索引

| 想了解 | 看这个 |
|---|---|
| 项目全景 / 启动 / 已实现能力 | [`README.md`](README.md) |
| 提交物清单与进度 | [`submission/README.md`](submission/README.md) |
| 架构契约（最高准则，改前慎重） | [`labelhub-architecture-contract.md`](labelhub-architecture-contract.md) |
| 后端模块说明 | [`apps/api/README.md`](apps/api/README.md) |
| 后端架构 / Schema 设计决策 | [`SCHEMA_ARCH_AGENT.md`](SCHEMA_ARCH_AGENT.md) / [`AGENTS.md`](AGENTS.md) |
| 完整 Demo 剧本 | [`docs/LabelHub_Demo_Guide.md`](docs/LabelHub_Demo_Guide.md) |
| 历史详细状态（AI 轮班用） | [`HANDOFF.md`](HANDOFF.md) |
| API 文档 | `apps/api/openapi.json`（导入 Postman/Apifox）/ 服务起后 `http://<host>:3000/docs` |

有任何「这块为什么这么设计」的疑问，先查上面文档，再找原维护者对齐。祝迭代顺利 🚀
