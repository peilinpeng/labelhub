# 治理与运行诊断交付计划

日期：2026-11-02。分支：`feat/complete-governance-runtime`。范围来自本轮全部待办完成请求。

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

实施后逐批填写；计划不代表已交付。

## 当前验证进度

- 依赖批次 `e890f6e`：6 个目标升级已整合；Vitest / coverage 5.0.5、React Router 8.5.1，安装前检查两棵锁。
- 契约批次 `cd671f0`：独立定义新增端点、状态与权限，先通过 contracts typecheck/test。
- 本地最新验证：API 291 passed、共享包 380 passed、Web 60 passed；类型检查、生产构建与三份依赖审计通过。
  Web coverage 66.48% statements / 54.84% branches / 67.40% functions / 70.02% lines。
- 本机磁盘不足曾导致 Docker 镜像存储 I/O 错误；清理可重建下载缓存后空间恢复，但镜像存储仍异常。
  完整 Docker、MySQL、监控和真实浏览器验收转交本 PR 的 GitHub Actions 全新隔离 runner，结果待补齐。
- 新增真实回归覆盖独立审批、原答卷不变、后台执行和运行诊断，并校验存在迁移产物时可重复 seed。
