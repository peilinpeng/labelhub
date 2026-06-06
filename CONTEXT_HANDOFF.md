# 迁移上下文文档（账号切换交接）

> 生成时间：2026-06-07。给接手的新会话/账号：**先读本文件**，再读 `CLAUDE.md`、
> `docs/backend-optimization-plan.md`、`HANDOFF.md`（前端轨道）。本文件记录客观事实。

---

## 0. 我是谁 / 职责

- 角色：**后端负责人 + 最终合并负责人**。
- 文件边界：主职 `apps/api/`（Python+FastAPI+SQLAlchemy+Celery+MySQL）。
- **作为合并负责人，前端（apps/web）有问题也可以改**（本会话已改过 vite.config.ts、docker-compose.yml）。
- 不要动：`packages/contracts/`、`labelhub-architecture-contract.md`（除非合并必需且明确）。

---

## 1. 仓库 / 分支 / 同步状态

- 仓库：`/Users/xiongweiluo/LabelHub_Coding/labelhub`
- 远程：`git@github.com:peilinpeng/labelhub.git`（默认分支 `main`）
- 当前分支：`integration/joint-test`
- **本地领先远程 2 个提交（未 push）**：
  - `566e74a` fix(api): schema 改用契约 canonical(root 树)，修复真实后端作答页渲染崩溃
  - `fdee211` feat(api): seed_competition 导入举办方真实数据
- 远程当前在 `a59a369`。
- **未跟踪文件**（未提交，待决定）：
  - `docs/dataset-test-scenario-plan.md`（比赛数据测试方案调研文档，有价值，建议提交）
  - `.claude/`（本地 preview 工具的 launch.json，本地产物，可不提交）

> 接手第一步：`git status` 确认分支=integration/joint-test、ahead 2；按需 `git push`。

## 1b. 团队 Git 惯例 / PR

- 惯例：`feature/* → dev → main`（PR #1~#9 印证）。
- **已开 PR**：`integration/joint-test → dev`（base=dev，零冲突）。push 后 PR 自动更新。
- 之后按惯例再走 `dev → main` 发布。
- 本机**未装 `gh` CLI**；建 PR 走 GitHub 网页 compare 链接。

---

## 2. 环境关键坑（务必知道）

1. **后端跑在 Docker 镜像 `/app`，无 hot-reload**。改后端代码后必须重建：
   `docker compose build api worker && docker compose up -d api worker`
2. **但 pytest / seed 脚本走 `/workspace` 挂载**（`docker compose exec -w /workspace/apps/api api ...`），
   读的是当前源码，**改测试/seed 无需重建**；只有要让**运行中的 uvicorn 服务器**生效才需重建。
3. 迁移手动跑：`docker compose exec -w /workspace/apps/api api alembic upgrade head`
   迁移链 head：`b2c3d4e5f6a7`。
4. 测试（SQLite in-memory，conftest 在 import app 前替换 engine）：
   - `docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q` → **应 125 passed**
   - 并发（需真实 MySQL）：`pytest -m integration` → 应 1 passed
5. E2E：`bash apps/api/scripts/e2e_test.sh` → 应 20/20
6. **前端运行模式（重要）**：web 容器现已默认 `VITE_ENABLE_MSW=false`（真实后端模式）。
   - MSW=true 时前端走 mock（`apps/web/src/mocks/`），完全绕过后端。
   - Vite 代理：`vite.config.ts` 的 `/api` target 走 `process.env.VITE_PROXY_TARGET ?? localhost:3000`；
     docker-compose 注入 `VITE_PROXY_TARGET=http://api:3000`（容器内 localhost 不是 api 容器！）。
   - web 端口映射：宿主 `5173` → 容器 `5180`（vite.config 端口是 5180）。访问 http://localhost:5173/
7. **三套 seed 账号**：
   - `scripts/seed.py`：`*@labelhub.test` / `Seed@1234`（E2E 用，勿动）
   - `scripts/seed_demo.py`：`*@labelhub.com` / `password123`（演示，含 1 个新闻演示任务）
   - `scripts/seed_competition.py`：复用 `*@labelhub.com`，建 2 个比赛真实任务（本会话新增）
8. **前后端 hash 一致**：canonical-json-v1 + SHA-256，后端 `app/utils/hashing.py`，
   对齐前端 `packages/schema-core/src/stable-hash.ts`。
9. 前端决策路径是 `/decision`（不是 /decide）。

---

## 3. Schema 形状（本会话踩的最大坑，务必牢记）

- **契约权威形状是 canonical**（`packages/contracts/src/schema.ts` 的 `LabelHubSchema`）：
  顶层有 `root: ContainerNode`（**树形**），节点有 `kind`（CONTAINER/FIELD/SHOW_ITEM/LLM_ASSIST）、
  `title`、容器用 `children`。**没有顶层 `nodes`**。
- 前端 `SchemaRenderer.tsx` 渲染 `schema.root`。
- 历史上后端用过扁平 `{nodes:[...]}`（`type`/`name`/`label`），**不符契约**，会导致真实后端模式作答页崩溃。
- 本会话已修：`schema_domain.validate_schema` 与 `assignment_domain` 现**同时兼容 canonical(root) 和历史扁平(nodes)**；
  两个 seed 已改产 canonical。**以后新建/修改 schema 一律用 canonical(root 树)**，可参考
  `apps/web/src/mocks/data/schemas.mock.ts` 或 `seed_competition.py` 的 `_schema/_field/_show/_container/_llm` 助手。

