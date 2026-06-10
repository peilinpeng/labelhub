# LabelHub 2026-06-10 今日改动交接说明

> 面向接手同学的快速交接文档。本文只记录 2026-06-10 已完成并推送到 `integration/joint-test` 的主要改动、验证结果、边界和后续建议。

## 当前 Git 状态

- 当前工作分支：`integration/joint-test`
- 远端分支：`origin/integration/joint-test`
- 最新远端提交：`84c6b2b feat(web): guide owner task setup flow`
- 今日关键提交：
  - `1e9338a fix(web): polish reviewer queue layout`
  - `84c6b2b feat(web): guide owner task setup flow`
- 稳定参考点：
  - `demo-stable-p1-0609` -> `09e5bf0`
  - `84c6b2b` 已在 `57c724e` 之后，并包含今日 Owner 流程引导、Reviewer 布局 polish、交付文档等内容。

## 今日改动总览

今天主要完成三件事：

1. 修复 Reviewer 审核队列页底部操作区拥挤问题。
2. 生成最终交付说明和现场运行手册。
3. 重做 Owner 新建任务后的配置流程引导，把“发布失败后才知道缺什么”改成“发布前就能看到完整配置步骤”。

## 追加未提交修复

> 以下内容是 2026-06-10 追加完成的本地修复，当前尚未 commit / push。接手前请先看 `git status --short`。

改动文件：

- `apps/web/src/mocks/mock-db.ts`

完成内容：

- AI 辅助建议 mock 现在在建议 `qualityScore: "1"` 时同步给出非空 `factCheckNote`。
- 这让低质量评分建议形成完整 `suggestedPatch`，仍然走现有 schema preflight，不绕过校验。
- 低分 patch 如果缺少 `factCheckNote`，现有 preflight 仍会 BLOCKED；本次只修 mock AI 输出完整性。
- mock 人工审核 PASS 后会同步把：
  - submission 置为 `ACCEPTED`
  - assignment 置为 `ACCEPTED`
  - dataset item 置为 `COMPLETED`
- 因此 Owner 导出默认 `ACCEPTED` 过滤可以选中审核通过记录，不再因为 mock 状态没流转导致导出 0 条。
- REJECT 路径按 contracts 既有约定让 dataset item 回到 `AVAILABLE`，并清理 `currentAssignmentId`。
- 双审首轮 PASS 的 audit summary 对齐为 `FINAL_REVIEW_REQUESTED`。

验证结果：

```bash
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run build
git diff --check
```

结果：

- typecheck 通过。
- build 在普通沙箱中仍会被 esbuild 上层目录读取权限阻断；提权重跑后通过。
- `git diff --check` 通过，仅有既有 LF/CRLF warning。

## 1. Reviewer 队列页布局 polish

提交：`1e9338a fix(web): polish reviewer queue layout`

改动文件：

- `apps/web/src/features/reviewer/ReviewerWorkspace.tsx`
- `apps/web/src/styles.css`

改动内容：

- 优化 `/reviewer/items` 右侧详情区域底部操作区。
- 原先橙色提示条和“进入人工审核”按钮在窄宽度下容易挤在一行。
- 现在调整为更清晰的布局：
  - 左侧展示 AI 提示 / 状态说明。
  - 右侧展示操作按钮。
  - 小屏宽度下按钮换到下一行。

影响范围：

- 仅前端 UI 布局。
- 未修改审核业务逻辑。
- 未修改队列筛选、批量审核、人工审核提交链路。

## 2. 交付文档与运行手册

提交：`84c6b2b feat(web): guide owner task setup flow`

新增 / 更新文件：

- `docs/LabelHub_Final_Delivery.md`
- `docs/LabelHub_Delivery_Runbook.md`
- `submission/README.md`

文档用途：

- `LabelHub_Final_Delivery.md`
  - 用于最终交付说明。
  - 汇总当前稳定状态、交付范围、演示路线、验收点、自动化验证、已知边界。

- `LabelHub_Delivery_Runbook.md`
  - 用于现场运行。
  - 包含真实后端 / Mock 模式启动命令、测试账号、演示操作卡、验证命令、故障排查。

- `submission/README.md`
  - 补充最终交付说明和现场运行手册入口。
  - 更新录屏剧本和演示环境说明索引。

## 3. Owner 任务配置流程引导

提交：`84c6b2b feat(web): guide owner task setup flow`

### 背景问题

原流程中，Owner 新建任务后会直接进入模板搭建页。但真实发布任务还依赖：

- 已导入标注数据。
- 已完成模板配置。
- 模板检查通过。
- AI 预审规则已配置，或明确选择不启用。
- 分发策略 / 配额等发布前条件完整。

