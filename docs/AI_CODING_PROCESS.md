# LabelHub AI Coding 过程与开发记录

> 这是 LabelHub 这一 AI 辅助数据标注与质量治理平台的开发过程记录。

**用途** — 本文档是一份交付 / 答辩材料，用于说明 LabelHub 如何通过 **AI 辅助编码 + 人工审查 + 小步验证** 的工作流完成开发：项目实际完成了什么，每项改动如何验证，以及哪些能力被明确界定为后续工作。

> **状态：定稿。** 本文件已落位于 `docs/AI_CODING_PROCESS.md`，作为仓库内的 AI Coding 过程记录交付材料。

---

## 0. 范围与基本原则

本记录基于项目自身的契约和开发规则撰写，而不是基于营销式表述：

* 顶层架构契约为 `labelhub-architecture-contract.md v1.1`。
* 共享类型的单一来源是 `packages/contracts`；所有层都导入 `@labelhub/contracts`，不得重新定义契约类型（见 `AI_CODING_RULES.md` 第 2–3 节）。
* 三人分工：前端负责 `apps/web` 以及 Designer / Renderer；后端负责 `apps/api`、数据库、API、状态机、审计和上传；Agent / Worker 负责人负责 AI Review、LLM 调用和导出 worker（见 `README.md` 中“三人协作规则”）。

凡是部分完成的能力，本文档都会明确标注为部分完成。我们刻意避免使用诸如 “AI fully implemented the system”、“fully automated migration execution” 或 “production-ready migration pipeline” 这类夸大表述。

---

## 1. 项目开发阶段

### 阶段一：契约与基础架构

**目标** — 先定义贯穿全系统的契约，使 Owner / Labeler / Reviewer 三类角色能够基于同一套共享数据模型协作，而不是各自形成三套分裂的数据结构。

**主要工作**

* 建立共享 TypeScript contracts 包：包括全局类型、错误码、审计日志、动态 schema 与组件注册表、Designer / Renderer 契约、workflow / review / AI-review / export / file-upload 契约，以及 API 请求 / 响应类型。
* 建立 Runtime Context 模型，即 `packages/contracts/src/global.ts` 中的 `LabelHubRuntimeContext`，用于可见性控制、校验和 AI binding。
* 搭建 Docker Compose 拓扑：`web`、`api`、`worker`、`mysql`、`redis`（见 `README.md` 中 “Docker 启动”）。
* 建立 MSW mock 层（`apps/web/src/mocks`），使三类角色页面可以在真实后端完全就绪前并行开发，同时使用 contract types，而不是重新定义类型。
* 建立基础 API 和 demo seed 数据，用于演示账号和比赛数据集（`scripts/seed_demo.py`、`scripts/seed_competition.py`）。

**关键产出** — 一个带有 contract 测试套件的契约包，一个确定性的 runtime context，以及一个能够模拟主要状态转移的 mock server，包括 claim → draft → submit → AI review → review decision → export → upload。

**相关模块 / 文件** — `packages/contracts/**`、`packages/schema-core/**`、`apps/web/src/mocks/**`、`docker-compose` services、`apps/api/scripts/seed_*.py`。

**验证方式** — `cd packages/contracts && npm run typecheck && npm run test`；跨实现 hash 测试向量（`packages/schema-core/src/__tests__/canonical-hash-vectors.test.ts`）与后端 hashing routine 保持一致。

> **边界说明：** 契约先于业务模块被定义。新的字段、状态和错误码不能在调用现场临时发明（见 `AI_CODING_RULES.md` 第 3.6 节）。

---

### 阶段二：Owner / Labeler / Reviewer 工作流打通

**目标** — 让三类角色围绕同一个任务和同一个提交对象形成闭环，而不是三个彼此孤立的页面。

**主要工作**

