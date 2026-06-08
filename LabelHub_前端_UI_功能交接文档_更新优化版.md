# LabelHub 前端 UI / 功能交接文档（更新优化版）

> 面向 UI 接力、联调与 QA 验收。  
> 当前主线：`integration/joint-test`  
> 建议 UI 分支：`feature/ui-polish` / `fix/joint-test-web-shell`

---

## 0. 一页版重点

| 主题 | 当前结论 | 接力动作 |
|---|---|---|
| 开发基线 | 以最新 `integration/joint-test` 为准，不再基于旧 `feature/web-shell-dev` 继续改。 | 新开 `feature/ui-polish`，或在 `fix/joint-test-web-shell` 上继续小批提交。 |
| 文件边界 | UI 主要改 `apps/web/`；`schema-designer` / `schema-renderer` 可为 UI 接入少量调整。 | 不碰 `contracts`、`apps/api`、`schema-core` 核心逻辑。 |
| P0 验收 | 不破坏 Formily runtime、字段联动、submit validation、AI preflight。 | 每次改 UI 后跑 build / typecheck，并手动测 Labeler 主链路。 |
| 下一重点 | AI Assist Panel：从工程提示改成人话的“AI 质量检查建议”。 | 先做 AI Panel，再补 Labeler 标注台和 Owner 模板配置页。 |
| 协作方式 | 不要直接推半成品到 `integration/joint-test`。 | 开 draft PR，分批 commit，PR 写清改动逻辑和验证结果。 |

---

## 1. 当前交接背景与进度状态

LabelHub 已进入前端 UI polish、演示链路补齐和真实联调阶段。当前重点不是重做一套页面，而是在 `integration/joint-test` 主线基础上，补齐标注台交互、AI Assist Panel、模板配置页动态搭建能力、死按钮反馈与 QA 记录。

接力开发时请优先保证主链路可跑，再做视觉统一；不要为了 UI 改动破坏已经并入主线的 schema runtime、Formily 联动、AI preflight、审核与导出链路。

### 1.1 已完成 / 已推进内容

- 移动端适配已完成，登录页和主要后台页面已可在窄屏下查看。
- 登录页逻辑已从“角色选择”调整为“账号登录后进入对应后台”：Owner / Labeler / Reviewer。
- `web-shell-dev` 中必要的前端 UI / schema runtime 相关改动已确认包含在当前 joint-test 相关分支中，不需要整分支搬运。
- `ConfirmDialog`、`demo-workflow-store`、`localComponentRegistry`、`schemaPresetLibrary`、`review-display` 已在当前分支并被页面引用。
- schema runtime / Formily 相关文件已在当前分支，并且比旧 `web-shell-dev` 更完整。
- 本轮 PR 包含 web UI、schema-designer materials / canvas / property / validation / preview，以及 schema-renderer AI Assist preflight 展示与测试等改动。

### 1.2 当前已知问题

| 问题 | 接力说明 |
|---|---|
| 任务发布创建失败 | 不确定是否为后端未接入，或前端 payload 与 contracts 不一致。需要检查发布任务 payload、状态机、错误提示和后端接口。 |
| AI 预审页面 UI 不统一 | 当前紫色 / 橙色使用较重，需要统一 Corporate Trust 风格，并清晰表达异步队列、维度评分、失败重试与人工兜底。 |
| Labeler 任务广场待完善 | 应区分发布到广场的任务、配额抢单任务、指派给自己的任务，不要混成一个列表。 |
| 标注台功能待补齐 | 题目导航、草稿自动保存、打回提示、题目级 LLM 辅助调用、提交校验需要继续完善。 |
| 人工审核流转待完善 | 需要覆盖复审 / 终审视图、第 1 / 2 轮 diff、AI 评语、批量操作和完整审计时间线。 |

---

## 2. 分支、PR 与协作规则

### 2.1 当前主线与分支策略

```bash
git fetch origin
git switch -c feature/ui-polish origin/integration/joint-test
```

当前主线为 `integration/joint-test`。最新集成进度都在这条分支上，不要再基于旧 `feature/web-shell-dev` 或旧 PR diff 继续改。

如果继续使用已存在的 `fix/joint-test-web-shell` 分支，应确保它已经基于最新 `origin/integration/joint-test`，并且 PR 目标为 `integration/joint-test`。

### 2.2 PR 规则

