# 鉴权路由：提供 POST /api/v1/auth/login 公开登录接口（无需鉴权）。
# 验证邮箱 + 密码，账号状态正常时返回 JWT Token 和 Actor 信息。
# 安全要求：邮箱不存在与密码错误统一返回 401，禁止区分（防止用户枚举攻击）。
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from passlib.context import CryptContext
from jose import jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.middleware.error_handler import UnauthorizedException

# ---------------------------------------------------------------------------
# 密码工具
# ---------------------------------------------------------------------------

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain: str, hashed: str) -> bool:
    """校验明文密码与 bcrypt 哈希是否匹配。"""
    return _pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT 生成工具
# ---------------------------------------------------------------------------

# Token 有效期：7 天（开发环境使用，方便 Postman 测试）
_ACCESS_TOKEN_EXPIRE = timedelta(days=7)


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
        "exp": now + _ACCESS_TOKEN_EXPIRE,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


# ---------------------------------------------------------------------------
# Pydantic 请求 / 响应 Schema
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    email: str
    password: str


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
def login(body: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    """
    POST /api/v1/auth/login — 邮箱密码登录，公开接口无需鉴权。

    失败场景：
    - 邮箱不存在 → 401 PERMISSION_DENIED（不区分"用户不存在"和"密码错误"，防枚举）
    - 密码错误   → 401 PERMISSION_DENIED
    - status 非 ACTIVE → 401 PERMISSION_DENIED，message 说明账号状态
    """
    user: User | None = db.query(User).filter(User.email == body.email).first()

    # 邮箱不存在或密码错误：统一返回 401，禁止区分两种失败原因（防用户枚举）
    if user is None or not verify_password(body.password, user.hashed_password):
        raise UnauthorizedException("邮箱或密码不正确")

    # 账号状态检查：只允许 ACTIVE 账号登录
    if user.status != "ACTIVE":
        raise UnauthorizedException(f"账号当前状态为 {user.status}，无法登录")

    token = create_access_token(user.id, user.role, user.display_name)
    return LoginResponse(
        token=token,
        actor=ActorResponse(
            id=user.id,
            role=user.role,
            displayName=user.display_name,
        ),
    )
