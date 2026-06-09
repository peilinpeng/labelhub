# LabelHub QA 测试记录

> 版本：2026-06-07（模板版，待人工填写）
> 适用分支：`feature/schema-governance-upgrade`
> 填写方式：逐项测试后在"结果"列填写 ✅ 通过 / ❌ 失败 / ⚠️ 部分通过，并附截图路径
>
> **截图规则：**
> - 所有截图放在 `docs/qa-assets/`
> - 命名使用英文小写 + 序号，例如：`01-owner-breaking-blocked.png`
> - Markdown 引用：`![描述](./qa-assets/xx-name.png)`
> - 图片较大时使用 HTML：`<img src="./qa-assets/xx-name.png" alt="描述" width="800" />`

---

## 1. 测试基本信息

| 项目 | 内容 |
|---|---|
| 测试日期 | `（填写）` |
| 测试人员 | `（填写）` |
| 测试环境 | `http://localhost:5180` |
| 启动命令 | `VITE_ENABLE_MSW=true npm run dev` |
| 浏览器 | `（填写，例如：Chrome 125）` |
| 操作系统 | `（填写）` |

---

## 2. Git 基线检查

在开始测试前，请执行以下命令并记录结果：

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status
```

| 检查项 | 预期值 | 实际值 | 结果 |
|---|---|---|---|
| 分支名 | `feature/schema-governance-upgrade` | `（填写）` | `（填写）` |
| HEAD commit | 以测试负责人提供的最终 commit 为准（测试时执行 `git rev-parse HEAD` 填写） | `（填写）` | `（填写）` |
| 工作区状态 | clean | `（填写）` | `（填写）` |

---

## 3. 自动化测试记录

在测试前请执行自动化测试套件并记录结果：

```bash
cd packages/contracts && npm run typecheck && npm run test
cd packages/schema-core && npm run typecheck && npm run test
cd packages/schema-compiler && npm run typecheck && npm run test
cd packages/schema-renderer && npm run typecheck && npm run test
cd apps/web && npm run typecheck && npm run build
```

> 执行日期：2026-06-09（Claude Code 自动化复跑，全绿）

| 测试套件 | 预期 | 实际结果 | 通过/失败 |
|---|---|---|---|
| contracts typecheck | ✅ | 通过（tsc --noEmit 无错误） | ✅ |
| contracts test | ✅ | 84/84 | ✅ |
| schema-core typecheck | ✅ | 通过 | ✅ |
| schema-core test | ✅ | 142/142 | ✅ |
| schema-compiler typecheck | ✅ | 通过 | ✅ |
| schema-compiler test | 31/31 | 31/31 | ✅ |
| schema-renderer typecheck | ✅ | 通过 | ✅ |
| schema-renderer test | 41/41 | 67/67（测试已扩充） | ✅ |
| schema-designer test | ✅ | 14/14（修复 5 处过期断言后） | ✅ |
| workflow-core test | ✅ | 29/29 | ✅ |
| apps/web typecheck | ✅ | 通过 | ✅ |
| apps/web build | ✅ | 通过（296 模块；仅遗留 vendor 循环 chunk warning，非阻断） | ✅ |
| **apps/api pytest** | ✅ | **165 passed**（`-m "not integration"`；1 个行锁并发用例需真实 MySQL，已 deselect） | ✅ |

> 注：apps/api 测试需安装 `celery[redis]` / `redis`（已并入 `apps/api/requirements.txt`）；CI（`.github/workflows/api-ci.yml`）以 `pytest -m "not integration"` 运行。

---

## 4. Owner Schema Governance QA

### 4.1 MSW 启动确认

| 检查项 | 结果 | 备注 |
|---|---|---|
| Console 显示 `[MSW] Mocking enabled.` | `（填写）` | `（填写）` |

### 4.2 Breaking Change 阻断

**URL：** `http://localhost:5180/owner/tasks/task_demo_schema_breaking_change/designer`

| 检查项 | 结果 | 备注 | 截图 |
|---|---|---|---|
| 页面正常加载 | `（填写）` | | |
| 兼容性检查显示 `FIELD_REMOVED` | `（填写）` | | |
| "确认发布"按钮为禁用状态 | `（填写）` | | `./qa-assets/01-owner-breaking-blocked.png` |
| Audit Timeline 显示 `SCHEMA_PUBLISH_BLOCKED` 事件 | `（填写）` | | |

