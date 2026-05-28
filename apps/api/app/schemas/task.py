# Task 相关 Pydantic 请求/响应模型，对齐契约第 6.1 节 Task 领域模型与第 16 节发布流程。
# 包含：CreateTaskRequest、UpdateTaskRequest、PublishTaskRequest/Response、
# PauseTaskRequest、ResumeTaskRequest、EndTaskRequest、TaskResponse。
# TaskStatus 取值：DRAFT | PUBLISHED | PAUSED | ENDED | ARCHIVED。

from typing import Literal
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# 契约 §13 ServerComponentRegistryItem（组件注册表 API 响应模型）
# ---------------------------------------------------------------------------

class ServerComponentRegistryItem(BaseModel):
    """服务端权威组件注册表条目，对应契约 §13 ServerComponentRegistryItem。"""
    type: str
    # 节点分类：INPUT=文本输入 CHOICE=选择 UPLOAD=上传 DATA=结构化数据
    #          SHOW=展示 AI=AI辅助 LAYOUT=布局容器
    category: Literal["INPUT", "CHOICE", "UPLOAD", "DATA", "SHOW", "AI", "LAYOUT"]
    # 答案值类型：NONE=不产生答案值 STRING=字符串 STRING_ARRAY=字符串数组
    #            FILE_ARRAY=文件引用数组 JSON=任意JSON RICH_TEXT=富文本AST
    valueKind: Literal["NONE", "STRING", "STRING_ARRAY", "FILE_ARRAY", "JSON", "RICH_TEXT"]
    # 后端归一化器 key（格式 normalizers.xxx），供提交校验时调用
    normalizer: str
    # 后端校验器 key 列表（格式 validators.xxx），供 schema validate 时调用
    validators: list[str]
    # 导出时的值类型
    exportValueType: Literal["TEXT", "NUMBER", "BOOLEAN", "JSON", "FILE_URLS"]
    # 允许在此 node type 上使用的 ValidationRule 类型（契约 §15 ValidationRuleType）
    allowedValidationRules: list[
        Literal[
            "required", "minLength", "maxLength", "regex",
            "minItems", "maxItems", "jsonSchema", "file",
            "custom", "conditional",
        ]
    ]
    # 是否默认参与提交（FieldNode=True，ShowItem/Container/LLMAssist=False）
    defaultSubmitEnabled: bool
    # 是否默认参与导出
    defaultExportEnabled: bool
    # 是否默认纳入 AI Review 上下文
    defaultAiReviewEnabled: bool
