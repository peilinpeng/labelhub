# AGENTS.md — Codex 入口（动态表单架构）

> 本文件供 Codex 自动读取。Claude Code 不读本文件，但读取相同的共享大脑。
> 两个工具按时间轮班，做同样的活，遵守同一套规则。

## 开始任何操作之前

**必须先完整阅读这两份文件，并严格遵守：**

1. `SCHEMA_ARCH_AGENT.md` — 共享工作上下文（身份、技术栈、文件边界、contracts 铁律、目标态 vs 本轮范围）
2. `HANDOFF.md` — 当前轮班交接状态（当前任务、git 基线、上一班遗留、下一步指令）

本文件只列最硬的红线；完整规则以 `SCHEMA_ARCH_AGENT.md` 为准。

## 当前分支

```txt
feature/schema-governance-upgrade
```

- 不要切换到 main，不要 commit 到 main。

## 文件边界

### 允许修改（架构师范围）

```txt
packages/schema-core/
packages/schema-renderer/
packages/schema-designer/
packages/contracts/          # 谨慎：破坏性变更必须先停下报告
apps/web/
```

### 禁止修改

```txt
packages/workflow-core/
packages/db/
packages/worker/
packages/export/
apps/api/
docs/CLAUDE.md               # 后端同学的 agent 文件
labelhub-architecture-contract.md
AI_CODING_RULES.md
.env
任何真实密钥文件
```

## 架构约束（不可绕过）

web 层不要重复实现以下逻辑，必须复用 schema 包：

```txt
schema traversal
visibleWhen
validation
normalization
```

组件使用约定：

```txt
Owner    → SchemaDesigner
Labeler  → SchemaRenderer LABELING
Reviewer → SchemaRenderer REVIEW_READONLY / REVIEW_DIFF
```

如果组件 props 缺失，**停下来报告**，不要绕过组件包自行实现。

## 不可违反的红线（摘要）

1. **不要 commit / push**，除非 `HANDOFF.md` 当前任务明确要求。
2. **不要做 contracts 破坏性变更**；必须改 `packages/contracts` 时先停下报告。
3. **设计文档是目标态，不是本轮范围**；本轮做什么以 `HANDOFF.md` 为准；想超范围先停下问人。
4. **不要伪造 hash**，不要把完整 answers / prompt / raw output 写入 audit。
5. **交班前工作区必须可编译、typecheck 通过**；做不到则在 `HANDOFF.md` 标注「未完成，卡在 X」。

## 开班 / 收班动作

- **开班**：读上面两份文件 → 跑 `git status` / `git rev-parse HEAD` 核对基线 → 读当前任务相关真实代码，再动手。
- **收班**：保证可编译 → 更新 `HANDOFF.md`（改了什么、是否触边界、遗留问题、下一步、最新 commit/状态）。

> 代码是唯一真相。接手时读真实代码，不要只信上一班的总结。
