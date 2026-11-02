# LabelHub 项目状态

> 这是受 Git 管理的公开状态快照，不是实时仪表盘。每次主线能力、依赖基线或验证结果变化后更新；
> 具体代码与 GitHub Actions 仍是最终事实来源。

## 当前主线

| 项目 | 状态 |
| --- | --- |
| 默认分支 | `main` |
| 已验证主线产品代码基线 | `3aab8e19d3b50badb561826a7acecd594ad74add`（PR #143；后续纯文档提交不改变该代码基线） |
| 最近产品合并 | [PR #143](https://github.com/peilinpeng/labelhub/pull/143)：修复 MSW 3 在 Pages 子路径的页面刷新 |
| 十一月依赖维护 | [PR #136](https://github.com/peilinpeng/labelhub/pull/136)，三批实现已合并；原 15 个依赖 PR 均已关闭 |
| 最近核验日期 | 2026-11-02 |
| 主线工作流状态 | PR #136 合并后的 API CI 与审计成功；PR #143 合并后的共享包/Web CI、真实后端 E2E 和 Pages 部署成功（API 代码与锁文件未再变化） |

## 验证基线

以下为 2026-11-02 的验证快照。依赖维护已通过 PR #136 合并，Pages 导航修补已通过
PR #143 合并；本地完整回归、合并后 CI 与线上浏览器验收共同构成该基线的证据。

| 范围 | 最近结果 | 核验来源 |
| --- | --- | --- |
| API 常规测试 | 277 passed，2 deselected | Python 3.11.15 全新哈希锁环境；远端 API CI 同时通过 |
| MySQL 并发集成测试 | 2 passed，277 deselected | 隔离 Docker 网络与真实 API/MySQL；验证无超卖、幂等业务只执行一次 |
| 共享包 | 375 passed | Node 26.13.0 / npm 11.20.0，全量 typecheck/test |
| Web 组件测试 | 58 passed | 全量 typecheck、Vitest 5 + MSW 3 coverage；包含新增根路径/子路径导航回归 |
| Web 覆盖率 | statements 66.05%、branches 54.36%、functions 67.79%、lines 69.45% | 四项门槛均为 50%，CI 已改为实际运行 coverage |
| 真实后端 E2E | 9/9 通过，另跑导出 1/1；非空导出后重复 seed 通过 | 隔离 Compose 数据卷；API/Web 镜像构建、健康检查、非 root 与内网数据库约束通过 |
| 依赖审计 | 根/Web npm 与 Python 锁文件无已知漏洞 | 本地审计与远端 Python dependency audit；PyJWT 2.15.1、dnspython 2.9.0 补齐安全修复 |
| 构建与契约 | 生产、Pages 路径 Demo 构建通过；OpenAPI 47 路径且内容不变 | 本地构建与 OpenAPI 导出 |
| Mock 浏览器验收 | 三角色登录、深链接刷新、控制台无错误 | 本地根目录 404 的子路径静态部署，以及更新后的 GitHub Pages 线上实际浏览器验收 |

## 十一月维护范围

- 第一批 `b34b78f`：修复 #126 的 Vitest/coverage 错配，统一 5.0.3；适配 #132 的 MSW 3.0.3
  导入、`onUnhandledFrame` 和 Service Worker。整合 React 19.3、jsdom、Playwright、tsx 等更新。
- 第二批 `6446a0e`：Node 26.13.0 / npm 11.20.0 同步本地、CI 和 Docker；更新 Node types、
  React Router 8.4.0 和 Nginx 1.31.7。
- 第三批 `3f82d59`：整合 SQLAlchemy、Alembic、PyMySQL、OpenAI SDK 与 PyJWT，重新生成
  Python universal SHA-256 锁；PyJWT 2.14.0 和 dnspython 2.8.0 的审计告警已修复。
- 已替代并关闭依赖 PR：#111、#112、#113、#114、#115、#116、#117、#119、#126、#129、
  #130、#131、#132、#134、#135。关闭时未主动删除来源分支。
- 部署验收修补 PR #143：MSW 3 开始拦截页面导航后，旧回退函数错误读取域名根首页。现改为
  使用 Vite `BASE_URL`，新增两项回归测试；线上三角色登录和刷新通过，控制台无错误。
- 不变更共享契约、API 路径、数据库模型或业务状态机。

合并后证据：[API CI 与审计](https://github.com/peilinpeng/labelhub/actions/runs/41460260143)、
[共享包/Web CI](https://github.com/peilinpeng/labelhub/actions/runs/41463066378)、
[真实后端 E2E](https://github.com/peilinpeng/labelhub/actions/runs/41463066681)、
[Pages 部署](https://github.com/peilinpeng/labelhub/actions/runs/41463066547)。

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

- 本轮原定 15 个依赖升级、失败修复、完整回归及部署验收均已完成。
- 合并后 Dependabot 新生成 6 个升级 PR，作为下一维护批次保留：#137 React Router、
  #138 Vite/Vitest 工具链、#139 OpenAI SDK、#140 Alembic、#141 SQLAlchemy、#142 PyMySQL。
  这些是新的版本目标，尚未作为本轮已交付升级合并。
- 历史答卷迁移、迁移审批、细粒度权限平台和生产监控仍属于“明确未交付”边界，不纳入本轮。

## 版本语义

- Git tag 或主线 commit：产品交付快照，可用于复现部署。
- 根 workspace 与 `@labelhub/web` 的 `0.1.0`：私有 npm workspace 元数据，不代表公开产品版本。
- FastAPI 的 `1.0.0`：OpenAPI 服务版本，不要求与私有 npm workspace 版本相同。
