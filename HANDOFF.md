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

## 2026-06-10 Owner 任务删除入口（Codex，未提交）

- 当前实际分支：`integration/joint-test`
- 当前基线：`22d1f05 fix(web): respect dataset item page size limit`
- 修改范围：
  - `apps/web/src/api/owner.ts`
  - `apps/web/src/features/owner/OwnerWorkspace.tsx`
  - `apps/web/src/styles.css`
- 本轮修改：
  - Owner 任务管理页新增删除入口：任务列表操作列新增红色删除图标按钮，任务详情弹窗 actions 新增“删除任务”按钮。
  - 点击删除会先打开 `ConfirmDialog` 确认弹窗，不会直接执行。
  - 删除逻辑复用真实后端已有状态机接口：`PUBLISHED/PAUSED` 任务先调用 `POST /api/v1/tasks/:taskId/end`，再调用 `POST /api/v1/tasks/:taskId/archive`；`ENDED` 任务直接归档。
  - 列表加载时过滤 `ARCHIVED` 任务；删除成功后从当前列表移除，并显示保留后端审计记录的成功提示。
  - `DRAFT` 草稿任务没有后端删除/归档路径，本轮不假删；确认后显示“当前后端暂未开放草稿任务删除接口，任务未删除。”。
  - 操作列宽度与按钮样式已补齐，删除按钮 hover 保持红色危险态；键盘触发操作按钮时不再冒泡打开任务详情。
- 边界：
  - 未修改 `apps/api`。
  - 未修改 `packages/contracts`。
  - 未修改 `schema-core` 核心逻辑。
  - 未伪造删除成功；草稿删除需要后端新增真实接口后才能完全闭环。
- 验证：
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix apps/web run build` 通过；仍保留既有 `Circular chunk: vendor -> vendor-react -> vendor` 提示。
  - `git diff --check` 通过，仅显示既有 LF/CRLF warning。
  - Codex 内置浏览器连接层两次失败于本地 `spawn setup refresh`，未完成截图式浏览器复验。
- 收班状态：
  - 本轮代码与交接文档尚未 commit / push。

## 2026-06-10 Owner 任务管理移动端裁切修复（Codex，未提交）

- 当前实际分支：`integration/joint-test`
- 当前基线：`22d1f05 fix(web): respect dataset item page size limit`
- 修改范围：
  - `apps/web/src/styles.css`
- 本轮修改：
  - 修复 `/owner/tasks` 移动端顶部错误/状态提示条长文本不换行导致右侧裁切的问题：`owner-fallback-notice` 文本现在允许收缩并按任意位置换行。
  - Owner 任务筛选栏在移动端改为单列，避免 `minmax(240px, 1fr) 150px 170px` 固定列宽撑出横向宽度。
  - Owner 任务表在移动端继续使用卡片式表格，并补充 `tbody`、操作区、表头统计区的 `min-width: 0` / 单列布局，减少横向溢出。
  - 任务表内的 5 个图标操作按钮在手机端改为可换行横向图标组，不再继承全局“操作区单列”导致布局异常。
  - 任务草稿卡标题、说明和“继续配置”按钮补充移动端收缩/换行规则，避免长任务名或按钮撑宽卡片。
- 边界：
  - 未修改 `apps/api`。
  - 未修改 `packages/contracts`。
  - 未修改业务逻辑，仅调整 Owner 任务管理页和通用移动端 CSS。
- 验证：
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix apps/web run build` 通过；仍保留既有 `Circular chunk: vendor -> vendor-react -> vendor` 提示。
  - `git diff --check` 通过，仅显示既有 LF/CRLF warning。
  - Codex 内置浏览器连接层仍失败于本地 `spawn setup refresh`，未完成截图式浏览器复验。

## 2026-06-10 追加修复：Owner 模板页数据导入状态与数据管理页同步（Codex，已提交并准备推送）

- 当前实际分支：`integration/joint-test`
- 当前基线：`84c6b2b feat(web): guide owner task setup flow`
- 修改范围：
  - `apps/web/src/features/owner/OwnerSchemaPage.tsx`
- 问题现象：
  - `/owner/tasks/:taskId/data` 显示已导入多条数据，且“继续配置模板”可点击。
  - 跳到 `/owner/tasks/:taskId/designer` 后，模板页顶部流程和发布前检查仍显示“数据管理：还未导入数据 / 去导入数据”，导致用户在数据页和模板页之间反复横跳。
