# AGENTS.md — LabelHub 稳定协作规则

本文件只记录所有分支长期有效的工程约束。当前主线、验证快照和维护待办统一读取
[`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)；临时轮班记录不得作为仓库状态依据。

## 当前开发模式

- 当前采用单人全栈开发；同一开发者可负责前端、API、数据库、worker 和工程维护，不设按人员划分的修改禁区。
- PR 用于保存改动范围、自查与验收记录，不强制他人 review 或 GitHub `APPROVED`。
  提交者完成完整 diff 自查、相关检查与已发现问题处理后，可自行合并。
- AI 可在用户已授权的任务与合并范围内完成修改、自查、验证和合并，无需重复索取确认。
  AI 自查必须如实标注，不能称为人工 review；GitHub 实际权限与检查仍须满足。
- 此开发模式不改变产品内的审核、迁移审批、权限与审计规则。

## 开始工作前

1. 阅读 `docs/PROJECT_STATUS.md`、`CONTRIBUTING.md`、`AI_CODING_RULES.md`。
2. 执行 `git status --short --branch`、`git rev-parse HEAD` 和 `git log -20 --oneline`。
3. 从最新 `origin/main` 建立任务分支；禁止直接在 `main` 开发或 push。
4. 工作区存在非本任务改动时先确认来源，不覆盖、不删除。

## 提交语言

- 从现在起，所有新 Git 提交说明的标题与正文统一使用英文，包括普通提交、merge 和 squash 提交。
- 普通提交沿用 `type(scope): English description` 格式；具体示例见 `CONTRIBUTING.md`。
- 合并前检查最终提交说明，避免将中文 PR 标题或描述自动带入 merge / squash 提交。
- 既有提交说明保留原样，不为翻译重写历史或强制推送。
- 根目录 `README.md` 使用英文；其他文档、代码注释与 UI 文案继续遵循各自现有语言约定。

## 架构边界

- `packages/contracts` 是共享类型的唯一来源；必要的契约变更先明确影响、更新架构契约与共享类型，再同步所有消费者及测试。
- Web 层必须复用 Schema 包的遍历、`visibleWhen`、校验和规范化逻辑，不得平行实现。
- Owner 使用 `SchemaDesigner`；Labeler 使用 `SchemaRenderer` 的 `LABELING` 模式；Reviewer 使用
  `REVIEW_READONLY` 或 `REVIEW_DIFF` 模式。
- `apps/api`、数据库、worker、导出管线的业务修改由提交者检查数据兼容、状态机、权限及失败恢复；跨边界变更须说明各层影响并验证真实链路。
- 设计文档描述目标态，不自动构成当前实现范围。

## 安全红线

- 不提交 `.env`、密钥、token、真实用户数据或本地存储产物。
- 不用占位值冒充 SHA-256；统一使用 `canonical-json-v1 + SHA-256`。
- Audit payload 不得写入完整 answers、prompt、raw LLM output、sourcePayload 或完整编辑轨迹。
- 不绕过状态机、`schemaVersionId`、发布校验、审核确认或权限检查。

## 交付门禁

业务代码及影响构建、运行行为的工程修改至少执行：

```bash
npm run typecheck
npm run test
npm --prefix apps/web run typecheck
npm --prefix apps/web run test:coverage
npm --prefix apps/web run build:production
git diff --check
```

涉及 API、Docker 或真实链路时，追加 API 测试、依赖审计和真实后端 Playwright。PR 必须列明
影响范围、验证结果、契约影响和后续待办；合并后更新 `docs/PROJECT_STATUS.md` 的日期与基线。
纯文档修改执行 `npm run check:docs`、`git diff --check` 并核实事实与链接即可，无需重复无关的全量测试。
所有改动均须检查完整 diff，确认没有密钥、本地产物或无关修改，且适用的远端 CI 通过。