* Owner 任务管理：任务配置引导、数据集导入与预览、带真实统计数据的任务详情面板。
* Labeler 任务市场与工作台：支持搜索 / 筛选的任务广场、上一题 / 下一题导航、草稿自动保存、提交时校验、“我的提交”。
* Reviewer 审核队列与详情页：领取、批量领取、审核决策流、批量通过 / 批量退回。
* 提交流程生命周期：assignment submit → AI precheck → review decision → return / revise / pass。

**关键产出** — 一个端到端路径：Owner 创建任务，Labeler 完成作答，AI 进行预检查，Reviewer 完成审核裁决，且这些操作都绑定到同一个 submission 对象上。

**相关模块 / 文件** — `apps/web/src/features/owner/**`、`apps/web/src/features/labeler/**`、`apps/web/src/features/reviewer/**`。

**验证方式** — 手动测试 Owner / Labeler / Reviewer 端到端路由；运行 `npm run typecheck` 和 `npm run build`；mock 与后端审核状态机使用同一套 decision codes 进行验证。

---

### 阶段三：Schema Governance 与版本管理

**目标** — 让动态表单模板可以随时间演进，同时不破坏历史数据。其核心原则来自 `docs/LabelHub_Schema_Version_Management.md`：**默认不迁移，每一次变更都可被识别，每一次迁移都应留下痕迹。**

**主要工作**

* 以 canonical、可序列化的 JSON tree 作为动态 schema 的单一真实来源。
* 契约中已经具备 Schema runtime / version 概念：`task.activeSchemaVersionId`、`schema.schemaVersionId`、`schema.schemaVersionNo`、`schemaDraftRevision`。
* 已发布版本形成不可变快照；任务 / 提交在创建时绑定 `schemaVersionId`。
* 在 Owner UI 中显化版本历史、草稿修订、复制为草稿以及历史保留式回滚语义。
* 使用 `packages/schema-core/src/compatibility.ts` 中的兼容性检查能力，支持 `SAFE / NEEDS_APPROVAL / BREAKING / MIGRATION_REQUIRED` 四类结果，用于**阻断**破坏性发布，并渲染 “migration required” 预览。

**关键产出** — 面向 Owner 的版本状态条、兼容性 badge 和发布结论 banner，避免用户误以为系统会自动完成迁移。

**相关模块 / 文件** — `apps/web/src/features/owner/SchemaVersionPanel.tsx`、`PublishPreviewDialog.tsx`、`OwnerSchemaPage.tsx`；`packages/schema-core/src/{compatibility,schema-versioning,deprecation,migration}.ts`。

**验证方式** — `packages/schema-core` 的 typecheck 与测试套件，包括 compatibility、versioning、deprecation、migration；手动测试 Owner 发布预览。

> **边界说明（后续工作）：** **migration execution backend pipeline**、**历史答卷批量迁移** 和 **migration approval workflow** 并未作为可运行的端到端系统交付。`schema-core` 提供了纯函数构建块，包括 plan / dry-run / execute drafts，以及契约类型；但持久化的、需要管理员审批的、会修改数据库的迁移 pipeline 仍属于后续工作。本文档不会声称它们已经完成。

---

### 阶段四：AI Assist 与质量治理

**目标** — 将 AI 作为一个**受 Schema 约束的质量建议器**，而不是让 AI 自动覆盖人工答案。

**主要工作**

* AI Assist 面板与字段级 `suggestedPatch`：Labeler 侧提供 LLM 辅助建议；Reviewer 侧支持 accept / edit-then-accept / dismiss，相关实现位于 `apps/web/src/features/reviewer/AiAssistPanel.tsx`。
* 应用 patch 前进行确定性的 **preflight** 检查（`packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx`）：检查字段是否存在、应用后是否会产生新的必填缺失、是否符合 schema-runtime 联动逻辑，并返回 `SAFE / WARNING / BLOCKED` 状态。
* 被阻断的建议可以被解释和忽略，而不会被静默应用。
* AI review / AI precheck 会生成结构化的、分维度的评分与理由，并给出 pass / return / needs-human-review 结果。
* Quality Center、Export Passport（附在导出中的 Data Quality Passport）和审计轨迹（`audit_logs` + `audit_events`）。

