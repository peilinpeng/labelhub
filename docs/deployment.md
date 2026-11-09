# LabelHub 部署与本地运行

本文是 LabelHub 当前部署配置的权威说明。系统包含静态 Web、FastAPI API、Celery
Worker / Scheduler、MySQL 8 和 Redis 7。前端 Mock 与真实后端是两种独立模式，
不要同时开启。

环境变量的必填性、默认值和敏感等级见
[`environment-variables.md`](environment-variables.md)。

## 1. 前置条件

- Docker Engine 24+ 与 Docker Compose v2；或 Docker Desktop。
- 仅做前端开发时：Node `26.13.0`、npm `11.20.0`。
- 直接运行 API / pytest 时：Python 3.11。

仓库根目录的 `.nvmrc`、`package-lock.json`、`apps/web/package-lock.json` 与
`apps/api/requirements.txt` / `apps/api/requirements-dev.txt` 是可重复安装的依据。不要用 `npm install` 或未锁定的
Python requirements 更新 CI / 生产环境。

## 2. 从零启动真实后端全栈

```bash
cp .env.example .env
# 本地演示可保留 demo 默认值；真实 AI 需要填写 DOUBAO_API_KEY / DOUBAO_MODEL。

python3 scripts/local-compose.py build --pull
python3 scripts/local-compose.py up -d mysql redis --wait
python3 scripts/local-compose.py --profile tools run --rm seed
python3 scripts/local-compose.py up -d --wait
```

`seed` 会先检查初始化目标，再执行 `alembic upgrade head` 和 E2E seed，并校验三角色账号、
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
python3 scripts/local-compose.py up -d mysql redis --wait
python3 scripts/local-compose.py run --rm api alembic upgrade head
python3 scripts/local-compose.py run --rm api alembic current
```

按需写入演示数据（只允许 `DEMO_MODE=true` 的非生产环境）：

```bash
python3 scripts/local-compose.py run --rm api python scripts/seed_demo.py
python3 scripts/local-compose.py run --rm api python scripts/seed_competition.py
```

确定性 CI / E2E 数据统一使用：

```bash
python3 scripts/local-compose.py --profile tools run --rm seed
```

默认 `LABELHUB_SEED_MODE=initialize` 只允许空库（忽略 `alembic_version`）；已有账号、审计、
任务或其他表数据均会拒绝，且在账号密码更新、删除或迁移之前检查。`seed.py`、`seed_demo.py`、
`seed_e2e.py`、`seed_competition.py`、`seed_demo_pipeline.py` 和 `clean_demo.py --apply` 共用保护。
`clean_demo.py` 默认预览及流水线 `--dry-run` 保持只读。

重复播种或在演示任务后继续加竞赛数据，只允许可丢弃测试库：**第一次在空库上运行前**明确设置
`LABELHUB_SEED_MODE=disposable`，由保护脚本登记 `_labelhub_disposable_seed` 运维表。
每次重复运行仍须显式传入此值；MySQL 标记绑定服务器 UUID 和数据库名称，复制到其他库的标记无效。
非空未登记库不能事后登记，不能通过这个环境变量解锁；不要手工补标记或删除业务数据来解除保护。
MySQL 命名锁阻止多个初始化并发执行，但它不阻止正常应用写入；初始化只能在新建隔离环境、无其他使用者时运行。
这不是持久业务库的数据迁移方案，也不是对任意手写 SQL 或旧版本镜像的权限隔离。

```bash
# 仅对全新、可丢弃的独立测试项目使用；不要沿用业务项目名、外部卷或外部数据库 URL。
LABELHUB_SEED_MODE=disposable python3 scripts/local-compose.py --profile tools run --rm seed
# api 服务不默认继承测试授权，单次命令明确传入。
python3 scripts/local-compose.py run --rm -e LABELHUB_SEED_MODE=disposable api python scripts/seed_competition.py
```

生产部署必须先单独运行迁移，禁止运行任何 seed。Windows 保留数据环境使用下述运维入口，不执行这里的重建命令。

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
python3 scripts/local-compose.py up -d mysql redis api worker scheduler --build --wait
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
python3 scripts/local-compose.py -f docker-compose.yml -f docker-compose.dev.yml up -d mysql redis
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
python3 scripts/local-compose.py -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
python3 scripts/local-compose.py run --rm api python scripts/seed.py
cd apps/api
DATABASE_URL=mysql+pymysql://labelhub:labelhub@127.0.0.1:3306/labelhub \
E2E_BASE=http://127.0.0.1:3000/api/v1 \
  .venv/bin/python -m pytest -m integration -v
cd ../..
```