### 4.3 安全发布

**URL：** `http://localhost:5180/owner/tasks/task_demo_schema_safe_publish/designer`

| 检查项 | 结果 | 备注 | 截图 |
|---|---|---|---|
| 兼容性检查通过（无错误） | `（填写）` | | |
| "确认发布"按钮可点击 | `（填写）` | | |
| 发布成功 | `（填写）` | | |
| Audit Timeline 显示 `SCHEMA_COMPATIBILITY_CHECKED` → `SCHEMA_VERSION_PUBLISHED` | `（填写）` | | `./qa-assets/02-owner-audit-timeline.png` |

### 4.4 Deprecated 字段

**URL：** `http://localhost:5180/owner/tasks/task_demo_schema_deprecation/designer`

| 检查项 | 结果 | 备注 |
|---|---|---|
| 显示 deprecation warning | `（填写）` | |
| 需勾选确认才能发布 | `（填写）` | |
| 发布成功后 Timeline 显示 deprecation 事件 | `（填写）` | |

### 4.5 Migration Required

**URL：** `http://localhost:5180/owner/tasks/task_demo_schema_migration_required/designer`

| 检查项 | 结果 | 备注 |
|---|---|---|
| 显示 `FIELD_TYPE_CAST_REQUIRED` | `（填写）` | |
| 有迁移提示信息 | `（填写）` | |

**截图路径（可选）：**

---

## 5. Labeler Formily Runtime QA

**URL：** `http://localhost:5180/labeler/workspace/asn_1001`

### 5.1 智能联动渲染模式确认

> 表单联动运行时由 schema-compiler 编译生成 Formily x-reactions 驱动。
> 页面默认使用智能联动渲染（formily-v2），无需手动切换。
>
> **URL 参数说明：**
> - 默认（无参数）：智能联动渲染（formily-v2）
> - `?renderer=legacy`：经典渲染（fallback，联动不生效）
> - `?showRendererToggle=1`：显示开发者模式切换控件

| 检查项 | 结果 | 备注 |
|---|---|---|
| 默认页面 Console 无 error | `（填写）` | 访问 `/labeler/workspace/asn_1001` |
| 不显示 `[debug]`、`legacy`、`formily-v2` 文字 | `（填写）` | 普通 UI 无引擎标签 |
| `?renderer=legacy` fallback 可用（AI Assist 按钮仍可见） | `（填写）` | |

### 5.2 qualityScore 联动测试

| 检查项 | 结果 | 备注 | 截图 |
|---|---|---|---|
| 初始状态：factCheckNote 隐藏 | `（填写）` | | |
| 选择 qualityScore = "1"：factCheckNote 显示 | `（填写）` | | `./qa-assets/03-formily-linkage-required.png` |
| factCheckNote 显示必填标记（*） | `（填写）` | | |
| 选择其他 qualityScore：factCheckNote 隐藏 | `（填写）` | | |

### 5.3 clearValue 测试（若有）

| 检查项 | 结果 | 备注 |
|---|---|---|
| 先填写 factCheckNote，再修改 qualityScore 触发隐藏 | `（填写）` | |
| factCheckNote 隐藏时值被清空 | `（填写）` | |

---

## 6. AI Assist Preflight QA

**URL：** `http://localhost:5180/labeler/workspace/asn_1001`

> **默认即为 formily-v2（智能联动渲染）。AI Assist preflight 与动态联动走同一 Schema Runtime Engine 路径，无需切换引擎。**

### 6.1 BLOCKED 场景

| 检查项 | 结果 | 备注 | 截图 |
|---|---|---|---|
| "AI 辅助"按钮存在且可点击 | `（填写）` | | |
| 点击后返回 AI 建议（output 文本显示） | `（填写）` | | |
| 预检状态块显示"⛔ 预检阻断" | `（填写）` | | `./qa-assets/04-ai-preflight-blocked.png` |
| 显示"本次建议会新增无法满足的表单规则" | `（填写）` | | |
| 显示"将更新字段：xxx" | `（填写）` | | |
| 显示必填字段缺失列表 | `（填写）` | | |
| "确认应用建议"按钮为**禁用**状态 | `（填写）` | | |
| "忽略建议"按钮可点击 | `（填写）` | | |
| 点击"忽略建议"后，AI 输出和预检块消失 | `（填写）` | | |
| Console 无报错 | `（填写）` | | |