- 根因：
  - 数据管理页的完成状态来自 `listItems(taskId)`。
  - 模板页的完成状态只依赖 `fetchTaskStats(taskId)` 的 `datasetTotal/datasetAvailable`。
  - 当前真实场景中 `fetchTaskStats` 可能滞后或返回 0，而 `listItems` 已能读到真实导入的 3 条数据，导致两个页面判断不同步。
- 本轮修改：
  - `OwnerSchemaPage` 在加载任务统计和 AI 配置时，同时调用数据管理页同源接口 `listItems(taskId, 1, 500)`。
  - 模板页的 `datasetImportedCount/datasetAvailableCount` 改为取 `fetchTaskStats` 与 `listItems` 两个真实来源的较大值。
  - 因此只要真实题目列表里已有可领取数据，模板页 stepper、发布前检查和“数据待导入”提示都会同步显示已完成，不再误拦“继续配置模板”。
- 边界：
  - 未修改 `packages/contracts`。
  - 未修改 `apps/api`。
  - 未修改 `schema-core` 核心逻辑。
  - 未伪造导入数据；只用已有真实接口 `listItems` 兜底修正前端状态判断。
- 验证：
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix apps/web run build` 沙箱内被 esbuild 上层目录读取权限阻断；提权重跑通过，仅保留既有 circular chunk 提示。
  - `git diff --check` 通过，仅有既有 LF/CRLF warning。
- 收班状态：
  - 本段改动已纳入本轮最终提交，准备推送到 `origin/integration/joint-test`。
  - 工作区在提交后应保持 clean。

---

## 2026-06-10 追加完成：Labeler 真实 assignment 单条链路 + 移动端账号菜单（Codex，已提交并准备推送）

- 当前实际分支：`integration/joint-test`
- 当前基线：`84c6b2b feat(web): guide owner task setup flow`
- 修改范围：
  - `apps/web/src/features/labeler/AssignmentPage.tsx`
  - `apps/web/src/ui/AppShell.tsx`
  - `apps/web/src/styles.css`
  - `apps/web/src/mocks/mock-db.ts`（接手前/前序已修改，本轮保留其 assignment 单条 item 修正）
- 本轮修改：
  - `AssignmentPage` 不再调用 `/api/v1/assignments/:assignmentId/items` 拉同任务所有数据，也不再维护 `answersByItemId`、`taskItems`、`previousItem/nextItem` 或前端切题状态。
  - 标注工作台语义改为“当前领取数据”：一个 assignment 只展示 `getAssignmentContext(assignmentId)` 返回的真实 `context.item`。
  - `CLAIMED` / `DRAFTING` / `RETURNED` 状态可编辑；`SUBMITTED` / `ACCEPTED` / `CANCELED` / `EXPIRED` 状态只读，禁用自动保存、保存草稿、AI 辅助和重复提交。
  - 提交成功后使用后端 `submitAssignment` 返回的 `assignment` 更新页面状态，不在前端伪造 dataset item 完成、不自动切到下一条；提示用户回任务市场重新领取下一条真实数据。
  - 如果后端返回“Assignment 当前状态 'SUBMITTED' 不允许提交”，页面显示“当前领取记录已经提交，不能重复提交。请回任务市场领取下一条数据。”，不再只给泛化失败提示。
  - 顶部和底部操作区移除“上一题 / 下一题 / 第 X 题”文案，替换为“任务市场”“我的提交”“返回任务市场”等真实链路入口。
  - `AppShell` 右上角头像改为可点击账号菜单，菜单内显示当前账号、角色、工作台、当前位置，并提供“切换账号”；移动端保留头像入口，不再把账号切换能力隐藏掉。
  - `styles.css` 增加账号菜单样式，并补充 Labeler 工作台移动端防溢出：长标题换行、按钮组可换行、表单输入/文本域最大宽度受控、当前数据卡片不再撑出横向宽度。
- 边界：
  - 未修改 `packages/contracts`。
  - 未修改 `apps/api`。
  - 未修改 `schema-core` 核心逻辑。
  - 未绕过提交校验或 assignment 状态机；后端拒绝已提交 assignment 二次提交仍是正确防护。
  - 未伪造“下一题”或发布/提交成功；下一条数据必须通过任务市场真实领取。
- 验证：
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix apps/web run build` 沙箱内会被 esbuild 上层目录读取权限阻断；提权重跑通过，仅保留既有 circular chunk 提示。
  - `git diff --check` 通过，仅有既有 LF/CRLF warning。