**关键产出** — 一条质量证据链：AI 参与检查，但受到 Schema Runtime 约束。任何会违反模板规则的建议都会被阻断，而不会被合并。

**相关模块 / 文件** — `apps/web/src/features/reviewer/AiAssistPanel.tsx`、`apps/web/src/features/labeler/AssignmentPage.tsx`、`packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx`、`apps/web/src/features/owner/OwnerQualityCenterPage.tsx`、`OwnerExportPage.tsx`、`AuditTimelinePanel.tsx`。

**验证方式** — `packages/schema-renderer` 的 preflight 测试（`LLMAssistPreflight.test.tsx`）；手动测试 Reviewer accept / dismiss 流程；AI-assist action 与 audit event 的 contract tests。

> **边界说明：** AI 不能绕过 Schema Governance。`outputBinding.requireUserConfirm` 会被强制执行；当 preflight 被阻断时，apply 会被禁用。

---

### 阶段五：UI polish 与端到端验证

**目标** — 在最后阶段停止增加新功能，专注于可演示性、稳定性和交付质量。

**主要工作**

* Reviewer UI polish，包括审核队列与决策流。
* Labeler workspace polish，包括动态字段间距修复，详见第 3.2 节。
* Owner schema version management polish，即显化已有版本管理能力。
* AI config 规则预览卡片对齐。
* AI config 归一化权重滑动条。
* 最终路由测试、稳定 tag 与 backup branch。

**关键产出** — 一个可演示的稳定构建，并具备可恢复的安全点，详见第 4 节。

**相关模块 / 文件** — `apps/web/src/features/{owner,labeler,reviewer}/**`、`apps/web/src/styles.css`。

**验证方式** — `npm run typecheck`、`npm run build`、`git diff --check`；按功能分开提交；在高风险变更前后建立 stable tags 与 backup branches。

---

## 2. AI Coding 的使用方式

AI 在整个开发生命周期中被作为辅助工具使用：

* **组件初稿** — 生成 React 组件和 CSS 的初版，之后由人工调整以适配现有代码风格。
* **Bug 定位** — 缩小缺陷范围，例如判断 CSS selector 是否命中了真实 DOM，或者定位 mock 与后端不一致的位置。
* **代码审查** — 阅读 diff，检查正确性和是否存在范围蔓延。
* **测试思路和 runbook** — 起草验证步骤、交接说明和运行文档。
* **交接与验收** — 生成交接摘要和验收 checklist。
* **文档与演示脚本** — 整理文档和 demo walkthrough。

**但 AI 不是自动合并者。** 每一次 AI 生成的改动都需要经过人工判断、手动测试和 `git diff` 审查。人类负责需求判断、边界控制、人工验收和合并决策。

具体例子包括：

* **Labeler 字段间距** — AI 首先诊断页面 CSS selector 是否命中真实的 `formily-v2` DOM，而不是盲目改样式，详见第 3.2 节。
* **Reviewer 批量审核决策流** — AI 帮助定位状态机和 mock 不一致的问题。
* **Owner Schema Version Management** — AI 先进行只读评估，确认已有工程基础，再做小范围前端显化，而不是重写，详见第 3.3 节。
* **AI config slider** — AI 帮助实现自动归一化逻辑，但最终正确性由人工手测确认，详见第 3.4 节。

---

## 3. 关键迭代记录

### 3.1 Reviewer decision flow

**背景** — 审核不应只是几个按钮，而应该是可记录、可解释、可追踪的质量决策过程。

**定位过程** — 将 UI action modes 与后端 / mock 的审核状态机进行映射。UI 区分三种 action modes（`apps/web/src/features/reviewer/ReviewDetailPage.tsx`）：`PASS`、`RETURN`、`REVISE`；而持久化的 decision 为 `PASS | RETURN`。其中 `REVISE` 会作为一个带字段级 patches 的 `PASS` decision 被承载。

