# LabelHub 后端优化计划 + 测试方案

## Context

前后端已在 `integration/joint-test` 分支完成首轮联调，E2E 主流程 16 步跑通。
经对照搭档的测试清单（`docs/test-cases.md`）和技术挑战四象限审计，后端**核心能力已基本完整**：
状态机/事务一致性/幂等并发/审计日志全部到位，Schema 版本管理、AI Worker 重试兜底也已实现。

剩余问题集中在三类：
1. **少数接口缺口** —— 阻塞前端 Labeler 工作台和 Reviewer 筛选的真实对接；
2. **AI 可追溯性未对外暴露** —— TC-AI-07 要求展示 Prompt/Token/模型 ID，数据部分存在但无接口、且 Token 完全没统计；
3. **零自动化测试 / 无 CI / 无 API 文档导出** —— 工程化提交物缺失（对应 `docs/test-cases.md` 第六、七节）。

本计划目标：补齐接口缺口 → 增强 AI 可追溯 → 建立测试金字塔与工程化交付物，使测试清单中的后端相关用例全部可验证。

> 文件边界：仅改 `apps/api/`（遵守 CLAUDE.md）。不动 `apps/web/`、`packages/contracts/`、契约文档。

---

## Part A — 接口缺口补齐（阻塞前端，最高优先）

### A1. `GET /api/v1/assignments/{assignment_id}/items`（TC-ANS-06 题目导航）
- **改**：`app/routers/assignments.py` 新增路由；`app/services/assignment_domain.py` 新增 `list_assignment_items()`
- **逻辑**：由 `assignment_id` → `task_id` → 查 `DatasetItem`（复用 `dataset_domain` 已有查询模式），标记当前 assignment 绑定 item 的 `currentIndex`
- **响应**（对齐前端 `apps/web/src/api/labeler.ts` 的 `listAssignmentItems` 期望）：
  ```json
  { "items": [DatasetItem...], "total": N, "currentIndex": 0 }
  ```
- 权限：`require_roles("LABELER","OWNER","ADMIN")`，并校验 assignment 归属当前 labeler

### A2. `POST /api/v1/assignments/{assignment_id}/llm-assist`（TC-ANS-05 / TC-DES-06 LLM 辅助）
- **改**：`app/routers/assignments.py` 新增路由；`app/services/assignment_domain.py` 新增 `llm_assist()`
- **请求**：`{ nodeId: str, answers: dict }`；**响应**：契约 `LLMRuntimeResponse`
- **复用**：`app/worker/ai_review_worker.py` 已有的 `from openai import OpenAI` 调用范式 + `LLMCallLog` 写入逻辑，抽出共用 helper（见 B1）
- 写一条 `LLMCallLog`（`purpose="ASSIST"`, 关联 `assignment_id` / `node_id`）
- **超时与耗时反馈**：
  - 大模型调用须设置 `timeout=30s`，避免前端长时间挂起（超时按失败处理并返回明确错误码）
  - 响应体须返回 `latency_ms` 字段（记录本次调用实际耗时），前端据此显示 loading 状态/超时提示

### A3. `GET /api/v1/review/queue` 增加 `?status=` 过滤（TC-REV-05~08 Tab 筛选）
- **改**：`app/routers/review.py` 的 `get_review_queue()` 增 `status: str | None = Query(None)`；`app/services/review_domain.py` 的 `get_review_queue()` 接收并下推到 query filter
- 前端已发 `?status=NEEDS_HUMAN_REVIEW|ACCEPTED|RETURNED`，后端目前**静默忽略**

### A4. `GET /api/v1/marketplace/tasks` 增加搜索/筛选（TC-LBL-02）
- **改**：`app/routers/marketplace.py` 增 `keyword: str | None`、`status: str | None` Query 参数，下推到 service 层 `ilike` 标题/描述匹配

---

## Part B — AI 可追溯性增强（TC-AI-07）

### B1. `LLMCallLog` 增加 Token 统计字段
- **改**：`app/models/llm.py` 增列 `prompt_tokens`、`completion_tokens`、`total_tokens`、`latency_ms`（均 nullable）
- **迁移**：新增 Alembic migration（项目已用 alembic）
  - ⚠️ **安全检查**：执行 `alembic revision --autogenerate` 后，**必须人工审查**生成的 migration 文件
  - 确认操作类型为 `op.add_column(...)`，**而非** `drop_table` + `create_table`（autogenerate 有时会误判为重建表）
  - 若发现重建表操作，手动改写为 `ALTER TABLE ... ADD COLUMN`（即仅保留 `add_column`），防止生产数据被清空
- **写入**：`app/worker/ai_review_worker.py` 调用 OpenAI 后从 `response.usage` 落库；A2 的 assist 调用同样落库

