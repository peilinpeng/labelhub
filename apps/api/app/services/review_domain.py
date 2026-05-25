# Review 领域服务：AI 审核结果接收与状态迁移（aiReviewPass/aiReviewReturn/aiReviewNeedHuman/aiReviewFailedToHuman）、
# 人工审核状态迁移（claimReview/humanReviewPass/humanReviewReturn/humanReviewReject）、
# 终审状态迁移（finalReviewPass/finalReviewReturn/finalReviewReject）、
# ReviewPatch 校验（不得绕过 schema validation）、批量审核（逐条写 audit log）。
# Reviewer patches 不直接覆盖 Submission.answers，保存为 review_results。
