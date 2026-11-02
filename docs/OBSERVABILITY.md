# 运行监控与故障处置

本方案部署在当前 Compose 栈内，不依赖外部云账号。Prometheus、Alertmanager、Grafana 只绑定本机回环地址；
远程访问使用 SSH 隧道或组织已有的受认证入口。默认告警在 Alertmanager 展示，尚未配置外部收件人。

## 启动

先按部署文档准备 API、MySQL、Redis 的生产配置。创建两个不纳入 Git 的凭据文件：一个随机监控 token，
一个 Grafana 管理密码。文件需可被容器中非 root 用户读取；生产环境使用组织的 secret 分发机制。

```bash
export METRICS_TOKEN_FILE=/absolute/private/metrics-token
export GRAFANA_PASSWORD_FILE=/absolute/private/grafana-password
export COMPOSE_FILE=docker-compose.yml:docker-compose.monitoring.yml
docker compose up -d --build --wait
# 新数据库或版本升级必须执行迁移；生产环境不要运行 demo seed。
docker compose exec -T api alembic upgrade head
python scripts/verify-monitoring.py
```

- Prometheus：`http://localhost:9090`；Grafana：`http://localhost:3001`（用户 admin，密码来自文件）。
- Alertmanager：`http://localhost:9093`。需要邮件/Webhook 时修改 `monitoring/alertmanager.yml`，通过 secret 引用真实渠道；
  配置后先运行 `amtool check-config`，再发送组织允许的测试告警。
- `GET /api/v1/health` 检查进程存活；`GET /api/v1/ready` 检查 MySQL 与 Redis，失败返回 503。
- `GET /api/v1/metrics` 需要监控 Bearer token 或有效 ADMIN；未配置 token 时不会匿名开放。
- 默认 API 为单 Uvicorn 进程。横向扩容应让 Prometheus 独立抓取各实例再聚合；不能把多个进程的内存计数当成单一累计计数。

## 指标与日志

请求量与延迟仅以路由模板、方法、状态码分组；404 合并为 unmatched。后台任务仅按种类、状态分组。
不以任务或用户 ID 作为标签。结构化请求日志包含 requestId、method、route、status、durationMs；默认容器关闭
Uvicorn 的原始 URL access log。应用业务日志仍应遵守不记录答案、prompt、模型输出和凭据的规则。

Grafana 自动加载六个面板：请求速率、P95、依赖可用性、任务状态、队列年龄、HTTP 错误。
Prometheus 保留 15 天数据，使用独立持久卷；容量增长应通过保留时间或存储容量规划处理。

## 告警处置

| 告警 | 检查与恢复 |
| --- | --- |
| LabelHubUnavailable | 检查 API 健康、抓取凭据、内部 DNS 与网络；不要直接重置数据库 |
| LabelHubDependencyUnavailable | 检查 MySQL/Redis 健康、连接配置、磁盘及连接数，恢复后确认 ready=200 |
| LabelHubHighErrorRate / SlowRequests | 用 requestId 关联脱敏日志，检查数据库延迟和 worker 饱和；不可记录业务正文排障 |
| LabelHubQueueStalled | 检查 worker 的 maintenance/export/ai_review 队列以及 scheduler；迁移 QUEUED 由每分钟 outbox 重投 |
| LabelHubMigrationFailed | 在迁移工作台检查权限、审批摘要和执行失败状态；修复后重试；源数据冲突需创建新计划重新审批 |

迁移在事务中写入产物；worker 崩溃时整批回滚，已提交成功状态不会重复执行。不得手工改状态或修改原始答案来“恢复”。

CI 使用全新 Compose 卷验证健康、匿名拒绝、Prometheus 实际抓取、告警规则及 Grafana 面板。
`scripts/verify-monitoring.py` 只打印通过/失败，不输出凭据。外部通知渠道尚未被要求接入，不能把默认本地 receiver 当作已发送通知。

参考：[Prometheus 指标命名](https://prometheus.io/docs/practices/naming/)、[Celery 任务与幂等](https://docs.celeryq.dev/en/stable/userguide/tasks.html)。
