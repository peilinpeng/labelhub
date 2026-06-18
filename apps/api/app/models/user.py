# users 表 ORM 模型，对应契约 §3 Actor/Role 与 §24 存储契约。
# role 合法值（契约 §3 Role）：OWNER / LABELER / REVIEWER / SYSTEM / ADMIN
# status 合法值（实现层补充）：ACTIVE / INACTIVE / BANNED
from sqlalchemy import Column, String, DateTime, func

from app.database import Base


class User(Base):
    __tablename__ = "users"

    # ID 由应用层生成，前缀 usr_，不使用数据库自增
    id = Column(String(64), primary_key=True, nullable=False)

    # 登录账号，实现层补充字段，契约 §24 未显式列出
    email = Column(String(255), unique=True, nullable=False)

    # bcrypt 哈希密码，实现层补充字段
    hashed_password = Column(String(255), nullable=False)

    # 契约 Actor.displayName
    display_name = Column(String(255), nullable=False)

    # 契约 Role：OWNER / LABELER / REVIEWER / SYSTEM / ADMIN
    role = Column(String(20), nullable=False)

    # 实现层账号状态：ACTIVE / INACTIVE / BANNED
    status = Column(String(20), nullable=False, default="ACTIVE")

    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
