# File 领域服务：上传 URL 生成（预签名 URL 或本地路径）、文件确认（status→READY）、
# 权限校验（fileId 必须属于当前用户或当前 assignment）、文件删除（status→DELETED，不物理删除引用）。
# Dataset import 只允许 purpose=DATASET_IMPORT 且 status=READY 的文件。
# Export download 只允许 purpose=EXPORT_RESULT 且 status=READY 的文件。