- 收班状态：
  - 本段改动已纳入本轮最终提交，准备推送到 `origin/integration/joint-test`。
  - `docs/LabelHub_2026-06-10_Team_Handoff.md` 已纳入版本管理。
  - 工作区在提交后应保持 clean。

---

## 2026-06-10 追加完成：AI 建议完整 patch + mock 审核导出闭环（Codex，已提交并准备推送）

- 当前实际分支：`integration/joint-test`
- 当前基线：`84c6b2b feat(web): guide owner task setup flow`
- 修改范围：
  - `apps/web/src/mocks/mock-db.ts`
- 本轮修改：
  - `callLLMAssist` 的 mock 低分建议从仅返回 `qualityScore: "1"` 改为同时返回非空 `factCheckNote`，让低质量评分建议形成完整 `suggestedPatch`，继续走现有 schema preflight，不绕过 `qualityScore=1/2 -> factCheckNote 必填` 规则。
  - 保留 renderer/preflight 行为不变：如果低分 patch 缺少 `factCheckNote`，仍会被现有 preflight 识别为 BLOCKED；本轮只修 mock AI 输出的完整性。
  - `decideReview` 对齐 mock 审核状态流转：人工审核 PASS 后 submission 进入 `ACCEPTED`、assignment 进入 `ACCEPTED`、dataset item 进入 `COMPLETED`，因此 Owner 导出默认 `ACCEPTED` 过滤能选中审核通过记录。
  - mock 审核决策现在允许 `AI_PASSED` / `NEEDS_HUMAN_REVIEW` / `HUMAN_REVIEWING` 走人工审核决策，终审仍要求 `FINAL_REVIEWING`，避免 mock 队列状态没有先领取时直接决策失败。
  - REJECT 路径按 contracts 既有约定把 dataset item 回到 `AVAILABLE`，并清理 `currentAssignmentId`；双审首轮 PASS 的 audit summary 改为 `FINAL_REVIEW_REQUESTED`。
- 边界：
  - 未修改 `packages/contracts`。
  - 未修改 `apps/api`。
  - 未修改 `schema-core` 核心逻辑。
  - 未绕过提交校验、AI preflight 或导出过滤；只修 mock 输出与 mock 状态副作用。
  - 未改 `qualityScore=1/2 -> factCheckNote 必填` 与 `qualityScore=3/4/5 -> factCheckNote 隐藏并清空` 的 schema 规则。
