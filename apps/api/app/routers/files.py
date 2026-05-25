# 文件上传路由，对应契约第 22 节与第 23.7 节。
# 端点：POST /files/upload-url、POST /files/:fileId/confirm、
#   GET /files/:fileId、DELETE /files/:fileId。
# 所有写接口必须支持 Idempotency-Key 请求头。
