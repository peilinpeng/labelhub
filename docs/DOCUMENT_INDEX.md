# LabelHub 文档索引

> 本文件是文档导航入口，只做归类与指引，不复述各文档的深度内容。
> 所有条目均为仓库中真实存在的文件。深度设计请直接阅读对应文档。

## 1. 快速入口

- [README.md](../README.md)：项目总览、架构、启动、模块、完成状态。
- [submission/README.md](../submission/README.md)：答辩提交物索引（对照课题 §八）。
- [docs/LabelHub_Final_Delivery.md](LabelHub_Final_Delivery.md)：最终交付说明（稳定状态、交付范围、验收点、已知边界）。
- [docs/LabelHub_Delivery_Runbook.md](LabelHub_Delivery_Runbook.md)：本地运行与现场演示手册。

## 2. 演示与 QA

- [docs/LabelHub_Final_Demo_Guide.md](LabelHub_Final_Demo_Guide.md)：最终演示脚本。
- [docs/LabelHub_Demo_Guide.md](LabelHub_Demo_Guide.md)：真实后端全链路录屏剧本。
- [docs/test-cases.md](test-cases.md)：测试用例。
- [docs/dataset-test-scenario-plan.md](dataset-test-scenario-plan.md)：数据集测试场景计划。

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
- [docs/git-workflow.md](git-workflow.md)：Git 协作流程。
- [CONTRIBUTING.md](../CONTRIBUTING.md)：贡献指南。
- [docs/optimization-checklist.md](optimization-checklist.md)：优化检查清单。
- [docs/backend-optimization-plan.md](backend-optimization-plan.md)：后端优化计划。

## 6. 历史计划

> 反映特定阶段的上下文，作为历史记录保留；阅读时请以 README 与 Final Delivery 中的当前状态为准。

- [docs/final-iteration-plan.md](final-iteration-plan.md)：最终迭代计划。

## 7. 阅读建议

- 评委 / 第一次看项目：README → Final Delivery → Final Demo Guide。
- 本地复现：README → Delivery Runbook → deployment.md。
- 技术评审：Architecture Contract → Schema Runtime Engine → Schema Version Management → Quality Layer。
- 接手开发：AI_CODING_RULES → git-workflow → CONTRIBUTING。