- 验证：
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix apps/web run build` 沙箱内首次被 esbuild 上层目录读取权限阻断；提权重跑通过，仅保留既有 circular chunk 提示。
  - `git diff --check` 通过，仅有既有 LF/CRLF warning。
- 收班状态：
  - 本段改动已纳入本轮最终提交，准备推送到 `origin/integration/joint-test`。
  - 未跟踪文档已纳入版本管理。
  - 工作区在提交后应保持 clean。

---

## 2026-06-10 Owner 任务创建后配置流程引导（Codex，已提交）

- 当前实际分支：`integration/joint-test`
  - 用户消息指定 `fix/joint-test-web-shell`，本地该分支存在但未包含当前 `integration/joint-test @ 57c724e` 之后的主线提交；接手时工作区已有未提交文档/CSS改动，因此本轮未切分支，避免带脏改跨分支或触发冲突。
- 当前基线：`57c724e fix(schema-renderer): allow dismissing blocked ai suggestions`
- 修改范围：
  - `apps/web/src/app/App.tsx`
  - `apps/web/src/app/routes.tsx`
  - `apps/web/src/features/owner/TaskSetupGuide.tsx`（新增）
  - `apps/web/src/features/owner/OwnerNewTaskPage.tsx`
  - `apps/web/src/features/owner/OwnerDatasetPage.tsx`
  - `apps/web/src/features/owner/OwnerSchemaPage.tsx`
  - `apps/web/src/features/owner/OwnerAIPage.tsx`
  - `apps/web/src/features/owner/OwnerTaskDetailPage.tsx`
  - `apps/web/src/features/owner/OwnerWorkspace.tsx`
  - `apps/web/src/features/owner/OwnerQualityCenterPage.tsx`
  - `apps/web/src/styles.css`
- 本轮修改：
  - 新增任务配置向导组件 `TaskSetupGuide`，统一展示 `[基础信息 → 数据管理 → 模板配置 → AI 预审配置 → 发布任务]` 五步状态，并提供发布前检查面板。
  - 新增推荐路由别名 `/owner/tasks/:taskId/data` 与 `/owner/tasks/:taskId/ai-precheck`；保留旧 `/dataset`、`/ai-config` 路由兼容。
  - 新建任务成功后从 `/owner/tasks/:taskId/designer` 改为跳转 `/owner/tasks/:taskId/data`；按钮文案改为“创建任务并导入数据”。
  - `OwnerDatasetPage` 复用现有真实导入逻辑，补充任务名称、格式说明、已导入数量、最近导入时间、字段预览、预览表格和“继续配置模板”按钮；无数据时按钮禁用并提示“请先导入至少 1 条标注数据”。
  - `OwnerSchemaPage` 顶部接入 stepper 和发布前检查；发布按钮点击前先检查基础信息、数据、可领取数据、模板、AI 预审配置和分发设置，缺失时给出明确人话提示和跳转按钮，不再先触发后端 422 才显示“模板参数不完整”。
  - 模板检查通过后显示“继续配置 AI 预审”入口，跳转 `/owner/tasks/:taskId/ai-precheck`。
  - `OwnerAIPage` 改为任务级“AI 预审配置”语境，加入 stepper、触发时机/审核流说明、保存后“下一步：发布任务”入口；不向后端写入未支持的触发时机字段。
  - `OwnerTaskDetailPage` 与 `OwnerWorkspace` 增加数据管理、AI 预审配置入口，并把草稿任务续配入口调整为先进入数据管理。
  - `OwnerQualityCenterPage` 的任务级 AI 配置跳转改为 `/ai-precheck`。
- 边界：
  - 未修改 `packages/contracts`。
  - 未修改 `apps/api`。
  - 未修改 `schema-core` 核心逻辑。
  - 未绕过现有发布校验；仅在前端发布入口前增加更清晰的完整性检查。
  - 未伪造导入数据、未伪装发布成功；CSV 仅作为说明提示“请先另存为 Excel 或 JSON 后导入”，不假装后端已支持。
- 验证：
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix apps/web run build` 通过；沙箱内首次被 esbuild 上层目录读取权限阻断，提权重跑通过，仅保留既有 circular chunk 提示。
  - `git diff --check` 通过，仅有既有 LF/CRLF warning。
  - `Invoke-WebRequest http://localhost:5180/` 返回 `HTTP 200 OK`。
  - Codex 内置浏览器连接层仍因本地 `spawn setup refresh` 失败无法截图式实测；未改动浏览器或 dev server 状态。
- 收班状态：
  - 本段前端流程改动已提交。
  - 后续追加的 Owner 数据状态同步修复已纳入本轮最终提交。

---

## 2026-06-10 Reviewer 队列页底部操作区布局修复 + 交付文档生成（Codex，已提交）

- 当前分支：`integration/joint-test`
- 当前基线：`57c724e fix(schema-renderer): allow dismissing blocked ai suggestions`
- 接手核对：
  - 已定向刷新 `origin/integration/joint-test`，远端主线包含 `39bc1ca` / `09e5bf0` / `9dbea2b` / `ecd6dc9` / `57c724e`。
  - P2-2「BLOCKED AI 建议可忽略」已作为 `57c724e` 落到主线；接手时工作区干净，无需补交 `LLMAssistRenderer.tsx` 与 `LLMAssistPreflight.test.tsx`。
- 本轮修改：
  - `apps/web/src/styles.css`
  - 修复 `/reviewer/items` 右侧详情底部 `.review-ai-comment` 布局：由 `标题 / 说明 / 按钮` 三列改为左侧标题+说明、右侧按钮的两列布局；640px 以下按钮独占整行，避免橙色提示条和「进入人工审核」按钮在窄宽度下挤在同一行。
  - `docs/LabelHub_Final_Delivery.md`：新增最终交付说明，集中说明当前稳定状态、交付范围、启动方式、演示路线、核心验收点、自动化验证、已知边界和交付物索引。
  - `docs/LabelHub_Delivery_Runbook.md`：新增现场运行手册，包含真实后端 / Mock 模式启动命令、账号、演示操作卡、验证命令和故障排查。
  - `submission/README.md`：补充最终交付说明与现场运行手册入口，更新录屏剧本和演示环境说明索引。
