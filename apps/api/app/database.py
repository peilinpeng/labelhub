# 数据库连接初始化：创建 SQLAlchemy Engine 和 SessionLocal，声明 ORM Base 类，
# 提供 get_db 依赖函数供 FastAPI 路由通过依赖注入获取数据库会话。
# engine 仅初始化连接池，不在模块顶层建立真实连接。
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from app.config import settings

_db_url = settings.DATABASE_URL
if _db_url.startswith("mysql://"):
    _db_url = "mysql+pymysql://" + _db_url[len("mysql://"):]
# pool_pre_ping：取连接前先探活，剔除被 MySQL wait_timeout 杀掉的死连接（避免空闲后首次请求 2006 "server has gone away"）
# pool_recycle：连接存活超 1 小时主动重建，始终低于 MySQL 默认 wait_timeout(8h)
engine = create_engine(_db_url, pool_pre_ping=True, pool_recycle=3600)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 所有 ORM 模型通过 from app.database import Base 继承此基类
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    # FastAPI 依赖注入：每次请求分配独立 session，请求结束后确保关闭
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
