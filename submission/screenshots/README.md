# Demo 截图索引

> 来源：前端 Mock 模式（`VITE_ENABLE_MSW=true`，端口 5180），账号 `*@labelhub.test`。
> 覆盖 Owner / Labeler / Reviewer 三角色关键页面。

| 文件 | 角色 | 页面 | 说明 |
|---|---|---|---|
| `owner-1-tasks.png` | Owner | `/owner/tasks` | 任务管理列表 |
| `owner-2-ai-config.png` | Owner | `/owner/ai-config` | AI 预审配置：维度权重 slider（自动归一化为 1.00）+ 右侧规则预览卡片 |
| `owner-3-schema-breaking-change.png` | Owner | `/owner/tasks/task_demo_schema_breaking_change/designer` | Schema Designer：Breaking Change 阻断、版本管理、审计时间线 |
| `labeler-1-workspace.png` | Labeler | `/labeler/workspace/asn_1001` | 标注工作台：动态表单 + qualityScore=1 触发 factCheckNote 必填联动 |
| `reviewer-1-queue.png` | Reviewer | `/reviewer/items` | 审核队列：批量领取/通过/打回（打回必填理由） |
| `reviewer-2-detail.png` | Reviewer | `/reviewer/items/sub_1001` | 单条审核详情：PASS/RETURN/REVISE + 字段级 Diff |

架构图见上一级目录：`../architecture.png`（系统架构）、`../data-quality-flow.png`（数据质量主线）。
