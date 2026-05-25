# JWT 鉴权中间件：解析 Authorization: Bearer <token>，使用 JWT_SECRET 验证签名与过期时间，
# 从 payload 提取 actorId、role、displayName，注入 Actor 对象到请求 state 供后续路由使用。
# 未携带或无效 token 返回 401 PERMISSION_DENIED。