- 不要直接往 `integration/joint-test` 推半成品。
- 请开 draft PR，方向为：`integration/joint-test ← feature/ui-polish / fix/joint-test-web-shell`。
- 每隔几天 rebase 最新主线，提前暴露冲突。
- 每一批单独 commit，不要一口气大改。
- PR 描述必须写清：改了哪些 UI、动了哪些逻辑、跑了哪些验证。

### 2.3 推荐 PR 描述模板

```md
## Summary
- Polished LabelHub web UI on top of integration/joint-test.
- Refined Labeler workspace / AI Assist panel presentation.
- Updated Owner schema designer materials, canvas, property and validation panels.
- Preserved Formily runtime, schema-aware preflight and submit validation.

## Scope
- apps/web
- packages/schema-designer
- packages/schema-renderer if needed

## Validation
- npm.cmd --prefix apps/web run build
- npm.cmd --prefix packages/schema-renderer run typecheck
- npm.cmd --prefix packages/schema-designer run typecheck

## Notes
- No changes to packages/contracts.
- No changes to apps/api.
- Target branch: integration/joint-test.
```

---

## 3. 文件边界

| 可改 | 谨慎改 | 不要碰 |
|---|---|---|
| `apps/web/`：前端页面、样式、交互反馈、页面级状态 | `apps/web/src/features/labeler/AssignmentPage.tsx`：Labeler 主战场，容易冲突 | `packages/contracts/`：契约类型由合并负责人统一管 |
| `HANDOFF.md` / 前端交接文档 | `apps/web/src/styles.css`：全局样式，避免破坏 tab / formily 视觉 | `apps/api/`：后端接口不要擅自改 |
| `packages/schema-designer/` 的 UI 表达、materials、面板样式 | `packages/schema-renderer/src/renderers/ContainerRenderer.tsx`：已有 O7 `container.tabs` 真 Tab 渲染逻辑 | `labelhub-architecture-contract.md`：架构契约不要动 |
| `packages/schema-renderer/` 的 AI Assist 展示层与相关测试 | `LLMAssistRenderer.tsx`：可改 UI 文案，但不要绕过 preflight | `packages/schema-core/` 核心逻辑：schema traversal / validation 不要重写 |

如果确实需要改字段名、错误码、接口形状或契约类型，必须三处同步：

```txt
packages/contracts → apps/api/app/schemas/*.py → apps/web
```

不要只改一半。

---

## 4. 本地启动与账号

### 4.1 只调前端 UI / mock 页面

```bash
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

打开：`http://localhost:5180/`。这是纯前端 mock，不需要起后端。

### 4.2 测完整链路：真实后端 + AI 预审 / 审核 / 导出

用 Docker 起全栈，打开：`http://localhost:5173/`。

注意端口区别：

```txt
本地前端 dev：5180
Docker 全栈：5173
```

### 4.3 测试账号

```txt
owner@labelhub.com / password123
labeler@labelhub.com / password123
reviewer@labelhub.com / password123
```

---

## 5. Schema 相关逻辑底线

Schema 不是普通表单 UI。请明确 Owner 端治理、Labeler 端 runtime、Submit Validation、AI Assist Preflight 的职责边界。

### 5.1 Schema Governance / Owner 端

Owner 端负责：

- schema 发布前检查
- 兼容性检查
- breaking change 阻断
- audit timeline / schema governance
- 不要和 Labeler 动态表单混为一谈

### 5.2 Schema Runtime / Labeler 端

- Labeler 端默认走 Formily runtime。
- `visibleWhen` / `disabledWhen` / `linkageRules` 会被编译成 runtime reaction。
- `qualityScore = 1 / 2` → `factCheckNote` 显示并必填。
- `qualityScore = 3 / 4 / 5` → `factCheckNote` 隐藏并清空。

### 5.3 Submit Validation

- 提交前不能只看静态 `required`。
- `visible + required + empty` → 阻断提交。
- `hidden required` → 不阻断。
- `disabled required` → 不阻断。
- 不要破坏 Formily values clone 后同步到外层 answers 的逻辑。

### 5.4 AI Assist Preflight

- AI `suggestedPatch` 不能直接写入答案。
- patch 字段不存在 → 不允许应用。
- patch 后新增必填缺失 → 不允许一键采纳。
- patch 会清空 / 隐藏字段 → 可以提示风险。
- 这些工程语言不要直接暴露给 Labeler 用户。

普通 UI 中不要出现以下工程词：

