# LabelHub 项目状态

> 这是受 Git 管理的公开状态快照，不是实时仪表盘。每次主线能力、依赖基线或验证结果变化后更新；
> 具体代码与 GitHub Actions 仍是最终事实来源。

## 当前主线

| 项目 | 状态 |
| --- | --- |
| 默认分支 | `main` |
| 状态基线 | `a88979f8c2f7ab73a6aacf6888b1148905d1e039` |
| 最近产品合并 | PR #77：Reviewer 与 Schema 信息密度优化 |
| 最近核验日期 | 2026-09-13 |
| 工作流状态 | Shared packages/Web、API、真实后端 E2E、GitHub Pages 最近对应运行均成功 |

## 验证基线

以下数字是带日期的验证快照，不应被理解为自动更新指标。

| 范围 | 最近结果 | 核验来源 |
| --- | --- | --- |
| API 常规测试 | 276 passed，2 deselected | 2026-08-25 API CI |
| 共享包 | 375 passed | 2026-08-25 Node 26 全量验证 |
| Web 组件测试 | 44 passed | 2026-09-13 本地 coverage 复核 |
| Web 覆盖率 | statements 44.61%、branches 36.91%、functions 43.92%、lines 47.33% | 2026-09-13 `npm --prefix apps/web run test:coverage` |
| 真实后端 E2E | 6 个场景通过 | 2026-08-25 main CI |

## 已完成能力

- Owner、Labeler、Reviewer 三角色的任务创建、数据导入、模板配置、领取标注、AI 辅助、人工审核和导出闭环。
- Schema Governance：不可变版本、兼容性检查、破坏性变更阻断、Deprecation、Migration Required 预览和审计时间线。
- Quality Layer：标注遥测、AI Assist 审计、Reviewer diff、质量中心和 Data Quality Passport。
- Formily 运行时、Schema Compiler、headless preflight，以及 AI 建议 SAFE/WARNING/BLOCKED 三态校验。
- Node 26、生产镜像、哈希依赖锁、依赖审计、从零 Compose/E2E 和 GitHub Pages Demo。

## 明确未交付

- 持久化的历史答卷迁移执行管线。
- Dry Run → 审批 → 执行 → 不可变记录的 migration approval workflow。
- 超出现有角色与资源所有权校验的细粒度生产权限平台。
- Runtime Trace Panel、Dependency Graph UI、WebWorker/compile cache 等竞赛阶段非必要能力。

## 当前维护待办

1. 整合并验证 2026-08-30 至 2026-09-06 产生的 Dependabot 更新。
2. 将 Web 四项覆盖率门禁提升至 50%，优先覆盖导出、数据导入、AI 配置和任务详情。
3. 在测试保护下拆分 `mock-db.ts`、`useSchemaDraft.ts` 和大型工作台页面。

## 版本语义

- Git tag 或主线 commit：产品交付快照，可用于复现部署。
- 根 workspace 与 `@labelhub/web` 的 `0.1.0`：私有 npm workspace 元数据，不代表公开产品版本。
- FastAPI 的 `1.0.0`：OpenAPI 服务版本，不要求与私有 npm workspace 版本相同。
