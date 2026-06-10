# FORMILY_ARCH_DECISIONS.md — Schema Runtime Engine v2 架构决策记录

> 日期：2026-06-06
> 决策人：维护者（peilinpeng）
> 依据：coder 技术审查报告 + 架构师判断
> 本文件是 FE-1 至 FE-14 任务执行的**约束前提**。
> 所有 coder 在实施前必须先读本文件，遇到与决策冲突的设计请先停下报告。

---

## 核心原则：竞赛优先级

**可演示的完整故事线 > 技术深度 > 代码覆盖率**

遇到时间压力或取舍时，按以下顺序决定做什么、放弃什么：

1. **最高优先**：保证 demo 故事线能从头跑通（见设计文档 §17）：
   Designer 配联动 → Compiler 编译 → AI patch preflight 拦截 → Reviewer diff → Passport 生成
2. **次优先**：每个模块有真实数据和可见效果，不用 hardcoded mock 替代
3. **可牺牲**：完整的错误处理边界、100% 测试覆盖、性能优化、Phase 6 内容

**当某个功能做到一半时间不够用，优先选择"做浅但能串进故事线"而不是"做深但孤立存在"。**

---

## 决策 1：linkageRules 与 visibleWhen/disabledWhen 共存策略

**决定：选项 B——新增可选字段，向后兼容。**

- `BaseFieldNode` 新增 `linkageRules?: FieldLinkageRule[]`（可选字段，不破坏现有类型消费方）。
- 现有 `visibleWhen` / `disabledWhen` 保留，继续有效。
- Compiler 同时处理两种形式：`visibleWhen/disabledWhen` 作为简化语法糖，`linkageRules` 作为完整 DSL。
- 不做 migration，不删除旧字段。

**禁止：** 不要在 FE-4/5/6 中把 `visibleWhen/disabledWhen` 从 contracts 删除或标记 deprecated。

---

## 决策 2：clearWhenHidden vs preserveWhenHidden 命名

**决定：contracts 继续使用 `preserveWhenHidden`，Compiler 内部转换。**

- contracts 中不新增 `clearWhenHidden` 字段（避免双重语意和误用）。
- Compiler 和 Sandbox 内部使用 `!preserveWhenHidden` 等价于 `clearWhenHidden`。
- 设计文档里的 `clearWhenHidden` 是业务语意描述，不是 contracts 字段名。
- 现有所有 schema JSON、mock 数据、测试全部不需要改。

---

## 决策 3：Formily 版本

**决定：使用 `@formily/core@^2` + `@formily/react@^2`（稳定版）。**

- 不追最新 major 版本，避免 API 不稳定。
- React 18 兼容性已确认无问题。
- Phase 1 最小安装：`@formily/core` + `@formily/react`。
- `@formily/react-schema-renderer` 暂不安装，Phase 2 接入 Compiler 后再评估。

---

## 决策 4：FieldLinkageRule 类型定义策略

**决定：在 FE-4 实施前审查阶段，由 coder 起草 `FieldLinkageRule` TypeScript 类型定义，维护者确认后再写实现代码。**

- FE-4 不能直接开始写 Compiler，必须先输出类型定义草稿。
- 类型定义需覆盖设计文档 §6.2 示例（when/effects/otherwise 结构）。
- 参照现有 `Expression` 类型（`contracts/src/schema.ts`），`when` 条件尽量复用现有 Expression 而不另起炉灶。
- 维护者确认类型定义后，FE-4 才能继续写 parser.ts 和 dependency-graph.ts。

---

## 决策 5：schema-compiler 性能隔离策略

**决定：Phase 2 在主线程运行，不做 WebWorker 隔离，不做 compile cache。**

- 竞赛阶段 schema 规模不需要 Worker 隔离。
- cache 策略（按 schemaVersionId 缓存编译结果）推迟到 Phase 6。
- FE-4/5/6 专注正确性，不做性能优化。

---

## 决策 6：dnd-kit 引入

**决定：确认引入 dnd-kit，用于 Schema Designer。**

- 安装 `@dnd-kit/core` + `@dnd-kit/sortable`。
- dnd-kit 只进入 `packages/schema-designer`，不进入 `packages/schema-renderer`（标注运行时）。
- FE-11 开始时安装，在此之前不引入。

---

