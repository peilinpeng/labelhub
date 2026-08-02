# LabelHub AI Coding 统一规则

本文档是 LabelHub 项目所有 AI Coding 工具的统一使用规则，适用于 Codex、Claude、Trae、Cursor、Copilot Agent 等。

任何 AI Coding 任务开始前，必须先阅读本文档，并遵守本文档与项目契约。

## 1. 语言与风格约定

1. 本项目工作语言统一为中文。
2. 文档、代码注释、README、错误提示、测试描述、UI 文案使用中文。
3. TypeScript 类型名、接口名、变量名、函数名、枚举值、API 路径使用英文。
4. Docker service 名、环境变量名、脚本名保持英文。
5. 不要在同一个文件中混用中英文注释。

## 2. Contract-driven 开发原则

LabelHub 采用 contract-driven 开发。

最高架构契约是：

- `labelhub-architecture-contract.md v1.1`

共享类型唯一来源是：

- `packages/contracts`

所有前端、后端、AI Agent、Worker、Mock、测试实现必须引用：

- `@labelhub/contracts`

任何模块都不得重新定义契约类型。

## 3. 严格禁止事项

1. 禁止重新定义 `packages/contracts` 已经导出的类型。
2. 禁止使用 `any`，灵活数据必须使用 `unknown`。
3. 禁止随意修改 `packages/contracts`。
4. 禁止随意修改 `labelhub-architecture-contract.md`。
5. 禁止为了通过编译而修改契约。
6. 禁止发明新的字段名、状态名、错误码、审计动作或 API path。
7. 禁止绕过 schema versioning、RuntimeContext、audit logs、command-driven state transitions。
8. 禁止提交 `.env`、真实 API key、私钥、密钥文件。
9. 禁止大范围无关重构。
10. 禁止顺手实现本次任务之外的额外功能。

如发现契约缺失、类型冲突或实现无法与契约对齐，必须停止并报告，不要自行脑补修复。

## 4. 每次 AI Coding 任务必须填写的信息

每次向 AI Coding 工具发起任务前，必须明确填写：

- 当前分支
- 本次任务
- 允许修改范围
- 禁止修改范围
- 验证命令

示例：

```text
当前分支：
- feature/web-schema-renderer

本次任务：
- 实现 Renderer 对 choice.radio 和 input.textarea 的渲染。

允许修改：
- apps/web/src/features/schema-renderer/**
- apps/web/src/components/**

禁止修改：
- labelhub-architecture-contract.md
- packages/contracts
- .env 或任何真实密钥文件
- 与 Renderer 无关的模块

验证命令：
- npm run typecheck
- npm run test
```
## 4.1 比赛项目开发哲学

本项目是比赛项目，但不采用“临时能跑、后面再重构”的开发方式。

所有 AI Coding 任务都必须以一次性生成可合并、可测试、可维护、可扩展的实现为目标。

允许分阶段实现，但每个阶段都必须满足：

1. 边界清晰；
2. 类型严格；
3. 不绕过契约；
4. 不使用 `any`；
5. 不留下会导致返工的临时结构；
6. 核心路径有测试；
7. 错误状态和非法状态有处理；
8. 可以进入 PR review。

禁止为了快速完成而：

1. 硬编码只适用于 demo 的特殊逻辑；
2. 在页面层重复实现 schema / workflow 规则；
3. 发明契约中不存在的字段名、状态名、错误码或 API path；
4. 用 TODO 代替必要实现；
5. 为了通过编译而修改 `packages/contracts`；
6. 只实现 happy path，不处理非法状态；
7. 写后续必然需要推倒重来的代码。

如果某个需求范围过大，AI 必须先报告风险，并提出分阶段方案，而不是直接写临时方案。

## 5. 修改前必须先输出实现计划

AI 修改代码前，必须先输出简短实现计划。

计划至少包含：

1. 将阅读哪些文件。
2. 将修改哪些文件。
3. 如何引用 `@labelhub/contracts`。
4. 如何验证结果。
5. 是否存在契约风险。

如果任务存在契约冲突，AI 必须先报告冲突并暂停，不得直接改代码。

## 6. 修改完成后必须总结

AI 修改完成后，必须总结：

- 修改文件
- 实现内容
- 运行检查
- 未解决风险

如果无法运行检查，必须说明原因，例如缺少依赖、缺少前端项目、当前环境没有 Docker 或 npm。

## 7. 验证要求

优先运行与任务相关的检查。

contracts：

```bash
cd packages/contracts
npm run typecheck
npm run test
```

前端：

```bash
cd apps/web
npm run typecheck
npm run test
```

后端：

```bash
cd apps/api
npm run typecheck
npm run test
```

Docker：

```bash
docker compose config
docker compose up --build
```

如果当前仓库尚未提供对应 package 或脚本，AI 必须说明无法运行的原因，并尽量执行可替代的静态检查。

## 8. 通用 Prompt 模板

以下模板可直接复制给任意 AI Coding 工具使用。

```text
语言与风格约定：

1. 本项目工作语言统一为中文。
2. 文档、代码注释、README、错误提示、测试描述、UI 文案使用中文。
3. TypeScript 类型名、接口名、变量名、函数名、枚举值、API 路径使用英文。
4. 不要在同一个文件中混用中英文注释。

任务背景：

本项目是 LabelHub，采用 contract-driven 开发。
最高契约是 `labelhub-architecture-contract.md v1.1`。
共享类型唯一来源是 `packages/contracts`。
所有实现必须引用 `@labelhub/contracts`。

当前分支：

- {填写当前分支，例如 feature/schema-core}

本次任务：

请实现：{填写具体任务}

允许修改：

- {填写允许修改的目录或文件}

禁止修改：

- `labelhub-architecture-contract.md`
- `packages/contracts`
- `.env` 或任何真实密钥文件
- 与本任务无关的模块

实现要求：

1. 不允许使用 `any`，灵活数据使用 `unknown`。
2. 不允许重新定义契约类型。
3. 不允许发明新的字段名、状态名、API path。
4. 不允许大范围无关重构。
5. 不允许为了通过编译而修改契约。
6. 发现契约缺失、类型冲突或实现无法对齐时，停止并报告，不要自行脑补。
7. 先输出实现计划，再修改代码。
8. 每次任务只解决本次指定问题，不要顺手做额外功能。
9. 完成后运行 typecheck 和 test。
10. 如果无法运行检查，说明原因。
11. 最后总结：
    - 修改了哪些文件
    - 实现了什么
    - 运行了哪些检查
    - 是否有未解决风险
```

## 9. 契约变更流程

原则上业务任务不得修改契约。

如果确实需要契约变更，必须单独发起契约变更任务，并按以下顺序执行：

1. 审查变更是否符合 `labelhub-architecture-contract.md v1.1` 的服务边界。
2. 更新 `labelhub-architecture-contract.md`。
3. 更新 `packages/contracts`。
4. 更新契约测试。
5. 运行 contracts typecheck 和 contracts test。
6. 再更新前端、后端、Worker、Mock。

禁止在业务实现 PR 中夹带未经说明的契约变更。
