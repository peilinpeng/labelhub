# LabelHub Demo Guide

## Owner mock demo 启动

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

注意：普通 `npm run dev` 不会启用 MSW，会把 `/api` 请求代理到 `localhost:3000`。

## Owner Schema Governance demo

### Demo A：安全发布

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_safe_publish/designer
```

预期结果：

- 发布前检查允许发布。
- 确认发布后成功跳转。
- Audit Timeline 显示 compatibility checked、publish requested、schema version published。

### Demo B：Breaking Change 阻断

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_breaking_change/designer
```

预期结果：

- 发布前检查显示 `FIELD_REMOVED`。
- 确认发布按钮禁用。
- Audit Timeline 显示 compatibility checked、publish blocked。

### Demo C：Deprecated 字段

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_deprecation/designer
```

预期结果：

- 发布前检查显示 deprecation warning。
- 勾选确认后可以发布。
- Audit Timeline 显示 compatibility checked、deprecation warning generated、publish requested、schema version published。

### Demo D：Migration Required

访问：

```txt
http://localhost:5180/owner/tasks/task_demo_schema_migration_required/designer
```

预期结果：

- 发布前检查显示 `FIELD_TYPE_CAST_REQUIRED`。
- 不需要后端 migration API。
- 不需要 mapping editor。
- Audit Timeline 至少显示 compatibility checked。

---

## 真实后端全链路 Demo（端到端数据质量故事，录屏用）

> 与上面的 MSW mock demo 不同：本节走**真实后端 + 真实 LLM**，用举办方真实数据，
> 串成 "结构可信 → 过程可信 → 数据可信" 的完整叙事（对应 Quality Layer demo 场景）。

### 0. 一次性准备

```bash
cd /Users/xiongweiluo/LabelHub_Coding/labelhub
# 1) 真实 DOUBAO key（根 .env 已配 DOUBAO_API_KEY / DOUBAO_MODEL / DOUBAO_BASE_URL）
# 2) 起服务（web 默认 MSW=false，走真实后端；Vite 代理 → api:3000）
docker compose build api worker && docker compose up -d
docker compose exec -w /workspace/apps/api api alembic upgrade head   # head=b2c3d4e5f6a7
# 3) 种数据：演示任务 + 举办方真实数据集（两个真实任务）
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
# 4)（可选）清理测试杂项任务，让任务市场干净
docker compose exec -w /workspace/apps/api api python scripts/clean_demo.py
```

访问 `http://localhost:5173/`，账号 `*@labelhub.com / password123`（owner / labeler / reviewer）。

### 1. 演示账号与任务

| 角色 | 账号 | 看点 |
|------|------|------|
| Owner | owner@labelhub.com | 模板搭建（拖拽）、发布、导出 |
| Labeler | labeler@labelhub.com | 作答、AI 辅助、提交 |
| Reviewer | reviewer@labelhub.com | 复审、就地修订、Diff |

真实数据任务：**「大模型问答质量标注」**（30 题）、**「偏好对比标注（RLHF）」**（12 题，含 A/B 并排 tabs）。

### 2. 录屏叙事（建议 6–8 分钟）

1. **Owner 搭模板（结构质量）**：进入「大模型问答质量标注」Designer，演示**物料拖拽到画布 + 节点拖拽重排**（P1-B），覆盖 ShowItem/单选/多选/富文本/JSON/上传/LLM 全组件。
2. **Owner 发布前治理**：演示 Schema 版本管理——已发布模板冻结、旧版本兼容（可配合上面 MSW Demo B 讲 Breaking Change 阻断）。
3. **Labeler 作答 + AI 辅助（过程质量 + AI 质量）**：领取一题 → 点 **AI 预评分参考**（llm.assist，真实 LLM，~20s 返回评分）→ 一键应用建议 → 提交。
4. **AI 自动预审（AI 质量）**：提交后状态 `AI_REVIEWING → AI_PASSED`（worker 真实调用 LLM，结构化评分）；审核详情可看 **token/模型/耗时**（TC-AI-07 可追溯）。
5. **Reviewer 复审 + Diff（数据质量 × 模型价值）**：进入审核详情，演示就地修订 → Diff（before/after hash 可溯源），讲"每次人工纠错都是 AI Reviewer 的训练信号"。
6. **Owner 导出带质量护照（可信数据交付）**：导出 → 每条数据附 **Data Quality Passport**（finalAnswerHash、reviewStatus、reviewer 修改、AI 参与），讲"导出的不是裸数据，而是带质量证据链的数据"。

### 3. 一键自动验证（录屏前自检 / 答辩兜底）

整条真实后端链路有自动化覆盖，录屏前可先跑一遍确认全绿：

```bash
# 后端单元+集成（148 passed）
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q
# 端到端（21/21，含 Step 21 导出→质量护照）
bash apps/api/scripts/e2e_test.sh
# 真实 LLM 链路手验（同步 llm.assist + 异步 AI 预审），见 docs/final-iteration-plan.md T1-D
```

### 4. 前后端 hash 一致性（答辩工程问题）

`canonical-json-v1 + SHA-256` 前后端逐字节一致，有 test vectors 证明：

```bash
docker compose exec -w /workspace/apps/api api pytest tests/unit/test_hash_vectors.py -q   # 后端 11 passed
node --test packages/schema-core/src/__tests__/canonical-hash-vectors.test.ts             # 前端 10 passed
```