## 决策 7：SSR 支持

**决定：忽略 SSR，当前是 Vite SPA，不需要服务端渲染兼容。**

- @formily/react 的 SSR 限制不影响当前架构。
- 后续若引入 SSR 框架，届时再处理。

---

## 决策 8：Phase 3 preflight 的 runtimeContext 来源

**决定：Reviewer patch preflight 使用 Labeler 的 runtimeContext。**

- preflight 预演的是"在表单原始运行环境里，这个 patch 是否合法"，必须用 Labeler 视角求值 visibleWhen。
- 用 Reviewer context 会导致 Labeler 专属字段被误判为 inactive，合法 patch 被错误拒绝。
- **执行要求（FE-7 时确认）：**
  - 检查 `ReviewDetailResponse` 是否包含 Labeler 的 `runtimeContext`。
  - 如果没有：报告给维护者，不要自行假设，等待决定（选项是从 API 带过来，或用 schema 默认 context 做 fallback）。
  - 不要用 Reviewer 的当前 context 代替。

---

## 任务列表与执行顺序

### 竞赛最小可展示路径（优先完成）

```
FE-1 → FE-2 → FE-4 → FE-5 → FE-7 → FE-8
```

> 注意：coder 审查报告建议的 "FE-1 → FE-2 → FE-7 → FE-8" 有依赖缺口——
> FE-7（preflight）依赖 FE-5（FormilyReactionVisitor），FE-5 依赖 FE-4（DependencyGraph）。
> 必须按上面修正后的顺序执行。

### 完整任务列表

| 任务 ID | Phase | 任务名称 | 前置 |
|---|---|---|---|
| FE-1 | Phase 1a | 安装 Formily + Component Registry + FormilyRuntimeRenderer shell | 无 |
| FE-2 | Phase 1b | 7 个 input 组件包装为 Formily adapters + feature flag 接入 SchemaRenderer | FE-1 |
| FE-3 | Phase 1c | Formily answers 同步策略（debounce + flush on submit）+ 新测试 | FE-2 |
| FE-4 | Phase 2a | 新建 schema-compiler 包 + FieldLinkageRule 类型定义（须等维护者确认）+ DependencyGraphVisitor | FE-1 |
| FE-5 | Phase 2b | FormilyReactionVisitor + basic linkage demo（visible/disabled/required/clearValue）+ 静态字段引用检查 | FE-4 |
| FE-6 | Phase 2c | 循环依赖 DFS 检测 + contracts BaseFieldNode.linkageRules 新增 | FE-5 |
| FE-7 | Phase 3a | schema-core 新增 runSchemaPreflight + buildFieldStates + detectIllegalFieldMutation | FE-5 |
| FE-8 | Phase 3b | LLMAssistRenderer 接入 preflight（SAFE/RISKY/REJECTED 三态 UI）+ integration tests | FE-7 |
| FE-9 | Phase 4a | Runtime Trace Event 类型 + Trace Panel 骨架 | FE-7 |
| FE-10 | Phase 4b | Dependency Graph 可视化 + Field Inspector | FE-9 |
| FE-11 | Phase 5a | schema-designer 接入 dnd-kit（Palette → Canvas 拖入 + 字段排序） | FE-2 |
| FE-12 | Phase 5b | Linkage Rule Builder（可视化配置一条 when-then-otherwise 规则） | FE-11, FE-6 |
| FE-13 | Phase 5c | Designer Publish 前 preflight | FE-12, FE-7 |
| FE-14 | Phase 6 | Virtual List + Lazy container + schema compile cache | FE-5 |

---

## 禁止事项（对所有 FE-* 任务全局有效）

- 不要修改 `visibleWhen` / `disabledWhen` 现有字段或语意。
- 不要在 contracts 中新增 `clearWhenHidden` 字段。
- 不要把 Formily 协议（`x-reactions`、`x-validator`、`x-component`）暴露在 LabelHub contracts 中。
- 不要在 schema-renderer（标注运行时）中引入 dnd-kit。
- 不要在 Phase 1/2/3 中修改 LLMAssistRenderer 的 patch 应用逻辑（Phase 3b FE-8 才触碰）。
- feature flag 默认值必须是 `"legacy"`，不能默认开 formily-v2。
- 不要 commit，不要 push，除非维护者明确要求。
