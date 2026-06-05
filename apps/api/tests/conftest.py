"""
pytest 全局 fixtures。

设计要点（对应 docs/backend-optimization-plan.md D1）：
- 使用 SQLite in-memory（StaticPool 共享单连接），不依赖运行中的 MySQL，CI 可直接运行。
- 在导入任何 app 模块之前注入必需的环境变量（settings 在 import 时即校验）。
- 在导入 main(app) 之前把 app.database 的 engine / SessionLocal 替换为测试引擎，
  确保通过 `from app.database import SessionLocal` 绑定的中间件也使用测试库。
- 每个测试用例前重建全部表，保证隔离。
"""
import os

# ---- 1. 必须在导入 app.* 之前设置环境变量 ----
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("JWT_SECRET", "test_jwt_secret")
os.environ.setdefault("DOUBAO_API_KEY", "test-key")
os.environ.setdefault("DOUBAO_BASE_URL", "http://localhost:9/v1")
os.environ.setdefault("DOUBAO_MODEL", "test-model")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# ---- 2. 替换数据库引擎为 in-memory SQLite（必须在 import main 之前）----
import app.database as database

_test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,  # 单连接共享，保证 in-memory 数据跨 session 可见
)
TestSessionLocal = sessionmaker(bind=_test_engine, autoflush=False, autocommit=False)
database.engine = _test_engine
database.SessionLocal = TestSessionLocal

# ---- 3. 导入全部模型，确保 metadata 完整 ----
from app.database import Base  # noqa: E402
import app.models.user  # noqa: E402,F401
import app.models.task  # noqa: E402,F401
import app.models.schema  # noqa: E402,F401
import app.models.dataset  # noqa: E402,F401
import app.models.assignment  # noqa: E402,F401
import app.models.submission  # noqa: E402,F401
import app.models.review  # noqa: E402,F401
import app.models.audit  # noqa: E402,F401
import app.models.export  # noqa: E402,F401
import app.models.file  # noqa: E402,F401
import app.models.llm  # noqa: E402,F401
import app.models.idempotency  # noqa: E402,F401

# ---- 4. 现在才导入 app（中间件会绑定到已替换的 SessionLocal）----
from fastapi.testclient import TestClient  # noqa: E402
from main import app as fastapi_app  # noqa: E402
from app.database import get_db  # noqa: E402
from app.routers.auth import create_access_token, _pwd_context  # noqa: E402
from app.models.user import User  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_db():
    """每个用例前重建全部表，保证隔离。"""
    Base.metadata.drop_all(bind=_test_engine)
    Base.metadata.create_all(bind=_test_engine)
    yield
    Base.metadata.drop_all(bind=_test_engine)


@pytest.fixture
def db_session():
    """直接操作数据库的 session（用于断言/构造数据）。"""
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client():
    """TestClient，覆盖 get_db 依赖指向测试库。"""
    def _override_get_db():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = _override_get_db
    with TestClient(fastapi_app) as c:
        yield c
    fastapi_app.dependency_overrides.clear()


def _make_user(db, *, role: str, suffix: str) -> User:
    user = User(
        id=f"usr_{role.lower()}_{suffix}",
        email=f"{role.lower()}_{suffix}@test.local",
        hashed_password=_pwd_context.hash("password123"),
        display_name=f"测试 {role}",
        role=role,
        status="ACTIVE",
    )
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def users(db_session):
    """创建 owner / labeler / reviewer 三个角色用户，返回 {role: User}。"""
    return {
        "OWNER": _make_user(db_session, role="OWNER", suffix="1"),
        "LABELER": _make_user(db_session, role="LABELER", suffix="1"),
        "REVIEWER": _make_user(db_session, role="REVIEWER", suffix="1"),
    }


def _auth_header(user: User) -> dict:
    token = create_access_token(user.id, user.role, user.display_name)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def auth(users):
    """返回各角色的 Authorization header：auth['OWNER'] / auth['LABELER'] / auth['REVIEWER']。"""
    return {role: _auth_header(u) for role, u in users.items()}
