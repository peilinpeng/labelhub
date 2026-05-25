# 幂等中间件：拦截所有写接口（POST/PUT/PATCH/DELETE），读取 Idempotency-Key 请求头，
# 以 actorId+method+path+key 为 scope，查询 idempotency_records 表：
#   - 命中且 request body hash 相同：返回缓存的 response snapshot，不重复执行业务逻辑。
#   - 命中且 request body hash 不同：返回 409 IDEMPOTENCY_CONFLICT。
#   - 未命中：执行业务逻辑，记录 response snapshot，expires_at 设为 24 小时后。