---

## 4. 本会话已完成（按时间）

1. **合并后冒烟全绿**：pytest 111→ 后续 125 passed、并发 1 passed、E2E 20/20。
2. **补 schema 版本测试**（`536c8c0`）：`tests/integration/test_schema_version.py`，TC-DES-09/10/11。
3. **实现 `POST /tasks/{id}/schema/ai-generate`**（`5b5f7d2`）：前后端接口映射唯一缺口，
   `schema_domain.generate_schema_draft()` 复用 llm_assist 范式，写 `LLMCallLog(purpose=SCHEMA_GENERATION)`。
4. **前后端接口映射全面核对**：后端 100% 覆盖前端调用（仅 ai-generate 缺，已补）。
5. **修 Docker 真实后端联调**（`a59a369`）：MSW 默认关 + Vite 代理指向 api 服务 + 端口 5173:5180。
6. **比赛数据测试方案（方案 A）**（`fdee211`）：`scripts/seed_competition.py` + `datasets/*.jsonl`，
   建 2 个 PUBLISHED 任务（配额 50），覆盖全部物料组件。方案文档 `docs/dataset-test-scenario-plan.md`。
7. **修 schema canonical bug**（`566e74a`）：见第 3 节。浏览器实走验证两任务作答页全部组件正常渲染、无报错。

### 已确认无泄漏
- 仓库无真实 API key（`.env` 被 gitignore；`.env.example` 全占位符；docker-compose 用 env 引用）。

---

## 5. 当前运行态

- 容器：api / worker（21 分钟前重建，含最新代码）、mysql / redis / web 均 Up。
- web：真实后端模式（MSW=false），http://localhost:5173/ 可访问。
- DB 已种：
  - `task_demo_qa_quality`（大模型问答质量标注，17 节点，30 题，PUBLISHED）
  - `task_demo_pref_compare`（偏好对比标注 RLHF，16 节点，12 题，PUBLISHED，含 container.tabs）
  - `task_demo_news_quality`（新闻质量演示，canonical schema，10 题）
  - 另有 E2E/并发测试遗留任务（市场里 `E2E测试任务`/`并发测试_*`，演示前可清理）
- 临时：本会话用 preview 工具在宿主 5180 起过一个 `npm run dev`（验证渲染用），可忽略/停掉。
  - 配置在 `/Users/xiongweiluo/LabelHub_Coding/.claude/launch.json`（仓库上层目录）。

---

## 6. 下一步 / 待办（接手可选）

**立即可做**
- [ ] `git push origin integration/joint-test`（推送 fdee211、566e74a，PR 自动更新）
- [ ] 决定是否提交 `docs/dataset-test-scenario-plan.md`（建议提交）

**演示/合并收尾**
- [ ] 清理真实 DB 的测试任务杂项（让任务市场干净）：可写脚本删 `E2E测试任务`/`并发测试_*`，或重置 DB 后只跑 seed_demo + seed_competition。
- [ ] 浏览器继续走完整链路验证：AI 预评分(llm.assist) → 提交 → AI 预审 → Reviewer 复审 → 导出。
      注意：真实 LLM 调用需 `.env` 配好 `DOUBAO_API_KEY`/`DOUBAO_MODEL`（当前容器 DOUBAO_MODEL 为空）。
- [ ] docs 同步：main 上有 7 个 docs 提交未在本分支（component integration guide / AI coding rules），择机 main→dev 同步。

**交付物清单（docs/test-cases.md 第七节，均待核验）**
- [ ] README（架构图/模块职责/env/一键启动）
- [ ] API 文档（`apps/api/openapi.json` 已有，可导入 Postman/Apifox）
- [ ] AI Coding 记录（prompt 日志/截图）
- [ ] 路演视频（5-10 分钟，Owner→Labeler→AI→Reviewer 全流程）

---

## 7. 验证命令速查

```bash
cd /Users/xiongweiluo/LabelHub_Coding/labelhub
# 改后端代码后
docker compose build api worker && docker compose up -d api worker
# 迁移
docker compose exec -w /workspace/apps/api api alembic upgrade head      # head=b2c3d4e5f6a7
# 测试
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q   # 125 passed
docker compose exec -w /workspace/apps/api api pytest -m integration -q          # 1 passed
bash apps/api/scripts/e2e_test.sh                                                # 20/20
# 种演示数据
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
# 前端真实后端模式登录：http://localhost:5173/  →  *@labelhub.com / password123
```

---

## 8. 关键文件索引

- 后端接口：`apps/api/app/routers/`（tasks/assignments/review/marketplace/exports/files/audit_events/ai_review/auth/dataset）
- 后端领域服务：`apps/api/app/services/`（schema_domain / assignment_domain / review_domain / export_domain / ...）
- Schema 校验/生成：`apps/api/app/services/schema_domain.py`（validate_schema / generate_schema_draft）
- 种子：`apps/api/scripts/{seed.py, seed_demo.py, seed_competition.py}`
- 测试：`apps/api/tests/{unit,integration}/`
- 前端渲染器：`packages/schema-renderer/src/SchemaRenderer.tsx`（渲染 schema.root）
- 前端 API 客户端：`apps/web/src/api/{client,owner,labeler,reviewer,audit}.ts`
- 前端 mock：`apps/web/src/mocks/`（MSW handlers + canonical schema 示例）
- 契约：`packages/contracts/src/schema.ts`（LabelHubSchema 权威形状）