### B2. 审核详情暴露 AI 原始信息
- **改**：`app/schemas/review.py` 的 `ReviewDetailResponse`（或 `aiResult` 字段）补充 `promptSnapshotHash`、`modelPolicyId`、`tokenUsage`、`modelId`
- **来源**：`get_review_detail()`（`app/services/review_domain.py`）联查该 submission 的 `LLMCallLog`（`purpose="AI_PRECHECK"`），随 `aiResult` 一并返回
- 评分维度/理由已在 `aiResult.resultJson` 中，无需改动

---

## Part C — 工程化交付物（docs/test-cases.md 第六、七节）

### C1. API 文档导出
- FastAPI 自带 `/openapi.json` + `/docs`。新增脚本 `apps/api/scripts/export_openapi.py` 导出静态 `apps/api/openapi.json`，供 Postman/Apifox 导入（满足"API/契约文档"提交项）
- ⚠️ **不能用 curl 调用运行中的服务**——CI 环境没有运行中的服务器。正确方式是**直接调用 `app.openapi()`** 在内存中生成 schema：
  ```python
  from app.main import app   # 注意 main.py 在 apps/api 根目录，import 路径以实际为准
  import json

  schema = app.openapi()
  with open("openapi.json", "w", encoding="utf-8") as f:
      json.dump(schema, f, ensure_ascii=False, indent=2)
  ```

### C2. CI 工作流
- 新增 `.github/workflows/api-ci.yml`：装依赖 → `pytest` → 类型/lint（可选）。让 TC-QA-01/02 可持续验证

### C3. README 补充（可选，看时间）
- 在 `apps/api/README.md` 补：环境变量示例、本地一键启动、测试运行指引

### C4. 演示用 Seed 数据脚本
- 新建 `apps/api/scripts/seed_demo.py`（**独立文件，不覆盖现有 `seed.py`**），一键初始化路演/演示所需基础数据：
  - **三个角色账号**：`owner@labelhub.com` / `labeler@labelhub.com` / `reviewer@labelhub.com`，密码均为 `password123`
  - **一个已发布状态的任务**（含配额、分发策略）
  - **10 条测试题目**：从 `datasets/` 目录读取；若目录/文件不存在则回退生成 mock 数据
  - **一套标注模板 Schema**：`ShowItem` + 单选 + 多行文本
  - **一条审核规则配置**（`ReviewConfig`，含评分维度与通过/打回阈值）
- **可重复执行**：执行前先清空相关演示数据（按固定 ID 幂等 upsert / 先 delete 再 insert），重复运行不报错
- **与现有 seed.py 隔离**：项目已存在 `apps/api/scripts/seed.py`（E2E 用，账号 `*@labelhub.test` / `Seed@1234`），**保持不变**。本演示脚本为**独立的 `seed_demo.py`**，账号 `*@labelhub.com` / `password123`，两者互不覆盖，E2E 依赖的种子账号继续可用

---

## Part D — 测试方案（金字塔：单元 + 集成 + E2E）

### D1. pytest 基础设施（从零搭建）
- `requirements.txt` 增 `pytest`、`httpx`（FastAPI TestClient 依赖）、`faker`（可选）
- 新建 `apps/api/tests/conftest.py`：
  - **必须使用 SQLite in-memory**（`sqlite:///:memory:`）构造测试 `engine`，**不依赖运行中的 MySQL 实例**，确保 CI 环境可直接 `pytest` 运行
  - 覆盖 `get_db` 依赖注入：通过 `app.dependency_overrides[get_db] = ...` 注入测试 session
  - fixture：`client`（TestClient 包 `main.py` 的 `app`）、`db_session`、各角色已登录 token、seed 数据工厂
  - 注意：SQLite 与 MySQL 在 JSON 列/外键行为上有差异，建表用 `Base.metadata.create_all()`，必要时为 SQLite 开启 `PRAGMA foreign_keys=ON`

### D2. 单元测试（纯函数，快速、无 DB）—— TC-QA-02
- `tests/unit/test_state_machines.py`：覆盖 4 个 `app/state_machines/*.py` 的 `apply_transition`
  - 合法迁移路径 + 非法迁移抛错（task/submission/assignment/export 全状态矩阵）
- `tests/unit/test_schema_validate.py`：`schema_domain.validate_schema` 的节点校验/必填 name 校验