- 边界：
  - 未修改 `packages/contracts`。
  - 未修改 `apps/api`。
  - 未修改 Reviewer 审核业务逻辑、队列筛选、批量审核、人工审核提交链路。
- 验证：
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix apps/web run build` 首次在沙箱内被 esbuild 上层目录读取权限阻断；提权重跑后通过，仅保留既有 circular chunk 提示。
  - `git diff --check` 通过，仅有既有 LF/CRLF warning。
  - 曾尝试启动 Vite dev server 做浏览器验证；服务可启动到 `http://127.0.0.1:5182/`，但 Codex 内置浏览器连接层两次因本地沙箱 `spawn setup refresh` 失败，未完成截图式实测。为避免残留，已停止本轮启动的 Vite/npm 子进程并清理 `.tmp-vite.log`。
- 收班状态：
  - 本段 Reviewer 布局修复与交付文档已提交。
  - 后续追加的 Labeler、Owner 数据状态与 mock 闭环修复已纳入本轮最终提交。

---

## 2026-06-09 P1/P2 前置修复进度（优先于下方所有记录）

- **P1-1** MySQL stale connection（缺陷 #1）：已修复并推送（`create_engine` 加 `pool_pre_ping` / `pool_recycle`）。
- **P1-2** Owner AI 预审页 Corporate Trust 视觉统一：已推送（紫/橙跳色统一为低饱和蓝，作用域限定 `.owner-ai-page`）。
- **缺陷 #3** Schema Audit Timeline：已挂载并推送（`OwnerSchemaPage.tsx` 接入 `AuditTimelinePanel`，按 `taskId + entityType:"SCHEMA"` 读取）。
- 当前 `HEAD = 9dbea2b`，分支 `integration/joint-test`。
- 稳定 tag `demo-stable-p1-0609` → `09e5bf0`（P1-1 + P1-2 稳定点）。
- 工作区干净，本地与远端已同步。

---

## 2026-06-09 最新状态（优先于下方旧记录）

- 当前分支：`fix/joint-test-web-shell`
- 当前基线：`origin/integration/joint-test @ 8881866`
- 工作区：dirty，未 commit / 未 push。
- 本轮累计修改前端入口、Owner AI 预审配置页与 Owner 模板搭建页：
  - `apps/web/src/app/App.tsx`
  - `apps/web/src/app/routes.tsx`
  - `apps/web/src/features/owner/OwnerAIPage.tsx`
  - `apps/web/src/features/owner/OwnerSchemaPage.tsx`
  - `apps/web/src/styles.css`
- 修复内容：
  - 移除侧栏中写死的 `task_news_quality` 任务链接。
  - 增加通用 `/owner/ai-config` 入口，页面从真实任务列表选择任务。
  - AI 预审配置的读取、创建、更新均使用当前选中的真实任务 ID。
  - 兼容旧 seed 中的 `autoPass` / `autoReturn` 阈值结构。
  - 无任务、无配置和接口失败均显示明确状态，不再闪回首页。
  - 登录失败不再创建本地角色会话；错误密码停留在登录弹窗并显示后端错误。
  - 无 token 的角色深链路会返回登录页，账号角色与所选入口不一致时拒绝进入。
  - Owner 模板搭建页顶部说明压缩为一句；画布节点改为左侧名称与保存字段、右侧类型 badge。
  - 实时预览改为顶部按钮触发的 SchemaRenderer 弹层，默认不再占据右侧底部。
  - Schema 发布请求改为携带保存接口返回的真实 `schemaDraftRevision`；本地自检失败时不发请求，422、服务不可用和任务发布前置条件均转换为人话提示。
  - 模板已发布但任务发布被数据集 / AI 预审前置条件阻断时，模板搭建页提示卡直接显示“去导入数据集”或“去配置 AI 预审”入口。
  - 质量中心改为桌面四列 KPI 和等高 2×2 看板；AI 配置跳转使用通用入口，无任务时导出入口显示禁用提示。
