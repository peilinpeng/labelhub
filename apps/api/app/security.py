"""运行时安全组件：登录限流、安全响应头与 Demo 模式保护。"""

from __future__ import annotations

import hashlib
import threading
import time
from dataclasses import dataclass

from redis import Redis
from redis.exceptions import RedisError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.config import settings


@dataclass(frozen=True)
class RateLimitState:
    blocked: bool
    retry_after_seconds: int


class LoginRateLimiter:
    """按 IP + 邮箱限制连续失败登录；生产环境使用 Redis 共享计数。"""

    def __init__(self) -> None:
        self._memory: dict[str, tuple[int, float]] = {}
        self._lock = threading.Lock()
        self._redis: Redis | None = None
        if settings.LOGIN_RATE_LIMIT_BACKEND == "redis":
            self._redis = Redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )

    @staticmethod
    def _key(client_ip: str, email: str) -> str:
        identity = f"{client_ip.strip()}:{email.strip().lower()}".encode()
        digest = hashlib.sha256(identity).hexdigest()
        return f"labelhub:login-failures:{digest}"

    def state(self, client_ip: str, email: str) -> RateLimitState:
        key = self._key(client_ip, email)
        if self._redis is not None:
            try:
                count_raw = self._redis.get(key)
                count = int(count_raw) if count_raw is not None else 0
                ttl = self._redis.ttl(key)
                return RateLimitState(
                    blocked=count >= settings.LOGIN_RATE_LIMIT_ATTEMPTS,
                    retry_after_seconds=max(ttl, 1) if ttl > 0 else 1,
                )
            except RedisError:
                # Redis 短暂不可用时仍使用进程内计数，避免完全失去暴力破解保护。
                pass
        return self._memory_state(key)

    def record_failure(self, client_ip: str, email: str) -> RateLimitState:
        key = self._key(client_ip, email)
        if self._redis is not None:
            try:
                pipeline = self._redis.pipeline()
                pipeline.incr(key)
                pipeline.ttl(key)
                count, ttl = pipeline.execute()
                if int(count) == 1 or int(ttl) < 0:
                    self._redis.expire(
                        key, settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
                    )
                    ttl = settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
                return RateLimitState(
                    blocked=int(count) >= settings.LOGIN_RATE_LIMIT_ATTEMPTS,
                    retry_after_seconds=max(int(ttl), 1),
                )
            except RedisError:
                pass
        return self._memory_record_failure(key)

    def reset(self, client_ip: str, email: str) -> None:
        key = self._key(client_ip, email)
        if self._redis is not None:
            try:
                self._redis.delete(key)
            except RedisError:
                pass
        with self._lock:
            self._memory.pop(key, None)

    def reset_all_for_tests(self) -> None:
        """仅供隔离自动化测试中的进程内计数。"""
        with self._lock:
            self._memory.clear()

    def _memory_state(self, key: str) -> RateLimitState:
        now = time.monotonic()
        with self._lock:
            count, expires_at = self._memory.get(key, (0, 0.0))
            if expires_at <= now:
                self._memory.pop(key, None)
                return RateLimitState(False, 1)
            return RateLimitState(
                blocked=count >= settings.LOGIN_RATE_LIMIT_ATTEMPTS,
                retry_after_seconds=max(int(expires_at - now), 1),
            )

    def _memory_record_failure(self, key: str) -> RateLimitState:
        now = time.monotonic()
        with self._lock:
            count, expires_at = self._memory.get(
                key, (0, now + settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS)
            )
            if expires_at <= now:
                count = 0
                expires_at = now + settings.LOGIN_RATE_LIMIT_WINDOW_SECONDS
            count += 1
            self._memory[key] = (count, expires_at)
            return RateLimitState(
                blocked=count >= settings.LOGIN_RATE_LIMIT_ATTEMPTS,
                retry_after_seconds=max(int(expires_at - now), 1),
            )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """为 API 的所有响应补齐基础浏览器安全头。"""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'"
        )
        if settings.APP_ENV == "production" or settings.ENABLE_HSTS:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


login_rate_limiter = LoginRateLimiter()


def require_demo_mode(operation: str) -> None:
    """演示数据写入只能在显式 Demo 模式运行，生产环境始终拒绝。"""
    if settings.APP_ENV == "production" or not settings.DEMO_MODE:
        raise RuntimeError(f"{operation} 仅允许在 DEMO_MODE=true 的非生产环境执行")
