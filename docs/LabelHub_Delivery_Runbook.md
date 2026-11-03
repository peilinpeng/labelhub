# LabelHub 交付运行手册

> 当前权威运行手册。适用于新成员复现、验收和发布前自查；历史答辩脚本只作为归档。

## 1. 五分钟启动

```bash
git status --short
cp .env.example .env
python3 scripts/local-compose.py build --pull
python3 scripts/local-compose.py up -d mysql redis --wait
python3 scripts/local-compose.py --profile tools run --rm seed
python3 scripts/local-compose.py up -d --wait
python3 scripts/local-compose.py ps
```

打开 <http://localhost:5173/>。API health 为
<http://localhost:3000/api/v1/health>。

账号统一为：

```txt
owner@labelhub.com    / password123
labeler@labelhub.com  / password123
reviewer@labelhub.com / password123
```

## 2. 验收路线

1. Owner：创建 / 配置任务，导入数据，搭建 Schema，配置 AI 预审并发布。
2. Labeler：从任务市场领取一条数据，验证动态联动、自动保存和提交。
3. Reviewer：进入审核队列，验证 `PASS / RETURN / REVISE` 与字段 diff。
4. Owner：查看质量中心、审计时间线并生成导出。

## 3. 自动化验收

先运行 `npm run check:docs` 和 `npm run test:ops`。Docker 写入命令均经过容量门禁；完整容器验收可按 [CI 流程](../.github/workflows/web-e2e.yml) 在独立 Compose 项目执行，避免 seed 写入已有业务数据。

```bash
npm ci
npm run typecheck
npm test

npm --prefix apps/web ci
npm --prefix apps/web run typecheck
npm --prefix apps/web run test:coverage
npm --prefix apps/web run build:production
npm run build:migration-engine

cd apps/api
python3.11 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r requirements-dev.txt
.venv/bin/python -m pytest -m "not integration" -q
cd ../..

python3 scripts/local-compose.py up -d --build --wait
python3 scripts/local-compose.py --profile tools run --rm seed
npm --prefix apps/web run e2e
git diff --check
```

当前基线、测试数量和覆盖率统一见 [项目状态](PROJECT_STATUS.md)。

## 4. Mock 模式

没有 Docker 或只开发前端时：

```bash
npm ci
npm --prefix apps/web ci
VITE_ENABLE_MSW=true VITE_DEMO_MODE=true \
  npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5180
```

访问 <http://127.0.0.1:5180/>，使用 `*@labelhub.test / Seed@1234`。Mock 模式
不覆盖真实数据库、Celery、迁移与 API 契约，最终验收仍必须跑真实后端 E2E。

## 5. 迁移、Seed、停止和清理

```bash
# 仅迁移
python3 scripts/local-compose.py run --rm api alembic upgrade head

# 确定性 E2E seed（内含迁移和前置条件自检）
python3 scripts/local-compose.py --profile tools run --rm seed

# 可选竞赛数据
python3 scripts/local-compose.py run --rm api python scripts/seed_competition.py

# 停止并保留数据
python3 scripts/local-compose.py down

# 删除全部 Compose 数据卷；数据库和上传文件不可恢复
python3 scripts/local-compose.py down -v
```

生产环境禁止运行 seed。

## 6. 健康与安全自检

```bash
python3 scripts/local-compose.py ps
python3 scripts/local-compose.py exec -T api id -u
python3 scripts/local-compose.py exec -T worker id -u
python3 scripts/local-compose.py port mysql 3306
python3 scripts/local-compose.py port redis 6379
```

预期 API / Worker UID 均为 `10001`；最后两个命令默认没有输出。Web / API 的
Compose 状态应为 healthy。依赖与敏感配置要求见
[`environment-variables.md`](environment-variables.md)。

## 7. 故障排查

| 现象 | 处理 |
| --- | --- |
| Web 502 / 登录失败 | `python3 scripts/local-compose.py logs --tail=200 web api` |
| API unhealthy | 同时检查 MySQL、Redis、API 日志；健康探针覆盖三者 |
| 数据表不存在 | `python3 scripts/local-compose.py run --rm api alembic upgrade head` |
| Worker 无结果 | `python3 scripts/local-compose.py logs --tail=200 worker`，检查 Redis 与 `DOUBAO_*` |
| Mock 请求 404 | 使用 `VITE_ENABLE_MSW=true` 重启 Vite |
| MySQL / Redis 宿主端口不可达 | 默认不暴露；需要调试时叠加 `docker-compose.dev.yml` |
| production 启动期报配置错误 | 生产安全校验正在拒绝弱密钥、Demo 模式或默认数据库密码 |

更完整的部署、锁文件更新与生产说明见 [`deployment.md`](deployment.md)。

容量预检、同盘拒绝、备份校验与恢复演练见 [本地存储维护](LOCAL_STORAGE_MAINTENANCE.md)。
