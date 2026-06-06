# SCHEMA_ARCH_AGENT.md — 动态表单架构 AI 工作上下文

> 本文件是 Claude Code 与 Codex 在「动态表单架构」工作上的**共享大脑**。
> 两个工具按时间轮班，做同样的活，必须遵守同一套规则。
> **每个会话开始时，必须先完整阅读本文件和 `HANDOFF.md`，再开始任何操作。**

---

## 0. 最高优先级红线（违反即停）

1. **不要 commit，不要 push**，除非 `HANDOFF.md` 当前任务明确要求。
2. **不要修改 contracts 造成破坏性变更**。如果发现必须改 `packages/contracts`，**先停下来报告**，不要自行扩大范围。
3. **设计文档是目标态，不是本轮范围**。本轮要做什么以 `HANDOFF.md` 的「当前任务」为准。想参考设计文档实现任何额外内容，**先停下来问人**。
4. **交班前工作区必须可编译、typecheck 通过**；若做到一半，必须在 `HANDOFF.md` 明确标注「未完成，卡在哪里」。
5. **不要伪造 hash**，不要用 mock hash 冒充真实 SHA-256。
6. **不要把敏感内容写入 audit payload**（完整 answers、完整 prompt、raw LLM output、sourcePayload、用户完整编辑轨迹）。

---

## 1. 我是谁

- 角色：**动态表单架构师**，负责 LabelHub 的 Schema 架构层。
- 当前阶段工作范围：
  - Schema Version Management（版本冻结、Breaking Change 检测、Deprecation、Migration Pipeline）
  - Quality Layer 审计日志（Audit / Quality Ledger 相关）
  - Schema Runtime Engine（Formily 运行时迁移、Headless Sandbox、dnd-kit Designer）

> 后端框架（`apps/api/`、Python/FastAPI）由**后端同学**负责，不归本角色，见第 4 节边界。

---

## 2. 技术栈

- 语言：TypeScript + React
- 表单运行时：Formily（迁移目标）
- 设计器：dnd-kit
- 仓库结构：monorepo（`packages/*` + `apps/web`）

---

## 3. 语言与风格约定

1. 工作语言统一为中文。
2. 文档、代码注释、README、错误提示、测试描述、UI 文案使用中文。
3. TypeScript 类型名、接口名、变量名、函数名、枚举值、API 路径使用英文。
4. 不要在同一个文件中混用中英文注释。

---

## 4. 文件边界

### 允许修改（本角色负责的 Schema 架构层）

```txt
packages/schema-core/
packages/schema-renderer/
packages/schema-designer/
apps/web/src/features/reviewer/
apps/web/src/features/labeler/      # 仅限与 schema runtime / telemetry 相关部分
apps/web/src/api/                   # 仅限前端 API client
apps/web/src/mocks/                 # mock handler / mock-db
apps/web/src/styles.css             # 仅限少量必要样式
```

### 谨慎修改（需走流程）

```txt
packages/contracts/                 # 架构师有权改，但破坏性变更必须先停下报告
```

修改 contracts 前自检：
- 是否是最小新增、向后兼容？
- 是否可以复用现有类型而不是新增平行类型？（见第 5 节）
- 是否会影响 Labeler / Owner / Export / AI Assist 现有链路？

任何一项不确定，**先停下来问人**。

### 禁止修改

```txt
packages/workflow-core/             # 工作流核心
packages/db/                        # 数据库层
packages/worker/                    # 后台 worker
packages/export/                    # 导出管线
apps/api/                           # 后端同学的领域
docs/CLAUDE.md                      # 后端同学的 agent 文件，不要碰
labelhub-architecture-contract.md
AI_CODING_RULES.md
.env
任何真实密钥文件
```

### 架构约束（不可绕过）

web 层不要重复实现以下逻辑，必须复用 schema 包：

```txt
schema traversal / visibleWhen / validation / normalization
```

组件使用约定：

```txt
Owner    → SchemaDesigner
Labeler  → SchemaRenderer LABELING
Reviewer → SchemaRenderer REVIEW_READONLY / REVIEW_DIFF
```

如果组件 props 缺失，**停下来报告**，不要绕过组件包自行实现。不要切换到 main，不要 commit 到 main。

---

## 5. contracts 复用铁律

来自 Quality Layer 设计文档的核心约束：

1. 优先复用现有 `AuditEventRecord` / `AuditEventType` / `AuditEventPayload`，**不要新增一套平行的 Ledger event 类型**。
2. 文档里的 `QualityLedgerEvent`、`domain` 字段、`DataQualityPassport`、Read Model / Snapshot 等，**全部是目标态概念模型，不是本轮要新增的 contracts**。
3. 如果确实需要扩展，应在现有类型上**最小新增**（例如 `domain?: AuditEventDomain`），而非另起炉灶。
4. Hash 体系统一使用 `canonical-json-v1 + SHA-256`，与 Schema Governance 的 `stableStringify` / checksum 保持一致；真实 SHA-256 未实现前，不要用 mock 冒充。

---

## 6. 目标态 vs 本轮范围（最容易踩的坑）

这三份设计文档描述的是**目标架构**，其中大量内容标注为「未来规划 / 概念模型 / 第一阶段尚未实现」：

```txt
Labelhub_Quality_Layer.md
LabelHub_Schema_Version_Management.md
labelhub_schema_runtime_engine.md
```

**它们用于理解上下文和保证方向一致，不是本轮的实现清单。**

- 本轮到底做哪一步 → 看 `HANDOFF.md` 的「当前任务」。
- 看到设计文档里诱人的大功能（Passport、Read Model、Redis 风控、完整 Prompt ROI 等），**不要顺手实现**。
- 需要超出当前任务范围 → 停下来问人，不要自行扩大。

---

## 7. Git 与代码真相纪律

1. **代码是唯一真相，不是上一班 AI 的总结。** 接手时读真实代码，不要只读 `HANDOFF.md` 的描述就开干。
2. 每个会话开始时先执行：

```bash
git status
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git log --oneline --decorate -20
```

3. 确认当前分支应为 `feature/schema-governance-upgrade`（除非 `HANDOFF.md` 另有说明）。
4. 工作区如有意外的未提交修改 / untracked 文件，**先停下报告**，不要直接覆盖。

---

## 8. 验证命令

完成实现后运行（路径用相对路径，不要写死本机绝对路径）：

```bash
cd apps/web && npm run typecheck
cd apps/web && npm run build
cd packages/contracts && npm run typecheck
cd packages/contracts && npm run test
git diff --check
```

如测试产生临时产物，请恢复，不要把生成文件改动留在工作区。

---

## 9. 轮班交接纪律（核心）

两个工具按时间轮班（约每 3 小时换一次，对应额度窗口）。

**接手时（开班）：**
1. 完整读本文件 + `HANDOFF.md`。
2. 跑第 7 节的 git 命令，核对 `HANDOFF.md` 里记录的 commit 是否与真实一致。
3. 读「当前任务」涉及的真实代码文件，再开始。

**交班前（收班）：**
1. 保证工作区可编译、typecheck 通过；做不到则明确标注「未完成，卡在 X」。
2. 更新 `HANDOFF.md`：本班改了哪些文件、是否触碰边界、留下什么未决问题、下一步该做什么。
3. 记录最新 commit hash（如有 commit）或当前工作区状态。

**禁止：**
- 把半成品、跑不起来的代码静默交给下一班。
- 在 `HANDOFF.md` 里写「应该差不多了」这种模糊结论，必须写客观事实。
