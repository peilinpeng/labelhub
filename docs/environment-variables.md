# LabelHub 环境变量清单

本文是运行时配置的权威清单。根目录 `.env.example` 面向 Docker Compose；
`apps/api/.env.example` 面向直接运行 Python 服务。真实密钥只能保存在未跟踪的
`.env`、部署平台 Secret 或密钥管理服务中。

敏感等级：`公开` 可进入构建日志；`内部` 不应公开但不是凭据；`敏感` 必须按密钥
处理。生产环境还会由 `apps/api/app/config.py` 执行启动期安全校验。

## 应用运行时

| 变量 | 必填 | 默认值 | 敏感等级 | 使用方与说明 |
| --- | --- | --- | --- | --- |
| `APP_ENV` | 生产必填 | `demo`（Compose） | 公开 | API / Worker；可选 `development/test/demo/production` |
| `DEMO_MODE` | 否 | `true`（Compose） | 公开 | API / Worker 与 Web 构建；生产必须为 `false` |
| `DATABASE_URL` | 是 | 本地 Compose MySQL URL | 敏感 | API / Worker / migration / seed；生产密码不得使用默认值 |
| `REDIS_URL` | 是 | `redis://redis:6379` | 敏感 | Celery broker/backend 与分布式登录限流 |
| `JWT_SECRET` | 是 | 仅本地弱值 | 敏感 | JWT HS256 签名；生产至少 32 字符随机值 |
| `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` | 否 | `10080` | 内部 | Token 有效期；生产建议 15～60 分钟 |
| `LOGIN_RATE_LIMIT_BACKEND` | 否 | `memory` | 公开 | `memory/redis`；生产强制 `redis` |
| `LOGIN_RATE_LIMIT_ATTEMPTS` | 否 | `5` | 内部 | 限流窗口内允许的失败次数 |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | 否 | `300` | 内部 | 登录限流窗口 |
| `TRUSTED_HOSTS` | 否 | `localhost,127.0.0.1,testserver,api` | 内部 | 逗号分隔；生产禁止通配符 |
| `ENABLE_HSTS` | 否 | `false` | 公开 | 生产或显式开启时添加 HSTS |

## AI 与文件

| 变量 | 必填 | 默认值 | 敏感等级 | 使用方与说明 |
| --- | --- | --- | --- | --- |
| `DOUBAO_API_KEY` | 使用真实 AI 时必填 | 空 | 敏感 | OpenAI 兼容客户端凭据 |
| `DOUBAO_BASE_URL` | 否 | 豆包北京端点 | 内部 | OpenAI 兼容 API 地址 |
| `DOUBAO_MODEL` | 使用真实 AI 时必填 | 空 | 内部 | 模型接入点 ID |
| `AI_REVIEW_CONFIDENCE_THRESHOLD` | 否 | `0.6` | 内部 | 低于阈值的 AI PASS 转人工 |
| `FILE_STORAGE_DRIVER` | 否 | `local` | 公开 | 当前支持 `local` |
| `LOCAL_STORAGE_DIR` | 否 | `/data/files`（Compose） | 内部 | API / Worker 共享持久化卷路径 |
| `MAX_UPLOAD_SIZE_BYTES` | 否 | `20971520` | 公开 | 上传硬上限，同时与 Nginx 20 MiB 限制对齐 |
| `FILE_ALLOWED_EXTENSIONS` | 否 | 见 `.env.example` | 公开 | 逗号分隔扩展名白名单 |
| `FILE_ALLOWED_MIME_TYPES` | 否 | 见 `.env.example` | 公开 | 逗号分隔 MIME 白名单 |

## Compose 与基础设施

| 变量 | 必填 | 默认值 | 敏感等级 | 使用方与说明 |
| --- | --- | --- | --- | --- |
| `MYSQL_ROOT_PASSWORD` | 内置 MySQL 时必填 | `root` | 敏感 | 仅本地默认值；生产必须替换 |
| `MYSQL_DATABASE` | 否 | `labelhub` | 内部 | 内置 MySQL 初始化库名 |
| `MYSQL_USER` | 否 | `labelhub` | 内部 | 内置 MySQL 初始化用户 |
| `MYSQL_PASSWORD` | 内置 MySQL 时必填 | `labelhub` | 敏感 | 必须与 `DATABASE_URL` 一致 |
| `LABELHUB_SEED_MODE` | 否 | `initialize` | 公开 | 仅 seed 服务；默认拒绝已有数据，`disposable` 仅能在空库登记后允许重复播种，不能解除持久库保护 |
| `LABELHUB_IMAGE_TAG` | 否 | `local` | 公开 | API / Worker / Web 镜像标签 |
| `WEB_PORT` | 否 | `5173` | 公开 | Web 对宿主发布端口 |
| `API_PORT` | 否 | `3000` | 公开 | API 对宿主发布端口 |
| `MYSQL_PORT` | 否 | `3306` | 公开 | 仅显式叠加 `docker-compose.dev.yml` 时生效 |
| `REDIS_PORT` | 否 | `6379` | 公开 | 仅显式叠加 `docker-compose.dev.yml` 时生效 |

