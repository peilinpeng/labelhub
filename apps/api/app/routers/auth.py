# 鉴权路由：提供 POST /api/v1/auth/login 公开登录接口（无需鉴权）。
# 验证邮箱 + 密码，账号状态正常时返回 JWT Token 和 Actor 信息。
# 安全要求：邮箱不存在与密码错误统一返回 401，禁止区分（防止用户枚举攻击）。
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
import jwt
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.passwords import DUMMY_PASSWORD_HASH, verify_password_and_update
from app.middleware.error_handler import (
    RateLimitExceededException,
    UnauthorizedException,
)
from app.security import login_rate_limiter

# ---------------------------------------------------------------------------
# JWT 生成工具
# ---------------------------------------------------------------------------

def create_access_token(user_id: str, role: str, display_name: str) -> str:
    """
    生成 HS256 签名的 JWT Token。
    payload 字段与 AuthMiddleware._parse_actor 完全对齐：sub / role / display_name。
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,               # actorId，格式 usr_xxx（契约 §3 Actor.id）
        "role": role,                 # 契约 §3 Role：OWNER / LABELER / REVIEWER / SYSTEM / ADMIN
        "display_name": display_name, # 契约 §3 Actor.displayName
        "iat": now,
        "exp": now + timedelta(
            minutes=settings.JWT_ACCESS_TOKEN_EXPIRE_MINUTES
        ),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


# ---------------------------------------------------------------------------
# Pydantic 请求 / 响应 Schema
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=1024)


class ActorResponse(BaseModel):
    id: str
    role: str
    displayName: str  # camelCase，与契约 §3 Actor.displayName 对齐


class LoginResponse(BaseModel):
    token: str
    actor: ActorResponse


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(
    body: LoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LoginResponse:
    """
    POST /api/v1/auth/login — 邮箱密码登录，公开接口无需鉴权。

    失败场景：
    - 邮箱不存在 → 401 PERMISSION_DENIED（不区分"用户不存在"和"密码错误"，防枚举）
    - 密码错误   → 401 PERMISSION_DENIED
    - status 非 ACTIVE → 401 PERMISSION_DENIED，message 说明账号状态
    """
    client_ip = request.client.host if request.client is not None else "unknown"
    rate_state = login_rate_limiter.state(client_ip, body.email)
    if rate_state.blocked:
        raise RateLimitExceededException(
            "登录失败次数过多，请稍后重试",
            details={"retryAfterSeconds": rate_state.retry_after_seconds},
            headers={"Retry-After": str(rate_state.retry_after_seconds)},
        )

    user: User | None = db.query(User).filter(User.email == body.email).first()
    updated_hash: str | None = None

    if user is None:
        # 与真实账号一样执行密码哈希验证，降低通过响应耗时枚举邮箱的风险。
        verify_password_and_update(body.password, DUMMY_PASSWORD_HASH)
        password_valid = False
    else:
        password_valid, updated_hash = verify_password_and_update(
            body.password,
            user.hashed_password,
        )

    # 邮箱不存在或密码错误：统一返回 401，禁止区分两种失败原因（防用户枚举）
    if user is None or not password_valid:
        failure_state = login_rate_limiter.record_failure(client_ip, body.email)
        if failure_state.blocked:
            raise RateLimitExceededException(
                "登录失败次数过多，请稍后重试",
                details={"retryAfterSeconds": failure_state.retry_after_seconds},
                headers={"Retry-After": str(failure_state.retry_after_seconds)},
            )
        raise UnauthorizedException("邮箱或密码不正确")

    # 账号状态检查：只允许 ACTIVE 账号登录
    if user.status != "ACTIVE":
        login_rate_limiter.record_failure(client_ip, body.email)
        raise UnauthorizedException(f"账号当前状态为 {user.status}，无法登录")

    # 仅在账号可登录且密码已验证后持久化新哈希。旧 bcrypt 与过时 Argon2 参数都会
    # 由 pwdlib 返回 updated_hash；并发登录即使重复计算，结果也验证同一明文密码。
    if updated_hash is not None:
        user.hashed_password = updated_hash
        db.commit()

    login_rate_limiter.reset(client_ip, body.email)
    token = create_access_token(user.id, user.role, user.display_name)
    return LoginResponse(
        token=token,
        actor=ActorResponse(
            id=user.id,
            role=user.role,
            displayName=user.display_name,
        ),
    )