**解决方案** — 建立支持批量领取、批量通过和批量退回的审核队列；`RETURN` 必须填写非空理由；`REVISE` 至少需要一个字段级 patch；这些操作都通过确认步骤进行 gate。历史打回意见会在再次审核时展示。

**为什么这样做** — 审核决策必须可审计，因此状态机和必填理由需要在流程中强制执行，而不能留作可选项。

**验证方式** — 手动测试 Reviewer 端 PASS / RETURN / REVISE 全流程；运行 typecheck 和 build；检查 mock 与后端状态机一致性。

**最终结果** — 形成了一个能够记录理由和字段修订、并与契约中的审核 codes 一致的 decision flow。

---

### 3.2 Labeler dynamic field spacing

**背景** — 动态表单字段的间距显示不正确。

**定位过程** — 问题**不是** schema renderer 写死导致的。真正原因是页面 CSS selector 没有匹配真实的 `formily-v2` DOM：该渲染路径下不存在 `form` / `fieldset` / `legend`。真实结构暴露的是 `data-container-type`、`data-formily-field` 以及 `role="radiogroup" | "group"`，并已在 `apps/web/src/styles.css` 中 labeler runner-form 规则附近注释记录。

**解决方案** — 在 `.labeler-runner-form .labeler-schema-renderer-surface` 作用域下，使用真实的 `data-*` / `role` hooks 编写 page-scoped CSS。

**为什么这样做** — 通过强行样式覆盖来修复表象会很脆弱；匹配真实渲染结构才是最小且正确的修复方式。

**验证方式** — 手动检查 Labeler workspace；运行 typecheck 和 build。

**最终结果** — 在不触碰 renderer 内部实现和 schema 的前提下，修复了字段间距。

---

### 3.3 Owner Schema Version Management

**背景** — Owner 需要可见的 schema 版本管理能力。

**定位过程** — 首先进行只读评估。我们发现 `SchemaVersionPanel`、`PublishPreviewDialog` 和后端 schema-version endpoints 已经存在；`packages/schema-core` 中的 compatibility engine 也已经存在。

**解决方案** — 没有从零重写。仅做前端显化 / polish：增加版本状态条、兼容性 badge 和发布 verdict banner。migration execution 被保留为后续计划。

**为什么这样做** — 尊重已有工程基础，避免重复造轮子（见 `AI_CODING_RULES.md` 第 3.9 节：不做大规模无关重构）。

**验证方式** — 运行 `schema-core` version / compatibility 测试；手动测试 Owner 发布预览。

**最终结果** — 版本管理现在在 Owner UI 中可见、可理解；breaking publish 会被阻断，migration 会被明确标记为 required，而不是被表现成自动执行。

---

### 3.4 AI config normalized weight sliders

**背景** — Review dimension weights 可能不等于 1。mock 示例曾经总和为 0.9。原始 UI 使用数字输入框，只是**建议**总和为 1。

**定位过程** — 确认这个约束应当通过交互来强制，而不是只通过文字提示。

**解决方案**（`apps/web/src/features/owner/OwnerAIPage.tsx`）— 将数字输入框替换为 range sliders。拖动任意一个维度时，其余维度会按照原有比例自动缩放。通过 integer-cents largest-remainder distribution，让所有值精确加总为 1；剩余的 cents 会被确定性吸收。权重在加载时会被归一化，并在保存时再次检查，作为持久化前的安全 gate。

**为什么这样做** — 将 “sum should be 1” 从文字提示转化为前端交互约束，可以减少任务配置错误。

**验证方式** — `npm run typecheck` 和 `npm run build` 均通过；手动测试拖动与保存；作为单一主题提交，commit message 为 `feat(web): add normalized ai review weight sliders`。

