# LabelHub Schema Runtime Engine v2 技术设计文档

> 文档名称：`labelhub_schema_runtime_engine.md`  
> 项目背景：字节跳动全栈挑战赛 LabelHub 项目  
> 当前阶段：设计方案升级版，用于指导 Codex/开发同学实现  
> 核心定位：Schema-governed, AI-aligned, explainable, high-performance labeling runtime

---

## 0. Executive Summary

LabelHub v2 不再把 `schema_renderer` 定位为一个简单的 JSON-to-UI 渲染器，而是升级为 **Schema Runtime Engine**。

升级后的系统由五个核心能力组成：

1. **Intent-to-Reaction Compiler**  
   将 LabelHub 自有 JSON DSL 编译为 AST，再通过 Visitor Pattern 生成 Formily runtime reaction、Headless Sandbox evaluator、Dependency Graph、Debug Trace 和 Audit metadata。

2. **Headless Schema Sandbox Preflight**  
   在 AI patch、Reviewer patch、Schema 发布和表单提交前，先在无 UI 环境中预演字段联动、运行时校验、隐藏字段策略和非法字段写入，避免 AI 幻觉或复杂联动直接污染前端表单。

3. **Formily Runtime Renderer**  
   使用 Formily 作为前端运行时表单状态引擎，承接字段级状态管理、局部联动、运行时校验和 JSON Schema 驱动渲染；LabelHub Schema 仍然作为平台级 Source of Truth。

4. **dnd-kit Schema Designer**  
   使用 dnd-kit 实现低代码 Schema Designer，支持字段拖拽、容器嵌套、属性编辑、联动配置、校验配置和实时预览。

5. **Runtime Trace Mode**  
   解决低代码响应式系统的“调试黑盒”问题。设计器提供 Dependency Graph、Event Timeline、Field Inspector、Rule Inspector、AI Patch Trace 和 Loop Guard，帮助开发者解释字段为什么显示、隐藏、必填、禁用或报错。

一句话概括：

> LabelHub v2 is not just a dynamic form renderer. It is an explainable schema runtime platform for AI-assisted labeling workflows.

---

## 1. 当前 schema_renderer 现状

根据当前上传的 `schema_renderer` 相关文件，现有架构已经具备一个清晰的轻量动态表单雏形。

### 1.1 当前核心文件

当前 renderer 主要由以下模块组成：

```text
SchemaRenderer.tsx
render-node.tsx
renderers/FieldRenderer.tsx
renderers/ContainerRenderer.tsx
renderers/ShowItemRenderer.tsx
renderers/LLMAssistRenderer.tsx
renderers/ReviewDiffRenderer.tsx
renderers/UnknownNodeFallback.tsx
components/TextInput.tsx
components/TextareaInput.tsx
components/RadioInput.tsx
components/CheckboxInput.tsx
components/SelectInput.tsx
components/TagsInput.tsx
components/FileInput.tsx
components/JsonEditorInput.tsx
types.ts
```

### 1.2 当前优点

当前实现已经具备以下优点：

1. `SchemaRenderer` 已经接入 `normalizeAnswers`、`validateAnswers`、`validateSchemaShape`。
2. `renderNode` 已经按 `CONTAINER`、`FIELD`、`SHOW_ITEM`、`LLM_ASSIST` 分发。
3. `FieldRenderer` 已经支持 text、textarea、radio、checkbox、select、tags、file、image、json 等字段类型。
4. 已经支持 `LABELING`、`REVIEW_READONLY`、`REVIEW_DIFF` 等模式。
5. 已经有 `ReviewDiffRenderer` 展示原始答案和修订答案。
6. 已经有 `LLMAssistRenderer` 支持 AI suggested patch。
7. 已经有 `UnknownNodeFallback`，具备向前兼容意识。

### 1.3 当前瓶颈

当前版本的主要瓶颈不在于“不能渲染表单”，而在于它还没有成为工业级 runtime engine。

主要问题如下：

1. **状态管理仍然偏手写受控表单模式**  
   当前 `onFieldChange` 会构造新的 `answers` 对象，然后触发 `normalizeAnswers` 和 `onAnswersChange`。当字段数变多、联动复杂时，容易导致整棵 renderer 频繁重算。

2. **字段联动能力有限**  
   当前主要通过 `resolveNodeVisibility` 和 `resolveNodeDisabled` 实现基础显示/禁用逻辑，尚未形成完整的 dependency graph、联动规则 DSL 和 reaction plan。

3. **运行时校验粒度不足**  
   当前主要在 submit 时调用 `validateAnswers`，缺少 onChange/onBlur/onPatchApply/onSchemaPublish 等多阶段校验。

4. **AI patch 直接进入表单状态，缺少 preflight**  
   当前 `LLMAssistRenderer` 在用户确认后，将 suggested patch 合并到 answers，然后 normalize。若 AI 返回非法字段、隐藏字段、联动冲突字段，系统缺少无头预演和风险降级机制。

5. **缺少可视化设计器**  
   当前 Schema 更偏开发者手写，不支持产品/运营通过拖拽设计任务表单。

6. **缺少调试工具**  
   一旦复杂联动出现问题，例如 A 联动 B、B 联动 C、C 反向影响 A，开发者很难解释为什么某个字段不显示、为什么校验失败、为什么 AI patch 被拒绝。

7. **FieldRenderer 扩展方式会逐渐变重**  
   当前通过 switch-case 分发 input 类型，后续新增字段类型、AI 节点、Review 节点、Designer preview 节点时，容易演化成 hardcoded mapper。

---

## 2. 升级目标

本次升级的目标是将 LabelHub 的动态表单能力升级为一套可解释、可治理、可审计、可扩展的 Schema Runtime Engine。

### 2.1 产品目标

