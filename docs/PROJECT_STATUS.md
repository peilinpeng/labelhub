# LabelHub 项目状态

> 这是受 Git 管理的公开状态快照，不是实时仪表盘。每次主线能力、依赖基线或验证结果变化后更新；
> 具体代码与 GitHub Actions 仍是最终事实来源。

## 当前主线

| 项目 | 状态 |
| --- | --- |
| 默认分支 | `main` |
| 已验证主线基线 | `9308fb6cd8adebcdf4b37f9a23428a2598fc3fa7` |
| 最近产品合并 | PR #97：修复导出后重复 seed 的外键清理 |
| 本轮稳定性收口 | PR #93～#99 的代码与治理变更已按依赖顺序进入 `main` |
| 最近核验日期 | 2026-09-13 |
| 工作流状态 | 该基线的 API CI、共享包/Web CI、增强真实后端 E2E 和 GitHub Pages 部署全部成功 |

## 验证基线

以下数字是带日期的验证快照，不应被理解为自动更新指标。

| 范围 | 最近结果 | 核验来源 |
| --- | --- | --- |
| API 常规测试 | 277 passed，2 deselected | 2026-09-13 Python 3.11 哈希锁环境 |
| 共享包 | 375 passed | 2026-09-13 全量 typecheck/test |
| Web 组件测试 | 56 passed | 2026-09-13 本地 coverage 复核 |
| Web 覆盖率 | statements 66.03%、branches 54.23%、functions 67.79%、lines 69.45% | 2026-09-13 `npm run test:coverage --prefix apps/web` |
| 真实后端 E2E | 9 个场景通过；非空导出后重复 seed 通过 | 2026-09-13 全新隔离 Compose 数据卷、PR #97 CI 与最终 `main` CI |
| GitHub Pages | 首页、三角色登录、Owner 导出、Labeler 我的提交、Reviewer 审核详情深链接通过 | 2026-09-13 最终 `main` 部署线上人工验收 |

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

- 本轮稳定性收口没有未完成的阻塞维护项。
- 历史答卷迁移、迁移审批、细粒度权限平台和生产监控仍属于“明确未交付”边界，不纳入本轮。

## 版本语义

- Git tag 或主线 commit：产品交付快照，可用于复现部署。
- 根 workspace 与 `@labelhub/web` 的 `0.1.0`：私有 npm workspace 元数据，不代表公开产品版本。
- FastAPI 的 `1.0.0`：OpenAPI 服务版本，不要求与私有 npm workspace 版本相同。
