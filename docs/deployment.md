# LabelHub 开发与演示环境

本文档说明如何在本地启动 LabelHub 的 Mock 前端模式、Docker 全栈模式，以及如何运行 contracts 检查和演示数据 seed。

当前仓库已经具备：

- `labelhub-architecture-contract.md v1.1`
- `packages/contracts`
- contracts typecheck
- 33 个契约测试
- `apps/web/src/mocks` MSW Mock 层
- Docker / Docker Compose 开发与演示环境

当前仓库尚未具备完整 `apps/web` Vite / React 应用和 `apps/api` 真实后端服务。因此 Docker 第一版会在缺少业务代码时启动占位服务，保证 MySQL、Redis、web、api、worker 的开发环境可以一条命令拉起。接入真实应用后，Dockerfile 会自动执行对应 package 的 `npm run dev`。

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

## 6. 数据库迁移

当前仓库尚未接入 ORM 和真实 API service，迁移命令为占位。

后续接入 Prisma 时建议：

```bash
cd apps/api
npm run db:migrate
```

后续接入其他 ORM 时，保持以下原则：

- 数据库模型必须来自 `labelhub-architecture-contract.md v1.1` 的 Storage Contract。
- 后端类型必须引用 `packages/contracts`，不要重新定义契约类型。
- 迁移必须覆盖 task、schema_versions、dataset_items、assignments、drafts、submissions、ai_review_jobs、review_results、export_jobs、files、audit_logs。

## 7. Seed demo data

已提供演示数据脚本：

```bash
scripts/seed-demo-data.ts
```

当前脚本会输出符合 contracts 类型的 demo data JSON。接入真实 ORM 后，应将该脚本改为写入 MySQL。

Docker 占位 seed：

```bash
docker compose --profile tools run --rm seed
```

后续接入 TypeScript runtime 后建议：

```bash
npx tsx scripts/seed-demo-data.ts
```

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

当前 worker 是占位进程。接入真实队列后，在 `apps/api/package.json` 中提供 `npm run worker`，并连接 `REDIS_URL` 和 `DATABASE_URL`。
