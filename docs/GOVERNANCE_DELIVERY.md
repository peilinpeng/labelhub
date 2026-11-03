# 治理与运行诊断交付记录

实施日期：2026-11-02 至 2026-11-03。实现分支：`feat/complete-governance-runtime`。
[PR #145](https://github.com/peilinpeng/labelhub/pull/145) 已合并；产品代码基线 `a793e5c5d7171db4073be8f8e6bab71d675e9570`。
范围来自本轮全部待办完成请求，监控按用户确认限定为仓库内方案部署与验证。

## 批次与验收

1. 依赖维护：整合 #137–142；Vitest/coverage 两棵锁文件一致；API、共享包、Web、真实后端回归与审计。
2. 契约扩展：先定义迁移计划、审批、不可变迁移记录、任务动作授权和运行诊断；运行契约测试后才实现消费者。
3. 历史迁移：持久化 Dry Run、固定输入与摘要、独立审批、后台执行、重试恢复、冲突检测、逐项不可变结果。原始提交与已发布 Schema 永不覆盖。
4. 权限：任务级动作授权、有效期、撤销和审计；服务端权威检查；禁止通过新入口绕过原有资源权限。
5. 运行诊断：依赖图、受限且不持久化答案的追踪面板；共享编译缓存和 Worker，处理失效、异常、取消与卸载。
6. 可观测性：探活与就绪分离、低基数指标、脱敏日志、可部署监控与告警；使用隔离环境验证。
7. 集成：管理界面与 Mock 对齐、负向及并发测试、完整回归、独立 Compose 验收、PR、CI、合并与文档同步。

## 边界

允许修改：上述功能需要的架构契约、共享包、API/数据库/worker、Web/Mock、测试、部署与文档。
禁止修改：真实环境密钥、真实用户数据；不覆盖历史答卷，不放松发布校验或以日志保存答案。
契约风险：新增端点/状态/动作必须作为独立契约提交说明；既有 v1.1 Schema 与原有导出语义保持兼容。
监控环境：先提供仓库内可部署方案并在隔离栈验证；外部生产地址和渠道等待用户补充，不能宣称已接入未知环境。

## 验证命令

根目录 `npm run check:toolchain`、`npm run typecheck`、`npm test`；Web `typecheck`、`test:coverage`、`build:production`；
API 常规与 MySQL 集成测试；npm/Python 依赖审计；Alembic 升级与 OpenAPI 导出；真实后端 Playwright；
隔离 Compose 健康、权限、迁移和监控验收；`git diff --check`；合并后的 CI 与 Pages 验收。

## 完成证据

本轮按独立提交实施；主线与部署基线以 [项目状态](PROJECT_STATUS.md) 为准。

## 实施与验收记录

- 依赖批次 `e890f6e`：6 个目标升级已整合；Vitest / coverage 5.0.5、React Router 8.5.1，安装前检查两棵锁。
- 契约批次 `cd671f0`：独立定义新增端点、状态与权限，先通过 contracts typecheck/test。
- 本地最新验证：API 293 passed、共享包 380 passed、Web 60 passed；类型检查、生产构建与三份依赖审计通过。
  Web coverage 66.49% statements / 54.87% branches / 67.40% functions / 70.03% lines。
- 本机磁盘不足曾导致 Docker 镜像存储 I/O 错误；清理可重建下载缓存后空间恢复，但镜像存储仍异常。
  完整 Docker、MySQL、监控和真实浏览器验收转交本 PR 的 GitHub Actions 全新隔离 runner，验收证据见下方。
- 新增真实回归覆盖独立审批、原答卷不变、后台执行和运行诊断，并校验存在迁移产物时可重复 seed。

- 远端逐项验收已通过 MySQL 并发、监控鉴权/抓取/规则/面板、非 root 与内网服务约束，以及原有 9 项 E2E 和运行诊断。
  新增迁移端到端暴露 API 精简镜像缺少 Node 的 `libatomic1` 运行库，已补齐并在镜像构建期加入 Node/引擎检查，随后完整链路已通过复验。
- 新页面桌面与 390px 窄屏验收通过，Demo 浏览器新建/预演/提交审批通过；授权时间统一为显式 UTC。

- [真实后端完整验收](https://github.com/peilinpeng/labelhub/actions/runs/41550493012) 已通过：11 项 E2E + 额外导出 1 项，2 项 MySQL 并发测试，监控部署、非 root 和内网服务约束，以及非空导出/迁移产物存在时重复 seed。
- 最终权限复核补齐任务广场与个人作答列表过滤，新增拒绝授权前后对照测试；API 293 项通过。E2E 触发范围扩展到全部共享包。

## 合并后结项

2026-11-03，PR #145 合并为 `a793e5c5d7171db4073be8f8e6bab71d675e9570`，
被替代的 #137–142 全部关闭并保留来源分支。

- [API 与依赖审计](https://github.com/peilinpeng/labelhub/actions/runs/41550975141)、
  [共享包/Web](https://github.com/peilinpeng/labelhub/actions/runs/41550975072)、
  [完整容器/E2E/监控](https://github.com/peilinpeng/labelhub/actions/runs/41550975096)、
  [Pages](https://github.com/peilinpeng/labelhub/actions/runs/41550975261) 均成功。
- 线上三角色登录、深链接刷新、治理桌面与 390px 窄屏、Worker、运行追踪通过，页面和控制台无异常。
- 本轮临时静态服务器与监控凭据已清理，隔离测试未遗留容器、数据卷或网络；原有用户服务和数据未重置。
- 仓库内监控方案已按用户确认部署验证，外部生产接入与通知渠道不在本轮范围。
