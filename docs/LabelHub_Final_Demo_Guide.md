# LabelHub Final Demo Guide

> 版本：2026-06-10
> 适用分支：`integration/joint-test`
>
> ## ⚠️ 交付/答辩录制请走「真实后端全链路」
>
> **录制最终演示视频、答辩演示，请使用真实后端**（Docker 全栈 + 真实 LLM + 举办方真实数据，
> 端口 `http://localhost:5173`，账号 `*@labelhub.com / password123`）。
> 完整步骤见 **[`docs/LabelHub_Demo_Guide.md`](./LabelHub_Demo_Guide.md) → 「真实后端全链路 Demo（录屏用）」**，
> 现场操作卡见 **[`docs/LabelHub_Delivery_Runbook.md`](./LabelHub_Delivery_Runbook.md)**。
>
> 真实后端起栈务必先跑迁移（否则审核详情 AI 建议会 500）：
> ```bash
> docker compose build api worker && docker compose up -d
> docker compose exec -w /workspace/apps/api api alembic upgrade head   # head=c3d4e5f6a7b8
> ```
>
> ---
>
> **本指南为「前端 Mock 快速演示」路径（备选）**：不连真实后端，用 MSW 内置假数据，
> 适合无后端环境时快速过 UI 故事线。Mock 模式下不体现真实后端行为，**不要用它录交付视频**。
> 适用场景：前端 UI 走查 / 无 Docker 环境的快速预览。
>
> **Mock 阅读前提：** 必须使用 `VITE_ENABLE_MSW=true npm run dev` 启动，普通启动会 404。

---

## 1. Demo 启动方式

### 1.1 标准启动

```bash
git checkout integration/joint-test
git pull
npm install

cd apps/web
VITE_ENABLE_MSW=true npm run dev
```

启动后访问：`http://localhost:5180`

### 1.2 验证 MSW 已启用

打开浏览器 Console，应看到：

```txt
[MSW] Mocking enabled.
```

如果没有此日志，说明未启用 MSW，所有 API 请求会 404，demo 无法运行。

### 1.3 常见故障排查

| 问题 | 原因 | 解决 |
|---|---|---|
| API 请求 404 | 未加 `VITE_ENABLE_MSW=true` | 重启 dev server |
| 页面空白 | 未 `npm install` 或依赖不完整 | 重跑 `npm install` |
| Reviewer 提交 409 | 状态机保护，非 bug | 刷新页面或用不同 sub_xxx |
| 需要 fallback 到经典渲染 | 调试需求 | 访问 `?renderer=legacy` |

---

## 2. Demo 总路线

推荐答辩顺序（完整故事线，约 15 分钟）：

```txt
Demo 1 → Demo 2 → Demo 3 → Demo 4 → Demo 5
```

| 序号 | Demo 名称 | 核心亮点 | 时长建议 |
|---|---|---|---|
| 1 | Owner Schema Governance | Breaking Change 被阻断 + Audit Timeline | 3 分钟 |
| 2 | Labeler Formily Runtime Linkage | qualityScore 触发 factCheckNote 联动 | 3 分钟 |
| 3 | AI Assist Preflight | AI patch 被 BLOCKED，理性拦截 | 3 分钟 |
| 4 | Reviewer Diff + AI Feedback | 修改答案生成 REVIEW_DIFF | 3 分钟 |
| 5 | Export Data Quality Passport | 导出携带质量证明 | 2 分钟 |

---

## 3. Demo 1：Owner Schema Governance

### 3.1 Breaking Change 阻断

**访问 URL：**

```
http://localhost:5180/owner/tasks/task_demo_schema_breaking_change/designer
```

**操作步骤：**

1. 进入页面后，点击"发布前检查"按钮
2. 观察兼容性检查结果
3. 注意"确认发布"按钮状态

**预期现象：**

- 兼容性检查显示 `FIELD_REMOVED`（字段被删除 = Breaking Change）
- "确认发布"按钮为禁用状态（灰色，无法点击）
- Audit Timeline 显示：`compatibility_checked` + `publish_blocked`

**讲解要点：**

> 这是 Schema Governance 的核心价值：当有人试图发布一个会破坏历史答卷的新版 Schema，系统会自动检测 Breaking Change 并在发布前阻断。历史数据永远不会被新 Schema 污染。

**失败 fallback：**

- 若页面加载失败，检查 MSW 是否启用
- 若按钮未禁用，刷新页面重新尝试

**建议截图：**

```
submission/screenshots/01-owner-breaking-blocked.png
```
截图内容：显示 FIELD_REMOVED 的兼容性检查结果 + 禁用的发布按钮

---

### 3.2 安全发布

**访问 URL：**

```
http://localhost:5180/owner/tasks/task_demo_schema_safe_publish/designer
```

**操作步骤：**

1. 点击"发布前检查"
2. 确认无错误后点击"确认发布"
3. 查看 Audit Timeline

**预期现象：**

