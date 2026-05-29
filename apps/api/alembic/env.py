# Alembic 迁移环境配置：从环境变量读取 DATABASE_URL，导入 ORM Base 元数据，
# 支持 offline（生成 SQL 文件）和 online（直接连库执行）两种迁移模式。
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from dotenv import load_dotenv

# 加载 .env 文件（仅本地开发使用；生产环境由容器注入环境变量）
load_dotenv()

# 导入所有 ORM 模型，确保 autogenerate 能感知到全部表结构
import app.models.user  # noqa: F401
import app.models.task  # noqa: F401
import app.models.schema  # noqa: F401
import app.models.dataset  # noqa: F401
import app.models.assignment  # noqa: F401
import app.models.submission  # noqa: F401
import app.models.review  # noqa: F401
import app.models.export  # noqa: F401
import app.models.file  # noqa: F401
import app.models.audit  # noqa: F401
import app.models.llm  # noqa: F401
import app.models.idempotency  # noqa: F401
from app.database import Base

config = context.config

# 用环境变量中的 DATABASE_URL 覆盖 alembic.ini 中的 sqlalchemy.url
config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# autogenerate 依赖此元数据对比现有表结构
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    # offline 模式：不建立真实连接，将迁移 SQL 输出到标准输出或文件
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # online 模式：建立真实数据库连接并直接执行迁移
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
