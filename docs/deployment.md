# LabelHub 部署与本地运行

本文是 LabelHub 当前部署配置的权威说明。系统包含静态 Web、FastAPI API、Celery
Worker / Scheduler、MySQL 8 和 Redis 7。前端 Mock 与真实后端是两种独立模式，
不要同时开启。

环境变量的必填性、默认值和敏感等级见
[`environment-variables.md`](environment-variables.md)。

## 1. 前置条件

- Docker Engine 24+ 与 Docker Compose v2；或 Docker Desktop。
- 仅做前端开发时：Node `22.23.1`、npm `10.9.8`。
- 直接运行 API / pytest 时：Python 3.11。

仓库根目录的 `.nvmrc`、`package-lock.json`、`apps/web/package-lock.json` 与
`apps/api/requirements*.lock` 是可重复安装的依据。不要用 `npm install` 或未锁定的
Python requirements 更新 CI / 生产环境。

## 2. 从零启动真实后端全栈

```bash
cp .env.example .env
# 本地演示可保留 demo 默认值；真实 AI 需要填写 DOUBAO_API_KEY / DOUBAO_MODEL。

docker compose build --pull
docker compose up -d mysql redis --wait
docker compose --profile tools run --rm seed
docker compose up -d --wait
```

`seed` 会先执行 `alembic upgrade head`，再运行可重复的 E2E seed，并校验三角色账号、
可领取题目和待审核提交。它不是启动占位服务，也不会在生产环境自动执行。

访问地址：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| Web | <http://localhost:5173/> | Nginx 静态资源与同源 `/api` 反向代理 |
| API | <http://localhost:3000/> | FastAPI |
| API health | <http://localhost:3000/api/v1/health> | API 进程存活检查 |
| Swagger | <http://localhost:3000/docs> | 非 production 环境可用 |
| MySQL | 仅 Compose 内网 `mysql:3306` | 默认不发布宿主端口 |
| Redis | 仅 Compose 内网 `redis:6379` | 默认不发布宿主端口 |

默认演示账号：

| 角色 | 邮箱 | 密码 |
| --- | --- | --- |
| Owner | `owner@labelhub.com` | `password123` |
| Labeler | `labeler@labelhub.com` | `password123` |
| Reviewer | `reviewer@labelhub.com` | `password123` |

## 3. 迁移与 Seed

只迁移、不写演示数据：

```bash
docker compose up -d mysql redis --wait
docker compose run --rm api alembic upgrade head
docker compose run --rm api alembic current
```

按需写入演示数据（只允许 `DEMO_MODE=true` 的非生产环境）：

```bash
docker compose run --rm api python scripts/seed_demo.py
docker compose run --rm api python scripts/seed_competition.py
```

确定性 CI / E2E 数据统一使用：

```bash
docker compose --profile tools run --rm seed
```

生产部署必须先单独运行迁移，禁止运行任何 seed。

## 4. 前端 Mock 模式

Mock 模式适合无 Docker、无真实数据库或只开发页面 / Schema Runtime 的场景。MSW
只在显式开启时加载，未匹配的请求在测试中会直接失败。

```bash
npm ci
npm --prefix apps/web ci
VITE_ENABLE_MSW=true VITE_DEMO_MODE=true \
  npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5180
```

访问 <http://127.0.0.1:5180/>，使用 `*@labelhub.test / Seed@1234` 账号。Mock 数据
不会写入 MySQL，也不验证真实 API 契约或 Celery 执行，因此不能替代真实后端 E2E。

`npm --prefix apps/web run build:demo` 会同时启用 MSW 和 Demo 登录提示，供
GitHub Pages 等公开 Mock 演示环境使用；正式构建必须使用 `build:production`。
当已打开的演示页面遇到 MSW worker 版本升级时，页面会在新 worker 接管后自动刷新
一次并重新建立 Mock 通道，避免请求短暂落到静态托管服务。

响应式 E2E 可在 Mock 服务运行时单独执行：

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5180 \
PLAYWRIGHT_USE_MSW=true \
  npm --prefix apps/web run e2e -- responsive.spec.ts
```

## 5. 本地真实 API + Vite 开发

需要热更新前端、但 API 使用 Docker 时：

```bash
docker compose up -d mysql redis api worker scheduler --build --wait
VITE_ENABLE_MSW=false VITE_PROXY_TARGET=http://127.0.0.1:3000 \
  npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5180