## 治理与监控

| 变量 | 必填 | 默认值 | 敏感等级 | 使用方与说明 |
| --- | --- | --- | --- | --- |
| `NODE_BINARY` | 否 | `node` | 内部 | API / worker 的共享迁移引擎；需 Node 26，Docker 已内置 |
| `METRICS_TOKEN` | 否 | 空 | 敏感 | API 指标专用 Bearer token；空值不开放匿名抓取 |
| `METRICS_TOKEN_FILE` | 监控 overlay 必填 | 空 | 敏感文件路径 | Compose 读取宿主文件并挂载为 secret；API 读取容器路径，优先于 `METRICS_TOKEN` |
| `GRAFANA_PASSWORD_FILE` | 监控 overlay 必填 | 空 | 敏感文件路径 | Grafana admin 密码来源，文件必须存在且可被容器用户读取 |
| `PROMETHEUS_PORT` | 否 | `9090` | 公开 | 仅绑定 127.0.0.1 |
| `ALERTMANAGER_PORT` | 否 | `9093` | 公开 | 仅绑定 127.0.0.1 |
| `GRAFANA_PORT` | 否 | `3001` | 公开 | 仅绑定 127.0.0.1 |

自定义监控端口后，验收脚本可使用 `MONITOR_API_URL`、`MONITOR_PROMETHEUS_URL`、
`MONITOR_GRAFANA_URL`、`MONITOR_ALERTMANAGER_URL` 指定对应地址。凭据不写入命令输出。
完整部署与故障处置见 [OBSERVABILITY.md](OBSERVABILITY.md)。

## Web 构建与本地开发

| 变量 | 必填 | 默认值 | 敏感等级 | 使用方与说明 |
| --- | --- | --- | --- | --- |
| `VITE_ENABLE_MSW` | 否 | `false` | 公开 | 仅 Vite 构建 / dev 读取；生产镜像固定为 `false` |
| `VITE_DEMO_MODE` | 否 | `false` | 公开 | 控制登录页演示账号提示；Compose 从 `DEMO_MODE` 构建参数映射 |
| `VITE_API_BASE_URL` | 否 | 空（同源） | 公开 | 仅 GitHub Pages 等子路径 Mock 构建用于添加请求前缀；Docker / Vite 本地模式保持为空 |
| `VITE_PROXY_TARGET` | 否 | `http://localhost:3000` | 内部 | 仅 Vite dev server 的 `/api` 代理使用 |

常规前端请求使用同源 `/api/v1/*`：生产环境由 Nginx、开发环境由 Vite 代理
`/api`。只有部署到 GitHub Pages 子路径的纯 Mock 构建设置 `VITE_API_BASE_URL`，例如
`/labelhub`；它不用于真实 API 地址或 Docker Compose 配置。

## 生产最小安全配置

```dotenv
APP_ENV=production
DEMO_MODE=false
DATABASE_URL=mysql+pymysql://<user>:<strong-password>@<host>:3306/<database>
REDIS_URL=redis://:<strong-password>@<host>:6379/0
JWT_SECRET=<至少32字符随机值>
LOGIN_RATE_LIMIT_BACKEND=redis
TRUSTED_HOSTS=api.example.com
ENABLE_HSTS=true
DOUBAO_API_KEY=<secret>
DOUBAO_MODEL=<model-id>
```

## 本机容量保护

`LABELHUB_DOCKER_DISK_PATH` 仅由宿主 `scripts/local-compose.py` 读取，用于 macOS Docker Desktop
自定义磁盘路径；默认检查用户目录下 Docker Desktop 标准 `Docker.raw`。它不注入业务容器，不包含凭据。
启动门槛 10 GiB、运行取消门槛 3 GiB 固定在维护脚本中，不提供调低阈值绕过保护的环境变量。
详见 [本地存储维护](LOCAL_STORAGE_MAINTENANCE.md)。
