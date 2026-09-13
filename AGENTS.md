# AGENTS.md — LabelHub 稳定协作规则

本文件只记录所有分支长期有效的工程约束。当前主线、验证快照和维护待办统一读取
[`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)；临时轮班记录不得作为仓库状态依据。

## 开始工作前

1. 阅读 `docs/PROJECT_STATUS.md`、`CONTRIBUTING.md`、`AI_CODING_RULES.md`。
2. 执行 `git status --short --branch`、`git rev-parse HEAD` 和 `git log -20 --oneline`。
3. 从最新 `origin/main` 建立任务分支；禁止直接在 `main` 开发或 push。
4. 工作区存在非本任务改动时先确认来源，不覆盖、不删除。

## 架构边界

- `packages/contracts` 是共享类型的唯一来源；破坏性变更必须先更新架构契约并协调所有消费者。
- Web 层必须复用 Schema 包的遍历、`visibleWhen`、校验和规范化逻辑，不得平行实现。
- Owner 使用 `SchemaDesigner`；Labeler 使用 `SchemaRenderer` 的 `LABELING` 模式；Reviewer 使用
  `REVIEW_READONLY` 或 `REVIEW_DIFF` 模式。
- `apps/api`、数据库、worker、导出管线的业务修改由后端负责人审阅；跨边界变更必须拆分说明。
- 设计文档描述目标态，不自动构成当前实现范围。

## 安全红线

- 不提交 `.env`、密钥、token、真实用户数据或本地存储产物。
- 不用占位值冒充 SHA-256；统一使用 `canonical-json-v1 + SHA-256`。
- Audit payload 不得写入完整 answers、prompt、raw LLM output、sourcePayload 或完整编辑轨迹。
- 不绕过状态机、`schemaVersionId`、发布校验、审核确认或权限检查。

## 交付门禁

按改动范围至少执行：

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
