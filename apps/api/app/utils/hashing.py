"""
canonical-json-v1 + SHA-256 哈希工具。

必须与前端 `apps/web/src/mocks/hash-utils.ts`（依赖 `@labelhub/schema-core` 的
`stableStringify`）逐字节一致，否则 finalAnswerHash / beforeAnswerHash /
passportBatchHash / promptSnapshotHash / outputHash 前后端对不上。

前端 stableStringify 语义（packages/schema-core/src/stable-hash.ts）：
  - 对象 key 递归升序排序，再 JSON.stringify（无空格）
  - 对象中值为 undefined 的 key 删除；数组中 undefined → null
  - Date → ISO string；BigInt/function/Symbol/循环引用 抛错
等价 Python：json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
（Python dict 无 undefined；None → null，与前端一致。已用前端测试向量校验。）
"""
import hashlib
import json
from typing import Any

# 契约 DataQualityPassportAnswerHashAlgorithm
ANSWER_HASH_ALGORITHM = "canonical-json-v1+SHA-256"


def stable_stringify(value: Any) -> str:
    """对齐前端 stableStringify：key 升序、无多余空格、非 ASCII 不转义。"""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hash_canonical_json(value: Any) -> str:
    """canonical-json-v1 + SHA-256，输出小写 hex。"""
    return hashlib.sha256(stable_stringify(value).encode("utf-8")).hexdigest()


def sha256_hex(text: str) -> str:
    """对纯字符串做 SHA-256（小写 hex）。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()
