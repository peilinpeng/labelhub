# 全局错误处理中间件：将业务异常（状态迁移冲突、权限拒绝、资源未找到等）
# 统一映射为契约 ApiError 结构（code/message/details/traceId）的 JSON 响应。
# HTTP 状态码约定：409→INVALID_STATE_TRANSITION/IDEMPOTENCY_CONFLICT，
# 403→PERMISSION_DENIED，404→RESOURCE_NOT_FOUND，422→VALIDATION_FAILED。
