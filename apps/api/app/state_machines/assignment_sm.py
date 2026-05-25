# Assignment 状态机，对应契约第 18.2 节 Assignment 相关迁移。
# 合法迁移：
#   claimItem: → CLAIMED（同时 DatasetItem → LOCKED）
#   saveDraft: CLAIMED/DRAFTING/RETURNED → DRAFTING
#   submitAssignment: CLAIMED/DRAFTING/RETURNED → SUBMITTED
#   expireAssignment: CLAIMED/DRAFTING → EXPIRED（同时 DatasetItem → AVAILABLE）
#   humanReviewReturn: → RETURNED（DatasetItem 保持 LOCKED）
#   humanReviewPass (SINGLE_REVIEW): → ACCEPTED（DatasetItem → COMPLETED）
#   humanReviewReject: → CANCELED（DatasetItem → DISABLED）
