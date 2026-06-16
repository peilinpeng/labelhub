# LabelHub 答辩演示交接（搭档专用）

> 你全权负责答辩当天的演示。照这份文档走即可，**它已针对"AI 审核策略 + 新闻任务"这套演示做过校准**，与 `LabelHub_Delivery_Runbook.md` / `LabelHub_Final_Demo_Guide.md` 里的旧演示方案不同——以本文为准。
>
> 分支：`integration/joint-test`。本机访问地址：**http://localhost:5173**。

---

## 0. 必须单独索取的 3 样东西（不在 GitHub 里）

代码在 GitHub，但下面三样 **gitignore / 在仓库外**，必须找交接人私下拿，缺一不可：

| # | 东西 | 用途 | 缺了会怎样 |
|---|------|------|-----------|
| 1 | **`.env` 内容**（含真实 `DOUBAO_API_KEY`、`DOUBAO_MODEL`、`JWT_SECRET`） | 接入豆包做 AI 预审 | **没有真 key，AI 预审直接失败，整个演示垮掉** |
| 2 | **`demo-news-quality-data.json`**（6 条新闻） | 现场建新闻任务时导入数据 | 演示不了"现场从零建任务" |
| 3 | 确认演示账号密码（见 §3） | 登录 | 进不去 |

> `DOUBAO_API_KEY` 是付费 key，确认**还有额度**再上场。

---

## 1. 答辩前一天：完整 bootstrap（务必提前做，别留到当天）

全新机器是**空数据库**，演示数据不在任何文件里，必须 seed 出来。

```bash
# 前置：已装 Docker Desktop 并启动；已 git clone 仓库并 checkout integration/joint-test
cd labelhub
git pull origin integration/joint-test

cp .env.example .env
#   ↑ 然后用编辑器打开 .env，把 DOUBAO_API_KEY / DOUBAO_MODEL / JWT_SECRET 换成交接人给的真值

docker compose up -d --build                 # 首次会拉镜像+构建，较慢，耐心等
docker compose exec -w /workspace/apps/api api alembic upgrade head        # 建表
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py            # ① 基础账号（必须先跑）
docker compose exec -w /workspace/apps/api api python scripts/seed_demo_pipeline.py   # ② AI 审核演示数据（真调豆包，约 3 分钟）
```

> ⚠️ 顺序不能反：`seed_demo_pipeline.py` 依赖 `seed_demo.py` 建好的 `usr_demo_*` 账号。
> ⚠️ `seed_demo_pipeline.py` 会真调豆包，跑的时候别断网，跑完不要再重复跑（会重置数据）。

**bootstrap 完成的验收标准**（登录 reviewer 看审核台）：

- 「已通过 15」「转人工/待审核 2」「已打回 1」量级（具体数字以当时为准，关键是有数据、无报错）。
- 两个演示任务：`大模型问答`（AUTO 策略，9 条高分自动通过）、`偏好对比标注(RLHF)`（advisory，一致率 ~0.86）。

---

## 2. 答辩当天：只启动，不要重新 seed

```bash
cd labelhub
docker compose up -d          # 注意：没有 --build，没有 seed，几秒起来
docker compose ps             # 五个容器都 Up 即可
```

打开 http://localhost:5173 登录验证一眼数据还在，就绪。**当天绝不要再跑 seed 脚本**（会重置/重跑，浪费时间且有风险）。

---

## 3. 登录账号

地址 http://localhost:5173，密码统一 **`password123`**（如交接人未改）：

| 角色 | 邮箱 |
|------|------|
| Owner（建任务/配 AI） | `owner@labelhub.com` |
| Labeler（做标注） | `labeler@labelhub.com` |
| Reviewer（审核） | `reviewer@labelhub.com` |

---

## 4. 演示主线

建议三段，时间紧可只演 A + C：

- **A. 已 seed 的成品（最稳，无网络风险）**
  - Reviewer 登录 → 审核台。
  - `大模型问答`：AUTO_PASS_RETURN 策略，高分提交**自动通过**到终态 ACCEPTED，无需人工。
  - `偏好对比标注(RLHF)`：advisory 策略，AI 只给建议、全量转人工；展示一致率指标。
  - 重点讲：**三种审核策略真实生效**，不是装饰；侧边栏徽章显示的是真实 AI 建议，已打回的提交动作栏显示「人工 · 已打回」结论。
- **B.（可选）切策略对比**：把某任务策略切到 `HUMAN_REVIEW_ONLY`，reviewer 端 AI 只给"质检提示"、不给通过/打回结论徽章。
- **C. 现场从零建新闻任务（亮点，依赖豆包实时调用）** → 见 §5。

---

## 5. 现场建新闻任务（完整参数，照抄）

用 **Owner** 账号，数据来自 `demo-news-quality-data.json`（6 条新闻，字段 `title` / `body` / `candidate_categories` / `source`）。

**建任务弹窗：**
- 名称：`新闻内容质量与分类标注`
- 配额：`6`
- 分发：`先到先得`
- 审核：`单轮审核`

**Schema 字段：**
| 字段 | 类型 | 选项/说明 |
|------|------|-----------|
| `qualityRating` | 单选 | 通过 / 需要修改 / 不可用 |
| `summary` | 文本域 | 摘要 |
| `rewriteSuggestion` | 文本域 | 改写建议 |

展示字段：`title` / `body`。

**AI 预审配置：**
- Prompt：照抄既有任务的 prompt（content-aware 那版）。
- 4 个维度（权重）：`factuality` 0.3 / `category` 0.25 / `evidence` 0.25 / `format` 0.2
- 阈值：通过 `0.8` / 打回 `0.45`
- 策略：**`AUTO_PASS_RETURN`**（硬阈值闸门）

**现场标注效果（已彩排验证）：**
- 优质标注（摘要写全正文关键数字）→ 约 92~96 分 → **自动通过**。
- 垃圾标注（`summary=111`、`rewriteSuggestion=11`）→ 约 12~15 分 → **自动打回**。

> AI 预审是异步的：标注员提交后，reviewer 端点「刷新队列」稍等几秒才看到结果。

---

## 6. 故障排查

| 现象 | 处理 |
|------|------|
| AI 预审一直无结果 / 报错 | 查 `.env` 的 `DOUBAO_API_KEY` 是否真值且有额度；`docker compose logs worker --tail 80` 看豆包调用报错 |
| 改了后端代码不生效 | api/worker 是 baked 镜像，需 `docker compose up -d --build api worker`（演示当天一般用不到） |
| 页面 5173 打不开 | `docker compose ps` 看 web 是否 Up；`docker compose logs web --tail 50` |
| 数据乱了想重置演示数据 | **仅在彩排时**：`docker compose exec -w /workspace/apps/api api python scripts/clean_demo.py` 再重跑 §1 的两个 seed |
| 想验证硬阈值流转 | `docker compose exec -w /workspace/apps/api api python scripts/verify_auto_threshold.py`（自清理） |

---

## 7. 与旧文档的差异（避免踩坑）

- `LabelHub_Delivery_Runbook.md` 里用 `seed_demo.py` + `seed_competition.py`、演示 Schema 治理/Formily/Export——那是**旧演示方案**，本次答辩**不走那套**。
- 本次答辩核心是 **AI 审核策略**，数据靠 `seed_demo_pipeline.py`，请以本文 §1 的 seed 顺序为准。