- 兼容性检查通过（无 Breaking Change）
- 发布成功
- Timeline 显示：`compatibility_checked` → `publish_requested` → `schema_version_published`

**建议截图：**

```
submission/screenshots/02-owner-audit-timeline.png
```

---

### 3.3 Deprecated 字段

**访问 URL：**

```
http://localhost:5180/owner/tasks/task_demo_schema_deprecation/designer
```

**预期现象：**

- 兼容性检查显示 deprecation warning（`FIELD_DEPRECATED`）
- 需勾选"我已确认废弃影响"才能发布
- Timeline 显示 `deprecation_warning_generated`

---

### 3.4 Migration Required

**访问 URL：**

```
http://localhost:5180/owner/tasks/task_demo_schema_migration_required/designer
```

**预期现象：**

- 显示 `FIELD_TYPE_CAST_REQUIRED`（字段类型变更需要数据迁移）
- 提示需要迁移，但不阻断（migration 是另一条流程）

---

## 4. Demo 2：Labeler Formily Runtime Linkage

**访问 URL：**

```
http://localhost:5180/labeler/workspace/asn_1001
```

> **默认即为智能联动渲染（formily-v2 引擎），无需切换。**
> Fallback：访问 `?renderer=legacy` 可切回经典渲染。
> 开发者模式：访问 `?showRendererToggle=1` 可显示运行模式切换控件。

### 4.2 测试 qualityScore 触发联动

**操作步骤：**

1. 找到"质量评分"（qualityScore）字段
2. 选择评分 "1"（低质量）
3. 观察页面变化

**预期现象：**

- "事实核查说明"（factCheckNote）字段出现（visibleWhen 联动）
- 该字段标注为必填（*）
- qualityScore 不为 1 时，factCheckNote 隐藏

**讲解要点：**

> 这是 FE-4/FE-5 的成果：LabelHub 自有 JSON DSL 被 schema-compiler 编译为 Formily x-reactions，字段联动在前端运行时由 Formily 状态机驱动，不是 if-else hardcode，而是声明式的 Schema-governed 运行时。

**建议截图：**

```
submission/screenshots/03-formily-linkage-required.png
```
截图内容：qualityScore = "1" 时 factCheckNote 显示且标注必填

**失败 fallback：**

- 若联动未触发，检查访问路径是否包含 `?renderer=legacy`（legacy 不走 Formily runtime）
- 若页面报错，访问 `?renderer=legacy` 切回经典渲染验证

---

## 5. Demo 3：AI Assist Preflight

**访问 URL：**

```
http://localhost:5180/labeler/workspace/asn_1001
```

> 此 demo 在**智能联动渲染（formily-v2）下**运行（默认即可，无需切换）。
> AI Assist preflight 现已与 Formily runtime 统一——动态联动与 AI 预检走同一条 Schema Runtime Engine 路径。

### 5.1 触发 AI Assist

**操作步骤：**

1. 找到页面上的"AI 辅助"按钮
2. 点击触发 AI 辅助
3. 等待 AI 建议返回

**预期现象（BLOCKED 场景）：**

- 显示 AI 建议文本（output）
- 预检状态块显示：`⛔ 预检阻断`
- 说明文字：`本次建议会新增无法满足的表单规则，因此不能直接应用。`
- 显示"将更新字段：factCheckNote、qualityScore"（或实际字段名）
- 显示必填字段缺失列表
- "确认应用建议"按钮为**禁用状态**（灰色）

**建议截图：**

```
submission/screenshots/04-ai-preflight-blocked.png
```

### 5.2 SAFE 场景

**操作步骤：**

1. 先手动填写所有必填字段
2. 再次点击"AI 辅助"

**预期现象（SAFE 场景）：**

- 预检状态块显示：`✅ 预检通过`
- 说明文字：`本次建议不会新增必填缺失、非法字段或隐藏清空风险。`
- 显示"将更新字段：xxx"
- "确认应用建议"按钮为**可点击状态**

**建议截图：**

```
submission/screenshots/05-ai-preflight-safe.png
```

**讲解要点：**

> 这是 FE-7/FE-8 的成果：AI 生成的 patch 不直接写入表单，而是先经过 headless preflight 引擎预演——如果 AI 的建议会导致新的必填字段缺失或非法状态，系统会在 UI 层阻断，不允许用户直接 apply。这解决了 AI 幻觉直接污染表单的问题。

---

## 6. Demo 4：Reviewer Diff + AI Feedback

### 6.1 Reviewer Diff 生成

**访问 URL（有 AI review 分数）：**

```
http://localhost:5180/reviewer/items/sub_1001
```

**操作步骤：**

1. 查看标注者的原始答案
2. 在"修正答案"区域修改部分字段值
3. 点击"通过"或"退回"提交

**预期现象：**

- 提交成功后，后台记录 `REVIEW_DIFF_GENERATED` audit 事件
- payload 包含 `patchedFieldNames`（字段名列表）+ `patchCount` + diff hash
- **不**记录完整答案内容（隐私保护）

