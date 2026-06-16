# LabelHub AI Coding 过程记录

> 对照课题《§八 提交物清单 · 相关文档》中的「AI Coding 过程记录」。
> 本文记录开发过程中如何使用 AI Coding 工具、关键技术决策与协作约束。
> 涉及的契约与规则见 [`AI_CODING_RULES.md`](../AI_CODING_RULES.md) 与 [`labelhub-architecture-contract.md`](../labelhub-architecture-contract.md)。

## 1. 概览

- 开发周期：2026-05-24 ~ 2026-06-10。
- 提交规模：约 232 次 commit（`feat` 58 · `fix` 48 · `docs` 44 · `chore` 16 · `test` 7 · …）。
- 协作：3 人分工——后端 / 前端 / Agent·Worker（见 `README.md` §三人协作规则）。
- 仓库：monorepo（`apps/web` + `apps/api` + `packages/*`），分支策略从 `dev` 拉 feature，集成在 `integration/joint-test`。

## 2. AI Coding 工具的使用方式

本项目允许 AI Coding 工具参与，但所有协作都受 [`AI_CODING_RULES.md`](../AI_CODING_RULES.md) 约束，核心做法：

1. **契约驱动（contract-driven）**：最高契约是 `labelhub-architecture-contract.md v1.1`，共享类型唯一来源是 `packages/contracts`。AI 生成的任何实现都必须 `import` 自 `@labelhub/contracts`，禁止在业务模块重新定义契约类型。
2. **先计划后修改**：AI 在改动代码前先输出实现计划，改完后总结「修改了哪些文件 / 实现了什么 / 跑了哪些检查 / 还有什么未解决风险」。
3. **类型安全红线**：禁止 `any`，灵活数据用 `unknown`；schema 中禁止注入任意 JavaScript 函数（表达式走受限 Expression 契约）。
4. **不绕过治理面**：不允许绕过 schema versioning、RuntimeContext、audit logs、命令驱动状态机。
5. **人工把关**：AI 产出经人工 review 后才合入；接口/状态/错误码/审计动作必须与契约一致。

实际使用的工具与典型 prompt 模式：

- **先读契约再动手**：每次让 AI 开工前，强制其先读 `labelhub-architecture-contract.md` 与 `AI_CODING_RULES.md`（每个子包的 `CLAUDE.md` 顶部也写明「读我之前先读这两个文件」），再描述要改的接口/状态/错误码，避免 AI 凭空发明类型。
- **用测试反向约束生成**：hash 一致性、契约类型、状态机迁移都先有 test vectors / pytest 用例，再让 AI 实现到「测试通过」为止；前后端 hash 用同一组 vectors 逐字节对齐，AI 改完立即跑 `pytest -m "not integration"` 与 `e2e_test.sh` 验证。
- **计划—改动—自检三段式**：AI 改代码前先输出实现计划，改完总结「改了哪些文件 / 实现了什么 / 跑了哪些检查 / 还有什么未解决风险」，人工据此 review。
- **边界约束**：按 monorepo 文件边界给 AI 划定可改目录（如后端只动 `apps/api/`），契约包与架构契约文件设为只读，防止 AI 顺手改动共享契约。

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

- 前端 / 共享库：`typecheck`、`build`、`test`（含 84 个 contracts 测试、前后端 hash test vectors）。
- 后端：`pytest`（单元 + 集成）、`bash apps/api/scripts/e2e_test.sh` 端到端。
- 提交前：`git diff --check`。

过程中发现并修正的 AI 产出问题（「AI 产出需人工校验」的实证）：

- **假文案 / 写死时间戳**：标注台早期版本里 AI 生成了写死的「已保存」提示和占位时间戳，被替换为基于真实草稿接口的自动保存逻辑（见 `feat(labeler): 草稿真实自动保存（替换写死的…假文案）`）。
- **「半个改动」比不改更危险**：收尾阶段「打回意见回传」功能，一次提交（`f30af86`）让后端 `get_assignment_context` 在 `RETURNED` 状态返回序列化后的 `ReviewResult` dict，却漏改了响应模型字段 `lastReturnReason: str | None`——类型层与序列化层不一致，导致该接口在打回态直接 500，恰好砸掉「标注员看打回意见→修改重提」主线。通过复跑类型校验/pytest 定位，补上 `dict | None`（`3fd2551`）才闭环。说明 AI/自动化产出的「结构正确但端到端类型不一致」最隐蔽，必须人工跑一遍真实链路验收。

## 6. 经验小结

1. **契约先行是多人 + AI 协作的地基**：把共享类型收敛到 `packages/contracts` 这一唯一事实源后，三人 + AI 并行开发的接口对齐成本和返工大幅下降——AI 即使理解有偏差，也会被契约和 typecheck 挡在合入之前。
2. **测试是约束 AI 最有效的「需求说明」**：与其反复用自然语言描述期望，不如先写 test vectors / pytest 用例，让 AI 实现到测试通过；hash 一致性、状态机这类强约束环节尤其明显。
3. **AI 提效明显的是「有契约、有测试兜底」的实现层；必须人工兜底的是端到端一致性与真实链路验收**——类型层、序列化层、前端读取三处的形状一致性，单看任一处都「对」，串起来才暴露问题，这一环 AI 难以自查，必须人工跑真实链路。