真实后端 E2E：

```bash
npm --prefix apps/web exec playwright install chromium
python3 scripts/local-compose.py up -d --build --wait
python3 scripts/local-compose.py --profile tools run --rm seed
npm --prefix apps/web run e2e
```

当前套件包含三角色、迁移治理、运行诊断与响应式真实后端场景；带日期的测试数量与结果统一见 [项目状态](PROJECT_STATUS.md)。

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

## 8. Windows 保留数据日常运维

已有容器部署完成后登记一次，随后无需激活 `.cache` 下的旧 Compose 配置。入口只需 Python 3.11+；
优先使用 `apps/api/.venv`，也支持 PATH 中的 Python。它固定 Docker 引擎、容器完整 ID、镜像、
配置摘要、网络和挂载；登记时从运行中的 API 核实实际 MySQL UUID/库名与 Redis 身份。
API/worker/scheduler 必须指向相同数据库和 Redis。项目名称由操作者按实际环境填写：

```powershell
.\scripts\windows-ops.ps1 register --app-project <当前应用项目> --infra-project <基础服务项目> --docker-disk <Docker数据VHDX绝对路径>
.\scripts\windows-ops.ps1 status
.\scripts\windows-ops.ps1 stop
.\scripts\windows-ops.ps1 start
.\scripts\windows-ops.ps1 backup --destination D:\LabelHub-backups\daily-<唯一时间戳>
.\scripts\windows-ops.ps1 verify-backup D:\LabelHub-backups\daily-<唯一时间戳>
```

跨平台等价入口为 `npm run ops -- <命令>` 或 `python scripts/local_ops.py <命令>`。
默认登记文件 `.local/operations.json` 已同时排除出 Git 和 Docker 构建上下文。
指定其他配置需把 `--profile <文件>` 放在子命令之前；已有配置拒绝覆盖，合法升级后须核实并另存新配置。
同一工作区的启停、登记和备份使用系统文件锁互斥，进程退出自动释放；备份期间不要使用其他工具手动启动写入服务。
日常 `start/stop` 只作用于登记 ID，不使用 Compose 环境变量、不创建/重建/删除容器或卷；
启动等待健康检查，未配置健康检查的监控服务只确认进程运行，其端点仍需按监控文档验证。
发现未登记的同网络运行容器或共享卷写入者时，启动和备份会拒绝，以防旧 worker 同时运行。
`stop/status` 不受低空间阻断；启动与备份继续执行原有 10 GiB 启动、3 GiB 运行时容量门禁。
恢复启动若被低空间阻断会明确报错，排除空间问题后执行 `start`，不得绕过保护。

本机备份要求 API/MySQL 正在运行以验证目标，目标必须是仓库外本地**新目录**，禁止覆盖及目录联接。
Windows ACL 只授权当前用户和 SYSTEM；Unix 使用 0700。备份会短暂停止应用、Redis 和监控，
等待 worker 正常退出（不强杀），保留 MySQL 运行，生成一致性 SQL、文件/Redis/监控卷归档、
绑定配置和容器恢复元数据，逐文件完整回读 SHA-256 后才发布成功清单；最后恢复原先运行的服务。
失败目录保留，不自动删除；没有有效 `manifest.json` 的目录不得作为完整备份使用。
备份可能含数据库密码、JWT 密钥和用户数据，必须留在私有目录，禁止上传 Git 或公开分享。

