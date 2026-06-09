# LabelHub 最终整合交接文档

> 面向：最终整合同学 / 负责合并、验收、部署、录屏与提交物收口的人。
> 更新时间：2026-06-09
> 当前本地分支：`fix/joint-test-web-shell`
> 当前本地 HEAD：`ed4a7804438f6dca068657976d4b1d5d65e0cfb3`（`Fix owner schema designer UI and mobile layout`）
>
> 用户已说明：代码已 push 到 GitHub。最终整合时请以 GitHub 上对应分支的最新 commit 为准。

---

## 1. 一句话状态

LabelHub 已完成三角色主链路：

- Owner：创建任务、配置模板、导入数据集、配置 AI 预审、发布任务、查看质量中心、导出数据。
- Labeler：领取任务、作答、草稿自动保存、AI 辅助、提交、查看我的提交。
- Reviewer：审核队列、AI 预审结果、人工复核、打回/通过、diff 与审计信息。

当前阶段不是继续做大功能，而是最终整合：确认分支、跑验证、补提交物、录屏、部署、处理小的 UI/文案和链路阻断。

---

## 2. 最终整合请先确认

1. 从 GitHub 拉取用户已 push 的最新分支。
2. 确认当前 commit 不低于本文件记录的 `ed4a780`。
3. 确认工作区 clean 后再开始整合。

推荐命令：

```bash
git fetch origin
git status
git branch --show-current
git rev-parse HEAD
git log --oneline --decorate -10
```

如果远端分支不是 `fix/joint-test-web-shell`，请按用户实际 push 的分支接，但要确认包含 `ed4a780` 这次 Owner 模板搭建页 UI 和移动端修复。

---

## 3. 本轮最新前端修复重点

本轮主要修了 Owner 侧真实链路和演示体验：

- 登录失败不再静默放行；无 token 的角色深链路会回登录页。
- 侧栏移除写死的 demo 任务链接，AI 预审配置改为通用 `/owner/ai-config` 入口。
- Owner 模板搭建页做了大量人话化和移动端适配：
  - 顶部统一操作：返回任务 / 保存草稿 / 实时预览 / 导出 JSON / 保存并发布模板。
  - 模板发布前本地自检会列出可定位问题。
  - 画布节点显示错误 badge，属性面板补必填与错误提示。
  - 保存并发布时使用真实 `schemaDraftRevision`，避免 409。
  - 后端返回“缺少数据集 / AI 预审配置”时，不再只给死提示，而是直接给“去导入数据集”或“去配置 AI 预审”按钮。
  - 窄屏下不再横向溢出，375 / 390 / 414 / 768 宽度已实测。
- 质量中心改为更适合桌面演示的四列 KPI + 2×2 看板。

关键文件：

- `apps/web/src/features/owner/OwnerSchemaPage.tsx`
- `apps/web/src/features/owner/OwnerAIPage.tsx`
- `apps/web/src/features/owner/OwnerQualityCenterPage.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/src/app/routes.tsx`
- `apps/web/src/styles.css`
- `packages/schema-designer/src/**`

---

## 4. 启动方式

