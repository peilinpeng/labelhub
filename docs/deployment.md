# LabelHub 开发与演示环境

本文档说明如何在本地与云端部署 LabelHub：Docker 全栈模式、前端 Mock 模式、迁移与 seed、以及云部署。

技术栈：前端 React + TS（Vite），后端 FastAPI + SQLAlchemy + Alembic，异步 Celery worker，MySQL 8 + Redis 7，LLM 接入豆包（OpenAI 兼容）。`docker compose up -d --build` 一条命令拉起全部服务（web / api / worker / mysql / redis）。

## 1. 本地 Mock 前端模式

Mock 前端模式用于前端 Designer、Renderer、Owner、Labeler、Reviewer 页面并行开发，不依赖真实后端。

环境变量：

```bash
VITE_ENABLE_MSW=true
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

在 Vite / React 入口中启用 MSW：

```ts
if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MSW === "true") {
  const { worker } = await import("./mocks/browser");
  await worker.start({ onUnhandledRequest: "bypass" });
}
```

启动方式占位：

```bash
cd apps/web
npm install
VITE_ENABLE_MSW=true npm run dev -- --host 0.0.0.0
```

如果 `apps/web/package.json` 尚未创建，可先使用 Docker web 占位服务确认端口和环境变量。

## 2. Docker 全栈模式

复制环境变量样例：

```bash
cp .env.example .env
```

启动全部服务：

```bash
docker compose up --build
```

服务端口：

- web：http://localhost:5173
- api：http://localhost:3000
- api health：http://localhost:3000/api/v1/health
- mysql：localhost:3306
- redis：localhost:6379

Docker Compose 服务：

- `web`：前端 Vite / React；当前缺少 `apps/web/package.json` 时启动占位页面。
- `api`：后端 API；当前缺少 `apps/api/package.json` 时启动占位 API。
- `worker`：AI Review / Export 异步任务 worker；当前缺少 worker 脚本时启动不阻塞的占位进程。
- `mysql`：MySQL 8，数据库名 `labelhub`。
- `redis`：Redis 7，用于队列和缓存。
- `seed`：演示数据 seed 占位服务，使用 `tools` profile。

停止服务：

```bash
docker compose down
```

清理数据库和缓存 volume：

```bash
docker compose down -v
```

## 3. Mock API 和真实 API 切换

Mock API 模式：

```bash
VITE_ENABLE_MSW=true
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

真实 API 模式：

```bash
VITE_ENABLE_MSW=false
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

说明：

- `VITE_ENABLE_MSW=true` 时，浏览器请求会被 `apps/web/src/mocks` 拦截。
- `VITE_ENABLE_MSW=false` 时，前端直接访问 `VITE_API_BASE_URL`。
- Docker Compose 默认保留 `api` 服务，即使前端使用 Mock，也方便后续联调真实后端。

## 4. 运行 contracts typecheck

当前环境如果安装了 npm：

```bash
cd packages/contracts
npm run typecheck
```

如果本机没有 npm，但有可用 TypeScript 编译器，也可以执行等价命令：

```bash
tsc -p packages/contracts/tsconfig.json --noEmit
```

## 5. 运行 contracts test

当前环境如果安装了 npm：

```bash
cd packages/contracts
npm run test
```

测试会生成 `packages/contracts/.contract-test-dist`。

清理测试产物：

```bash
cd packages/contracts
npm run clean:test
```

## 6. 数据库迁移（Alembic）

后端使用 Alembic 管理迁移，迁移链 head 为 `c3d4e5f6a7b8`（新增 `ai_assist_actions` 表）：

```bash
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api alembic current   # 应显示 c3d4e5f6a7b8 (head)
```

迁移覆盖 task、schema_drafts、schema_versions、dataset_items、assignments、drafts、submissions、ai_review_jobs、review_results、review_configs、export_jobs、export_records、files、llm_call_logs、audit_logs、audit_events 等表。

## 7. Seed demo data

提供三套独立 seed 脚本（写入真实 MySQL）：

```bash
# E2E 种子（账号 *@labelhub.test / Seed@1234）—— e2e_test.sh 依赖
docker compose exec -w /workspace/apps/api api python scripts/seed.py
# 演示种子（账号 *@labelhub.com / password123，含已发布任务 + 题目 + ReviewConfig）
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
# 举办方真实数据集（qa_quality 30 题 + preference_compare 12 题，两个真实任务）
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
# （可选）清理测试杂项任务，让任务市场干净
docker compose exec -w /workspace/apps/api api python scripts/clean_demo.py
```

三套账号互不覆盖，可重复执行。

## 8. 文件存储

当前第一版不引入 MinIO，使用本地 volume：

```bash
FILE_STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=/workspace/.storage/files
```

Compose 中该目录映射到 `file_storage` volume。后续接入对象存储时，应保持 File Upload Contract 不变，只替换存储驱动实现。

## 9. 常见问题排查

### 端口被占用

修改 `.env`：

```bash
WEB_PORT=5174
API_PORT=3001
MYSQL_PORT=3307
REDIS_PORT=6380
```

然后重新启动：

```bash
docker compose up --build
```

### MySQL 启动慢

第一次启动 MySQL 8 会初始化数据目录。等待 healthcheck 通过即可：

```bash
docker compose ps
```

### 前端请求没有被 Mock 拦截

检查：

- `VITE_ENABLE_MSW=true`
- Vite 入口是否调用 `worker.start`
- 浏览器 DevTools 中是否加载了 MSW worker
- `public/mockServiceWorker.js` 是否通过 `npx msw init public --save` 生成

### 前端想切到真实 API

设置：

```bash
VITE_ENABLE_MSW=false
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

