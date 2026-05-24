# 贡献指南

本文档约定 LabelHub 的协作方式、分支策略、提交规范和 PR 规则。

## 工作语言

- 文档、README、部署说明、代码注释、错误提示统一使用中文。
- TypeScript 类型名、接口名、变量名、函数名、枚举值、API 路径保持英文。
- 不要在同一个文件中混用中英文注释。

## 分支策略

固定分支：

- `main`：稳定分支，只保留可演示、可交付版本。
- `dev`：集成分支，日常开发从这里拉分支并合并回这里。

功能分支命名：

- `feature/web-designer`
- `feature/api-task-workflow`
- `feature/worker-ai-review`
- `fix/contracts-validation`
- `docs/deployment-guide`

禁止：

- 禁止直接 push `main`。
- 禁止在 `main` 上直接开发。
- 禁止把未通过检查的代码合入 `dev`。

## Commit message 规范

格式：

```text
type(scope): 中文描述
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
feat(web): 接入任务广场 mock 数据
fix(api): 修复提交状态非法迁移判断
docs: 补充 Docker 启动说明
test(contracts): 增加 JsonPath 命名空间测试
```

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