- 本地真实服务：
  - Web：`http://localhost:5180/`
  - API：`http://127.0.0.1:3000/`
  - API health 已返回 200。
  - 本地 SQLite：`.storage/labelhub-local.db`
- 真实接口链已验证通过：
  - 登录
  - 创建任务
  - 保存 Schema 草稿
  - 上传并导入数据集
  - 创建并读取 ReviewConfig
  - 发布 Schema
  - 发布任务，最终状态 `PUBLISHED`
  - 验证产生的 3 条乱码测试任务及其关联数据已从本地数据库清理。
- 浏览器验证：
  - `owner@labelhub.test` / `Seed@1234` 可登录。
  - `/owner/tasks` 能显示真实任务。
  - `/owner/ai-config` 能显示真实任务下拉及已保存 AI 配置。
- 验证结果：
  - `npm.cmd --prefix apps/web run build` 通过。
  - `npm.cmd --prefix apps/web run typecheck` 通过。
  - `npm.cmd --prefix packages/schema-designer run typecheck` 通过。
  - `npm.cmd --prefix packages/schema-renderer run typecheck` 通过。
  - `git diff --check` 通过，仅有 CRLF warning。
  - 本次追加验证：`npm.cmd --prefix apps/web run typecheck` 通过；`npm.cmd --prefix apps/web run build` 在沙箱内被 esbuild 上层目录读取权限阻断，提权重跑后通过；`git diff --check` 通过，仅有 CRLF warning。
- Owner 模板搭建页本轮补充：
  - 顶部统一为“返回任务 / 保存草稿 / 实时预览 / 导出 JSON / 保存并发布模板”，移除画布区重复按钮。
  - 发布前增加可定位的配置问题列表；空模板、未命名模板、字段名、选项、组件名称等问题会在请求后端前阻断。
  - 画布节点显示错误 badge，点击错误列表可定位节点；属性面板对组件名称、字段名称、字段类型、选项增加必填和错误提示。
  - 加载内置或自定义预设时保留当前草稿 `schemaId` 与 `schemaDraftRevision`，避免 revision 重置为 1 导致 409。
  - 模板检查与发布前校验统一使用 Owner 发布校验结果；成功文案改为“当前模板已通过发布前检查”，不再只检查局部结构。
  - 画布节点统一显示完整组件类型名称，节点标题与保存字段居左，类型 badge 固定在右上角。
  - “发布与审计记录”改为独立白色卡片和事件列表，长 ID / 错误说明限制在卡片内换行或截断。
  - 修复 schema draft GET/PUT 响应中真实 `schemaDraftRevision` 未合并的问题；此前页面读取嵌套旧 revision，导致保存发布稳定返回 409。
  - 内置“新闻质量标注”已在浏览器验证通过统一发布前检查。
  - 真实 API 验证：保存草稿成功并升至 revision 3；Schema 发布接口返回 201，生成 `sv_7be367b80b7744588a379c090fc16a7f`。随后任务发布接口返回 422，明确原因为“发布前必须导入数据集（至少 1 条可领取题目）”，属于真实业务前置条件，不是模板 payload 错误。
  - 针对此 422 前置条件，模板搭建页现在会在提示卡上直接提供 `/owner/tasks/:taskId/dataset` 入口；数据集 / AI 预审前置条件判断优先于通用 422 模板参数错误判断。
  - Owner 模板搭建页移动端适配已补齐：
    - 移除窄屏下各主区块的 `min-width: 760px` 和页面横向滚动。
    - 768px 以下顶部操作改为两列，主发布按钮独占整行；预设模板改单列。
    - SchemaDesigner 在手机端按“模板画布 → 组件物料 → 属性”纵向排列，节点操作按钮可换行。
    - 当前模板、错误提示、审计事件和长 ID 均限制在视口内自动换行。
    - 浏览器实测 375×812、390×844、414×896、768×1024，页面 `scrollWidth` 均未超过视口，未发现越界元素。
- 已知边界：
  - 当前没有 Redis / Worker，真实异步 AIReviewJob 执行仍不可用；同步 API、配置读取和任务发布不受影响。
  - 未修改 `apps/api/`、contracts 或 schema runtime 核心逻辑。

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