**建议截图：**

```
submission/screenshots/06-reviewer-diff-generated.png
```

**讲解要点：**

> Reviewer 修改答案时，系统自动计算 diff patch，记录"哪些字段被改了"而不是"改成了什么"，在 audit trail 中保留质量证据，但不泄露完整答案内容。

### 6.2 其他 Reviewer 场景

| URL | 场景 |
|---|---|
| `/reviewer/items/sub_1003` | 有 AI review 建议 + 评分的样本 |
| `/reviewer/items/sub_1004` | 另一个样本，测试 diff 生成 |

---

## 7. Demo 5：Export Data Quality Passport

**访问 URL：**

```
http://localhost:5180/owner/tasks/task_news_quality/export
```

**操作步骤：**

1. 进入导出页面
2. 点击"导出"或查看已生成的导出记录
3. 查看 Data Quality Passport 摘要

**预期现象：**

- 显示 Data Quality Passport 摘要：
  - 总答卷数
  - 审核通过率
  - AI 辅助使用率
  - 平均 Reviewer 修改字段数
  - passportBatchHash（真实 SHA-256）
- 后台记录 `DATA_QUALITY_PASSPORT_GENERATED` audit 事件

**建议截图：**

```
submission/screenshots/07-export-passport-summary.png
```

**讲解要点：**

> 导出的数据不只是裸答案，而是携带 Quality Passport——记录了这批数据的生产质量指标（谁标注、AI 辅助了多少、Reviewer 改了多少字段、整批数据的完整性 hash）。下游 AI 训练链路可以凭此 Passport 判断这批数据的可信度。

---

## 8. 推荐答辩讲解顺序

### 8.1 完整故事线（15 分钟版）

```
[开场：LabelHub 是什么？]
  ↓ 数据生产流程概览（Labeler → Reviewer → Owner）

[Demo 1：Schema Governance（3 分钟）]
  Breaking Change 阻断 → "我们的数据质量保障从 Schema 层开始"

[Demo 2：Formily Runtime Linkage（3 分钟）]
  qualityScore 触发 factCheckNote → "Schema-governed 声明式联动，不是 if-else"

[Demo 3：AI Assist Preflight（3 分钟）]
  BLOCKED 场景 → "AI 的建议必须经过 schema 规则预检，不能直接污染表单"

[Demo 4：Reviewer Diff（3 分钟）]
  修改答案 → REVIEW_DIFF_GENERATED → "每一次修改都有证据链"

[Demo 5：Export Passport（2 分钟）]
  导出 Passport → "最终交付的数据携带质量证明，不是裸答案"

[总结：Quality Layer 的价值]
  "行为全留痕，风险可拦截，质量可回溯，指标可沉淀"
```

### 8.2 精简版（8 分钟，时间不够用时）

```
Demo 1 → Demo 3 → Demo 5
（Schema Governance → AI Preflight → Passport）
省略 Demo 2 和 Demo 4，口头介绍即可
```

---

## 9. 常见问题与 fallback

### Q1：AI Assist 按钮点击没有反应

- 检查 MSW 是否启用（Console 看 `[MSW] Mocking enabled.`）
- 确认在正确 URL（`/labeler/workspace/asn_1001`）
- 刷新页面重试

### Q2：Formily 联动没有触发

- 默认已使用智能联动渲染（formily-v2），无需手动切换
- 确认 URL 中没有 `?renderer=legacy`（legacy 引擎不走 Formily runtime）
- 若有此参数，去掉后刷新即可

### Q3：Reviewer 提交 409

- 是状态机保护，不是 bug
- 切换到 `sub_1003` 或 `sub_1004` 重试

### Q4：AI Assist 总是 BLOCKED

- mock 数据中 `qualityScore: "1"` 触发了 R-low-quality-requires-note 规则，factCheckNote 未填时必然 BLOCKED
- 先在 Labeler 页面填写 factCheckNote，再触发 AI Assist，即可看到 SAFE 场景

### Q5：Export 页面没有 Passport 摘要

- 确认 MSW 启用
- 确认访问 `/owner/tasks/task_news_quality/export`
- 先点击"导出"触发生成，再查看摘要

### Fallback 兜底脚本

若 demo 途中某个功能无法演示：

```txt
"这个功能的自动化测试已经覆盖了这个场景，我们来看一下测试代码..."
（打开对应的 *.test.tsx / *.test.ts 文件，展示测试用例）
```

---

## 10. 相关文档

| 文档 | 内容 |
|---|---|
| `docs/Labelhub_Quality_Layer.md` | Quality Layer 架构设计 |
| `docs/LabelHub_Schema_Version_Management.md` | Schema Governance 设计规格 |
| `docs/labelhub_schema_runtime_engine.md` | Schema Runtime Engine v2 技术设计 |
| `docs/FORMILY_ARCH_DECISIONS.md` | Formily 架构决策记录 |
