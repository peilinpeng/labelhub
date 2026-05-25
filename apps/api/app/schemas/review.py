# AI 审核与人工审核相关 Pydantic 模型，对齐契约第 19 节人工审核与第 20 节 AI Review Agent。
# 包含：ReviewCommand、ReviewDecisionRequest/Response、BatchReviewRequest/Response、
# ReviewDetailResponse、EnqueueAIReviewRequest/Response、AIReviewJobSummary。
# 决策限制：AI_PRECHECK 只允许 PASS/RETURN/NEED_HUMAN_REVIEW；
#   HUMAN_REVIEW/FINAL_REVIEW 只允许 PASS/RETURN/REJECT。
# 人工 Reviewer 禁止提交 NEED_HUMAN_REVIEW。
