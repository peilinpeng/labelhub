# 我的开发上下文

> 文档定位：历史记录：正文中的分支、测试数量、待办和命令仅反映当时阶段，不作为当前操作指引。当前能力与验证见 [项目状态](docs/PROJECT_STATUS.md)；运行命令见 [部署说明](docs/deployment.md)。

## 读我之前先读这两个文件
- labelhub-architecture-contract.md v1.1
- AI_CODING_RULES.md

## 我的职责
后端负责人，负责 apps/api/ 全部内容。

## 技术栈
Python 3.11 + FastAPI + SQLAlchemy + Celery + Redis + MySQL

## 我的文件边界
只能修改：apps/api/
不能动：apps/web/、packages/contracts/、labelhub-architecture-contract.md

## 当时阶段
搭建后端基础框架。当前任务范围由用户请求和 AGENTS 决定，最新实现见 PROJECT_STATUS。