```txt
schema constraint
requiredMissingFieldNames
preflight blocked
sourcePayload
answers JSON
raw patch
raw prompt
debug
mock
legacy
formily-v2
```

---

## 6. 下一轮 UI 优先级

### 6.1 P0：不要破坏主链路

- [ ] Labeler 页面能正常打开。
- [ ] AI Assist 按钮可见。
- [ ] ShowItem / 原文 / 媒体显示正常。
- [ ] `qualityScore = 1 / 2` 时 `factCheckNote` 出现且必填。
- [ ] `qualityScore = 3 / 4 / 5` 时 `factCheckNote` 隐藏且不阻断提交。
- [ ] 必填字段没填时提交按钮不能误提交。
- [ ] 填完整后 submit 成功。
- [ ] Console 不出现 `submit 500` / `audit-events 500`。

### 6.2 P1：AI Assist Panel

这是下一轮最重要的 UI。目标是把 AI Assist 从工程提示改成“AI 质量检查建议”面板，让用户看懂 AI 判断、建议修改、当前值和建议值的区别。

推荐结构：

```txt
AI 质量检查建议

AI 判断：
这条内容来源依据不足，建议降低质量评分，并补充事实核查说明。

建议修改：
- 质量评分：3 → 1
- 修改建议：（空） → 建议补充新闻来源和事实依据
- 事实核查说明：（空） → 该内容缺少可验证来源，建议人工复核。

[一键采纳]  反馈问题
```

要求：

- 主按钮叫“一键采纳”，不要再用“确认应用建议”。
- 不放显眼的“暂不使用”按钮；用户不点“一键采纳”，继续手动标注即可。
- 反馈问题可以作为弱操作保留。
- patch 不完整或不能一键采纳时，显示人话提示，不显示工程错误。
- 不要强做“AI 自动补充 factCheckNote”，先只做 UI 表达和安全应用。

### 6.3 P2：Labeler 标注台

- 题目导航
- 草稿自动保存
- 打回提示
- 题目级 LLM 辅助调用
- 提交校验

### 6.4 P3：Owner 模板配置页

对应 4.2 标注页面动态搭建：

```txt
左侧物料与布局组件 → 中间 Schema 画布 → 右侧属性 / 校验 / 联动配置
```

---

## 7. Labeler 标注台功能说明

### 7.1 题目导航

- 显示当前题目序号，例如 `3 / 20`。
- 支持上一题 / 下一题。
- 支持题目状态：未开始 / 草稿 / 已提交 / 被打回 / 当前题。
- 当前题目高亮。
- mock 数据不足时 disabled + tooltip，不要死按钮。

### 7.2 草稿自动保存

- 表单填写后显示“正在保存 / 已自动保存 / 保存失败”。
- 不要硬编码假时间。
- 手动保存草稿也要有反馈。

### 7.3 打回提示

- `returned` 状态显示打回原因、审核员建议、需要修改的字段。
- 提示放在表单上方或右侧辅助栏。
- 不要显示 audit / debug / raw payload。

### 7.4 题目级 LLM 辅助

- 按钮文案：AI 质量检查 / 获取 AI 建议。
- 点击后展示 AI 质量检查建议。
- 不展示 raw prompt / answers JSON / sourcePayload。
- 不绕过 schema-aware preflight。

### 7.5 提交校验

- 基于 runtime 状态校验 visible / hidden / disabled。
- 必填未填时给字段级提示，不只在 Console。
- 填完整后 submit 成功并有页面反馈。

---

## 8. Owner 模板配置页功能说明

### 8.1 左侧物料与布局

| 物料 | 布局 |
|---|---|
| 单行输入 | 分组容器 |
| 多行文本 | 多 Tab 布局 |
| 单选 |  |
| 多选 |  |
| 标签选择 |  |
| 富文本 |  |
| 文件 / 图片 |  |
| JSON 编辑器 |  |
| LLM 触发组件 |  |
| 展示项 ShowItem |  |

组件项需要有图标或字母标识、名称、简短说明。如果真实 SchemaDesigner 尚不支持拖拽，不要做假拖拽；可 disabled + tooltip，或提示“由 SchemaDesigner 组件接管”。

### 8.2 中间 Schema 画布

- 至少展示 ShowItem、表单输入字段、LLM 触发组件、分组 / 多 Tab 布局节点。
- 不要写 `schema-core exports/build 修复` 等工程提示。
- 改成人话：“模板编辑器用于配置字段结构、联动规则与 AI 辅助节点。”

