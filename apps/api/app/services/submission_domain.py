# Submission 领域服务：提交时使用 schemaVersionId 对 answers 做权威校验（不信任前端）、
# attempt_no 管理（打回重提时递增，不覆盖历史快照）、
# 提交成功后触发 AI 审核入队（enqueueAIReview command）。
# Submission.answers 只能包含 visible/preserve 的 submit-enabled FieldNode。