```

常规浏览器请求使用同源 `/api/v1/*`：生产由 Nginx 代理，开发由 Vite 代理。
`VITE_API_BASE_URL` 仅供 GitHub Pages 子路径的纯 Mock 构建添加路径前缀，不配置为
真实后端域名。

## 6. 服务与镜像约束

- Web Dockerfile 使用 Node builder 执行两次 `npm ci`，运行层只包含 Nginx 和
  `dist` 静态文件，不含 Vite、源码或 node_modules。
- API Dockerfile 使用带 SHA-256 的 `requirements.txt`，只安装运行时依赖；测试
  依赖位于独立 `requirements-dev.txt`。
- API、Worker、Scheduler 和 seed 复用同一 `labelhub-api:<tag>` 镜像。
- API / Worker / Scheduler 以 UID/GID `10001` 运行；Web 使用 unprivileged Nginx。
- 服务默认 `cap_drop: ALL`、`no-new-privileges`，API 与 Worker 使用持久化文件卷。
- API 容器健康检查同时验证 HTTP、MySQL 与 Redis；Worker / Scheduler 验证 MySQL
  与 Redis。Compose 配置了 SIGTERM 与退出宽限期。
- MySQL / Redis 默认仅在 Compose 网络可达。如确需宿主直连，显式叠加：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql redis
```

## 7. 测试与依赖验证

共享包与 Web：

```bash
npm ci
npm run typecheck
npm test
npm --prefix apps/web ci
npm --prefix apps/web run typecheck
npm --prefix apps/web run test:coverage
npm --prefix apps/web run build
npm audit --omit=dev --audit-level=high
npm --prefix apps/web run audit:production
```

API（全新 Python 3.11 虚拟环境）：

```bash
cd apps/api
python3.11 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
.venv/bin/python -m pytest -m "not integration" -q
```

真实 MySQL 并发测试需要先从仓库根显式发布数据库端口，并写入 `*.labelhub.test`
测试账号：

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
docker compose run --rm api python scripts/seed.py
cd apps/api
DATABASE_URL=mysql+pymysql://labelhub:labelhub@127.0.0.1:3306/labelhub \
E2E_BASE=http://127.0.0.1:3000/api/v1 \
  .venv/bin/python -m pytest -m integration -v
cd ../..
```

真实后端 E2E：

```bash
npm --prefix apps/web exec playwright install chromium
docker compose up -d --build --wait
docker compose --profile tools run --rm seed
npm --prefix apps/web run e2e
```

当前套件包含 4 个真实业务 E2E 与 2 个桌面 / 移动端响应式 E2E，共 6 个场景。

锁文件更新流程：

```bash
cd apps/api
uv pip compile --python-version 3.11 --universal --generate-hashes \
  requirements.in -o requirements.txt
uv pip compile --python-version 3.11 --universal --generate-hashes \
  requirements-dev.in -o requirements-dev.txt
```

CI 会对 Python 锁文件执行 `pip-audit`，对共享包执行 `npm audit --audit-level=high`，
Web 使用 `audit:production` 保持同等门禁。Web 审计只允许
`apps/web/audit-allowlist.json` 中带到期日与适用性说明的精确 GHSA；未批准的 high /
critical 仍会失败，已修复后残留的例外也会失败并要求删除。Dependabot 每周检查 npm、
pip、Docker 与 Actions，并将必须同步升级的 React / Vite 测试工具链分组。

## 8. 停止、清理与重建

保留数据库和文件：

```bash
docker compose down
```

删除 Compose 容器、数据库、Redis 和上传文件卷（不可恢复）：

```bash
docker compose down -v
```

仅重建应用镜像：

```bash
docker compose build api web
docker compose up -d api worker scheduler web --wait
```

查看状态与日志：

```bash
docker compose ps
docker compose logs --tail=200 api worker scheduler web
```

## 9. 生产部署

生产环境至少满足：

```dotenv
APP_ENV=production
DEMO_MODE=false
JWT_SECRET=<至少32字符随机值>
DATABASE_URL=mysql+pymysql://<user>:<strong-password>@<host>:3306/<database>
REDIS_URL=redis://:<strong-password>@<host>:6379/0
LOGIN_RATE_LIMIT_BACKEND=redis
TRUSTED_HOSTS=api.example.com
ENABLE_HSTS=true
```

推荐使用托管 MySQL / Redis、对象存储和平台 Secret。部署顺序为：构建并推送唯一版本
镜像 → 运行 Alembic migration job → 启动 API / Worker / Scheduler → 启动 Web → 等待
readiness。生产环境不运行 Vite、不执行 npm 安装、不运行 seed。

镜像体积可用以下命令记录：

```bash
docker image inspect labelhub-api:local --format '{{.Size}}'
docker image inspect labelhub-web:local --format '{{.Size}}'
docker history labelhub-api:local
docker history labelhub-web:local
```

## 10. 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| Web 502 | `docker compose ps api`，再查 `docker compose logs api` |
| API unhealthy | 健康探针会同时检查 API、MySQL、Redis；按日志中的失败依赖排查 |
| 页面 `/api` 404 | Mock 模式确认 `VITE_ENABLE_MSW=true`；真实模式确认 Nginx / Vite 代理 |
| Pages 演示登录返回 405 | 确认 `mockServiceWorker.js` 与 `msw` 版本一致；已打开的旧页面应在 worker 更新后自动刷新一次 |
| 数据表不存在 | 执行 `docker compose run --rm api alembic upgrade head` |
| Worker 不消费任务 | 检查 Worker health、Redis URL、队列名和 `DOUBAO_*` |
| 宿主无法连 MySQL / Redis | 默认是安全行为；确有需要时叠加 `docker-compose.dev.yml` |
| production 启动失败 | 按 `environment-variables.md` 检查弱 JWT、默认数据库密码、Demo 模式和 Trusted Hosts |