**最终结果** — 权重始终加总为 1；非法配置无法被保存。

---

### 3.5 AI suggestedPatch preflight and blocked suggestion

**背景** — AI `suggestedPatch` 不应直接覆盖答案。

**定位过程** — Renderer（`packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx`）在任何 apply 操作前都会运行 `runSchemaPreflight`。

**解决方案** — Preflight 检查字段是否存在、应用后是否会引入新的必填缺失、以及是否符合 Schema Runtime 联动逻辑；返回 `SAFE / WARNING / BLOCKED`。当结果为 blocked 时，apply 被禁用（`canApply = hasSuggestedPatch && !preflightBlocked`），但 dismiss 始终可用。对于 bindings，`outputBinding.requireUserConfirm` 必须为 true。

**为什么这样做** — AI 可以参与质量检查，但不能绕过 Schema Governance。

**验证方式** — `LLMAssistPreflight.test.tsx`；手动测试 Reviewer accept / edit / dismiss 流程。

**最终结果** — AI 被定位为受模板规则约束的建议器；被阻断的建议会被解释，并且可以被忽略，但不会被静默合并。

---

## 4. 验证方式

本项目实际使用过的验证方式包括：

* `npm run typecheck`，用于 web 和 shared packages
* `npm run build`，用于 web
* `git diff --check`，用于检查空白错误和冲突标记
* `git status -sb` 和 `git log --oneline --decorate`，用于确认状态和提交链路
* 手动路由测试
* Owner / Labeler / Reviewer 端到端测试
* 各 package 的 contract / schema-core / schema-renderer 测试套件
* 使用 stable tags 和 backup branches 作为可恢复安全点

**关键稳定点（仓库中的真实 tag / branch）：**

```txt
tag    stable-before-owner-schema-version-ui-0610
tag    stable-after-owner-ai-config-polish-0610
tag    stable-after-reviewer-decision-flow-0610
branch backup/stable-before-owner-schema-version-ui-0610
branch backup/stable-after-owner-ai-config-polish-0610
```

**实践方式** — 每次高风险修改前，先创建 tag 和 backup branch。如果改动失败，可以从已知良好的安全点恢复，而不需要用 `reset` / `restore` / `checkout` 去重写已有工作。

---

## 5. 人工审查与安全边界

整个过程中持续执行的边界包括：

* 修改 `contracts` 或后端前必须确认；不要把这些改动混进业务 PR。
* 不做 fake migration execution。
* 不把未完成能力写成已完成。
* 每个功能单独提交；不把无关改动混在同一个 commit 中。
* 不使用 `force push`；不对已有工作使用 `reset` / `restore` / `checkout`。
* 最终阶段不做大文件重构。

**明确属于后续工作，未作为已完成能力交付：**

* **Migration execution backend pipeline** — 持久化的、会修改数据库的执行阶段。
* **Historical answers batch migration** — 跨 schema 版本批量升级旧提交。
* **Migration approval workflow** — 管理员 Dry Run → Approval → Execute → immutable record 的状态机。

`schema-core` 提供这些能力所需的确定性纯函数片段和共享 contract types，但可运行的端到端系统仍是后续工作。它们不能被描述为已经完成。

---

## 6. 交付总结

LabelHub 采用 **AI 辅助编码 + 人工审查 + 小步验证** 的方式完成开发。AI 被用于生成、定位、审查和文档整理；人类负责产品判断、工程边界、人工验收和合并决策。最终系统形成了 Owner / Labeler / Reviewer 三角色闭环，并围绕 **schema governance**、**确定性的 AI preflight checks** 和 **quality evidence chain**（Data Quality Passport）建立核心亮点。系统支持 history-preserving rollback；migration execution 被明确列为后续工作。

---

## 7. 存放位置

本文件最终落位于 `docs/AI_CODING_PROCESS.md`，作为仓库内的 AI Coding 过程记录；提交物索引 `submission/README.md` 指向此处。