1. 支持多任务类型的动态标注表单。
2. 支持字段联动，包括显示/隐藏、启用/禁用、必填状态、选项过滤、值派生、字段清空。
3. 支持运行时校验，包括字段级校验、跨字段校验、AI patch 后校验、Reviewer patch 后校验、提交前校验。
4. 支持低代码 Schema Designer，让非前端开发者也能设计任务表单。
5. 支持 AI Assist，但 AI 输出必须被 Schema 约束和预演。
6. 支持 Review Diff 和 Patch 审计。
7. 支持复杂联动场景下的调试追踪。

### 2.2 工程目标

1. 保留 LabelHub Schema 作为平台契约，不将 Formily 协议直接暴露给后端。
2. 引入 Schema Compiler，将 LabelHub DSL 编译为 Formily runtime schema 和 sandbox evaluator。
3. 引入 Headless Sandbox，在无 UI 环境中预演联动和校验。
4. 引入 Runtime Trace Mode，提升低代码系统可调试性。
5. 引入虚拟化渲染和字段级订阅策略，支撑大型多模态标注任务。
6. 保留向后兼容路径，避免一次性重写导致竞赛周期失控。

---

## 3. 技术选型原则

### 3.1 Formily 的定位

Formily 不作为 LabelHub 的平台契约，而作为前端 runtime engine。

```text
LabelHub Schema = Source of Truth
Formily Schema = Runtime Intermediate Representation
```

LabelHub 自己的 contracts 继续服务于：

- 后端任务创建
- schema versioning
- answer validation
- review patch
- export
- audit log
- worker processing

Formily 主要服务于：

- 前端字段状态管理
- JSON Schema driven rendering
- field-level reaction
- runtime validation
- local form interaction

这样可以避免第三方库协议锁死平台核心契约。

### 3.2 dnd-kit 的定位

dnd-kit 只用于 Schema Designer，不进入 Labeling Runtime。

Designer 负责：

- 字段拖拽
- 容器嵌套
- 字段排序
- 属性编辑
- 联动配置
- 校验配置
- schema preview
- trace/debug preview

Runtime 负责：

- 稳定渲染
- 高性能输入
- runtime validation
- answer submit
- AI patch preview
- review diff

不要把拖拽逻辑混入标注运行时，否则会污染 runtime 的复杂度。

### 3.3 Headless Sandbox 的定位

Headless Sandbox 是 LabelHub v2 的关键安全层。

它不是 UI 预览，而是无 UI 的确定性预演引擎。

```text
Schema + RuntimeContext + Answers + Patch
        ↓
Headless Sandbox Preflight
        ↓
finalAnswers + fieldStates + validationErrors + linkageTrace + warnings
```

它用于：

- Schema 发布前检查
- AI patch 应用前检查
- Reviewer patch 应用前检查
- Submit 前检查
- Formily runtime parity test

---

## 4. 总体架构

### 4.1 模块分层

建议将 LabelHub Schema Runtime Engine 拆分为以下模块：

```text
packages/contracts
  └── LabelHubSchema / FieldNode / LinkageRule / ValidationRule / AuditEventType

packages/schema-core
  └── schema shape validation
  └── normalizeAnswers
  └── validateAnswers
  └── evaluateLinkageRules
  └── dependency graph analysis
  └── headless core sandbox

packages/schema-compiler
  └── DSL Parser
  └── AST Transformer
  └── Static Analyzer
  └── Visitors
      ├── DependencyGraphVisitor
      ├── FormilyReactionVisitor
      ├── SandboxEvaluatorVisitor
      ├── ValidationPlanVisitor
      ├── TraceMetadataVisitor
      └── AuditEventVisitor

packages/schema-renderer
  └── FormilyRuntimeRenderer
  └── Component Registry
  └── Field Adapters
  └── ReviewDiff Adapter
  └── LLMAssist Adapter
  └── Runtime Trace Bridge

packages/schema-designer
  └── dnd-kit Canvas
  └── Component Palette
  └── Property Panel
  └── Linkage Rule Builder
  └── Validation Rule Builder
  └── Trace Mode Panel

packages/api / packages/worker
  └── AI patch preflight
  └── reviewer patch preflight
  └── backend validation
  └── audit log
  └── export worker
```

### 4.2 数据流

```text
Backend returns LabelHubSchema + RuntimeContext + initialAnswers
        ↓
Schema Shape Validation
        ↓
Intent-to-Reaction Compiler
        ↓
AST + Dependency Graph + Reaction Plan + Validation Plan
        ↓
Headless Sandbox Preflight
        ↓
Formily Runtime Renderer
        ↓
User Input / AI Patch / Reviewer Patch
        ↓
Runtime Validation + Trace Event + Audit Event
        ↓
Submit to Backend
        ↓
Backend Authoritative Validation
```

### 4.3 核心原则

1. **LabelHub Schema 是源头事实**  
   Formily Schema 是编译产物，不反向污染平台契约。

2. **AI patch 不能直接落表单**  
   所有 AI patch 必须先经过 sandbox preflight。

3. **联动规则必须可解释**  
   每次字段状态变化都应该能追溯到具体 ruleId 和 dependency path。

4. **Designer 输出 LabelHub Schema，不输出 Formily Schema**  
   Designer 面向业务意图，Compiler 面向运行时实现。

5. **前端校验提升体验，后端校验保证权威**  
   不允许只依赖前端 validation。

---

## 5. LabelHub Schema 协议升级

### 5.1 为什么不直接使用 Formily 协议

不建议直接把 Formily 的 `x-reactions`、`x-validator`、`x-component` 暴露在 LabelHub Schema 中。

原因：

1. 会把平台契约绑定到第三方前端库。
2. 后端、worker、export 和 audit 不应该理解 Formily 私有协议。
3. 任意表达式会增加注入风险。
4. 长期迁移成本高。
5. 很难做统一审计和静态分析。

