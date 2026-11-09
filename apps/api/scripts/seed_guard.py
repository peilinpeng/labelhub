"""初始化保护：已有数据默认只读，重复播种必须在空库阶段登记为可丢弃测试库。"""
from contextlib import contextmanager
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Column, MetaData, String, Table, inspect, select, text
from sqlalchemy.exc import SQLAlchemyError

from app.security import require_demo_mode
from app.utils.hashing import hash_canonical_json

_marker = Table(
    "_labelhub_disposable_seed", MetaData(),
    Column("id", String(16), primary_key=True),
    Column("identity", String(64), nullable=False),
)


class SeedRefused(RuntimeError):
    pass


def identity(connection) -> str:
    if connection.dialect.name == "mysql":
        value = list(connection.execute(text("SELECT @@server_uuid, DATABASE()")).one())
    elif connection.dialect.name == "sqlite":
        value = [list(row) for row in connection.execute(text("PRAGMA database_list")).all()]
    else:
        raise SeedRefused("初始化保护不支持此数据库，已拒绝写入。")
    return hash_canonical_json(value)


def authorize(connection, mode: str) -> None:
    if mode not in {"initialize", "disposable"}:
        raise SeedRefused("LABELHUB_SEED_MODE 只允许 initialize 或 disposable。")
    tables = inspect(connection).get_table_names()
    if _marker.name in tables:
        rows = connection.execute(select(_marker)).all()
        if mode != "disposable" or rows != [("v1", identity(connection))]:
            raise SeedRefused("重复播种需要显式 disposable 模式及与当前数据库匹配的测试库标记。")
        return
    # 不只检查演示任务；账号、审计、非演示业务和未知表也必须保护。
    quote = connection.dialect.identifier_preparer.quote
    for table in tables:
        if table != "alembic_version" and connection.execute(
            text(f"SELECT 1 FROM {quote(table)} LIMIT 1")
        ).first():
            raise SeedRefused("数据库已有数据，拒绝初始化或重置；请使用全新的隔离测试库。")
    if mode == "disposable":
        # 仅空库可以登记；此运维表不属于产品迁移，不在持久业务库创建。
        _marker.create(connection)
        connection.execute(_marker.insert().values(id="v1", identity=identity(connection)))
        connection.commit()


@contextmanager
def guarded_seed_session(factory, *, readonly: bool = False):
    require_demo_mode("数据初始化/演示清理")
    with factory() as session:
        if readonly:
            yield session
            return
        # 使用独立连接持有 MySQL 命名锁，脚本内部 commit 不会提前释放。
        with session.get_bind().connect() as connection:
            locked = False
            try:
                if connection.dialect.name == "mysql":
                    locked = connection.execute(text("SELECT GET_LOCK('labelhub_seed_guard', 0)")).scalar() == 1
                    if not locked:
                        raise SeedRefused("另一个初始化正在执行，已拒绝并发初始化。")
                authorize(connection, os.environ.get("LABELHUB_SEED_MODE", "initialize"))
                yield session
            except SQLAlchemyError:
                # 驱动异常可能包含连接信息或参数，不向终端输出原始异常。
                raise SeedRefused("初始化保护或写入失败；请检查数据库及私有日志，未自动重试。") from None
            finally:
                if locked:
                    connection.execute(text("SELECT RELEASE_LOCK('labelhub_seed_guard')"))


if __name__ == "__main__":
    from app.database import SessionLocal
    try:
        with guarded_seed_session(SessionLocal):
            print("初始化目标校验通过。")
    except (SeedRefused, RuntimeError) as exc:
        sys.exit(str(exc))
