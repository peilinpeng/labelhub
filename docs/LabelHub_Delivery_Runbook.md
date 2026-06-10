# LabelHub 交付运行手册

> 适用场景：答辩现场、验收复现、交付前自查
> 推荐分支：`integration/joint-test`
> 推荐入口：先读 `docs/LabelHub_Final_Delivery.md`，再按本手册操作

---

## 1. 现场前检查

```bash
git checkout integration/joint-test
git pull --rebase
git status --short
git log --oneline -8
```

正常主线应至少包含：

```txt
7ff8d8a feat(web): add normalized ai review weight sliders
b8963d4 fix(web): top-align ai-config rule preview card
7f9958b feat(web): surface owner schema version management
64a39ab fix(web): complete reviewer queue and decision flow
57c724e fix(schema-renderer): allow dismissing blocked ai suggestions
```

> 稳定 tag：`stable-after-owner-ai-config-polish-0610`（`7ff8d8a`）。

如果工作区有未提交改动，先确认它们是否为交付收尾文档或 UI 修复；不要直接覆盖。

---

## 2. 真实后端模式

### 2.1 启动

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
```

### 2.2 访问

```txt
Web: http://localhost:5173/
API: http://localhost:3000/
Swagger: http://localhost:3000/docs
```

账号：

```txt
Owner:    owner@labelhub.com    / password123
Labeler:  labeler@labelhub.com  / password123
Reviewer: reviewer@labelhub.com / password123
```

### 2.3 健康检查

```bash
docker compose ps
docker compose logs api --tail 80
docker compose logs worker --tail 80
```

如登录或首次请求出现 500，优先确认当前代码是否包含 `39bc1ca`，该提交已通过 `pool_pre_ping` / `pool_recycle` 修复 MySQL stale connection。

---

## 3. Mock 前端模式

Mock 模式适合在没有 Docker 后端或真实 LLM key 时做前端演示。

Windows PowerShell：

```powershell
$env:VITE_ENABLE_MSW="true"
npm.cmd --prefix apps/web run dev -- --host 127.0.0.1 --port 5180
```

macOS / Linux：

```bash
VITE_ENABLE_MSW=true npm --prefix apps/web run dev -- --host 127.0.0.1 --port 5180
```

访问：

```txt
http://127.0.0.1:5180/
```

账号：

```txt
Owner:    owner@labelhub.test    / Seed@1234
Labeler:  labeler@labelhub.test  / Seed@1234
Reviewer: reviewer@labelhub.test / Seed@1234
```

Console 中应能看到 MSW 启用日志。若 `/api` 请求全部 404，通常是未设置 `VITE_ENABLE_MSW=true`。

---

## 4. 演示操作卡

### 4.1 Owner：Schema Governance

访问：

```txt
/owner/tasks/task_demo_schema_breaking_change/designer
```

动作：

1. 点击发布前检查。
2. 观察 Breaking Change / `FIELD_REMOVED`。
3. 确认发布按钮被阻断。
4. 查看 Schema Audit Timeline。

讲法：

```txt
已发布 Schema 是历史答卷的结构契约。破坏性变更在发布前被阻断，阻断事件写入审计时间线。
```

### 4.2 Labeler：动态表单联动

访问：

```txt
/labeler/workspace/asn_1001
```

动作：

1. 找到质量评分字段。
2. 选择 `1` 或 `2`。
3. 观察 `factCheckNote` 显示并变为必填。
4. 改为 `3/4/5`，观察 `factCheckNote` 隐藏并清空。

讲法：

```txt
可见性、必填和清空规则来自 Schema Runtime，不是页面 if-else。
```

### 4.3 Labeler：AI Assist Preflight

动作：

1. 点击 AI 辅助。
2. 观察 SAFE / WARNING / BLOCKED 状态。
3. BLOCKED 时确认“一键采纳”禁用。
4. 点击“忽略建议”，确认建议区关闭。

讲法：

```txt
AI suggestedPatch 先经过 headless preflight 预演。会破坏表单规则的建议不能直接采纳，但用户可以忽略。
```

### 4.4 Reviewer：人工审核与 Diff

访问：

```txt
/reviewer/items
/reviewer/items/sub_1003
```

动作：

1. 在队列页查看 AI 预审摘要。
2. 点击进入人工审核。
3. 修改字段级修订值。
4. 提交通过或打回。

讲法：

```txt
Reviewer 修改会生成字段级 diff。审计只记录字段名、patch 数量和摘要，不写完整答案。
```

### 4.5 Owner：Export Passport

访问：

```txt
/owner/tasks/task_news_quality/export
```

动作：

1. 查看或触发导出。
2. 展示 Data Quality Passport 摘要。
3. 说明 recordCount、passportCount、warningCount、passportBatchHash。

讲法：

```txt
导出交付的不只是答案，还有质量证据链。下游可用 Passport 判断数据可信度。
```

---

## 5. 交付前验证命令

前端：

```bash
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run build
```

共享包：

```bash
npm run typecheck
npm run test
```

后端：

```bash
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q
docker compose exec -w /workspace/apps/api api pytest -m integration -q
```

端到端：

```bash
bash apps/api/scripts/e2e_test.sh
```

格式检查：

```bash
git diff --check
```

---

## 6. 故障排查

| 现象 | 优先检查 | 处理 |
|---|---|---|
| 前端 API 404 | 是否开启 MSW 或 Docker API | Mock 模式加 `VITE_ENABLE_MSW=true`；真实模式看 compose api |
| 登录失败 | 账号体系是否混用 | 真实后端用 `*@labelhub.com/password123`，Mock/E2E 用 `*@labelhub.test/Seed@1234` |
| 首次请求 500 | 是否包含 stale connection 修复 | 确认 `39bc1ca`，必要时重建 api/worker |
| Reviewer 重复提交 409 | 状态机保护 | 换一个 submission 或刷新队列 |
| Export mock 下 0 条 | Mock 状态流转缺口 | 用真实后端演示导出，或按 QA 记录说明该边界 |
| Vite build 权限错误 | 本地沙箱限制 | 在受信终端重跑 `npm.cmd --prefix apps/web run build` |
| build circular chunk 提示 | 既有 chunk 关系 | 非阻断，产物正常生成 |

---

## 7. 收尾清单

交付前逐项确认：

- [ ] 分支为 `integration/joint-test`。
- [ ] 已记录最终 commit hash。
- [ ] `.env` 未被提交。
- [ ] 演示账号可登录。
- [ ] Owner / Labeler / Reviewer / Export 四条主线至少各跑一次。
- [ ] `apps/web` typecheck 和 build 通过。
- [ ] `git diff --check` 通过。
- [ ] 已知边界已在答辩或交付说明中主动说明。