LabelHub 应该定义自己的安全 DSL，然后由 compiler 生成 Formily reaction plan。

### 5.2 FieldNode 建议扩展

```ts
interface FieldNode {
  id: string;
  kind: "FIELD";
  type: string;
  name: string;
  title: string;
  description?: string;
  required?: boolean;
  placeholder?: string;

  validationRules?: RuntimeValidationRule[];
  linkageRules?: FieldLinkageRule[];
  clearWhenHidden?: boolean;
  validateTrigger?: "onChange" | "onBlur" | "onSubmit" | "onPatchApply";
  asyncValidation?: AsyncValidationSpec;
  ui?: FieldUISpec;
  designerMeta?: DesignerMeta;
}
```

### 5.3 ContainerNode 建议扩展

```ts
interface ContainerNode {
  id: string;
  kind: "CONTAINER";
  type: "container.group" | "container.section" | "container.tabs" | "container.collapse";
  title: string;
  description?: string;
  children: SchemaNode[];

  layout?: "vertical" | "horizontal" | "grid" | "tabs" | "collapse";
  lazyMount?: boolean;
  virtualized?: boolean;
  designerMeta?: DesignerMeta;
}
```

### 5.4 Schema 根对象建议扩展

```ts
interface LabelHubSchema {
  schemaVersionId: string;
  schemaVersionNo: number;
  schemaDraftRevision?: number;
  contractVersion: string;
  root: SchemaNode;

  interactionPolicy?: InteractionPolicy;
  validationPolicy?: ValidationPolicy;
  aiPatchPolicy?: AIPatchPolicy;
  tracePolicy?: TracePolicy;
  designerMeta?: DesignerMeta;
}
```

---

## 6. Intent-to-Reaction Compiler

### 6.1 背景

当前 renderer 通过 `renderNode` 和 `FieldRenderer` 进行硬编码类型分发。这个方式在早期很清晰，但当系统引入联动、校验、AI patch、debug trace、audit metadata 后，简单 if-else mapper 会快速膨胀。

LabelHub v2 需要的不是普通 mapper，而是一个轻量级编译器：

```text
Visual Intent / JSON DSL
        ↓
Parser
        ↓
AST
        ↓
Static Analyzer
        ↓
Visitors
        ↓
Runtime Artifacts
```

这个编译器可以命名为：

> Intent-to-Reaction Compiler

含义是：用户在设计器里配置的是业务意图，而不是可执行代码；LabelHub Compiler 将业务意图转换成安全、可预演、可调试、可审计的运行时计划。

### 6.2 DSL 设计

示例：当 review_result 为 reject 时，显示 reject_reason 并设为必填。

```json
{
  "id": "R-review-reject-reason",
  "when": {
    "field": "review_result",
    "operator": "eq",
    "value": "reject"
  },
  "effects": [
    {
      "target": "reject_reason",
      "action": "setVisible",
      "value": true
    },
    {
      "target": "reject_reason",
      "action": "setRequired",
      "value": true
    }
  ],
  "otherwise": [
    {
      "target": "reject_reason",
      "action": "setVisible",
      "value": false
    },
    {
      "target": "reject_reason",
      "action": "clearValue"
    }
  ]
}
```

### 6.3 AST 表达

上述 DSL 会被解析成 AST：

```text
RuleNode(id="R-review-reject-reason")
├── condition: EqNode
│   ├── left: FieldRefNode("review_result")
│   └── right: LiteralNode("reject")
├── effects:
│   ├── SetVisibleNode(target="reject_reason", value=true)
│   └── SetRequiredNode(target="reject_reason", value=true)
└── otherwise:
    ├── SetVisibleNode(target="reject_reason", value=false)
    └── ClearValueNode(target="reject_reason")
```

### 6.4 Visitor Pattern

同一个 AST 会被不同 visitor 转换成不同产物。

```text
AST
├── DependencyGraphVisitor
│   └── review_result → reject_reason
│
├── FormilyReactionVisitor
│   └── Formily reaction plan
│
├── SandboxEvaluatorVisitor
│   └── headless evaluator function
│
├── ValidationPlanVisitor
│   └── runtime validation plan
│
├── TraceMetadataVisitor
│   └── rule explanation metadata
│
└── AuditEventVisitor
    └── audit event templates
```

### 6.5 Static Analyzer

Compiler 必须在生成 runtime artifacts 前做静态分析。

至少检查：

1. field reference 是否存在。
2. target field 是否存在。
3. operator 与字段类型是否兼容。
4. effect action 是否允许作用在目标字段上。
5. read dependency 与 write effect 是否构成循环。
6. required 字段是否永远不可见。
7. clearWhenHidden 是否与持久化策略冲突。
8. options linkage 是否引用不存在的 option。
9. AI patch policy 是否允许修改目标字段。

### 6.6 DSL 能力边界

LabelHub DSL 应该足够表达表单联动，但不能成为完整编程语言。

允许的 condition operators：

```text
eq
neq
in
notIn
exists
empty
notEmpty
gt
gte
lt
lte
and
or
not
```

允许的 effects：

```text
setVisible
setDisabled
setRequired
setOptions
setValue
clearValue
setWarning
setReadonly
```

明确禁止：

```text
eval
function
while
for
network call
arbitrary JavaScript
async side effect inside condition
```

设计原则：

> DSL is expressive enough for form linkage, but intentionally not Turing-complete.

---

## 7. Headless Schema Sandbox Preflight

### 7.1 为什么需要无头沙盒

在 AI Assist 和复杂字段联动场景下，直接将 patch 应用到前端表单是危险的。

典型风险：

