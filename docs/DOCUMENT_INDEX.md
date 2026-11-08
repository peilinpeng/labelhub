# LabelHub 文档索引

> 本文件是文档导航入口，只做归类与指引，不复述各文档的深度内容。
> 所有条目均为仓库中真实存在的文件。深度设计请直接阅读对应文档。

## 1. 快速入口

- [docs/PROJECT_STATUS.md](PROJECT_STATUS.md)：当前主线、维护进展、带日期验证快照和能力边界。
- [README.md](../README.md)：项目总览、架构、启动和模块。
- [submission/README.md](../submission/README.md)：答辩提交物索引（对照课题 §八）。
- [docs/LabelHub_Final_Delivery.md](LabelHub_Final_Delivery.md)：最终交付说明（稳定状态、交付范围、验收点、已知边界）。
- [docs/LabelHub_Delivery_Runbook.md](LabelHub_Delivery_Runbook.md)：本地运行与现场演示手册。
- [docs/environment-variables.md](environment-variables.md)：统一环境变量、默认值与敏感等级清单。
- [docs/LabelHub_Optimization_Plan.md](LabelHub_Optimization_Plan.md)：基于 2026-07-31 起的历史优化计划与完成记录，不代表当前待办。

## 2. 演示与 QA

- [docs/LabelHub_Final_Demo_Guide.md](LabelHub_Final_Demo_Guide.md)：2026-06-10 Mock 演示脚本（历史快照）。
- [docs/LabelHub_Demo_Guide.md](LabelHub_Demo_Guide.md)：真实后端全链路录屏剧本。
- [docs/test-cases.md](test-cases.md)：测试用例。
- [docs/dataset-test-scenario-plan.md](dataset-test-scenario-plan.md)：数据集测试场景计划。

- [AI 固定工作流质量改进](AI_WORKFLOW_QUALITY.md)：结构化输入、服务端校验、审核路由与评测基线。

## 3. 核心技术设计

- [labelhub-architecture-contract.md](../labelhub-architecture-contract.md)：最高架构契约（v1.1）。
- [docs/labelhub_schema_runtime_engine.md](labelhub_schema_runtime_engine.md)：Schema Runtime Engine。
- [docs/LabelHub_Schema_Version_Management.md](LabelHub_Schema_Version_Management.md)：Schema 版本管理实施规格。
- [docs/Labelhub_Quality_Layer.md](Labelhub_Quality_Layer.md)：质量治理层。
- [docs/FORMILY_ARCH_DECISIONS.md](FORMILY_ARCH_DECISIONS.md)：Formily / Schema Runtime v2 架构决策记录。

## 4. AI Coding 与开发过程

- [AI_CODING_RULES.md](../AI_CODING_RULES.md)：AI Coding 统一规则（contract-driven、禁止事项、验证要求）。
- [docs/AI_CODING_PROCESS.md](AI_CODING_PROCESS.md)：AI Coding 过程与开发记录（开发阶段 / 工具使用 / 关键迭代 / 验证方式）。

## 5. 运行 / 部署 / 协作参考

- [docs/deployment.md](deployment.md)：本地与云部署说明。
- [docs/WINDOWS_DEVELOPMENT.md](WINDOWS_DEVELOPMENT.md)：Windows 工具链、WSL2 Docker 容量保护、隔离验收与备份边界。
- [docs/git-workflow.md](git-workflow.md)：早期协作流程归档；当前分支策略以 AGENTS / CONTRIBUTING 为准。
- [CONTRIBUTING.md](../CONTRIBUTING.md)：贡献指南。

## 6. 历史计划

> 反映特定阶段的上下文，作为历史记录保留；阅读时请以 PROJECT_STATUS 中的当前状态为准。

- [docs/optimization-checklist.md](optimization-checklist.md)：2026-06-07 课题验收阶段优化清单。
- [docs/backend-optimization-plan.md](backend-optimization-plan.md)：早期后端接口补齐与测试建设计划。
- [docs/final-iteration-plan.md](final-iteration-plan.md)：最终迭代计划。
- [docs/LabelHub_Final_Delivery.md](LabelHub_Final_Delivery.md)：2026-06-10 答辩交付快照；启动命令以当前运行手册为准。

## 7. 阅读建议

- 评委 / 第一次看项目：README → PROJECT_STATUS → GOVERNANCE → Delivery Runbook。
- 本地复现：README → Delivery Runbook → deployment.md。
- 技术评审：Architecture Contract → Schema Runtime Engine → Schema Version Management → Quality Layer。
- 接手开发：AGENTS → PROJECT_STATUS → AI_CODING_RULES → CONTRIBUTING；历史流程与稳定规则冲突时以 AGENTS 为准。

## 8. 本地维护与文档治理

- [LOCAL_STORAGE_MAINTENANCE.md](LOCAL_STORAGE_MAINTENANCE.md)：容量门禁、备份转存、完整回读、恢复演练与保留策略。
- [LOCAL_DOCKER_RECOVERY.md](LOCAL_DOCKER_RECOVERY.md)：2026-11-03 故障恢复记录。
- [document-policy.json](document-policy.json)：全部 Git 管理 Markdown 的定位清单，由 `npm run check:docs` 检查遗漏、链接与关键陈旧描述。

当前状态与测试证据统一引用 PROJECT_STATUS；历史文件保留当时数字与结论，但顶部明确标识。设计文档的目标态不自动构成已交付能力，也不自动成为当前待办。
