# JWT 鉴权中间件：解析 Authorization: Bearer <token>，使用 JWT_SECRET 验证签名与过期时间，
# 从 payload 提取 actorId、role、displayName，注入 Actor 对象到请求 state 供后续路由使用。
# 未携带或无效 token 时软失败（actor = None），由路由层通过 Depends 决定是否强制要求鉴权。
from dataclasses import dataclass

from jose import jwt, JWTError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from fastapi import Depends

from app.config import settings
from app.middleware.error_handler import UnauthorizedException, PermissionDeniedException


# ---------------------------------------------------------------------------
# Actor 数据类（契约 §3 Actor）
# ---------------------------------------------------------------------------

@dataclass
class Actor:
    """已认证用户的身份信息，由 AuthMiddleware 从 JWT payload 提取。"""
    id: str           # 契约 §3 Actor.id，格式 usr_xxx
    role: str         # 契约 §3 Role：OWNER / LABELER / REVIEWER / SYSTEM / ADMIN
    display_name: str # 契约 §3 Actor.displayName


# ---------------------------------------------------------------------------
# AuthMiddleware（Starlette BaseHTTPMiddleware）
# ---------------------------------------------------------------------------

class AuthMiddleware(BaseHTTPMiddleware):
    """
    JWT 鉴权中间件，软失败模式：
    - token 有效 → request.state.actor = Actor(...)
    - token 缺失或非法 → request.state.actor = None
    无论结果如何，始终调用 call_next 继续处理；路由层通过 get_current_actor Depends 决定是否拒绝。
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request.state.actor = self._parse_actor(request)
        return await call_next(request)

    @staticmethod
    def _parse_actor(request: Request) -> Actor | None:
        """
        尝试从 Authorization 请求头解析 JWT，返回 Actor 或 None。
        任何错误（格式错误、签名非法、token 过期、payload 字段缺失）均静默返回 None。
        """
        authorization: str = request.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            return None

        token = authorization[len("Bearer "):]
        try:
            payload: dict = jwt.decode(
                token,
                settings.JWT_SECRET,
                algorithms=["HS256"],
            )
            return Actor(
                id=payload["sub"],
                role=payload["role"],
                display_name=payload["display_name"],
            )
        except (JWTError, KeyError):
            # JWTError：签名非法、token 过期、格式错误等
            # KeyError：payload 缺少必要字段
            return None


# ---------------------------------------------------------------------------
# FastAPI 依赖：get_current_actor
# ---------------------------------------------------------------------------

def get_current_actor(request: Request) -> Actor:
    """
    FastAPI Depends：读取 request.state.actor。
    actor 为 None（未认证）时抛出 401 UnauthorizedException。
    用法：actor: Actor = Depends(get_current_actor)
    """
    actor = getattr(request.state, "actor", None)
    if actor is None:
        raise UnauthorizedException("未提供有效的认证 token")
    return actor


# ---------------------------------------------------------------------------
# FastAPI 依赖工厂：require_roles
# ---------------------------------------------------------------------------

def require_roles(*roles: str):
    """
    角色访问控制依赖工厂，用法：Depends(require_roles("OWNER", "ADMIN"))。
    - 未认证 → 401（由 get_current_actor 抛出）
    - 角色不在 roles 列表中 → 403 PermissionDeniedException
    - 角色合法 → 返回 Actor 供路由使用
    """
    def _check(actor: Actor = Depends(get_current_actor)) -> Actor:
        if actor.role not in roles:
            raise PermissionDeniedException(
                f"当前角色 {actor.role} 无权访问，需要 {list(roles)} 之一"
            )
        return actor

    return _check