1. AI 返回了 schema 中不存在的字段。
2. AI 给隐藏字段赋值。
3. AI 修改了 readonly 字段。
4. AI 生成的 patch 触发新的必填错误。
5. AI patch 破坏 category 与 sub_category 的选项关系。
6. Reviewer patch 造成跨字段校验失败。
7. 联动规则形成循环，导致运行时死循环。

因此，LabelHub v2 引入 Headless Schema Sandbox，在 patch 展示给用户之前先预演。

### 7.2 双沙盒架构

推荐使用双层沙盒。

```text
Headless Schema Sandbox
├── LabelHub Core Sandbox
│   ├── applyPatch
│   ├── normalizeAnswers
│   ├── evaluateLinkageRules
│   ├── validateRuntimeRules
│   ├── detectIllegalFieldMutation
│   └── generatePreflightReport
│
└── Formily Parity Sandbox
    ├── createForm
    ├── compileToFormilySchema
    ├── runReactions
    ├── collectFieldStates
    └── compareWithCoreSandbox
```

### 7.3 LabelHub Core Sandbox

Core Sandbox 是权威层，建议放在 `packages/schema-core`。

它不依赖 React、DOM 或 Formily UI。

输入：

```ts
interface RunSchemaPreflightInput {
  schema: LabelHubSchema;
  runtimeContext: LabelHubRuntimeContext;
  initialAnswers: AnswerPayload;
  patch?: AnswerPatch;
  mode:
    | "schema-publish-check"
    | "ai-patch-preview"
    | "reviewer-patch-preview"
    | "submit-check"
    | "designer-preview";
}
```

输出：

```ts
interface SchemaPreflightReport {
  ok: boolean;
  decision: "SAFE" | "RISKY" | "REJECTED";
  finalAnswers: AnswerPayload;
  fieldStates: Record<string, FieldRuntimeState>;
  validationErrors: ValidationError[];
  linkageTrace: RuntimeTraceEvent[];
  changedFields: string[];
  illegalMutations: IllegalMutation[];
  warnings: RuntimeWarning[];
  dependencyGraph: DependencyGraph;
}
```

### 7.4 Formily Parity Sandbox

Formily Parity Sandbox 是一致性校验层，不是唯一裁判。

它用于验证：

```text
LabelHub Core Sandbox 的字段状态
是否与 Formily Runtime 实际 reaction 后的字段状态一致
```

如果不一致，说明 compiler 或 adapter 有 bug。

### 7.5 AI Patch Preflight

AI patch 不能直接应用。

流程：

```text
AI Agent generates suggestedPatch
        ↓
Headless Sandbox Preflight
        ↓
SAFE / RISKY / REJECTED
        ↓
Reviewer UI
```

示例：

```json
{
  "category": "A",
  "b_only_reason": "because xxx"
}
```

若 `b_only_reason` 只在 `category = B` 时可见，则沙盒返回：

```text
REJECTED_PATCH
Reason:
- b_only_reason is inactive under current schema state
- AI attempted to mutate an inactive field
```

### 7.6 Reviewer Patch Preflight

Reviewer patch 同样需要预演。

原因是 reviewer 修改一个字段，也可能触发联动，造成其他字段无效。

```text
Reviewer modifies answer
        ↓
Sandbox checks field states + validation
        ↓
Patch preview diff
        ↓
Apply patch or show warning
```

### 7.7 Submit Preflight

前端提交前跑一次 sandbox，后端收到后再跑一次权威校验。

```text
Frontend submit-check = UX optimization
Backend submit-check = authoritative validation
```

---

## 8. Runtime Trace Mode

### 8.1 为什么需要 Trace Mode

低代码 + 响应式 + AI patch 会带来调试黑盒问题。

如果 PM 配置了复杂联动：

```text
A → B
B → C and D
D → A
```

开发者仅看 React 代码无法定位问题，因为代码只是解析和渲染 JSON。必须提供 schema-level 的解释工具。

因此，LabelHub v2 在 Schema Designer 中加入 Runtime Trace Mode。

### 8.2 Trace Panel 结构

```text
Trace Panel
├── Dependency Graph
├── Event Timeline
├── Field Inspector
├── Rule Inspector
├── AI Patch Trace
├── Validation Trace
└── Loop Guard Panel
```

### 8.3 Dependency Graph

展示字段之间的依赖关系。

示例：

```text
review_result
  └── reject_reason

category
  ├── sub_category
  └── b_only_reason
```

如果发现循环依赖：

```text
Circular dependency detected:
A → B → C → A
```

Designer 必须阻止发布。

### 8.4 Event Timeline

记录每一次状态变化。

示例：

```text
[10:21:03.120] USER_INPUT
field: category
from: "B"
to: "A"

[10:21:03.126] RULE_TRIGGERED
ruleId: R-category-subcategory
condition: category == "A"
effect: updateOptions(sub_category)

[10:21:03.131] FIELD_STATE_CHANGED
field: sub_category
options: ["A1", "A2", "A3"]

[10:21:03.138] RULE_TRIGGERED
ruleId: R-category-b-only-reason
condition: category != "B"
effect: setVisible(b_only_reason, false)

[10:21:03.142] FIELD_VALUE_CLEARED
field: b_only_reason
reason: clearWhenHidden = true

[10:21:03.150] VALIDATION_RUN
result: passed
```

### 8.5 Field Inspector

点击任意字段，显示：

```text
Field: reject_reason

Current State:
- visible: true
- required: true
- disabled: false
- readonly: false
- value: ""

Why visible?
- Rule R-review-reject-reason matched
- condition: review_result == "reject"

Why required?
- Rule R-review-reject-required matched
- condition: review_result == "reject"

Validation:
- REQUIRED failed

Dependencies:
- depends on: review_result
- affects: final_review_status
```

### 8.6 Rule Inspector

点击一条 rule，显示：