### 6.2 SAFE 场景

| 检查项 | 结果 | 备注 | 截图 |
|---|---|---|---|
| 先填写所有必填字段（含 factCheckNote） | `（填写）` | | |
| 再点击"AI 辅助" | `（填写）` | | |
| 预检状态块显示"✅ 预检通过" | `（填写）` | | `./qa-assets/05-ai-preflight-safe.png` |
| 显示"不会新增必填缺失" | `（填写）` | | |
| 显示"将更新字段：xxx" | `（填写）` | | |
| "确认应用建议"按钮可点击 | `（填写）` | | |
| 点击"确认应用建议"后，答案更新 | `（填写）` | | |

### 6.3 安全边界检查

| 检查项 | 结果 | 备注 |
|---|---|---|
| 预检 UI 区域不显示完整 patch value（具体字段值） | `（填写）` | |
| 预检 UI 区域不显示完整 prompt | `（填写）` | |
| 预检 UI 区域不显示完整 answers | `（填写）` | |
| BLOCKED 状态下"确认应用建议"按钮物理禁用，Network/audit-events 请求中不应出现 `AI_ASSIST_ACCEPTED` | `（填写）` | 可在 DevTools Network 过滤 audit-events 请求确认 |

---

## 7. Reviewer Diff / AI Feedback QA

> 三个 sub 对应不同演示场景，请按下方分工测试：
> - `sub_1001`：无修改审核（AI Precheck 转人工），只写 `REVIEW_SUBMITTED`，**不生成** `REVIEW_DIFF_GENERATED`
> - `sub_1003`：修改 corrected answers 后提交，演示 `REVIEW_DIFF_GENERATED` 生成
> - `sub_1004`：AI Review Feedback 显式选择演示（AI 评分 PASS + 人工确认）

### 7.1 sub_1001：无修改审核（REVIEW_SUBMITTED，无 DIFF）

**URL：** `http://localhost:5180/reviewer/items/sub_1001`

| 检查项 | 结果 | 备注 |
|---|---|---|
| 页面正常加载，显示标注者原始答案 | `（填写）` | |
| AI Precheck 结果显示（AI 评分 / 意见） | `（填写）` | rev_1001 decision = NEED_HUMAN_REVIEW |
| **不修改**答案，直接点击"通过"或"退回" | `（填写）` | |
| 提交成功（或 409 说明已提交过） | `（填写）` | 409 = 状态机保护，非 bug |
| 提交后**不产生** `REVIEW_DIFF_GENERATED` 事件（因无 patch） | `（填写）` | patches 为空时不写 diff audit |

### 7.2 sub_1003：修改答案 + REVIEW_DIFF_GENERATED

**URL：** `http://localhost:5180/reviewer/items/sub_1003`

| 检查项 | 结果 | 备注 | 截图 |
|---|---|---|---|
| 页面正常加载，显示标注者原始答案 | `（填写）` | | |
| AI Precheck 结果显示（评分 61，多条 fieldIssues） | `（填写）` | rev_1003 适合 Reviewer diff 演示 | |
| 在"修正答案"区域**修改至少一个字段值** | `（填写）` | | |
| 点击"通过"或"退回"提交成功 | `（填写）` | | `./qa-assets/06-reviewer-diff-generated.png` |
| 后台产生 `REVIEW_DIFF_GENERATED` audit 事件 | `（填写）` | Network 可见 audit-events 请求 | |
| audit payload 只含 patchedFieldNames（字段名），不含完整答案内容 | `（填写）` | 隐私保护验证 | |
| Console 无 API error | `（填写）` | | |

### 7.3 sub_1004：AI Review Feedback 演示

**URL：** `http://localhost:5180/reviewer/items/sub_1004`

| 检查项 | 结果 | 备注 |
|---|---|---|
| 页面正常加载 | `（填写）` | |
| AI Review 结果显示（评分 84，decision = PASS） | `（填写）` | rev_1004 适合 AI 反馈显式选择演示 |
| 可查看 AI Review 打分明细（dimensionScores） | `（填写）` | |
| 人工确认后提交成功 | `（填写）` | |

