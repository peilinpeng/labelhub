# LabelHub 项目状态

> 受 Git 管理的交付快照，代码与 GitHub Actions 是最终事实来源。更新时间：2026-11-03。

## 本轮交付

[PR #145](https://github.com/peilinpeng/labelhub/pull/145) 完成剩余治理、运行诊断与监控任务，
并整合依赖 PR #137–142，已于 2026-11-03 合并。
产品代码基线：`a793e5c5d7171db4073be8f8e6bab71d675e9570`（PR #145；后续纯文档提交不改变此基线）。
合并前全部 CI、合并后主线四套工作流与线上浏览器验收均已通过。

## 已实现能力

- Owner、Labeler、Reviewer 的任务创建、数据导入、模板配置、领取标注、AI 辅助、人工审核与导出闭环。
- Schema 不可变版本、兼容性检查、破坏性发布阻断、Deprecation、质量证据、Export Passport 与审计。
- 历史答卷迁移：固定输入与摘要、持久化预演、独立审批、后台执行、冲突检测、失败重试和不可变产物。
  原始答卷、审核结果和既有导出不被覆盖。
- 任务动作权限：允许 / 拒绝、有效期、撤销、审计；每次请求重新验证用户状态和权限，幂等回放也不绕过鉴权。
- 运行诊断：实际 Formily 事件追踪、字段依赖图、Worker 编译和有界缓存；追踪不保存答案，关闭即清空。
- 仓库内监控：就绪探针、受保护指标、低基数日志、Prometheus / Alertmanager / Grafana overlay 和自动验收。

详细说明：[治理与权限](GOVERNANCE.md)、[监控部署](OBSERVABILITY.md)、[交付记录](GOVERNANCE_DELIVERY.md)。

## 验证快照

| 范围 | 结果与来源 |
| --- | --- |
| API | 本地 293 passed、2 deselected，包含审批、篡改、撤权、冲突、重试与 UTC 时间回归 |
| 共享包 | 380 passed；全量 typecheck/test |
| Web | 60 passed；typecheck、coverage、生产与 Demo 构建通过 |
| Web 覆盖率 | statements 66.49%、branches 54.87%、functions 67.40%、lines 70.03%；四项门槛 50% |
| 依赖审计 | 根/Web npm 与 Python 哈希锁无已知漏洞 |
| 浏览器 | 本地子路径部署，治理桌面/390px 窄屏、Worker、实际运行追踪、深链接刷新通过；Demo 新建/预演/提交审批通过 |
| 远端集成 | [主线隔离全栈验收](https://github.com/peilinpeng/labelhub/actions/runs/41550975096)：11 项 E2E + 额外导出 1 项、MySQL 并发 2 项、监控、非 root 与内网服务约束、非空导出及迁移产物存在时重复 seed 均通过 |
| Pages 线上验收 | 三角色登录与深链接刷新、治理桌面/390px 窄屏、Worker、实际运行追踪通过；控制台与页面无异常 |

本机曾因磁盘不足出现 Docker 镜像存储 I/O 错误；已释放可重建下载缓存，未重置 Docker 或修改原有数据卷。
本轮完整容器验收使用 GitHub Actions 的全新隔离环境；不把本机 Docker 描述为已修复。

## 依赖与历史维护

- 本批整合 React Router 8.5.1、Vitest / coverage 5.0.5、OpenAI SDK 3.41.0、Alembic 1.20.1、
  SQLAlchemy 2.1.6、PyMySQL 1.2.3；新增两棵 npm 锁文件的工具链一致性检查。
- PR #136 已完成此前三批升级、Vitest / MSW 适配、Node 26.13.0 / npm 11.20.0 统一和安全修复。
- PR #143 已修复 MSW 3 的 Pages 子路径刷新。此前被替代的 15 个依赖 PR 已关闭。
- #137–142 已在 #145 合并后全部关闭；关闭时保留来源分支。

## 当前待办

本轮要求的功能、依赖、回归、文档与仓库内监控均已完成；无遗留开放依赖 PR。

主线证据：[API 与审计](https://github.com/peilinpeng/labelhub/actions/runs/41550975141)、
[共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/41550975072)、
[真实后端/监控](https://github.com/peilinpeng/labelhub/actions/runs/41550975096)、
[Pages 部署](https://github.com/peilinpeng/labelhub/actions/runs/41550975261)。
[线上演示](https://peilinpeng.github.io/labelhub/) 仍采用 Mock，不代表真实生产后端上线。

## 明确边界

- GitHub Pages 是 Mock 演示。持久化迁移、权限和 worker 需要部署真实后端。
- 迁移只能选同一任务的两个已发布版本，单批 1–500 条、输入不超过 8 MiB；原有破坏性发布门禁继续生效。
  未注册自定义校验会阻断迁移。源答卷变化生成冲突记录，不能直接覆盖。
- 新权限是任务级动作授权，仍受现有角色入口限制；不包含组织目录、SSO 或任意角色模拟。ADMIN 使用受控 API。
- 按用户确认，本轮完成并验证仓库内监控部署，不接入未知生产服务器或外部告警渠道。
- 更深入质量分析、AI 审计摘要属于未来可选扩展，不属于本轮承诺的剩余交付清单。

## 版本语义

Git tag / commit 标识产品快照；私有 npm workspace 的 `0.1.0` 与 OpenAPI 的 `1.0.0`
分别属于包元数据和 API 服务版本，无需与产品交付 commit 相同。
