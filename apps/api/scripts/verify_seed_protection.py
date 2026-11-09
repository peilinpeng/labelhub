"""在隔离验收库验证旧初始化入口默认拒绝，逐表内容保持不变。"""
import importlib
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import inspect, text
from app.database import engine
from scripts.seed_guard import SeedRefused


def snapshot():
    result = {}
    with engine.connect() as connection:
        quote = connection.dialect.identifier_preparer.quote
        for table in inspect(connection).get_table_names():
            rows = connection.execute(text(f'SELECT * FROM {quote(table)}')).mappings()
            result[table] = sorted(json.dumps(dict(row), sort_keys=True, default=str) for row in rows)
    return result


def main():
    before = snapshot()
    if not before.get('users'):
        raise RuntimeError('保护验收需要先在隔离库初始化数据，空库不能证明拒绝重置。')
    os.environ['LABELHUB_SEED_MODE'] = 'initialize'
    for module, args in [('seed', []), ('seed_demo', []), ('seed_e2e', []),
                         ('seed_competition', []), ('seed_demo_pipeline', []), ('clean_demo', ['--apply'])]:
        sys.argv = [module, *args]
        try:
            importlib.import_module(f'scripts.{module}').main()
        except SeedRefused as exc:
            if not str(exc).startswith(('数据库已有数据', '重复播种需要')):
                raise
        else:
            raise RuntimeError(f'{module} 未拒绝已有数据。')
        if snapshot() != before:
            raise RuntimeError(f'{module} 拒绝后数据发生变化。')
        print(f'{module}：拒绝写入，所有表逐行一致。')


if __name__ == '__main__':
    main()