---

## 8. Export / Data Quality Passport QA

**URL：** `http://localhost:5180/owner/tasks/task_news_quality/export`

| 检查项 | 结果 | 备注 | 截图 |
|---|---|---|---|
| 导出页面正常加载 | `（填写）` | | |
| 点击导出后生成 Passport 摘要 | `（填写）` | | `./qa-assets/07-export-passport-summary.png` |
| 显示 `recordCount`（总答卷数） | `（填写）` | contracts 字段 | |
| 显示 `passportCount`（附带 passport 的答卷数） | `（填写）` | contracts 字段 | |
| 显示 `warningCount`（质量警告数） | `（填写）` | contracts 字段 | |
| 显示 `passportBatchHash`（应为真实 SHA-256 hex，非 `sha256:mock-xxx` 格式） | `（填写）` | 验证 hash 真实性 | |
| Console 无报错 | `（填写）` | | |

---

## 9. 缺陷记录

| 序号 | 发现时间 | 所属模块 | 描述 | 严重程度 | 状态 | 截图路径 |
|---|---|---|---|---|---|---|
| 1 | 2026-06-09 | 真实后端 / 全局 | 后端长时间空闲后首批请求 500：`apps/api/app/database.py` 的 `create_engine` 未配 `pool_pre_ping` / `pool_recycle`，MySQL 空闲超时后连接池里是死连接。复现：api 容器 Up 超过 MySQL wait_timeout（默认 8h）后调用任意接口（如 POST /auth/login）。期望：正常返回。实际：第一次报 `{"code":"VALIDATION_FAILED","message":"服务端内部错误"}`，api 日志 `pymysql OperationalError (2006, "MySQL server has gone away")`；重试即成功。Console：前端只看到通用错误提示。⚠️ 高度疑似历史「任务创建/发布偶发失败」（P1-1）的根因。**修复**：`create_engine` 加 `pool_pre_ping=True, pool_recycle=3600`；重建 api/worker 后验证：容器内 pytest 170 passed；经 5173 真实链路首次登录 200，Owner 建任务→存模板→发布模板→上传文件→导入数据集→发布任务全链路 2xx；api 日志再无 gone away / Broken pipe / 500。运维注意：重建 api 容器后需 `docker compose restart web`，否则 web 容器内 vite 代理持有旧 api 连接会报 500。 | 高 | 已修复 | 无（见 api 容器日志 traceId f429b2e76c644cc08b53fe7e13d62d32） |
| 2 | 2026-06-09 | Mock / Reviewer+导出 | mock 模式下审核决策不更新 submission 状态：在 `/reviewer/items/sub_1002`、`sub_1003` 提交「通过/保存修订并通过」成功（审计事件 REVIEW_SUBMITTED / REVIEW_DIFF_GENERATED 正常写入）后，`GET /api/v1/review/queue` 中两条仍为 `NEEDS_HUMAN_REVIEW`；连带 `/owner/tasks/task_news_quality/export` 导出结果为 0 条、质量护照「记录数 0 / 批次指纹 暂无」，QA 表 §8 的 passportBatchHash 验证项在 mock 下无法通过。期望：通过后状态流转、进入可导出池。实际：状态停滞、导出空。Console 无报错。（真实后端不受影响，仅 `mock-db.ts` 状态机缺口） | 中 | 未修复 | 无 |
| 3 | 2026-06-09 | Owner 模板搭建 | QA 表 §4.2/§4.3 要求「Audit Timeline 显示 SCHEMA_PUBLISH_BLOCKED / SCHEMA_VERSION_PUBLISHED」，但模板搭建页和任务详情页都没有审计时间线 UI；事件本身已正确写入 `/api/v1/audit-events`。`apps/web/src/features/owner/AuditTimelinePanel.tsx` 组件存在但全仓库无任何引用（死代码）。期望：发布/阻断后页面可见审计时间线。实际：只能在质量中心看到全局事件流。Console 无报错。**修复（2026-06-10）**：根因为 `AuditTimelinePanel` 组件完整可用但从未被引用——既无 import 也无挂载（非 taskId/样式问题）。在 `apps/web/src/features/owner/OwnerSchemaPage.tsx` 中挂载该面板（位于 `SchemaVersionPanel` 之后），按 `taskId + entityType: "SCHEMA"` 调用 `queryAuditEvents` 读取审计事件，进入页面与每次发布/回滚后（versionRefreshKey 变化）自动刷新，并提供「刷新审计日志」按钮；读取失败优雅降级（保留已有事件 + 软提示，不抛红错）。仅前端接入，未改 contracts/后端/Schema Runtime/提交校验/AI preflight/Designer 结构。**验证**：mock 5180，QA §4 Demo B `task_demo_schema_breaking_change`，触发发布后 Timeline 显示「发布被阻断」(已阻断/错误, 阻断代码 FIELD_REMOVED) 与「发布前兼容性检查」(校验完成/警告, 阻断数量 1)；Console 无红色 error；`apps/web` typecheck/build 均通过。⚠️ 环境注意事项（本次不修，见下条备注）：dev 环境同时跑 MSW mock 与真实后端（Docker :3000，Vite 代理 /api），部分 audit 请求偶发绕过 MSW 命中真后端，被以 mock token 拒成 401（`apps/api/app/middleware/auth.py:84`）；影响所有 audit 调用，非本次接入引入，UI 已软降级。 | 中 | 已修复 | 无 |
| 4 | 2026-06-09 | Labeler AI 辅助 | AI 建议为「还需要补充信息」（阻断）状态时，「一键采纳」正确物理禁用，但「反馈问题」按钮同样被禁用，且没有 QA 表 §6.1 预期的可点击「忽略建议」入口——阻断状态下用户无法关闭/忽略这条 AI 建议区块。期望：忽略/反馈入口可用。实际：两个按钮均 disabled。Console 无报错。 | 低 | 未修复 | 无 |
| 5 | 2026-06-09 | Owner 导出中心 | 下载历史时间戳直接渲染原始 ISO/UTC 字符串 `2026-06-09T20:07:24.731Z`（本地实际 22:07），未本地化、未格式化，且与平台其他页面「2026/6/9 22:05:10」格式不一致。 | 低 | 未修复 | 无 |
| 6 | 2026-06-09 | 真实后端 / 文件上传 | `POST /files/{id}/confirm` 不校验二进制内容是否真的已上传：对一个从未成功上传内容的文件 confirm 返回 200 并置 READY，随后 `POST /tasks/{id}/dataset/import` 报 422「本地文件不存在: /workspace/.storage/...」。期望：confirm 时校验存储文件存在，否则 409/422。实际：confirm 假成功，错误延迟到导入阶段才暴露。复现：upload-url 拿 fileId → 跳过（或失败）upload → 直接 confirm → import。 | 中 | 未修复 | 无 |

