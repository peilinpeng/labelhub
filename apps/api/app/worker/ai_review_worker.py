# AI 审核异步 Worker：消费 ai_review 队列，执行以下流程：
# 1. 拉取 AIReviewJobPayload（含 schemaSnapshot、item、submission、reviewConfig、promptSnapshot）。
# 2. 渲染 Prompt（promptTemplate + RuntimeContext 变量替换）。
# 3. 调用豆包 / OpenAI 兼容 LLM（结构化输出，responseFormat=JSON_SCHEMA/FUNCTION_CALLING）。
# 4. 解析 AIReviewResult（decision/totalScore/dimensionScores/fieldIssues/summary/confidence）。
# 5. 写入 review_results 和 llm_call_logs（purpose=AI_REVIEW）。
# 6. 触发状态迁移（aiReviewPass/aiReviewReturn/aiReviewNeedHuman）。
# 7. 失败重试（最多 maxRetries 次），耗尽后执行 aiReviewFailedToHuman，迁移至 NEEDS_HUMAN_REVIEW。
# AI Review 永远不能直接修改 answers。