### API 返回占位错误

当前 `apps/api` 真实后端尚未实现，Docker API 容器会返回占位 JSON。接入真实 API 后，在 `apps/api/package.json` 中提供 `npm run dev`，容器会自动运行真实后端。

### Worker 没有处理 AI Review / Export

确认 `worker` 容器在运行（`docker compose ps`），且 `celery_app.py` 已 `include` 任务模块、`REDIS_URL` / `DATABASE_URL` / `DOUBAO_*` 已注入。可查看日志：`docker compose logs worker --tail 50`。

## 10. 云部署（任意云平台）

整套系统已 Docker 化，可部署到任意支持容器的云平台（ECS / 轻量应用服务器 / K8s / Render / Railway 等）。核心步骤：

1. **托管依赖（推荐）**：用云数据库 MySQL 8 + 云 Redis，替代 compose 内置的 `mysql` / `redis`，提升可用性。
2. **构建并推送镜像**：
   ```bash
   docker build -f apps/api/Dockerfile -t <registry>/labelhub-api:<tag> .
   docker build -f apps/web/Dockerfile -t <registry>/labelhub-web:<tag> .
   docker push <registry>/labelhub-api:<tag> && docker push <registry>/labelhub-web:<tag>
   # worker 复用 api 镜像，启动命令改为 celery -A app.worker.celery_app worker
   ```
3. **配置环境变量**（云平台 Secret / 环境变量面板，切勿写进镜像）：
   ```bash
   DATABASE_URL=mysql+pymysql://<user>:<pwd>@<mysql-host>:3306/labelhub
   REDIS_URL=redis://<redis-host>:6379
   JWT_SECRET=<高强度随机值>
   DOUBAO_API_KEY=<真实 key>
   DOUBAO_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
   DOUBAO_MODEL=<接入点 ep-...>
   FILE_STORAGE_DRIVER=local   # 或对接对象存储
   ```
4. **启动顺序**：api 容器启动前先跑迁移 `alembic upgrade head`；首次部署跑一次 seed。
5. **前端代理/接口地址**：
   - 若 web 容器内置 Vite 代理：注入 `VITE_PROXY_TARGET=http://<api-host>:3000`、`VITE_ENABLE_MSW=false`。
   - 若前端走静态托管 + 网关：将 `/api` 反向代理到 api 服务，或构建时设 `VITE_API_BASE_URL` 为公网 api 地址。
6. **健康检查**：api `GET /docs`（或自定义 `/health`）；mysql/redis 用云厂商健康检查；worker 看 Celery 日志。
7. **演示环境最小配置建议**：2 vCPU / 4GB；api 与 worker 同镜像不同启动命令；MySQL/Redis 用托管小规格即可。

> 演示环境访问地址与账号请在 `submission/README.md` 中补充。