之前用户通常是在点击发布后才看到“未完成 / 参数不完整 / 请求校验失败”等阻断提示，体验不清楚。

### 新流程

Owner 任务配置现在统一为五步：

```txt
1 基础信息 -> 2 数据管理 -> 3 模板配置 -> 4 AI 预审配置 -> 5 发布任务
```

新增共享组件：

- `apps/web/src/features/owner/TaskSetupGuide.tsx`

组件能力：

- 统一显示任务配置 stepper。
- 支持状态：
  - 已完成
  - 当前步骤
  - 待完成
  - 有错误
- 提供发布前检查面板：
  - 基础信息
  - 数据管理
  - 模板配置
  - AI 预审
  - 分发设置
- 缺失项会给出明确“去完成”按钮。

### 新增推荐路由

新增：

- `/owner/tasks/:taskId/data`
- `/owner/tasks/:taskId/ai-precheck`

保留兼容：

- `/owner/tasks/:taskId/dataset`
- `/owner/tasks/:taskId/ai-config`

说明：

- 新流程优先使用 `/data` 和 `/ai-precheck`。
- 旧路由没有删除，避免打断已有入口或外部链接。

### 新建任务后的跳转

改动文件：

- `apps/web/src/features/owner/OwnerNewTaskPage.tsx`

行为变化：

- 新建任务成功后不再跳转 `/owner/tasks/:taskId/designer`。
- 现在跳转 `/owner/tasks/:taskId/data`。
- 主按钮文案改为：
  - “创建任务并导入数据”

### 数据管理页

改动文件：

- `apps/web/src/features/owner/OwnerDatasetPage.tsx`

实现方式：

- 复用已有数据导入页面和真实导入接口。
- 未新增后端接口。
- 未伪造数据导入状态。

新增内容：

- 页面标题改为“数据管理”。
- 页面说明：
  - “请先导入本任务需要标注的数据，再继续配置标注模板。”
- 展示当前任务名称。
- 展示已导入数据数量。
- 展示当前可领取数据数量。
- 展示最近导入时间。
- 展示数据字段预览。
- 保留数据预览表格。
- 新增“继续配置模板”按钮。

按钮逻辑：

- 已有数据时可点击，跳转 `/owner/tasks/:taskId/designer`。
- 无数据时禁用，并提示：
  - “请先导入至少 1 条标注数据。”

格式说明：

- 真实接口支持 JSON / JSONL / Excel。
- 页面没有伪装 CSV 已支持。
- 文案提示：
  - “CSV 请先另存为 Excel 或 JSON 后导入。”

### 模板搭建页

改动文件：

- `apps/web/src/features/owner/OwnerSchemaPage.tsx`

新增内容：

- 顶部接入任务配置 stepper。
- 若当前任务未导入数据，顶部显示柔和提示：
  - “当前任务还未导入数据，请先完成数据管理。”
  - 按钮：“去导入数据”
- 新增“发布前检查”面板。
- 模板检查通过后显示：
  - “继续配置 AI 预审”

发布前检查规则：

- 基础信息已填写。
- 已导入至少 1 条数据。
- 至少 1 条数据处于可领取状态。
- 模板配置完整。
- 模板检查通过。
- AI 预审规则已配置，或明确选择不启用。
- 分发策略 / 配额完整。

发布按钮变化：

- 点击发布前先做前端完整性检查。
- 缺数据时提示：
  - “发布前需要先导入标注数据。”
- 缺可领取数据时提示：
  - “发布前需要至少 1 条可领取数据。请在数据管理中启用或重新导入数据。”
- 缺模板时提示：
  - “发布前需要完成标注模板配置。”
- 缺 AI 预审配置时提示：
  - “发布前需要配置 AI 预审规则，或明确选择不启用 AI 预审。”
- 缺分发设置时提示：
  - “发布前需要完成分发策略和配额设置。”

重要边界：

- 没有绕过后端发布校验。
- 没有绕过 Schema 发布预检。
- 没有为了发布成功伪造数据。
- 全部完成后仍走原来的保存草稿、Schema 发布、任务发布链路。

### AI 预审配置页

改动文件：

- `apps/web/src/features/owner/OwnerAIPage.tsx`

新增内容：

- 页面标题改为“AI 预审配置”。
- 接入任务配置 stepper。
- 支持从任务级路由 `/owner/tasks/:taskId/ai-precheck` 进入。
- 保留原有 ReviewConfig 读写逻辑。
- 新增触发时机说明控件：
  - 提交后进入预审队列
  - 审核前自动预审
- 新增审核流说明控件：
  - AI 预审后进入人工复核
  - 高分自动通过，低分自动打回，中间转人工
  - 只生成 AI 质检提示，由审核员决策