此入口的 `verify-backup` 只证明字节完整性；恢复仍须在全新隔离库/卷演练，不能向业务库自动覆盖恢复。
SQL 不包含 MySQL 系统账号或 binlog/PITR，数据目录不做在线物理拷贝；历史日志需另行按需留存。
同盘备份不提供物理介质损坏保障，不能称作异盘备份；Windows 异盘识别仍保持原有拒绝策略。
旧镜像中的 seed 不会因主机脚本更新自动改变，禁止对保留的旧镜像运行 seed/clean；只使用这些日常命令。

## 9. 隔离开发环境的停止、清理与重建

以下仅适用于自行创建的可丢弃开发环境，不适用于需保留容器的 Windows 业务环境。
仅停止并保留容器、数据库和文件：

```bash
python3 scripts/local-compose.py stop
```

删除 Compose 容器、数据库、Redis 和上传文件卷（不可恢复）：

```bash
python3 scripts/local-compose.py down -v
```

仅重建应用镜像：

```bash
python3 scripts/local-compose.py build api web
python3 scripts/local-compose.py up -d api worker scheduler web --wait
```

若只替换 API 容器后 Web 返回 502，而 API 健康检查正常，Nginx 可能仍缓存旧的容器地址；
执行 `python3 scripts/local-compose.py restart web` 后，再检查 Web 代理的 `/api/v1/health`。

查看状态与日志：

```bash
python3 scripts/local-compose.py ps
python3 scripts/local-compose.py logs --tail=200 api worker scheduler web
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
| Web 502 | `python3 scripts/local-compose.py ps api`，再查 `python3 scripts/local-compose.py logs api` |
| API unhealthy | 健康探针会同时检查 API、MySQL、Redis；按日志中的失败依赖排查 |
| 页面 `/api` 404 | Mock 模式确认 `VITE_ENABLE_MSW=true`；真实模式确认 Nginx / Vite 代理 |
| Pages 演示登录返回 405 | 确认 `mockServiceWorker.js` 与 `msw` 版本一致；已打开的旧页面应在 worker 更新后自动刷新一次 |
| 数据表不存在 | 执行 `python3 scripts/local-compose.py run --rm api alembic upgrade head` |
| Worker 不消费任务 | 检查 Worker health、Redis URL、队列名和 `DOUBAO_*` |
| 宿主无法连 MySQL / Redis | 默认是安全行为；确有需要时叠加 `docker-compose.dev.yml` |
| production 启动失败 | 按 `environment-variables.md` 检查弱 JWT、默认数据库密码、Demo 模式和 Trusted Hosts |

## 11. 迁移治理与监控扩展

本轮升级新增 Alembic revision `f6a7b8c9d0e1`，API 镜像内包含从共享包构建的 Node 迁移引擎。
升级前备份数据库；先运行迁移，再启动新版 API、worker 和 scheduler。迁移执行使用 maintenance 队列，
scheduler 每分钟重投尚未执行的任务。禁止通过删除迁移表或覆盖历史答卷回退业务状态。

任务授权、独立审批、结果检查与失败恢复见 [GOVERNANCE.md](GOVERNANCE.md)。
Prometheus / Alertmanager / Grafana 使用独立 overlay 和凭据文件，启动及验收命令见
[OBSERVABILITY.md](OBSERVABILITY.md)；默认只部署本机监控，不发送外部通知。

## 12. 本机存储保护

上述 Compose 命令从仓库根运行，经过容量保护入口。macOS 需 Python 3.9+；原生 Linux 需能够读取 Docker 数据目录。写入操作启动前要求至少 10 GiB 可用空间，执行中低于 3 GiB 时取消本次命令；只读与停止操作仍可使用。远程 Docker 不接受本地空间替代检查。

详细边界、自定义磁盘位置和异盘备份见 [本地存储维护](LOCAL_STORAGE_MAINTENANCE.md)。