### 8.3 右侧属性 / 校验 / 联动配置

| 属性配置 | 校验配置 | 联动配置 |
|---|---|---|
| 当前选中组件名称 | `required` | `visibleWhen` |
| 字段 `name` | `min / max` | `disabledWhen` |
| 字段类型 | 格式校验 | `linkageRules` |
| 是否必填 | 提交前校验说明 | 示例：`qualityScore = 1/2 → factCheckNote 显示并必填` |
| 默认值 / 选项配置 |  | 示例：`qualityScore = 3/4/5 → factCheckNote 隐藏并清空` |
| 输出绑定 |  |  |

---

## 9. 其他待完善模块

| 模块 | 接力说明 |
|---|---|
| AI 预审页面 | 对应 4.4 AI Agent：异步队列、维度评分、function_calling 结构化输出、Prompt 模板、失败重试与人工兜底。后续统一 Corporate Trust 风格，减少紫色 / 橙色过度跳色。 |
| 人工审核流转 | 对应 4.5 多角色审核流转：复审 / 终审视图、第 1 / 2 轮 diff、AI 评语、批量操作、完整审计时间线。Reviewer 只看与自己审核相关的信息。 |
| Labeler 任务广场 | 需区分：所有发布到广场的任务（先到先得）、配额抢单任务、指派给自己的任务。不要混在一个列表。 |
| 任务发布页 | 当前存在创建失败，需要排查前端 payload 是否符合 contracts、后端接口是否已接、错误提示是否人话、发布失败是否有页面反馈。 |

---

## 10. 死按钮与反馈清单

- [ ] 页面里有没有按钮点了没反应。
- [ ] 如果功能未实现，按钮隐藏或 disabled + tooltip。
- [ ] 不要留下看起来能点但没有反馈的按钮。
- [ ] 草稿保存时间不要硬编码假时间。
- [ ] 提交成功 / 失败要有页面反馈，不只在 Console。
- [ ] disabled 按钮视觉要明显。
- [ ] hash、audit timeline、长文本不要溢出。
- [ ] 普通 UI 不显示 `[debug]` / `legacy` / `formily-v2` / `mock` / `raw` 等工程词。

---

## 11. Quality Center 暂后

AI Panel 做完后，可以再做 Owner 侧 Quality Center Lite。不要先做完整 BI。

| Owner | Reviewer | Labeler |
|---|---|---|
| 完整质量中心：AI 采纳率、Reviewer 修改率、风险信号、审计日志、Data Quality Passport、导出质量摘要。 | 只看与自己审核有关的数据：已审核数量、退回数量、修订字段、AI 预审反馈等。 | 不需要质量看板，只看当前任务即时反馈：AI 建议、必填提示、提交结果、退回原因。 |

---

## 12. 推荐执行顺序

1. 确认最新 `integration/joint-test` 能跑。
2. 新开 `feature/ui-polish` 分支，开 draft PR。
3. 做 AI Assist Panel 的人话表达与安全采纳。
4. 做 Labeler 标注台题目导航 / 自动保存 / 打回提示 / 提交校验。
5. 做 Owner 模板配置页物料、布局、画布、属性 / 校验 / 联动配置。
6. 做死按钮和页面反馈。
7. 做字体、字号、溢出、按钮视觉统一。
8. 再考虑 Owner Quality Center Lite。
9. 最后补 QA 截图和测试记录。

---

## 13. 提交前自检

### 13.1 前端

```bash
cd apps/web
npm run typecheck
npm run build
```

### 13.2 如果动了 schema-renderer

```bash
npm.cmd --prefix packages/schema-renderer run typecheck
```

### 13.3 如果动了 schema-designer

```bash
npm.cmd --prefix packages/schema-designer run typecheck
```

### 13.4 后端与 E2E

```bash
pytest -m "not integration"
bash apps/api/scripts/e2e_test.sh
```

改了数据库模型必须走 alembic 迁移，不要手改库。

---

## 14. 给接力同学的重点总结

**不要破坏** 已合并的 schema runtime / Formily 联动 / AI preflight。  
**先做** AI Assist Panel 的人话表达。  
**再补** Labeler 标注台交互和 Owner 模板配置页物料与布局。  
**最后** 死按钮检查、QA 截图和测试记录。

一句话：

> 先保证真实链路能跑，再做 UI polish；先做人能理解的 AI 建议，再做更漂亮的界面。