```text
Rule R-review-reject-required

When:
review_result == "reject"

Effects:
- setRequired(reject_reason, true)

Last evaluation:
- matched: true
- input value: "reject"
- triggered by: USER_INPUT

Affected fields:
- reject_reason

Risk:
- no cycle detected
```

### 8.7 AI Patch Trace

AI patch 失败时，显示明确原因。

```text
AI_PATCH_PREFLIGHT_FAILED

Illegal mutation:
- b_only_reason is inactive under current schema state
- current condition: category == "A"
- b_only_reason is only active when category == "B"

Decision:
- patch not applied
- converted to reviewer suggestion
```

### 8.8 Loop Guard

防死循环需要四层防线。

第一层：编译期循环检测。

```text
DependencyGraphVisitor detects:
A → B → C → A
```

第二层：读写边界检查。

```text
Rule 1 reads A, writes B
Rule 2 reads B, writes A
```

默认禁止反馈环。

第三层：运行时深度限制。

```text
maxReactionDepth = 10
maxRuleExecutionsPerTick = 50
```

第四层：Trace Mode 定位。

```text
REACTION_LOOP_GUARD_TRIGGERED
Potential infinite reaction detected:
A changed B
B changed C
C changed A
```

---

## 9. Formily Runtime Renderer

### 9.1 新职责

升级后的 `SchemaRenderer` 不再手动递归渲染所有 node，而是变成 Formily Runtime Shell。

职责：

1. 接收 LabelHubSchema。
2. 调用 compiler 生成 Formily schema。
3. 创建 Formily form instance。
4. 注册 LabelHub component registry。
5. 监听 values change。
6. 将 Formily values 同步为 LabelHub answers snapshot。
7. 调用 normalize 和 validation。
8. 调用 Headless Sandbox 进行 patch preflight。
9. 映射 Formily errors 到 LabelHub ValidationError。
10. 输出 trace events 给 Runtime Trace Mode。

### 9.2 组件适配策略

不要一次性删除现有组件，而是包装成 Formily adapter。

```text
TextInput              → FormilyTextInputAdapter
TextareaInput          → FormilyTextareaInputAdapter
RadioInput             → FormilyRadioAdapter
CheckboxInput          → FormilyCheckboxAdapter
SelectInput            → FormilySelectAdapter
TagsInput              → FormilyTagsAdapter
FileInput              → FormilyUploadAdapter
JsonEditorInput        → FormilyJsonEditorAdapter
LLMAssistRenderer      → FormilyVoidLLMAssist
ShowItemRenderer       → FormilyVoidShowItem
ReviewDiffRenderer     → ReviewDiffRuntimeAdapter
UnknownNodeFallback    → UnsupportedNodeAdapter
```

### 9.3 Mode 映射

```text
LABELING          → editable Formily field
REVIEW_READONLY   → readPretty / disabled
REVIEW_DIFF       → diff adapter, not normal input
DESIGN_PREVIEW    → editable preview without persistence
SCHEMA_DESIGN     → handled by dnd-kit designer, not runtime renderer
```

### 9.4 answers 同步策略

避免每次字段变化都把整份 answers 向上冒泡。

推荐：

1. Formily 内部持有即时 field state。
2. Runtime 通过 debounce 同步 answers snapshot。
3. Submit 时强制 flush。
4. autosave 使用节流。
5. AI patch / Review patch 使用 transaction。

```text
Field input
   ↓
Formily field state update
   ↓
Affected fields reaction
   ↓
debounced answer snapshot
   ↓
normalizeAnswers
   ↓
onAnswersChange
```

### 9.5 AI Assist 接入方式

现有 `LLMAssistRenderer` 在确认后直接应用 patch。升级后必须改成：

```text
User clicks AI Assist
        ↓
AI Agent returns suggestedPatch
        ↓
Headless Sandbox Preflight
        ↓
SAFE: show apply button
RISKY: show warning + trace
REJECTED: do not apply, show reason
        ↓
User confirms
        ↓
Apply patch as transaction
        ↓
Runtime validation
        ↓
Audit event
```

### 9.6 FileInput / Upload Adapter

当前 `FileInput` 应该升级为 Upload Adapter。

表单里不直接保存 `File` 对象，而保存 `FileRef`。

```ts
interface FileRef {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadStatus: "pending" | "uploaded" | "failed" | "virus_scan_pending" | "blocked";
  storageProvider?: string;
  signedUrl?: string;
  signedUrlExpiresAt?: string;
}
```

Upload Adapter 需要处理：

- mime type validation
- file size validation
- max count validation
- upload progress
- retry
- virus scan state
- storage fileId
- signed URL expiration

---

## 10. dnd-kit Schema Designer

### 10.1 Designer 定位

Schema Designer 是低代码配置入口，输出 LabelHub Schema，不输出 Formily Schema。

```text
dnd-kit Designer
        ↓
Schema Patch Operations
        ↓
LabelHub Schema Draft
        ↓
Schema Validation + Headless Preflight
        ↓
Publish schemaVersionId
```

### 10.2 页面结构

```text
Schema Designer
├── Component Palette
│   ├── Text
│   ├── Textarea
│   ├── Radio
│   ├── Checkbox
│   ├── Select
│   ├── Tags
│   ├── Upload
│   ├── JSON
│   ├── Group
│   ├── Section
│   ├── Tabs
│   ├── Show Item
│   └── LLM Assist
│
├── Canvas
│   ├── Drag field into container
│   ├── Reorder fields
│   ├── Move field across containers
│   └── Select node
│
├── Property Panel
│   ├── Basic properties
│   ├── Options
│   ├── Validation rules
│   ├── Linkage rules
│   ├── AI binding
│   └── Review policy
│
└── Debug / Trace Panel
    ├── Preview
    ├── Dependency Graph
    ├── Event Timeline
    └── Schema JSON
```

