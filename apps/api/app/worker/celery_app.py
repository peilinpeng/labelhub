# Celery 应用初始化：使用 REDIS_URL 作为 broker 和 result backend，
# 注册 ai_review_worker 和 export_worker 两个任务队列（queues: ai_review, export）。
# Celery Beat 可选配置 expireAssignment 的定时扫描任务。
