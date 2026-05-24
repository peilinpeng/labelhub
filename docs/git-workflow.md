# 三人 Git 协作流程

本文档说明三个人如何基于 `main`、`dev` 和 feature 分支协作。

## 角色建议

- 前端负责人：`apps/web`、MSW Mock、Designer、Renderer、页面交互。
- 后端负责人：`apps/api`、MySQL、Redis、API、状态机、审计。
- Worker 负责人：AI Review Agent、Export worker、异步队列、LLM 调用。

每个人都必须引用 `packages/contracts`，不得在自己的模块中重新定义契约类型。

## 首次拉取仓库

```bash
git clone <repo-url>
cd labelhub
git checkout dev
git pull origin dev
```

如果远端还没有 `dev`：

```bash
git checkout -b dev
git push -u origin dev
```

## 创建功能分支

从最新 `dev` 拉分支：

```bash
git checkout dev
git pull origin dev
git checkout -b feature/web-task-marketplace
```

分支命名建议：

- `feature/web-*`
- `feature/api-*`
- `feature/worker-*`
- `fix/*`
- `docs/*`
- `test/*`

## 日常提交

查看改动：

```bash
git status
git diff
```

提交：

```bash
git add <files>
git commit -m "feat(web): 实现任务广场列表"
```

推送分支：

```bash
git push -u origin feature/web-task-marketplace
```

## 同步 dev

开发过程中经常同步 `dev`，减少冲突：

```bash
git checkout dev
git pull origin dev
git checkout feature/web-task-marketplace
git merge dev
```

如果团队更习惯 rebase，也可以：

```bash
git checkout feature/web-task-marketplace
git fetch origin
git rebase origin/dev
```

同一个团队内请统一 merge 或 rebase 策略，避免提交历史混乱。

## 解决冲突

当 Git 提示冲突：

```bash
git status
```

打开冲突文件，处理标记：

```text
<<<<<<< HEAD
当前分支内容
=======
目标分支内容
>>>>>>> dev
```

处理原则：

- 不要随意覆盖别人改动。
- 涉及 `packages/contracts` 时，先确认契约文档是否同步更新。
- 涉及状态机、API、schema 时，以 `labelhub-architecture-contract.md v1.1` 为准。

解决后：

```bash
git add <resolved-files>
git commit
```

如果是 rebase：

```bash
git add <resolved-files>
git rebase --continue
```

## 提 PR

PR 目标分支默认是 `dev`。

PR 描述需要包含：

- 做了什么。
- 影响哪些模块。
- 是否修改契约。
- 跑了哪些检查。
- 有哪些未完成事项。

示例：

```text
## 变更内容
- 实现 Labeler 任务广场页面
- 接入 MSW mock marketplace API

## 检查
- npm run typecheck
- npm run test

## 契约变更
无
```

## 合并到 dev

PR review 通过后合并到 `dev`。

合并后每个人同步：

```bash
git checkout dev
git pull origin dev
```

## 发布到 main

当 `dev` 达到可演示状态：

```bash
git checkout main
git pull origin main
git merge dev
git push origin main
```

建议只由一位负责人执行 `dev -> main` 合并。

## 三人并行开发建议

前端负责人：

- 优先使用 MSW Mock 开发页面。
- 不等待真实后端完成。
- 遇到接口缺口先检查 `packages/contracts`，不要临时发明字段。

后端负责人：

- 以 `packages/contracts/src/api.ts` 为 request / response 来源。
- 状态迁移必须 command-driven。
- 所有关键迁移必须写 audit log。

Worker 负责人：

- AI Review 和 Export worker 通过 Redis 队列或后续选定队列实现。
- AI 输出必须符合结构化契约。
- 不直接修改 `Submission.answers`。

## 提交前检查清单

- 没有提交 `.env`、密钥、缓存、测试产物。
- 没有重新定义 contracts 类型。
- 没有绕过 schema versioning。
- 没有破坏 Docker Compose 启动。
- 文档和注释使用中文。
- PR 描述写明检查结果。