### 10.3 Schema Patch Operations

Designer 不应该直接随意 mutate schema object，而应该生成 patch operation。

```text
INSERT_NODE
MOVE_NODE
DELETE_NODE
DUPLICATE_NODE
UPDATE_NODE_PROPS
UPDATE_FIELD_OPTIONS
ADD_VALIDATION_RULE
UPDATE_VALIDATION_RULE
REMOVE_VALIDATION_RULE
ADD_LINKAGE_RULE
UPDATE_LINKAGE_RULE
REMOVE_LINKAGE_RULE
PUBLISH_SCHEMA_DRAFT
```

这样便于 undo/redo、审计、多人协作和版本管理。

### 10.4 Publish 前检查

发布 schema 前必须执行：

```text
validateSchemaShape
        ↓
compile DSL to AST
        ↓
static analysis
        ↓
dependency graph cycle detection
        ↓
headless schema-publish-check
        ↓
allow publish / block publish
```

---

## 11. 运行时校验设计

### 11.1 校验分层

LabelHub v2 使用五层校验。

```text
1. Schema Shape Validation
2. Field-Level Validation
3. Cross-Field Validation
4. Patch Preflight Validation
5. Backend Authoritative Validation
```

### 11.2 校验触发时机

```text
onChange       → lightweight field validation
onBlur         → format / length / JSON validation
onPatchApply   → AI patch / Reviewer patch validation
onSubmit       → full validation
onSchemaPublish→ schema shape + dependency graph + sandbox check
```

### 11.3 ValidationError 结构

建议扩展为：

```ts
interface ValidationError {
  fieldName?: string;
  nodeId?: string;
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  source:
    | "formily"
    | "schema-core"
    | "headless-sandbox"
    | "backend"
    | "ai-review"
    | "designer";
  relatedFields?: string[];
  ruleId?: string;
  traceId?: string;
}
```

这样可以把错误挂到字段、规则、trace 和 audit 上。

---

## 12. 高性能与高并发设计

### 12.1 前端性能问题的本质

评委可能会问：

> 如果一个多模态标注任务有 500 个框，每个框都有属性表单，页面会不会卡死？

回答原则：

> 500 个对象存在于数据层，不等于 500 组完整表单同时挂载到 DOM 层。

### 12.2 Reactive & Virtualized Runtime

LabelHub 不暴力渲染大型 DOM，而是分层处理。

```text
Large Multimodal Task
├── Annotation Object Store
│   ├── box_001
│   ├── box_002
│   └── box_500
│
├── Virtualized Object List
│   └── render visible window only
│
├── Active Object Form
│   └── Formily field-level subscription
│
└── Dependency Graph
    └── update affected fields only
```

### 12.3 更新复杂度表达

不要承诺全局 O(1)。更严谨的说法是：

```text
Traditional controlled form:
O(n) rerender risk

LabelHub Formily Runtime:
O(k) reactive update scope

where:
k = directly affected fields + visible virtualized nodes
k << n in most labeling workflows
```

### 12.4 具体策略

1. Formily 管理字段级状态，避免整表受控重渲染。
2. 使用 dependency graph 限制 reaction 范围。
3. answers snapshot debounce。
4. 大 container 懒挂载。
5. tabs/collapse 中不可见内容延迟渲染。
6. 多对象列表使用 Virtual List。
7. 当前选中对象使用 Active Object Form。
8. options 异步加载与缓存。
9. schema compiler 结果按 `schemaVersionId + schemaDraftRevision` 缓存。
10. Review diff 只对 patch 涉及字段计算。

### 12.5 后端高并发策略

Formily 解决的是前端大表单性能，不等于后端高并发。后端仍需独立设计。

建议：

1. Submit 带 `schemaVersionId`、`answerRevisionNo`、`idempotencyKey`、`clientMutationId`。
2. 使用 optimistic locking 防止多人/多 patch 覆盖。
3. AI patch 和 Reviewer patch 也必须带 revision。
4. autosave 使用 debounce + mutation log。
5. export 进入 worker queue。
6. audit event 异步写入，但关键事件保证最终一致。
7. backend validation 是权威校验。

---

## 13. Audit & Governance

### 13.1 必须审计的事件

```text
SCHEMA_DRAFT_CREATED
SCHEMA_NODE_INSERTED
SCHEMA_NODE_MOVED
SCHEMA_NODE_DELETED
SCHEMA_FIELD_UPDATED
SCHEMA_LINKAGE_RULE_ADDED
SCHEMA_LINKAGE_RULE_UPDATED
SCHEMA_VALIDATION_RULE_ADDED
SCHEMA_PUBLISH_BLOCKED
SCHEMA_PUBLISHED

FIELD_VALUE_CHANGED
FIELD_LINKAGE_TRIGGERED
FIELD_STATE_CHANGED
FIELD_VALUE_CLEARED
RUNTIME_VALIDATION_FAILED
REACTION_LOOP_GUARD_TRIGGERED

AI_ASSIST_TRIGGERED
AI_PATCH_PREFLIGHT_PASSED
AI_PATCH_PREFLIGHT_FAILED
AI_PATCH_APPLIED
AI_PATCH_REJECTED_BY_SCHEMA

REVIEW_PATCH_CREATED
REVIEW_PATCH_PREFLIGHT_PASSED
REVIEW_PATCH_PREFLIGHT_FAILED
REVIEW_PATCH_APPLIED
REVIEW_DIFF_GENERATED

ANSWER_SUBMIT_ATTEMPTED
ANSWER_SUBMIT_VALIDATION_FAILED
ANSWER_SUBMITTED
EXPORT_REQUESTED
EXPORT_COMPLETED
```

### 13.2 Trace 与 Audit 的关系