### D3. 集成测试（TestClient 打 API）—— 映射 TC-* 用例
| 测试文件 | 覆盖用例 |
|----------|---------|
| `test_task_lifecycle.py` | TC-TASK-01~06（建/编辑/发布/暂停/结束）+ 暂停后领取被拒 |
| `test_schema_version.py` | TC-DES-09 草稿保存、TC-DES-10 发布冻结、TC-DES-11 旧版本渲染兼容 |
| `test_assignment_flow.py` | TC-ANS-01~06（领取/草稿/提交/题目导航/llm-assist） |
| `test_review_flow.py` | TC-REV-05~10（复审通过/打回/批量/审计/就地修订）+ A3 status 过滤 |
| `test_rbac.py` | **TC-SEC-01 越权**：Labeler 打 Owner API 必须 403 |
| `test_concurrency.py` | **TC-QA-04 抢单幂等**：并发 claim 最后配额仅一人成功、不超卖（验证 `with_for_update(skip_locked=True)`） |
| `test_export.py` | TC-EXP-01~04 导出任务创建/字段映射/含审核记录 |

> ⚠️ **`test_concurrency.py` 必须独立运行**：SQLite in-memory **不支持真正的行锁并发**，无法验证 `with_for_update`。
> 因此该文件标记 `@pytest.mark.integration`，**CI 默认跳过**（`pytest -m "not integration"`）。
> 需连真实 MySQL 时本地手动运行：`pytest -m integration`（需先 `docker compose up -d` 起 MySQL）。
> 在 `pytest.ini` / `pyproject.toml` 注册 `integration` marker 以免告警。

### D4. E2E 脚本扩展 —— `apps/api/scripts/e2e_test.sh`
在现有 16 步基础上追加端到端场景（bash+curl）：
- **打回重审闭环**（TC-FULL-02）：reviewer RETURN → labeler 重新提交 → 二次 PASS → 导出仅含最新版本
- **暂停拦截**（TC-TASK-05）：发布后暂停 → labeler 领取返回业务错误
- **越权 403**（TC-SEC-01）：用 labeler token 打 `POST /tasks` 断言 403
- **AI 可追溯**（TC-AI-07）：审核详情接口断言返回含 token/modelId 字段

---

## 关键文件清单

**接口缺口（Part A）**
- `apps/api/app/routers/assignments.py`（+items, +llm-assist）
- `apps/api/app/services/assignment_domain.py`（+list_assignment_items, +llm_assist）
- `apps/api/app/routers/review.py` + `app/services/review_domain.py`（status 过滤）
- `apps/api/app/routers/marketplace.py`（keyword/status 过滤）

**AI 可追溯（Part B）**
- `apps/api/app/models/llm.py`（+token 列）+ 新 alembic migration
- `apps/api/app/worker/ai_review_worker.py`（写 token）
- `apps/api/app/schemas/review.py` + `app/services/review_domain.py`（暴露 trace）

**工程化 + 测试（Part C/D）**
- `apps/api/scripts/export_openapi.py`（新，调用 `app.openapi()` 生成 `apps/api/openapi.json`）
- `apps/api/scripts/seed_demo.py`（新增独立演示 seed，**不动现有 `seed.py`**）
- `.github/workflows/api-ci.yml`（新，运行 `pytest -m "not integration"`）
- `apps/api/tests/`（新：conftest + unit + integration，conftest 用 SQLite in-memory）
- `apps/api/pytest.ini` 或 `pyproject.toml`（注册 `integration` marker）
- `apps/api/requirements.txt`（+pytest, httpx）
- `apps/api/scripts/e2e_test.sh`（扩展）

---

## 验证方式

```bash
# 1. 单元 + 集成测试（CI 同款，SQLite in-memory，无需 MySQL）
cd apps/api && pytest -m "not integration" -v

# 1b. 并发/行锁测试（需真实 MySQL，本地手动跑）
docker compose up -d
pytest -m integration -v

# 2. 端到端冒烟（需后端 + DB 运行）
docker compose up -d
bash apps/api/scripts/e2e_test.sh        # 应全部 PASS

# 3. 新接口手验
#   GET  /api/v1/assignments/{id}/items
#   POST /api/v1/assignments/{id}/llm-assist   # 响应含 latency_ms
#   GET  /api/v1/review/queue?status=NEEDS_HUMAN_REVIEW
#   GET  /api/v1/marketplace/tasks?keyword=新闻

# 4. API 文档导出（内存生成，无需起服务）
python apps/api/scripts/export_openapi.py  # 生成 apps/api/openapi.json

# 5. 演示数据初始化（可重复执行，独立于 E2E 的 seed.py）
python apps/api/scripts/seed_demo.py       # 账号 *@labelhub.com / password123
```

---

## 建议执行顺序

1. **Part A**（接口缺口）—— 解锁前端真实对接，搭档可立即并行改 UI
2. **Part D1~D3**（pytest 基础设施 + 单元/集成）—— 为后续改动建立回归网
3. **Part B**（AI 可追溯）—— 补 TC-AI-07
4. **Part D4**（E2E 扩展）+ **Part C**（CI / OpenAPI 导出）—— 工程化收尾
