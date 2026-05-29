"""
LabelHub 数据库测试数据 Seeder。
运行：cd labelhub/apps/api && python scripts/seed.py
功能：创建4个测试账号（OWNER/LABELER/REVIEWER/ADMIN），输出 JWT Token。
幂等：已存在的账号跳过创建，仍输出 Token，方便重复运行刷新 Token。
"""
# sys.path 修正：脚本独立运行，需要能 import app.*
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uuid
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import jwt
from dotenv import load_dotenv

# 必须在 import app.* 之前加载 .env，否则 settings 会因缺少环境变量而报错
load_dotenv()

from app.config import settings
from app.database import SessionLocal
from app.models.user import User

# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Seed 脚本生成的 token 有效期 30 天（方便 Postman 测试，不影响生产）
_TOKEN_EXPIRE_DAYS = 30

# 测试账号定义（契约 §3 Role）
_SEED_USERS = [
    {"role": "OWNER",    "email": "owner@labelhub.test",    "display_name": "测试 Owner"},
    {"role": "LABELER",  "email": "labeler@labelhub.test",  "display_name": "测试 Labeler"},
    {"role": "REVIEWER", "email": "reviewer@labelhub.test", "display_name": "测试 Reviewer"},
    {"role": "ADMIN",    "email": "admin@labelhub.test",    "display_name": "测试 Admin"},
]

# 所有测试账号共用同一密码
_SEED_PASSWORD = "Seed@1234"


def _gen_id() -> str:
    """生成符合契约 §3 Actor.id 规范的 usr_ 前缀 ID。"""
    return f"usr_{uuid.uuid4().hex}"


def _create_token(user_id: str, role: str, display_name: str) -> str:
    """
    生成 HS256 JWT Token，有效期 30 天。
    payload 字段与 AuthMiddleware._parse_actor 完全对齐：sub / role / display_name。
    JWT_SECRET 从 settings 读取，禁止硬编码。
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "role": role,
        "display_name": display_name,
        "iat": now,
        "exp": now + timedelta(days=_TOKEN_EXPIRE_DAYS),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


# ---------------------------------------------------------------------------
# 主函数
# ---------------------------------------------------------------------------

def main() -> None:
    db = SessionLocal()
    try:
        print("=" * 60)
        print("LabelHub Seeder — 测试账号")
        print("=" * 60)

        for spec in _SEED_USERS:
            # 幂等保证：以 email 为唯一键检查是否已存在
            existing: User | None = db.query(User).filter(
                User.email == spec["email"]
            ).first()

            if existing is None:
                # 首次运行：创建账号
                user = User(
                    id=_gen_id(),
                    email=spec["email"],
                    hashed_password=_pwd_context.hash(_SEED_PASSWORD),
                    display_name=spec["display_name"],
                    role=spec["role"],
                    status="ACTIVE",
                )
                db.add(user)
                db.commit()
                db.refresh(user)
                action = "✅ 已创建"
            else:
                # 已存在：跳过创建，仍输出 Token
                user = existing
                action = "⏭️  已跳过（已存在）"

            token = _create_token(user.id, user.role, user.display_name)

            print(f"\n[{user.role}] {user.email}  {action}")
            print(f"  User ID  : {user.id}")
            print(f"  Password : {_SEED_PASSWORD}")
            print(f"  JWT Token（有效 {_TOKEN_EXPIRE_DAYS} 天）:")
            print(f"    {token}")

        print("\n" + "=" * 60)
        print("Seed 完成。请将上面的 Token 配置到 Postman 的 Bearer Token 中。")
        print("=" * 60)
    finally:
        db.close()


if __name__ == "__main__":
    main()