Trace 是开发者调试层，Audit 是平台治理层。

```text
Runtime Trace Event
        ↓
selected important events
        ↓
Audit Event
        ↓
backend persistence
```

不是所有 trace 都需要持久化，否则数据量会很大。建议：

- dev/debug 环境保留详细 trace。
- production 只持久化关键审计事件。
- AI patch、review patch、submit failure 必须持久化。

---

## 14. 安全策略

### 14.1 零信任表达式边界

不允许用户、PM、AI 在 Schema 中注入任意 JS。

```text
Visual Intent
        ↓
Restricted JSON DSL
        ↓
AST
        ↓
Static Analysis
        ↓
Safe Reaction Plan
```

### 14.2 AI Patch 安全

AI patch 必须检查：

1. 字段是否存在。
2. 字段当前是否 active。
3. 字段是否 readonly。
4. 字段类型是否匹配。
5. 是否违反联动规则。
6. 是否触发 validation error。
7. 是否越权修改 reviewer-only 字段。
8. 是否修改系统字段。

### 14.3 文件上传安全

Upload Adapter 必须检查：

- mime type
- extension
- size
- count
- storage status
- virus scan status
- signed URL expiration

### 14.4 Rich Text 安全

如果后续支持 rich text，必须进行 HTML sanitize，避免 XSS。

---

## 15. 测试方案

### 15.1 Unit Tests

必须覆盖：

1. DSL parser。
2. AST builder。
3. DependencyGraphVisitor。
4. cycle detection。
5. FormilyReactionVisitor。
6. SandboxEvaluatorVisitor。
7. validation rule compiler。
8. trace metadata generation。
9. illegal AI mutation detection。
10. hidden field clear policy。
11. unsupported node fallback。

### 15.2 Integration Tests

必须覆盖：

1. radio 选择后显示新字段。
2. select 一级分类控制二级选项。
3. review_result = reject 后 reject_reason 必填。
4. AI patch 修改 category 后触发隐藏字段清空。
5. AI patch 给 inactive field 赋值时被拒绝。
6. Reviewer patch 触发 validation warning。
7. REVIEW_READONLY 不可编辑。
8. REVIEW_DIFF 正确显示原始答案和修订答案。
9. designer publish 前发现循环依赖。
10. sandbox 与 Formily runtime 字段状态一致。

### 15.3 Performance Tests

建议设定竞赛展示指标：

1. 200 字段表单，单字段输入无明显卡顿。
2. 500 对象多模态任务，只渲染当前可见列表和 active object form。
3. 1000 字段 schema 编译结果可缓存。
4. 100 次连续输入不触发整棵表单 100 次完整重渲染。
5. 循环联动在 publish 前被发现。
6. runtime loop guard 能中断异常联动。

### 15.4 Designer Tests

必须覆盖：

1. 字段从 palette 拖入 canvas。
2. 字段在同一 container 内排序。
3. 字段跨 container 移动。
4. container 嵌套。
5. 删除字段后相关 rule 报错。
6. 重命名 field name 后依赖关系提示更新。
7. keyboard drag reorder。
8. schema preview 与 canvas 一致。

---

## 16. 迁移路线

### Phase 1：建立 Formily Runtime Shell

目标：

- 新增 `FormilyRuntimeRenderer`。
- 保留旧 `SchemaRenderer` 作为 fallback。
- 建立 component registry。
- 将现有 input components 包装成 Formily adapter。
- 最小支持 text、textarea、radio、checkbox、select、tags、json。

验收：

- 原有 demo schema 可以正常渲染。
- LABELING / REVIEW_READONLY / REVIEW_DIFF 不退化。
- 原有测试通过。

### Phase 2：Schema Compiler 最小闭环

目标：

- 新增 `packages/schema-compiler`。
- 实现 DSL parser。
- 实现 AST。
- 实现 DependencyGraphVisitor。
- 实现 FormilyReactionVisitor。
- 实现基础 validation mapping。

验收：

- 能把 LabelHub Schema 编译为 Formily Schema。
- 能检测字段引用错误。
- 能检测简单循环依赖。

### Phase 3：Headless Sandbox Preflight

目标：

- 新增 `runSchemaPreflight`。
- 支持 AI patch preflight。
- 支持 reviewer patch preflight。
- 支持 submit-check。
- 输出 finalAnswers、fieldStates、validationErrors、linkageTrace。

验收：

- AI patch 给 inactive field 赋值时被拒绝。
- AI patch 触发必填错误时被标记为 RISKY。
- SAFE patch 可以进入前端确认应用。

### Phase 4：Runtime Trace Mode

目标：

- Designer 中新增 Trace Panel。
- 支持 Dependency Graph。
- 支持 Event Timeline。
- 支持 Field Inspector。
- 支持 Rule Inspector。
- 支持 Loop Guard 展示。

验收：

- 能解释字段为什么 hidden/required/disabled。
- 能展示一条输入触发的联动链路。
- 能展示 AI patch 被拒绝原因。

### Phase 5：dnd-kit Schema Designer

目标：

- Component Palette。
- Canvas 拖拽。
- Property Panel。
- Linkage Rule Builder。
- Validation Rule Builder。
- Schema JSON Preview。
- Publish 前 preflight。

验收：

- 非开发者可以拖出一个任务表单。
- 可以配置 reject reason 联动。
- 可以发布 schemaVersionId。

### Phase 6：Performance & Governance

目标：

- Virtual List。
- Lazy container mount。
- schema compile cache。
- audit event integration。
- optimistic locking。
- autosave mutation log。

验收：

- 大型任务不卡顿。
- AI/review/submit 关键事件可追溯。
- schema draft 到 publish 可审计。

---

## 17. Demo Storyline

建议答辩 demo 使用下面这条故事线。

