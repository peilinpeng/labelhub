# Submission 相关 Pydantic 模型，对齐契约第 6.3 节 Submission 与第 23.3 节提交接口。
# SubmissionStatus 取值：SUBMITTED | AI_REVIEWING | AI_PASSED | NEEDS_HUMAN_REVIEW |
#   HUMAN_REVIEWING | FINAL_REVIEWING | RETURNED | ACCEPTED | REJECTED。
# answers 只能包含可提交的 FieldNode.name，不得包含 ShowItem/Container/LLMAssist 节点。
