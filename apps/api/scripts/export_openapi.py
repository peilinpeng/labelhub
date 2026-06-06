"""
导出 OpenAPI schema 到 apps/api/openapi.json，供 Postman / Apifox 导入（API 契约文档交付项）。

运行：cd labelhub/apps/api && python scripts/export_openapi.py

实现要点（CI 友好）：
  - 不调用运行中的服务（CI 无运行中的 server），直接在内存中调用 app.openapi()。
  - 导入 app 前注入安全的默认环境变量，使 settings 可加载，无需真实 DB/密钥。
"""
import sys
import os
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 导入 app 之前注入占位环境变量（settings 在 import 时即校验必填项）。
# 仅用于生成静态 schema，不建立任何真实连接。
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "openapi-export-dummy")
os.environ.setdefault("DOUBAO_API_KEY", "dummy")
os.environ.setdefault("DOUBAO_BASE_URL", "http://localhost/v1")
os.environ.setdefault("DOUBAO_MODEL", "dummy-model")

from main import app  # noqa: E402


def main() -> None:
    schema = app.openapi()
    out_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "openapi.json"
    )
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, ensure_ascii=False, indent=2)
    print(f"✅ OpenAPI schema 已导出：{out_path}")
    print(f"   路径数量：{len(schema.get('paths', {}))}")
    print(f"   OpenAPI 版本：{schema.get('openapi')}")


if __name__ == "__main__":
    main()