### Step 1：Designer 搭建表单

在 dnd-kit Schema Designer 中拖入：

- category
- sub_category
- review_result
- reject_reason
- confidence_score
- LLM Assist

### Step 2：配置联动

配置规则：

```text
When review_result == reject:
  show reject_reason
  set reject_reason required
Otherwise:
  hide reject_reason
  clear reject_reason
```

### Step 3：Debug/Trace Mode 查看依赖图

展示：

```text
review_result → reject_reason
```

### Step 4：Runtime Preview

用户选择 reject，reject_reason 出现并变成必填。

Trace Panel 显示 rule triggered。

### Step 5：AI Assist 返回 risky patch

AI 返回：

```json
{
  "category": "A",
  "b_only_reason": "because xxx"
}
```

Headless Sandbox 拒绝 patch：

```text
b_only_reason inactive because category != B
```

### Step 6：Reviewer Patch

Reviewer 修改答案后，系统先 sandbox preflight，再展示 Review Diff。

### Step 7：Audit Log

展示事件：

```text
AI_PATCH_PREFLIGHT_FAILED
FIELD_LINKAGE_TRIGGERED
REVIEW_DIFF_GENERATED
ANSWER_SUBMITTED
```

这条 demo 可以完整展示：

```text
low-code design
→ safe compilation
→ headless preflight
→ reactive runtime
→ explainable debug
→ audit governance
```

---

## 18. 对外讲法

### 18.1 中文版

LabelHub v2 将 schema renderer 升级为一个安全响应式标注引擎。它不再只是把 JSON Schema 渲染成表单，而是引入 Intent-to-Reaction Compiler、Headless Schema Sandbox 和 Runtime Trace Mode。可视化配置出的字段联动规则会先被编译成受限 AST，并经过字段引用检查、类型检查和循环依赖分析，再生成安全的 Formily reaction plan。AI 生成的 patch 不会直接写入前端表单，而是先进入无头沙盒预演，验证字段状态、联动结果和运行时校验是否通过。运行时则结合 Formily 的字段级状态管理、响应式订阅、虚拟列表和容器懒加载，保证大型多模态标注任务在不挂载海量 DOM 的情况下保持流畅。系统还提供 Runtime Trace Mode，让每一次字段状态变化、规则触发、AI patch 决策和校验失败都可以追溯到具体 Schema 规则。

### 18.2 English Version

LabelHub v2 upgrades the schema renderer into a Safe Reactive Labeling Engine. Instead of treating dynamic forms as simple JSON-to-UI rendering, LabelHub introduces an Intent-to-Reaction Compiler, a Headless Schema Sandbox, and a Runtime Trace Mode. Visual linkage rules are compiled from a restricted DSL into an internal AST, statically analyzed for field references, type compatibility, and dependency cycles, and emitted as safe Formily reaction plans. AI-generated patches are never applied blindly; they are first executed in a headless schema sandbox to verify field states, linkage effects, and runtime validation results. At runtime, Formily’s field-level state management and reactive subscription model are combined with virtualized object lists and lazy container mounting, allowing large multimodal labeling tasks to remain responsive without mounting thousands of DOM nodes. Runtime Trace Mode makes every field state change, rule evaluation, AI patch decision, and validation failure explainable and auditable.

---

## 19. 给 Codex 的实现指令摘要

如果交给 Codex，实现优先级如下：

```text
P0
- 新增 packages/schema-compiler
- 新增 DSL AST 类型
- 新增 DependencyGraphVisitor
- 新增 runSchemaPreflight 最小实现
- 修改 LLMAssistRenderer patch 应用流程：先 preflight，再 apply

P1
- 新增 FormilyRuntimeRenderer shell
- 将现有 input components 包装成 Formily adapters
- 实现 basic linkage: visible / disabled / required / clearValue
- 实现 validation error mapping

P2
- 新增 Runtime Trace Event 类型
- 新增 Trace Panel mock UI
- 新增 Field Inspector / Rule Inspector
- 新增 loop guard

P3
- 新增 dnd-kit Schema Designer skeleton
- 实现 palette → canvas
- 实现 schema patch operations
- 实现 property panel

P4
- virtual list
- active object form
- audit event integration
- backend parity validation
```

第一阶段不要一次性重写全部 renderer。推荐保留旧 renderer，通过 feature flag 切换：

```text
schemaRendererEngine = "legacy" | "formily-v2"
```

这样可以在竞赛周期内降低风险。

---

## 20. 参考依据

- Formily 官方文档将其定位为 Alibaba 统一前端表单解决方案，强调高性能、JSON Schema 驱动、Form Builder 和 Pure Core 扩展性。
- Formily GitHub 说明中提到，其通过分布式管理每个表单字段状态，缓解 React controlled form 在数据联动场景下整棵树渲染带来的卡顿问题。
- dnd-kit 官方文档支持 draggable/sortable、跨列表排序、传感器、collision detection、keyboard/touch 支持和可访问性能力，适合构建 Schema Designer。
- dnd-kit sortable strategy 中存在适配虚拟列表的策略，适合大型字段列表/对象列表场景。

---

## 21. 最终结论

LabelHub v2 的关键不是“用了 Formily 和 dnd-kit”，而是围绕它们建立了自己的工程壁垒：

```text
LabelHub Schema as Source of Truth
        ↓
Intent-to-Reaction Compiler
        ↓
Headless Sandbox Preflight
        ↓
Formily Runtime Renderer
        ↓
Runtime Trace Mode
        ↓
Audit & Governance
```

最终系统能力可以总结为：

> 规则可编译，联动可预演，状态可追踪，AI 可约束，异常可定位，提交可审计。

这会让 LabelHub 从普通标注平台升级为一个真正具备工业级潜力的 Schema-governed AI labeling infrastructure。