> 若无缺陷，请填写：**无缺陷**

---

## 10. 最终测试结论

| 维度 | 结论 | 备注 |
|---|---|---|
| 自动化测试 | `（通过/部分通过/未通过）` | |
| Owner Schema Governance | `（通过/部分通过/未通过）` | |
| Labeler Formily Runtime | `（通过/部分通过/未通过）` | |
| AI Assist Preflight | `（通过/部分通过/未通过）` | |
| Reviewer Diff | `（通过/部分通过/未通过）` | |
| Export Passport | `（通过/部分通过/未通过）` | |

**整体结论：**

```
（填写：可用于竞赛答辩 / 存在阻断性问题需先修复 / 仅部分功能可 demo）
```

**已完成截图列表：**

```
（填写已放入 docs/qa-assets/ 的截图文件名）
```

**测试人签字：** `（填写）`

**测试日期：** `（填写）`

---

## 附录：截图参考命名

| 截图文件名 | 对应场景 |
|---|---|
| `01-owner-breaking-blocked.png` | Breaking Change 阻断 + 禁用的发布按钮 |
| `02-owner-audit-timeline.png` | 安全发布后的 Audit Timeline |
| `03-formily-linkage-required.png` | qualityScore = "1" 触发 factCheckNote 必填 |
| `04-ai-preflight-blocked.png` | AI Assist BLOCKED 状态 + 禁用的确认按钮 |
| `05-ai-preflight-safe.png` | AI Assist SAFE 状态 + 可用的确认按钮 |
| `06-reviewer-diff-generated.png` | Reviewer 修改答案提交成功 |
| `07-export-passport-summary.png` | Export Data Quality Passport 摘要 |