- 保存配置后显示：
  - “下一步：发布任务”

重要边界：

- 触发时机 / 审核流说明目前是前端流程说明。
- 未向后端写入未支持的 contracts 字段。
- ReviewConfig payload 保持原结构。

### 任务详情和任务列表入口

改动文件：

- `apps/web/src/features/owner/OwnerTaskDetailPage.tsx`
- `apps/web/src/features/owner/OwnerWorkspace.tsx`
- `apps/web/src/features/owner/OwnerQualityCenterPage.tsx`

改动内容：

- 单任务详情页增加：
  - 数据管理入口
  - AI 预审配置入口
  - 配置流程 stepper
  - 发布前检查面板
- 任务列表中的草稿任务主操作改为先进入“数据管理”。
- 任务行操作增加数据管理入口。
- 质量中心跳转任务级 AI 配置时改为 `/ai-precheck`。

## 今日验证结果

已执行并通过：

```bash
npm.cmd --prefix apps/web run typecheck
npm.cmd --prefix apps/web run build
git diff --check
```

说明：

- `npm.cmd --prefix apps/web run build` 在普通沙箱中会被 Vite / esbuild 读取上层目录权限阻断。
- 提权重跑后通过。
- 构建仍有既有 circular chunk 提示：

```txt
Circular chunk: vendor -> vendor-react -> vendor
```

该提示为既有打包提示，不是今日新增阻断。

本地服务检查：

```txt
http://localhost:5180/ -> HTTP 200 OK
```

浏览器实测说明：

- Codex 内置浏览器通道本轮仍因本地 `spawn setup refresh` 失败，未完成截图式实测。
- 代码层面已通过 typecheck、build 和静态路径检查。

## 没有触碰的边界

今日未修改：

- `packages/contracts`
- `apps/api`
- `packages/schema-core`
- 数据库模型
- Alembic migration
- 后端发布接口
- AI preflight 判定逻辑
- suggestedPatch 应用逻辑
- Reviewer 审核业务提交链路

今日没有做：

- 没有伪造导入数据。
- 没有伪装真实发布成功。
- 没有绕过提交校验。
- 没有绕过 AI 预审。
- 没有把 CSV 写成真实已支持格式。

## 接手同学建议复验路径

建议从真实后端链路复验：

1. 打开 `http://localhost:5180/`。
2. 使用 Owner 账号登录。
3. 进入 `/owner/tasks/new`。
4. 创建任务草稿。
5. 确认创建成功后进入 `/owner/tasks/:taskId/data`。
6. 在数据管理页导入 JSON / JSONL / Excel 数据。
7. 有数据后点击“继续配置模板”进入 `/owner/tasks/:taskId/designer`。
8. 在模板页确认顶部 stepper 和“发布前检查”存在。
9. 未配置 AI 预审时点击发布，应看到“发布前需要配置 AI 预审规则”。
10. 点击“继续配置 AI 预审”进入 `/owner/tasks/:taskId/ai-precheck`。
11. 保存 AI 预审配置，或明确关闭 AI 预审。
12. 返回模板页，再执行发布前检查和发布。

建议额外检查：

- `/owner/tasks/:taskId` 是否显示配置流程和发布前检查。
- `/owner/tasks` 草稿任务主按钮是否进入数据管理。
- `/owner/quality` 中 AI 配置入口是否跳转 `/ai-precheck`。
- 旧路由 `/owner/tasks/:taskId/dataset` 和 `/owner/tasks/:taskId/ai-config` 是否仍可访问。

## 后续建议

短期建议：

- 用真实浏览器补一次截图式 QA，尤其是：
  - 新建任务后跳转数据管理。
  - 无数据时模板页顶部提示。
  - 发布前检查缺项按钮。
  - AI 预审保存后返回发布。

中期建议：

- 如果后端未来支持任务级触发时机、审核流策略字段，再把 `OwnerAIPage` 中的触发时机 / 结果流控件接入真实 payload。
- 如果后端未来支持 CSV 导入，再把数据管理页的格式选择扩展为真实 CSV，而不是当前“另存为 Excel 或 JSON”的提示。
- 当前 `HANDOFF.md` 内部仍有早期历史段落记录旧分支 `fix/joint-test-web-shell`，接手时以顶部最新记录和真实 `git status` / `git log` 为准。

## 给队友的一句话

今天的核心变化是：Owner 任务发布不再靠模糊错误提示倒逼用户补配置，而是变成清晰的五步配置流程。发布前缺数据、缺模板、缺 AI 预审或缺分发设置时，页面会直接告诉用户缺哪一步，并给出对应入口。
