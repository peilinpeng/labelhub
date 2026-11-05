# 贡献指南

本文档约定 LabelHub 的协作方式、分支策略、提交规范和 PR 规则。

## 工作语言

- 根目录 `README.md` 使用英文；其他文档、部署说明、代码注释、错误提示继续使用中文。
- 所有新 Git 提交说明（标题与正文）统一使用英文，具体规则见下文。
- TypeScript 类型名、接口名、变量名、函数名、枚举值、API 路径保持英文。
- 不要在同一个文件中混用中英文注释。

## 分支策略

固定分支：

- `main`：稳定分支，只保留可演示、可交付版本。
- 日常任务从最新 `origin/main` 建立独立分支，通过 PR 合并回 `main`。
- `dev` / `integration/joint-test` 是历史协作分支，不作为当前默认开发基线。

功能分支命名：

- `feature/web-designer`
- `feature/api-task-workflow`
- `feature/worker-ai-review`
- `fix/contracts-validation`
- `docs/deployment-guide`

禁止：

- 禁止直接 push `main`。
- 禁止在 `main` 上直接开发。
- 禁止把未通过检查的代码合入 `main`。

## Commit message 规范

从现在起，所有新提交说明的标题与正文统一使用英文，包括普通提交、merge 和 squash 提交。
既有提交保留原样，不为翻译重写历史或强制推送。

格式：

```text
type(scope): English description
```

常用 type：

- `feat`：新增功能
- `fix`：修复问题
- `docs`：文档
- `test`：测试
- `refactor`：重构
- `chore`：工程配置
- `build`：构建和 Docker

示例：

```text
feat(web): integrate mock data into the task marketplace
fix(api): reject invalid submission state transitions
docs: add Docker setup instructions
test(contracts): cover JsonPath namespaces
```

合并 PR 前，检查 GitHub 最终生成的提交标题与正文。如果 merge / squash 默认说明包含中文
PR 标题、描述或提交列表，应编辑为英文后再合并。PR 讨论可继续使用中文。

## PR 规则

每个 PR 必须说明：

- 本次变更目标。
- 影响范围。
- 是否涉及契约变更。
- 已运行的检查命令。
- 后续待办。

合并前要求：

- 至少 1 人 review。
- contracts typecheck 通过。
- contracts test 通过。
- 不引入真实 API key、私钥、`.env`。
- 不修改与当前任务无关的大量文件。

涉及契约变更时：

1. 先更新 `labelhub-architecture-contract.md`。
2. 同步更新 `packages/contracts`。
3. 同步更新契约测试。
4. 再更新前端、后端、worker 调用代码。

## 禁止事项

- 禁止重新定义 `packages/contracts` 已有类型。
- 禁止绕过 `schemaVersionId`、audit log、状态机 command。
- 禁止在 schema 中写任意 JavaScript 函数。
- 禁止提交 `.env`、密钥、Docker volume、测试产物、缓存目录。
- 禁止为了临时调试破坏 Docker 启动路径。

## 推荐本地检查

```bash
cd packages/contracts
npm run typecheck
npm run test
```

如果本机没有 npm，可使用已有 TypeScript 编译器执行等价检查。