### 4.1 真实全栈演示（最终验收推荐）

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api python scripts/seed_demo.py
docker compose exec -w /workspace/apps/api api python scripts/seed_competition.py
```

访问：

```txt
http://localhost:5173/
```

演示账号：

```txt
owner@labelhub.com / password123
labeler@labelhub.com / password123
reviewer@labelhub.com / password123
```

### 4.2 本地前端开发 / 快速 UI 检查

```bash
cd apps/web
npm run dev
```

如果启用 MSW mock：

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

常见访问地址：

```txt
http://localhost:5180/
```

本地 seed / E2E 测试账号：

```txt
owner@labelhub.test / Seed@1234
labeler@labelhub.test / Seed@1234
reviewer@labelhub.test / Seed@1234
```

注意：Docker web 是 `5173`；本地 Vite dev 常见是 `5180`。不要混。

---

## 5. 最终验收命令

前端和共享包：

```bash
npm run typecheck
npm run test
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run build
```

后端：

```bash
docker compose exec -w /workspace/apps/api api alembic upgrade head
docker compose exec -w /workspace/apps/api api pytest -m "not integration" -q
docker compose exec -w /workspace/apps/api api pytest -m integration -q
```

端到端：

```bash
bash apps/api/scripts/e2e_test.sh
```

当前最近一次前端验证结果：

- `npm.cmd --prefix apps/web run typecheck` 通过。
- `npm.cmd --prefix apps/web run build` 通过。
- `git diff --check` 通过，仅有 CRLF warning。

说明：在受限沙箱内跑 `vite build` 可能遇到 esbuild 读上层目录权限问题；正常终端或提权后可通过。

---

## 6. 最终录屏建议路线

推荐用真实全栈，不用 mock。

1. Owner 登录，进入任务管理。
2. 新建任务或打开已有真实任务。
3. 模板搭建页演示字段配置、预设模板、实时预览。
4. 导入至少一条数据集，再保存并发布模板/任务。
5. Owner 配置 AI 预审规则。
6. Labeler 登录，领取任务、作答、AI 辅助、提交。
7. Reviewer 登录，查看 AI 预审结果，人工审核/打回/通过。
8. Owner 回到质量中心和导出页，展示质量护照与导出结果。

现成脚本看：

- `docs/LabelHub_Demo_Guide.md`
- `docs/LabelHub_Final_Demo_Guide.md`
- `submission/README.md`

---

## 7. 最容易踩的坑

### 7.1 发布任务前必须有数据集

后端真实规则：模板版本发布成功后，任务要进入分发，还必须至少有 1 条可领取数据。

如果看到：

```txt
模板版本已发布，但任务还不能进入分发：请先导入至少一条可领取数据。
```

不是模板 payload 错，是业务前置条件。现在模板页提示卡已有“去导入数据集”按钮，进入 `/owner/tasks/:taskId/dataset` 上传 JSON / JSONL / Excel 后再发布。

### 7.2 AI 预审配置也是任务发布前置条件

如果后端要求 ReviewConfig，请进入：

```txt
/owner/tasks/:taskId/ai-config
```

或从提示卡点击“去配置 AI 预审”。

### 7.3 不要绕过 schema 包

web 层不要重复实现：

```txt
schema traversal
visibleWhen
validation
normalization
```

这些应复用 `packages/schema-core` / `packages/schema-renderer` / `packages/schema-designer`。

### 7.4 contracts 改动必须三端同步

如果最终整合时要改共享数据结构、接口 shape、错误码、审计动作：

1. `packages/contracts`
2. `apps/web`
3. `apps/api/app/schemas/*.py`

三处必须同步。不要只改一侧。

### 7.5 不要提交密钥

`.env` 和真实 key 不进仓库。`.env.example` 只能放占位符。

---

## 8. 提交物收口清单

对照 `submission/README.md`，最终提交前还要确认：

- [ ] 演示视频 5-10 分钟。
- [ ] 架构图 `submission/architecture.png`。
- [ ] AI Coding 过程记录 `submission/ai-coding-log.md`。
- [ ] Demo 截图 `submission/screenshots/` 或 `docs/qa-assets/`。
- [ ] 云演示环境公网地址。
- [ ] 云环境账号密码说明。
- [ ] `README.md`、`docs/deployment.md`、`apps/api/openapi.json` 与实际版本一致。

---

## 9. 合并建议

建议最终整合同学按这个顺序做：

1. 拉最新 GitHub 分支，确认包含 `ed4a780`。
2. 本地跑 `apps/web typecheck + build`。
3. 起 Docker 全栈，跑 migration + seed。
4. 用三角色账号手动走一遍真实链路。
5. 跑后端 pytest 和 e2e。
6. 补截图、视频、架构图、AI Coding 记录。
7. 合并到最终提交分支前，确认没有 `.env`、临时数据库、录屏大文件误入仓库。

---

## 10. 关键文档索引

| 场景 | 文档 |
|---|---|
| 项目全景与启动 | `README.md` |
| 最终提交物索引 | `submission/README.md` |
| 真实后端录屏剧本 | `docs/LabelHub_Demo_Guide.md` |
| Mock / Schema Governance demo | `docs/LabelHub_Final_Demo_Guide.md` |
| 部署 | `docs/deployment.md` |
| QA 记录 | `docs/QA_TEST_RECORD.md` |
| 最新 AI 轮班状态 | `HANDOFF.md` |
| 给 UI / 测试搭档 | `HANDOFF_FOR_PARTNERS.md` |
| 后端迁移上下文 | `CONTEXT_HANDOFF.md` |

---

## 11. 当前结论

当前代码已经具备最终整合条件。剩余工作主要是：

- 合并分支与验收。
- 补提交物。
- 录屏和部署。
- 小范围 UI/文案/数据演示修补。

不要在最终整合阶段再扩展大功能；优先保证真实链路稳定、演示路径清晰、提交物完整。
