# LabelHub AI Coding 过程记录

> 对照课题《§八 提交物清单 · 相关文档》中的「AI Coding 过程记录」。
> 本文记录开发过程中如何使用 AI Coding 工具、关键技术决策与协作约束。
> 涉及的契约与规则见 [`AI_CODING_RULES.md`](../AI_CODING_RULES.md) 与 [`labelhub-architecture-contract.md`](../labelhub-architecture-contract.md)。
>
> 注：方括号 `〔…〕` 处为可补充个人细节的占位，提交前按实际情况填写或删除。

## 1. 概览

- 开发周期：2026-05-24 ~ 2026-06-10。
- 提交规模：约 208 次 commit（`feat` 57 · `fix` 42 · `docs` 35 · `test` 7 · …）。
- 协作：3 人分工——后端 / 前端 / Agent·Worker（见 `README.md` §三人协作规则）。
- 仓库：monorepo（`apps/web` + `apps/api` + `packages/*`），分支策略从 `dev` 拉 feature，集成在 `integration/joint-test`。

## 2. AI Coding 工具的使用方式

本项目允许 AI Coding 工具参与，但所有协作都受 [`AI_CODING_RULES.md`](../AI_CODING_RULES.md) 约束，核心做法：

1. **契约驱动（contract-driven）**：最高契约是 `labelhub-architecture-contract.md v1.1`，共享类型唯一来源是 `packages/contracts`。AI 生成的任何实现都必须 `import` 自 `@labelhub/contracts`，禁止在业务模块重新定义契约类型。
2. **先计划后修改**：AI 在改动代码前先输出实现计划，改完后总结「修改了哪些文件 / 实现了什么 / 跑了哪些检查 / 还有什么未解决风险」。
3. **类型安全红线**：禁止 `any`，灵活数据用 `unknown`；schema 中禁止注入任意 JavaScript 函数（表达式走受限 Expression 契约）。
4. **不绕过治理面**：不允许绕过 schema versioning、RuntimeContext、audit logs、命令驱动状态机。
5. **人工把关**：AI 产出经人工 review 后才合入；接口/状态/错误码/审计动作必须与契约一致。

〔可补充：你实际使用的工具与典型 prompt 模式，例如让 AI 先读两个契约文件再动手、用测试反向约束生成结果等。〕

## 3. 分阶段开发脉络

| 阶段 | 时间 | 重点 | 代表性 commit |
|---|---|---|---|
| 基础框架 | 05-24 起 | monorepo、契约、FastAPI 入口、数据库模型、鉴权中间件 | `chore: initialize labelhub project foundation` |
| 动态 Schema 内核 | — | schema-core/renderer/designer，Designer/Renderer 解耦，canonical JSON | `feat(renderer)` / `feat(schema-designer)` 系列 |
| 标注台 Runtime | ~06-07 | 真实草稿自动保存、富文本、字段联动、批量编辑 | `feat(labeler): 草稿真实自动保存`、`feat(web): container.tabs 多 Tab` |
| AI 预审 + Assist | ~06-09 | 异步结构化预审、AI Assist preflight、采纳/忽略动作 + 审计 | `feat(contracts): add ai assist actions`、`feat(api): persist ai assist actions` |
| 审核与质量中心 | ~06-09 | Reviewer 详情重构、字段级 Diff、质量中心面板 | `feat(web): rework reviewer detail layout`、`feat(web): add full quality center dashboard` |
| Schema 版本管理 | 06-09~10 | 版本历史、兼容性检查、Breaking Change 前端阻断显化 | `feat: surface schema version management`、`feat(web): surface owner schema version management` |
| 收尾打磨 | 06-10 | Reviewer/Labeler/Owner UI 优化、AI config 权重 slider 归一化 | `feat(web): add normalized ai review weight sliders` |

## 4. 关键技术决策（AI 协作下的取舍）

- **Designer/Renderer 解耦 + 自有 canonical Schema**：以 `root` 树 + `kind` 为唯一事实源，同一份 schema 同时驱动 Designer 预览与 Labeler 运行时；不把第三方表单库协议暴露进契约，避免被库锁定。
- **AI 建议不绕过表单规则**：AI Assist 的 `suggestedPatch` 先经 headless preflight 预演，破坏表单规则（BLOCKED）的建议不能一键采纳，但可显式忽略（复用 `AI_ASSIST_DISMISSED`）。AI 只产出结论与评分，不改写答案。
- **命令驱动状态机 + 双轨审计**：task/assignment/submission/export 全状态迁移可追溯，审计与业务同事务；审计只记录字段名、patch 数量与摘要，不落完整答案。
- **前后端 hash 一致**：`canonical-json-v1 + SHA-256`，后端 `app/utils/hashing.py` 与前端 `packages/schema-core` 用同一组 test vectors 逐字节校验。
- **AI 异步预审**：Celery + 真实 LLM（temperature=0 提升评分稳定）+ 结构化 JSON 解析容错 + 人工兜底。
- **Schema 版本管理边界**：已落地不可变版本快照、发布前兼容性检查、Breaking Change 前端阻断、copy-to-draft / rollback、任务绑定版本；**历史答卷批量迁移 / migration execution pipeline / 迁移审批流为下一阶段计划，未实现**（默认不迁移旧答卷）。

## 5. 质量保障

AI 生成的代码统一纳入自动化校验（命令见 `README.md` §测试与验证、`docs/LabelHub_Final_Delivery.md` §6）：

- 前端 / 共享库：`typecheck`、`build`、`test`（含 33 个 contracts 测试、前后端 hash test vectors）。
- 后端：`pytest`（单元 + 集成）、`bash apps/api/scripts/e2e_test.sh` 端到端。
- 提交前：`git diff --check`。

〔可补充：你在过程中发现并修正的 AI 产出问题，例如假文案 / 写死时间戳被替换为真实逻辑（见 `feat(labeler): 草稿真实自动保存（替换写死的…假文案）`）等，作为「AI 产出需人工校验」的实证。〕

## 6. 经验小结

〔1–3 条你自己的体会，例如：契约先行如何降低多人 + AI 协作的返工；如何用测试约束 AI 生成；哪些环节 AI 提效明显、哪些必须人工兜底。〕
