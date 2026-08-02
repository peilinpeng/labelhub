"""容器健康探针：不输出凭据，只验证进程依赖的真实服务是否可用。"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

# 直接执行 scripts/container_healthcheck.py 时，Python 只把 scripts/ 加入
# sys.path；显式补上应用根目录，确保本地与精简容器镜像行为一致。
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from redis import Redis
from sqlalchemy import text

from app.config import settings
from app.database import engine


def check_database() -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def check_redis() -> None:
    client = Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
    try:
        if client.ping() is not True:
            raise RuntimeError("Redis ping 未返回成功")
    finally:
        client.close()


def check_api() -> None:
    with urllib.request.urlopen("http://127.0.0.1:3000/api/v1/health", timeout=2) as response:
        if response.status != 200:
            raise RuntimeError(f"API health 返回 {response.status}")


def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else "api"
    if target == "api":
        check_api()
        check_database()
        check_redis()
    elif target in {"worker", "scheduler"}:
        check_database()
        check_redis()
    else:
        raise ValueError(f"未知健康检查目标：{target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
