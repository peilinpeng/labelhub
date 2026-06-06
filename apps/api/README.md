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
└── tests/                  # pytest 单元 + 集成测试
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

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
docker compose up -d            # 启动 mysql / redis / api / worker / web
docker compose exec -w /workspace/apps/api api alembic upgrade head   # 应用迁移
docker compose exec -w /workspace/apps/api api python scripts/seed.py # 测试账号
```

> ⚠️ **改动后端代码后需重建镜像**：服务运行自镜像内 `/app`（无 `--reload`），
> `.:/workspace` 挂载不影响运行进程。
> 执行：`docker compose build api worker && docker compose up -d api worker`

健康检查：`curl http://localhost:3000/api/v1/health`

## 测试账号

| 来源 | 账号 | 密码 |
|------|------|------|
| `scripts/seed.py`（E2E 用） | `owner@labelhub.test` / `labeler@labelhub.test` / `reviewer@labelhub.test` / `admin@labelhub.test` | `Seed@1234` |
| `scripts/seed_demo.py`（演示用） | `owner@labelhub.com` / `labeler@labelhub.com` / `reviewer@labelhub.com` | `password123` |

`seed_demo.py` 还会创建一个已发布的演示任务（含 Schema + 10 题 + ReviewConfig），可重复执行。

## 运行测试

```bash
# 单元 + 集成（SQLite in-memory，无需 MySQL/Redis；CI 同款）
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -v

# 并发/行锁测试（需真实 MySQL，本地手动）
docker compose exec -w /workspace/apps/api api pytest -m integration -v

# 端到端冒烟（需后端 + DB 运行）
bash scripts/e2e_test.sh
```

## 其他脚本

```bash
python scripts/export_openapi.py   # 导出 openapi.json（供 Postman/Apifox 导入）
python scripts/seed_demo.py        # 初始化演示数据
```

## API 文档

服务运行后访问交互式文档：

- Swagger UI：http://localhost:3000/docs
- OpenAPI JSON：http://localhost:3000/openapi.json（或离线 `scripts/export_openapi.py` 生成的 `openapi.json`）
