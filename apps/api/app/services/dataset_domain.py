# Dataset 领域服务：数据集文件导入（支持 JSON/JSONL/Excel，使用 pandas/openpyxl 解析）、
# externalKey 去重（基于 externalKeyPath 提取）、题目状态维护（AVAILABLE/LOCKED/COMPLETED/DISABLED）。
# 导入时只接受 purpose=DATASET_IMPORT 且 status=READY 的文件。
