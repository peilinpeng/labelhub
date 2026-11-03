# LabelHub API（后端）

Python 3.11 + FastAPI + SQLAlchemy + Celery + Redis + MySQL。
数据标注平台后端，覆盖「数据生产 → AI 预审 → 人工审核 → 导出」全生命周期。

## 目录结构

```
apps/api/
├── main.py                 # FastAPI 入口（app 实例 + 路由注册）
├── app/
│   ├── config.py           # 环境变量配置（pydantic-settings）
│   ├── database.py         # SQLAlchemy engine / SessionLocal / get_db
│   ├── middleware/         # 鉴权 / 幂等 / 全局异常处理
│   ├── models/             # ORM 模型
│   ├── schemas/            # Pydantic 请求/响应模型
│   ├── routers/            # REST 路由（/api/v1/*）
│   ├── services/           # 领域逻辑（*_domain.py）
│   ├── state_machines/     # 任务/提交/作答/导出 状态机
│   └── worker/             # Celery worker（AI 预审）
├── alembic/                # 数据库迁移
├── scripts/                # seed / e2e / openapi 导出
├── requirements.in         # 生产直接依赖
├── requirements.txt        # 生产完整依赖锁（含 SHA-256）
├── requirements-dev.txt    # 测试完整依赖锁（含 SHA-256）
└── tests/                  # pytest 单元 + 集成测试
```

## 环境变量

直接运行 API 时复制本目录 `.env.example` 为 `.env`；Compose 使用仓库根
`.env.example`。权威清单见 `docs/environment-variables.md`。

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | MySQL 连接串，如 `mysql+pymysql://labelhub:labelhub@mysql:3306/labelhub` |
| `REDIS_URL` | Redis（Celery broker + backend），如 `redis://redis:6379` |
| `DOUBAO_API_KEY` / `DOUBAO_BASE_URL` / `DOUBAO_MODEL` | 豆包（OpenAI 兼容）大模型配置 |
| `JWT_SECRET` | JWT 签名密钥（生产务必替换为高强度随机值） |
| `FILE_STORAGE_DRIVER` / `LOCAL_STORAGE_DIR` | 文件存储驱动与本地目录 |

## 本地一键启动（推荐 Docker）

```bash
# 仓库根目录
docker compose build api
docker compose up -d mysql redis --wait
docker compose --profile tools run --rm seed
docker compose up -d api worker scheduler web --wait
```

> **改动后端代码后需重建镜像**：服务运行自镜像内 `/app`（无源码挂载、无
> `--reload`）。API、Worker、Scheduler 复用同一镜像：
> `docker compose build api && docker compose up -d api worker scheduler`。

健康检查：`curl http://localhost:3000/api/v1/health`

## 测试账号

| 来源 | 账号 | 密码 |
|------|------|------|
| `scripts/seed.py`（E2E 用） | `owner@labelhub.test` / `labeler@labelhub.test` / `reviewer@labelhub.test` / `admin@labelhub.test` | `Seed@1234` |
| `scripts/seed_demo.py`（演示用） | `owner@labelhub.com` / `labeler@labelhub.com` / `reviewer@labelhub.com` | `password123` |

`seed_demo.py` 还会创建一个已发布的演示任务（含 Schema + 10 题 + ReviewConfig），可重复执行。

## 密码哈希迁移

- 新账号与 Seed 统一使用 pwdlib 的 Argon2id 推荐参数，不再生成 bcrypt 哈希。
- 历史 bcrypt 哈希仍可登录；账号状态正常且密码验证成功后，会在同一事务中渐进重哈希为
  Argon2id，无需批量读取明文或强制用户重置密码。
- 未知邮箱仍执行一次 dummy Argon2 验证，降低通过响应耗时枚举账号的风险；未知或损坏的
  哈希统一按认证失败处理，不向客户端暴露存储状态。

## 迁移治理与监控

历史迁移需要新增 Alembic revision `f6a7b8c9d0e1`、共享迁移引擎和 maintenance worker 队列。
Docker 镜像自动构建引擎；本地运行 API 前，在仓库根目录安装 npm 依赖并执行 `npm run build:migration-engine`，
确保 Node 26 位于 PATH。审批与任务权限见 [治理说明](../../docs/GOVERNANCE.md)，
就绪探针、受保护指标和 Compose 监控方案见 [监控运维](../../docs/OBSERVABILITY.md)。

## 运行测试

```bash
# 全新 Python 3.11 环境按哈希锁安装（生产镜像不包含 pytest）
python3.11 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt

# 先在仓库根目录运行 npm ci && npm run build:migration-engine，再返回 apps/api
# 单元 + SQLite 集成测试（CI 同款）
.venv/bin/python -m pytest -m "not integration" -v

# 并发/行锁测试（先从仓库根叠加 dev override、运行 scripts/seed.py）
DATABASE_URL=mysql+pymysql://labelhub:labelhub@127.0.0.1:3306/labelhub \
E2E_BASE=http://127.0.0.1:3000/api/v1 \
  .venv/bin/python -m pytest -m integration -v

# 端到端冒烟（需后端 + DB 运行）
bash scripts/e2e_test.sh
```

使用 `seed_e2e.py` 的 `.com` 演示账号运行并发测试时，额外设置 `E2E_EMAIL_DOMAIN=labelhub.com` 和
`E2E_PASSWORD=password123`；CI 已自动传入并验证真实 MySQL。

CI 还会使用 `pip-audit` 扫描 `requirements.txt`，发现已知漏洞即失败。

## 其他脚本

```bash
python scripts/export_openapi.py   # 导出 openapi.json（供 Postman/Apifox 导入）
python scripts/seed_demo.py        # 初始化演示数据
```

## API 文档

服务运行后访问交互式文档：

- Swagger UI：http://localhost:3000/docs
- OpenAPI JSON：http://localhost:3000/openapi.json（或离线 `scripts/export_openapi.py` 生成的 `openapi.json`）
