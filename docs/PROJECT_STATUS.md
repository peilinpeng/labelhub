# LabelHub 项目状态

> 受 Git 管理的交付快照，代码与 GitHub Actions 是最终事实来源。更新时间：2026-11-05。

## 文档维护（2026-11-05）

[PR #150](https://github.com/peilinpeng/labelhub/pull/150) 将仓库首页 README 改为英文，
并在 `AGENTS.md`、`CONTRIBUTING.md`、`AI_CODING_RULES.md` 中统一后续提交语言：
所有新提交的标题与正文使用英文，包括 merge / squash；既有提交不重写、不强制推送。
应用界面、其他文档及产品代码基线保持不变，仍为下述 PR #145 基线。
本次文档检查通过；此前本分支共享包 380 项测试、Web 60 项测试、类型检查、覆盖率检查及生产构建均通过。

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
| Web 覆盖率 | 本次本地复验 statements 66.56%、branches 54.92%、functions 67.40%、lines 70.03%；四项门槛 50% |
| 依赖审计 | 根/Web npm 与 Python 哈希锁无已知漏洞 |
| 浏览器 | 本地子路径部署，治理桌面/390px 窄屏、Worker、实际运行追踪、深链接刷新通过；Demo 新建/预演/提交审批通过 |
| 远端集成 | [主线隔离全栈验收](https://github.com/peilinpeng/labelhub/actions/runs/41550975096)：11 项 E2E + 额外导出 1 项、MySQL 并发 2 项、监控、非 root 与内网服务约束、非空导出及迁移产物存在时重复 seed 均通过 |
| Docker 本地复验 | 2026-11-03 修复存储 I/O 与失效构建缓存后，从空构建缓存构建 API/Web；隔离栈 11 项 E2E + 额外导出 1 项、MySQL 并发 2 项、监控、非 root、内网端口及重复 seed 均通过 |
| 运维收尾 | 40 份文档一致性检查、14 项维护工具测试、本机七卷恢复比较通过；异盘目标尚待指定 |
| Pages 线上验收 | 三角色登录与深链接刷新、治理桌面/390px 窄屏、Worker、实际运行追踪通过；控制台与页面无异常 |

本机 Docker 存储故障已完成恢复与本地完整验收：停机备份虚拟磁盘，重启恢复存储读取，
清除失效的未使用构建缓存，并回收已释放磁盘空间。原有 12 个容器和 7 个卷保留；
7 份卷备份均实际恢复到临时卷并逐文件对比通过，数据库逻辑备份已保存。
本地验收临时容器、卷及网络已清理，原有容器配置、挂载与运行/停止状态核对一致。
恢复方法、证据边界与容量检查见 [本机 Docker 恢复记录](LOCAL_DOCKER_RECOVERY.md)。

## 依赖与历史维护

- 本批整合 React Router 8.5.1、Vitest / coverage 5.0.5、OpenAI SDK 3.41.0、Alembic 1.20.1、
  SQLAlchemy 2.1.6、PyMySQL 1.2.3；新增两棵 npm 锁文件的工具链一致性检查。
- PR #136 已完成此前三批升级、Vitest / MSW 适配、Node 26.13.0 / npm 11.20.0 统一和安全修复。
- PR #143 已修复 MSW 3 的 Pages 子路径刷新。此前被替代的 15 个依赖 PR 已关闭。
- #137–142 已在 #145 合并后全部关闭；关闭时保留来源分支。

## 当前待办

核心功能、依赖整合、Docker 恢复与仓库内监控已交付。2026-11-03 的维护收尾统一全仓文档定位，
新增容量保护入口、文档 CI 与异盘备份工具；此类运维脚本不改变产品业务基线。

异盘备份当前状态：数据恢复包与包含停机磁盘副本的完整包均已准备，完成全文件 SHA-256；
七个卷归档已通过新工具在临时卷恢复比较。尚无用户指定的独立目标，
未完成异盘复制或从异盘恢复演练，不能标记为全部收尾完成。当前低容量会阻断新构建；
持续空间余量需结合宿主内存交换与存储使用情况维护。具体操作见 [本地存储维护](LOCAL_STORAGE_MAINTENANCE.md)。

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
