# LabelHub 项目状态

> 这是受 Git 管理的公开状态快照，不是实时仪表盘。每次主线能力、依赖基线或验证结果变化后更新；
> 具体代码与 GitHub Actions 仍是最终事实来源。

## 当前主线

| 项目 | 状态 |
| --- | --- |
| 默认分支 | `main` |
| 当前远端主线 | `04313c7dcabea95559f1d4da7f476b60d55fbedb`（PR #100，文档确认） |
| 上次完整验证的主线代码基线 | `9308fb6cd8adebcdf4b37f9a23428a2598fc3fa7` |
| 最近产品合并 | PR #97：修复导出后重复 seed 的外键清理 |
| 十一月依赖维护 | [PR #136](https://github.com/peilinpeng/labelhub/pull/136)，三批实现已完成，等待审核与合并 |
| 最近核验日期 | 2026-11-02 |
| 主线工作流状态 | 9 月代码基线的 API CI、共享包/Web CI、真实后端 E2E 和 Pages 部署成功；十一月维护验证见下表 |

## 验证基线

以下是 2026-11-02 对 PR #136 实现提交 `3f82d5928625c71ec53a45e7b6e4da7c93b7bfa4`
的验证快照，不代表这些升级已进入主线。文档更新不改变已验证的应用代码。

| 范围 | 最近结果 | 核验来源 |
| --- | --- | --- |
| API 常规测试 | 277 passed，2 deselected | Python 3.11.15 全新哈希锁环境；远端 API CI 同时通过 |
| MySQL 并发集成测试 | 2 passed，277 deselected | 隔离 Docker 网络与真实 API/MySQL；验证无超卖、幂等业务只执行一次 |
| 共享包 | 375 passed | Node 26.13.0 / npm 11.20.0，全量 typecheck/test |
| Web 组件测试 | 56 passed | 全量 typecheck、Vitest 5 + MSW 3 coverage |
| Web 覆盖率 | statements 66.05%、branches 54.36%、functions 67.79%、lines 69.45% | 四项门槛均为 50%，CI 已改为实际运行 coverage |
| 真实后端 E2E | 9/9 通过，另跑导出 1/1；非空导出后重复 seed 通过 | 隔离 Compose 数据卷；API/Web 镜像构建、健康检查、非 root 与内网数据库约束通过 |
| 依赖审计 | 根/Web npm 与 Python 锁文件无已知漏洞 | 本地审计与远端 Python dependency audit；PyJWT 2.15.1、dnspython 2.9.0 补齐安全修复 |
| 构建与契约 | 生产、Pages 路径 Demo 构建通过；OpenAPI 47 路径且内容不变 | 本地构建与 OpenAPI 导出 |
| Mock 浏览器验收 | 三角色登录、深链接刷新、控制台无错误 | 本地 `/labelhub/` 部署路径，MSW 3 Service Worker；当前线上仍为 9 月版本 |

## 十一月维护范围

- 第一批 `b34b78f`：修复 #126 的 Vitest/coverage 错配，统一 5.0.3；适配 #132 的 MSW 3.0.3
  导入、`onUnhandledFrame` 和 Service Worker。整合 React 19.3、jsdom、Playwright、tsx 等更新。
- 第二批 `6446a0e`：Node 26.13.0 / npm 11.20.0 同步本地、CI 和 Docker；更新 Node types、
  React Router 8.4.0 和 Nginx 1.31.7。
- 第三批 `3f82d59`：整合 SQLAlchemy、Alembic、PyMySQL、OpenAI SDK 与 PyJWT，重新生成
  Python universal SHA-256 锁；PyJWT 2.14.0 和 dnspython 2.8.0 的审计告警已修复。
- 合并后替代依赖 PR：#111、#112、#113、#114、#115、#116、#117、#119、#126、#129、
  #130、#131、#132、#134、#135。原来源分支保留。
- 不变更共享契约、API 路径、数据库模型或业务状态机。

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

- PR #136 完成审核、合并后，确认主线 CI 与 Pages 部署，并关闭被替代的 15 个依赖 PR。
- 历史答卷迁移、迁移审批、细粒度权限平台和生产监控仍属于“明确未交付”边界，不纳入本轮。

## 版本语义

- Git tag 或主线 commit：产品交付快照，可用于复现部署。
- 根 workspace 与 `@labelhub/web` 的 `0.1.0`：私有 npm workspace 元数据，不代表公开产品版本。
- FastAPI 的 `1.0.0`：OpenAPI 服务版本，不要求与私有 npm workspace 版本相同。
