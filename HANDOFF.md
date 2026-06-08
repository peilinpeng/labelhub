# HANDOFF.md — 轮班交接状态（动态表单架构）

> 本文件是两个 AI 工具（Claude Code / Codex）轮班时的**唯一实时状态来源**。
> 接手第一件事：读本文件 + `SCHEMA_ARCH_AGENT.md`，再读真实代码核对。
> 交班最后一件事：更新本文件。
> **本文件记录客观事实，不写「应该差不多了」这类模糊结论。**
>
> **关于 commit 的说明（给接手的 AI）：** 「不要 commit / push」的纪律针对的是**任务代码改动**。
> 项目维护者本人可能会为「交接文档 / 任务文件」（本文件、SCHEMA_ARCH_AGENT.md、AGENTS.md、tasks/*.md）做基础设施 commit，这是正常的，不违反纪律。
> 你（AI）在执行任务时，除非当前任务明确要求，否则仍然不要 commit 任何东西。

---

## 0. 统一编号对照表

| 统一编号 | 内容 | 状态 |
|---|---|---|
| Phase A | Prompt Feedback Loop（metadata、renderer callback、Labeler 事件、AI_ASSIST_EDITED、Reviewer AI feedback） | ✅ 已完成 |
| A-tail | mock prompt registry / 真实 SHA-256 `promptSnapshotHash` / `outputHash` | ✅ 已完成（commit 73ec0bc） |
| Phase B1 | Reviewer corrected answers + shallow patches（不写 audit） | ✅ 已完成（commit 31e4bac） |
| Phase B2 | `REVIEW_DIFF_GENERATED` audit | ✅ 已完成（commit 436886f） |
| Phase C | Export / Data Quality Passport contracts 与 mock | ✅ 已完成（contracts 6993e3b / web fcbccb4） |
| Phase D | Read Model / Snapshot / risk fast path | ⬜ 暂缓（竞赛阶段不做） |
| FE-1 | 安装 Formily + ComponentRegistry + FormilyRuntimeRenderer shell | ✅ 已完成（commit 00491e4） |
| FE-2 | 7 个 input adapter + feature flag 接入 SchemaRenderer | ✅ 已完成（commit ee1206b） |
| FE-2b | AssignmentPage 引擎切换 debug 开关 | ✅ 已完成（commit 9378e29） |
| FE-3 | Formily answers 双向同步策略（debounce + flush on submit）+ 新增测试 | ⬜ 暂缓（demo 阶段不做） |
| FE-4 | 新建 schema-compiler 包 + DependencyGraphVisitor | ✅ 已完成（commit 6827673） |
| FE-5 | FormilyReactionVisitor + linkage runtime + 测试 | ✅ 已完成（commit 0bd1ea8） |
| FE-7 | runSchemaPreflight headless 预检引擎 | ✅ 已完成（commit f089697） |
| FE-8 | AI Assist preflight UI（SAFE/WARNING/BLOCKED 三态）| ✅ 已完成（commit cf3317a） |
| FE-6 | 循环依赖 DFS 检测 | ⬜ 暂缓 |
| FE-9 | Runtime Trace Event + Trace Panel 骨架 | ⬜ 不做（见第 3 节） |
| FE-10 | Dependency Graph 可视化 + Field Inspector | ⬜ 不做 |
| FE-11 | dnd-kit Designer | ⬜ 不做（见第 3 节） |
| FE-12~14 | Designer Linkage Builder / Publish preflight / Virtual List | ⬜ 不做 |

---

## 1. 当前 Git 基线（每次开班核对，每次收班更新）

```txt
分支：    fix/joint-test-web-shell（基线：origin/integration/joint-test @ 87abab0，本轮未 commit / 未 push）
commit：  87abab0   origin/integration/joint-test 当前同步基线
工作区：  dirty（apps/web UI/真实链路清理 + schema-renderer AI Assist UI polish，未提交；不要误认为 clean）
更新时间：2026-06-08（Codex：AI 预审/人工审核职责澄清 + ReviewConfig 前端链路 + Reviewer 验收视图补强）
更新者：  Codex

近三次收尾（本轮）：
  - b4cd12b fix(web): 登录健壮性——失败不再静默放行 + token 失效跳登录
  - 3199248 chore(web): bundle 按依赖代码分割，消除 >500kB chunk 警告（main 624kB→266kB）
  - 2cf3c7e chore(deploy): 新增 .env.example 云部署模板

三条主线均已完成并 push：
  - Schema Governance：cf3317a 及之前各 commit
  - Quality Layer：Phase A / A-tail / B1 / B2 / C 全部 push
  - Schema Runtime Engine：FE-1~FE-5 / FE-7 / FE-8 全部 push
```

---

## 2. 当前任务

**当前阶段：最终交付收束（文档、demo 路线固化、QA 记录）**

已完成的主线：

- Schema Governance：Breaking Change 检测 + Audit Timeline + Deprecation + Migration Required
- Quality Layer：Labeler 遥测 + AI Assist 审计 + Reviewer diff + Export Passport
- Schema Runtime Engine：Formily 联动运行时 + headless preflight + AI Assist 预检 UI

**当前不建议继续开发的大功能（见第 3 节）**

---

## 3. 不建议继续开发的功能（最终状态声明）

```txt
不建议继续做：dnd-kit Schema Designer（FE-11~13）
  原因：竞赛阶段时间不足，demo 故事线不依赖 Designer 可交互

不建议继续做：WebWorker / compile cache（FE-14 / 决策 5）
  原因：竞赛规模 schema 无需 Worker 隔离

不建议继续做：Runtime Trace Panel（FE-9 / FE-10）
  原因：demo 无此路线，实现成本高

不建议继续做：大范围 UI 重构
  原因：当前重点是 demo 稳定、QA 记录、答辩材料

不建议继续做：FE-3 answers debounce
  原因：demo 使用 legacy renderer，formily-v2 路径不在主 demo 路线

当前优先级：
  1. 手动 QA（见 docs/QA_TEST_RECORD.md）
  2. 补全截图（放入 docs/qa-assets/）
  3. 答辩讲解材料整理
```

---

## 4. 已完成主线详细记录

### A. Schema Governance

| 功能点 | 说明 | 状态 |
|---|---|---|
| Owner Publish Preview | 发布前兼容性检查 + 预览 diff | ✅ |
| compatibility check | Breaking Change / Deprecation / Migration Required 三类检测 | ✅ |
| deprecation rules | `FIELD_DEPRECATED` warning + 勾选确认才发布 | ✅ |
| migration required | `FIELD_TYPE_CAST_REQUIRED` 提示，不阻断发布 | ✅ |
| publish blocked | Breaking Change（`FIELD_REMOVED`）阻断发布按钮 | ✅ |
| audit timeline | publish_blocked / compatibility_checked / schema_version_published | ✅ |
| demo data | task_demo_schema_breaking_change / safe_publish / deprecation / migration_required | ✅ |

### B. Quality Layer

| 功能点 | 说明 | 状态 |
|---|---|---|
| Labeler telemetry | LABELING_SESSION_STARTED / AI_ASSIST_TRIGGERED 等事件 | ✅ |
| AI Assist audit | AI_ASSIST_SHOWN / ACCEPTED / DISMISSED / EDITED + promptSnapshotHash / outputHash | ✅ |
| Reviewer audit | REVIEW_SUBMITTED 含 patchCount | ✅ |
| Reviewer diff | computeReviewPatches + REVIEW_DIFF_GENERATED audit | ✅ |
| Reviewer AI feedback | AI_REVIEW_FEEDBACK 审计（reviewer AI 辅助打分） | ✅ |
| Export audit summary | DATA_QUALITY_PASSPORT_GENERATED + passportBatchHash（真实 SHA-256） | ✅ |
| Data Quality Passport | contracts `DataQualityPassport` + OwnerExportPage 展示摘要 | ✅ |

### C. Schema Runtime Engine / Formily

| 任务 | 功能点 | 关键文件 |
|---|---|---|
| FE-1 | Formily shell + ComponentRegistry | packages/schema-renderer/src/ComponentRegistry.ts, FormilyRuntimeRenderer.tsx |
| FE-2 | 7 adapter + feature flag（默认 legacy） | packages/schema-renderer/src/adapters/ |
| FE-2b | AssignmentPage renderer engine 切换开关 | apps/web/src/features/labeler/AssignmentPage.tsx |
| FE-4 | schema-compiler 包 + DependencyGraphVisitor | packages/schema-compiler/src/dependency-graph.ts |
| FE-5 | FormilyReactionVisitor + linkage runtime + 测试 | packages/schema-compiler/src/formily-reaction-visitor.ts |
| FE-7 | runSchemaPreflight（headless，纯函数，无 DOM） | packages/schema-compiler/src/preflight.ts |
| FE-8 | LLMAssistRenderer SAFE/WARNING/BLOCKED 三态 preflight UI | packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx |

---

## 5. 最终启动命令

```bash
# 切换到正确分支
git checkout feature/schema-governance-upgrade
git pull

# 安装依赖
npm install

# 启动 dev（必须带 MSW 环境变量）
cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

访问：`http://localhost:5180`

---

## 6. 最终验证命令

```bash
cd packages/contracts && npm run typecheck && npm run test
cd packages/schema-core && npm run typecheck && npm run test
cd packages/schema-compiler && npm run typecheck && npm run test
cd packages/schema-renderer && npm run typecheck && npm run test
cd apps/web && npm run typecheck && npm run build
```

预期：全部通过，无 typecheck 错误，无 build 错误。

---

## 7. 已知边界与注意事项

```txt
1. ~~formily-v2 当前不渲染 LLM_ASSIST 节点~~ **【已过期，2026-06-07 订正】**
   - 现状：formily-v2（默认引擎）**已渲染** LLM_ASSIST + SHOW_ITEM（FormilyRuntimeRenderer.renderSchemaNode 已分流，实测 AI 辅助按钮在）
   - 默认引擎现已覆盖标注要求点名的全部物料组件（含 upload、富文本，见 §9 最新日志）
   - demo 直接用默认 formily-v2 即可，无需切 legacy

2. Reviewer submission 重复提交可能返回 409
   - 这是状态机保护行为，不是 bug
   - 提示：刷新页面或使用不同的 sub_xxx

3. Demo 必须启用 MSW
   - 普通 npm run dev 不带 MSW，/api 请求会 404
   - 必须：VITE_ENABLE_MSW=true npm run dev

4. 截图和 QA 记录
   - 所有截图放 docs/qa-assets/
   - 命名规范见 docs/QA_TEST_RECORD.md

5. mock-db.ts 中残留 sha256:mock-* 占位符（6 处）
   - 仅在静态种子审计记录中，非 live 路径，不阻断 demo

6. Vitest <4.1.0 CVE（GHSA-5xrq-8626-4rwp）
   - 非阻断性，由维护者决定升级时机
```

---

## 8. 状态看板（最终快照）

**已完成（已 push）：**
- Schema Governance 全线 ✅
- Quality Layer 全线 ✅
- FE-1 / FE-2 / FE-2b / FE-4 / FE-5 / FE-7 / FE-8 ✅

**暂缓（竞赛不做）：**
- Phase D（Read Model / Snapshot）
- FE-3（answers debounce）
- FE-6（循环依赖 DFS）
- FE-9~14（Trace Panel / Designer / Virtual List）

**当前工作区：**
- dirty（本轮前端改动未 commit，遵守“未明确要求不 commit/push”）
- 已验证：apps/web typecheck ✅；apps/web build ✅；packages/schema-designer typecheck ✅；packages/schema-renderer typecheck ✅；git diff --check ✅（仅 CRLF warning）

---

## 9. 上一班工作日志（收班时追加，最新在上）

```txt
### 2026-06-08 | Codex（AI 预审职责 + 人工审核验收 UI，未 commit）
- 任务：按用户要求明确 AI 预审与人工审核边界：
  - AI 预审相关设置由任务负责人操作，覆盖 4.4 AI Agent：异步队列、维度评分 / function_calling 结构化输出、Prompt 模板、失败重试与人工兜底。
  - 人工审核侧覆盖 4.5 多角色审核流转：复审 / 终审视图、第 1 / 2 轮 diff、AI 评语、批量操作、完整审计时间线。
- 改动文件：
  - apps/web/src/api/reviewer.ts：新增 ReviewConfig 前端 client（get/create/update），复用现有 review API，不改 contracts。
  - apps/web/src/features/owner/OwnerAIPage.tsx：Owner AI 预审设置改为真实配置表单，含模型、自动通过/打回阈值、失败重试次数、Prompt 模板、维度权重、function_calling 结构化输出说明与流转预览。
  - apps/web/src/features/reviewer/ReviewerWorkspace.tsx：审核队列增加“人工审核验收”说明、任务负责人维护规则提示、复审/终审/第 N 轮 diff 流程条、批量通过/批量打回入口；批量请求仍走 batchDecideReview。
  - apps/web/src/features/reviewer/ReviewDetailPage.tsx：审核详情去除 mock fallback，展示 AI 评语与预审 trace、修订 diff 预览、审核/终审阶段条、完整时间线（history/auditLogs/queryAuditEvents）。
  - apps/web/src/styles.css：补充 Owner AI 配置与 Reviewer 审核验收相关样式。
  - apps/web/src/main.tsx：增加 bootstrap 失败可见兜底，避免启动失败时白屏。
- 浏览器验证：
  - http://localhost:5180/owner/tasks/task_news_quality/ai-config 可见“任务负责人维护 AI Agent 配置：异步队列、结构化评分、Prompt 模板、失败重试与人工兜底”，可见 function_calling 输出、重试后转人工等说明。
  - 当前后端/MSW 对 GET /api/v1/tasks/task_news_quality/review-config 返回 500 时，Owner 页面显示“尚未读取到已保存配置：Request failed: 500 Internal Server Error”，但页面可继续编辑默认配置。
  - ReviewerWorkspace 组件与完整 App 的服务端渲染探针均能渲染审核队列 loading 壳；应用内浏览器直接打开 /reviewer/items 曾出现 root 空白，未能继续刷新验证（浏览器安全策略阻止该页刷新），需下一班在干净浏览器会话复查真实客户端深链路。
- 验证：
  - npm.cmd --prefix apps/web run typecheck ✅
  - npm.cmd --prefix apps/web run build ✅（仍有既有 circular chunk warning: vendor -> vendor-react -> vendor）
  - npm.cmd --prefix packages/schema-renderer run typecheck ✅
  - git diff --check ✅（仅 CRLF warning）
- 是否触碰边界：修改 apps/web 前端 UI/API client 与 main 启动兜底；未改 apps/api，未改 packages/schema-core / schema-renderer runtime 逻辑，未改 contracts。

### 2026-06-08 | Codex（Owner Schema Designer UI polish，未 commit）
- 针对 Owner 模板搭建页继续 UI polish：
  - 新建空白预设模板不再继承任务名，默认显示“未命名预设模板 / 空白模板”，另存输入框默认同名。
  - packages/schema-designer 右侧属性面板改成人话表达：隐藏 visibleWhen / disabledWhen / validations / sourcePath / transform 等工程 JSON 入口；展示内容改为“读取内容”选择；字段属性改为“保存字段 / 必填 / 隐藏时保留”等短文案。
  - 画布节点不再显示 show.text / input.textarea / choice.radio 等紫色工程类型；底部从“Schema 校验通过”改为“模板检查 / 本地结构检查 / 当前模板结构无错误”，避免误认为服务端发布校验。
  - 选项属性改为每项一组“选项文字”textarea + “保存值”input，修复看起来像不可编辑的右对齐文字。
  - apps/web 样式移除右侧属性面板伪造的“校验规则 / 字段联动 / 新增联动规则”内容；分屏窄宽度下模板搭建页保持可横向滚动的三栏编辑器，不再把工具条和标题挤成竖排。
  - 预设命名区从画布下方移动到常用预设区之后、模板画布之前；预设名称和说明始终可编辑，并实时同步到当前 schema 的 meta/root 标题说明。
  - “新建预设”卡片加号改为 CSS 几何十字，避免字体基线导致视觉不居中。
- 浏览器验证：http://localhost:5180/owner/tasks/task_news_quality/designer 在 753px 分屏宽度下工具条宽 760px，设计器三栏为 190/420/300；可见文本不再包含 RuntimeContext、show.text、sourcePath、validations、visibleWhen、disabledWhen、noEmoji、属性面板等工程词；点击“新建预设”后标题和另存输入为“未命名预设模板”。
- 追加浏览器验证：预设命名卡位于画布之前；点击“新建预设”后名称=“未命名预设模板”、说明=“空白模板。”、节点=0；编辑名称/说明后下方模板标题和说明实时同步；加号 CSS 十字中心为 21px/21px。
- 验证：
  - npm.cmd --prefix apps/web run typecheck ✅
  - npm.cmd --prefix packages/schema-designer run typecheck ✅
  - npm.cmd --prefix apps/web run build ✅（仍有既有 circular chunk warning: vendor -> vendor-react -> vendor）
  - npm.cmd --prefix packages/schema-renderer run typecheck ✅
- 是否触碰边界：修改 apps/web 样式与 OwnerSchemaPage，以及 packages/schema-designer 显示层组件；未改 apps/api，未改 schema-core / schema-renderer runtime 逻辑。

### 2026-06-08 | Codex（fix/joint-test-web-shell：UI polish + 真实链路清理，未 commit）
- 基线：当前分支 fix/joint-test-web-shell；已同步 origin/integration/joint-test @ 87abab0；未覆盖 backup/web-shell-dev-before-joint。
- AI Assist Panel：packages/schema-renderer/src/renderers/LLMAssistRenderer.tsx 已改为“AI 质量检查建议”面板，保留 existing preflight / onApplySuggestedPatch 安全链路，不展示 raw prompt / answers JSON / sourcePayload / 工程 preflight 字段。
- 恢复并保留 web-shell-dev 侧 apps/web UI polish：紫/橙主题、移动端适配、Owner/Reviewer/Labeler 中文文案、Owner 详情看板、Owner AI 预审配置、Reviewer 去 AI 设置入口等。
- 本轮新增：AppShell 头像不再用 CSS 伪元素硬编码姓名，改读取真实 labelhub_actor；补 `.app-user-avatar` 居中样式。
- 本轮新增：移除前端 API 失败后自动回退 mock/local/demo 数据的路径：
  - OwnerWorkspace / LabelerWorkspace：API 失败显示空态与错误；过滤后端已知 seed/demo 任务（task_news_quality、task_product_title、Demo A/B/C 等），真实新建任务仍显示。
  - OwnerNewTaskPage：真实 createTask 失败时不再创建 task_local_* 本地临时任务，也不再跳转到必然不存在的 designer 页；后端未启动时停留在新建页显示失败原因。createTask 前端解包兼容真实后端 `{ task, auditLog }` 与 MSW 直接 Task 响应，修复 “Cannot read properties of undefined (reading 'id')”。
  - OwnerSchemaPage：常用预设区新增“新建预设模板”卡片，可创建空白 schema 起点；模板画布下新增“另存为预设模板”，将当前 schema 快照保存到浏览器本地预设库并可在后续任务中重新加载。
  - AssignmentPage：不再 fallback 到 mock assignment / datasetItems / demo submit；submit 失败显示错误；LLM 失败只返回不可用提示和空 patch。
  - ReviewerWorkspace / ReviewDetailPage / review-display：不再塞 fallbackQueue / sub_1001~1004 假内容 / 假分数 / 假时间线 / 假个人统计。
  - OwnerTaskDetailPage：改 fetchTask 真实加载；无真实统计接口时显示 `-` 或空态，不再显示假标注员与 128/121/7 等统计。
  - OwnerExportPage：改 fetchTask + listExportJobs 真实加载；不再创建 exp_demo_001、不再本地异步假导出、不再生成本地假下载文件。
  - owner/reviewer audit actor：不再写 usr_owner_demo / usr_reviewer_demo，改读取登录 actor，缺失时使用角色兜底。
- 浏览器验证：http://localhost:5180/owner/tasks 刷新后头像 grid 居中，seed/demo 任务不显示，Owner 列表为空态（0 个任务，等待真实链路创建任务）。
- 验证：
  - npm.cmd --prefix apps/web run typecheck ✅
  - npm.cmd --prefix apps/web run build ✅（仍有既有 circular chunk warning: vendor -> vendor-react -> vendor）
  - npm.cmd --prefix packages/schema-renderer run typecheck ✅
  - git diff --check ✅（仅 CRLF warning）
- 是否触碰边界：主要 apps/web；保留早前 schema-renderer AI Assist UI polish；未改 apps/api，未改 schema-core 核心逻辑。
- 遗留提醒：当前工作区 dirty，未 commit/push；如果要推 joint-test，先由维护者确认是否直接 push 或开 PR。

### 2026-06-07 | Claude Code（体验健壮性 + 工程打磨 + 云部署模板，已 push 2cf3c7e）
- 背景：对照官方提交物要求收尾三项（跳过移动端/虚拟化等可选加分）。
- b4cd12b 登录健壮性：原 App.tsx handleRoleSelect 把登录失败 catch 吞掉仍进工作台
  （只存 role 不存 token → 全程 401 回退 mock 假数据，答辩易误导评委）。
  修：①登录失败停在登录页报错、不进工作台；②client.ts 401 清 token 跳登录、不再静默 mock。
  浏览器三态实测：错误密码停留报错 / 无效 token 跳登录清 token / 正确登录进真实数据，均通过。
- 3199248 bundle 代码分割：单 chunk 624kB 超 500kB 警告。vite manualChunks 拆
  vendor-react(207kB)/vendor-formily(137kB)/vendor(14kB)，main 降到 266kB，警告消除。
  （vitest CVE 升级、mock-db 占位评估后不动——dev-only / 非 live 路径，非阻断。）
- 2cf3c7e .env.example 云部署模板：compose 已用 ${VAR:-default} 参数化但缺可提交模板。
  按 config.py 必需 6 变量补占位符模板 + 云部署说明；真实 .env 仍 gitignore，无密钥泄漏。
- 是否触碰边界：动了 apps/web（渲染/壳层）+ 根 .env.example，未改 packages/contracts 与架构契约。
- 验证：web typecheck+build ✅；登录三态浏览器实测 ✅；密钥泄漏安全检查 ✅（.env 被忽略、模板纯占位、历史无 .env）。

### 2026-06-07 | Claude Code（对照官方 PDF 修复 Labeler 两缺口，已 push e625d63）
- 背景：按官方课题 PDF（LabelHub·AI全栈课题实现要求）逐条核对 4.1~4.6。绝大部分已真实落地；
  发现 2 个 Labeler 功能完备性缺口（属验收 60% 桶）。
- 5d20b49 草稿自动保存：原徽章写死「草稿已自动保存 18:02:31」假文案 + 仅手动按钮。
  修：答案变更防抖 1.2s 自动 saveDraft + 真实时间戳 + 基线脏检查（切题/载入不误存）。
  文件：apps/web/src/features/labeler/AssignmentPage.tsx。
- e625d63 我的提交页：原 LABELER_SUBMISSIONS 是 PlaceholderPage，但后端 GET /me/submissions 已就绪。
  修：新增 LabelerSubmissionsPage（归类统计+KPI+筛选+列表）+ api listMyAssignments + App 路由接入。
  文件：apps/web/src/features/labeler/LabelerSubmissionsPage.tsx、api/labeler.ts、app/App.tsx。
- 是否触碰边界：未改 packages/contracts/、未改架构契约；仅 apps/web。
- 验证：web typecheck+build ✅；真实后端浏览器复验——自动保存触发真实 PUT/draft+真实时间戳；
  我的提交渲染 6 条、标题解析、KPI/筛选正确 ✅。
- 结论：Labeler 全流程完整闭环。可选加分项未做：移动端、O5 大表单虚拟化。

### 2026-06-07 | Claude Code（组件覆盖审计 + upload 缺口/富文本修复，已 push 50ba8f0）
- 背景：拿举办方测试数据（~/Downloads/datasets，已核对 = 仓库 seed = 运行库，零偏差）做组件覆盖度审计。
  对照两份「标注要求.md」点名物料，逐项核对 + 浏览器在真实数据上实测。
  结论：seed 已 100% 用到点名组件，但默认引擎 formily-v2 有 1 真缺口 + 1 降级。
- f3f3cfa upload 缺口：getComponentName 缺 upload.* 分支 + registry 未注册 FileInput → upload 字段不渲染；
  叠加 O11 联动 setRequired(evidence) 会卡提交。修：FormilyFileAdapter + 注册 COMPONENT_NAMES.FILE + 分支。
- 50ba8f0 富文本：input.richtext 原两引擎都降级成 textarea。新增零依赖 RichTextInput（Markdown 编辑器：
  工具栏+文本域+预览，复用 MarkdownPreview，不引重型 WYSIWYG）；getComponentName → RICHTEXT；legacy 拆出。
- 改动文件：
  - packages/schema-renderer/src/components/RichTextInput.tsx（新）
  - packages/schema-renderer/src/adapters/FormilyFileAdapter.tsx（新）+ FormilyRichTextAdapter.tsx（新）
  - packages/schema-renderer/src/{ComponentRegistry.ts, adapters/index.ts, FormilyRuntimeRenderer.tsx, index.ts}
  - packages/schema-renderer/src/renderers/FieldRenderer.tsx（legacy richtext 拆出）
  - packages/schema-renderer/src/__tests__/FormilyRuntimeRenderer.test.tsx（+upload +richtext×2 回归）
  - apps/web/src/styles.css（富文本工具栏/预览样式）
- 顺带确认（非缺口）：O11 字段联动在默认引擎用举办方真实数据当场验证通过（修订建议/证据素材联动）；
  订正本文件 §7 第 1 条过期描述（formily-v2 现已渲染 LLM_ASSIST/SHOW_ITEM）。
- 是否触碰边界：未改 packages/contracts/、未改架构契约；动了 schema-renderer + apps/web 渲染层（合并负责人职责内）。
- 验证：schema-renderer typecheck + 67 测试 ✅；web typecheck+build ✅；真实后端浏览器复验
  upload（勾安全违规→fileInputs 0→1）+ 富文本（加粗插入 **xx** / 预览渲染 <strong>）✅。
- commit：f3f3cfa + 50ba8f0（均已 push，integration/joint-test 与远程同步）。

### 2026-06-07 | Claude Code（ShowItem 媒体渲染 P0 修复，已 push 55a1bc0）
- 背景：核对 ShowItem 对 image/video/markdown 渲染时挖出真实竞赛数据 P0 缺口——
  默认 formily-v2 引擎对 SHOW_ITEM return null（标注员看不到 prompt/答案/媒体），
  legacy ShowItemRenderer 又只输出纯文本（媒体不渲染），且页面源数据面板是电商 demo 残留。
- 改动文件：
  - packages/schema-renderer/src/FormilyRuntimeRenderer.tsx（默认引擎渲染 SHOW_ITEM）
  - packages/schema-renderer/src/renderers/ShowItemRenderer.tsx（按 node.type 真渲染 + URL 净化）
  - packages/schema-renderer/src/markdown.tsx（新，零依赖轻量 Markdown，移植自 apps/web 扩展图片/链接）
  - apps/web/src/features/labeler/AssignmentPage.tsx（删电商残留「原始商品标题」面板）
  - apps/web/src/styles.css（媒体不溢出）
  - apps/api/scripts/seed_competition.py（_show 加 visibleWhen 按 media_type 网关）
  - 测试：ShowItemRenderer.test.tsx（新，7）+ FormilyRuntimeRenderer.test.tsx（+formily-v2 P0 集成测试）
- 运行库补丁：sv_qa_quality_v1 的 schema_json 已手工注入 3 个 visibleWhen（seed 幂等不更新现有任务，故现库需直接打补丁）。
- 是否触碰边界：未改 packages/contracts/、未改架构契约；动了 apps/web 渲染层（合并负责人职责内）。
- 验证：schema-renderer typecheck + 64 测试 ✅；web typecheck+build ✅；真实后端浏览器复验 video/image/markdown 三类渲染正确、visibleWhen 网关生效 ✅。
- commit：55a1bc0（已 push，integration/joint-test 与远程同步）。

### 2026-06-07 | Claude Code（文档收束）
- 任务：最终交付收束——更新 HANDOFF.md + 新增 Final Demo Guide + QA_TEST_RECORD + qa-assets 目录
- 改动文件：
  - HANDOFF.md（更新为最终状态）
  - docs/LabelHub_Final_Demo_Guide.md（新增）
  - docs/QA_TEST_RECORD.md（新增）
  - docs/qa-assets/.gitkeep（新增）
- 是否触碰边界：否（仅文档，未改 apps / packages 任何源码）
- 验证：git diff --check ✅；git status 确认仅文档变更
- commit：待维护者确认后 commit
- 遗留问题：
  - 手动浏览器 QA 尚未完成（需维护者填写 docs/QA_TEST_RECORD.md）
  - 截图尚未放入 docs/qa-assets/

### 2026-06-07 | 维护者（push FE-8）
- 任务：push FE-8 AI Assist preflight UI（含 UI polish）
- commit：cf3317a feat(schema-renderer): add AI assist preflight UI
- 工作区：clean

### 2026-06-06 | Claude Code（FE-8 UI Polish）
- 任务：优化 FE-8 preflight UI 文案（SAFE/WARNING/BLOCKED 三态）
- 核心改动：
  - PreflightStatusBlock 新增 patchFieldNames prop，三态均显示"将更新字段：xxx"
  - SAFE → "✅ 预检通过" + "本次建议不会新增必填缺失、非法字段或隐藏清空风险。"
  - WARNING → "⚠️ 预检发现影响" + "本次建议可以应用，但会影响部分字段。"
  - BLOCKED → "⛔ 预检阻断" + "本次建议会新增无法满足的表单规则，因此不能直接应用。"
- 新增 3 个测试，总计 41/41 通过
- 验证：typecheck ✅ test ✅ build ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-8 实现）
- 任务：LLMAssistRenderer 接入 preflight（SAFE/WARNING/BLOCKED）
- 关键约束：
  - BLOCKED 时"确认应用建议"按钮 disabled（物理拦截，ACCEPTED audit 无法触发）
  - 不展示完整 answers / patch 值 / prompt
  - 不写入新 audit 事件（复用已有 SHOWN/ACCEPTED/DISMISSED/EDITED）
- 新增：convertSuggestedPatchToPreflightPatch（export，供测试直验）
- 测试：LLMAssistPreflight.test.tsx 21 个测试，全部通过
- 验证：typecheck ✅ test(41) ✅ build ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-7 Headless Preflight Engine）
- 任务：runSchemaPreflight 纯函数 headless 预检引擎
- 文件：packages/schema-compiler/src/preflight.ts（新增）
- 测试：packages/schema-compiler/src/__tests__/preflight.test.ts（17 个，node:test 而非 vitest）
- 总测试：31/31 通过
- 验证：typecheck ✅ test ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-5 + FE-4）
- FE-5：FormilyReactionVisitor + linkage runtime + FormilyRuntimeRenderer.test.tsx（7 个测试）
- 修复 vitest.config.ts 缺 @labelhub/schema-compiler alias
- 验证：typecheck ✅ test(41) ✅ build ✅ git diff --check ✅

### 2026-06-06 | Claude Code（FE-2b Phase 1b 插入）
- 任务：AssignmentPage 加引擎切换 debug 开关
- 改动文件：apps/web/src/features/labeler/AssignmentPage.tsx
- 验证：typecheck ✅；git diff --check ✅

### 2026-06-06 | Claude Code（FE-2 Phase 1b）
- 任务：7 个 input adapter + feature flag 接入 SchemaRenderer
- 验证：schema-renderer typecheck ✅；test ✅(13/13)；apps/web typecheck ✅

### 2026-06-06 | Claude Code（FE-1 Phase 1a）
- 任务：安装 Formily + ComponentRegistry + FormilyRuntimeRenderer shell
- 验证：schema-renderer typecheck ✅；test ✅(13/13)；apps/web typecheck ✅
```

---

## 10. 开班检查清单（接手时逐项确认）

- [ ] 已完整读 `SCHEMA_ARCH_AGENT.md`
- [ ] 已完整读本文件（含第 0 节编号表、第 2 节当前任务）
- [ ] 已跑 `git status` / `git rev-parse HEAD`，与第 1 节基线一致
- [ ] 工作区 clean（或已理解 dirty 原因）
- [ ] 已读当前任务涉及的真实代码文件
- [ ] 已确认本轮范围，不超出第 2 节「明确不做」

---

## 11. 收班检查清单（交班前逐项确认）

- [ ] 工作区可编译，typecheck 通过（或已明确标注「未完成，卡在 X」）
- [ ] 已更新第 1 节 Git 基线（commit / 工作区状态 / 时间 / 更新者）
- [ ] 已更新第 8 节状态看板
- [ ] 已在第 9 节追加本班工作日志
- [ ] 未把跑不起来的半成品静默交接
