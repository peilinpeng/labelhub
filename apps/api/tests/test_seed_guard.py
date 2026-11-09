"""验证初始化保护先于账号更新、任务删除及模型调用执行。"""
import importlib

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from scripts.seed_guard import SeedRefused, _marker, guarded_seed_session


@pytest.fixture
def factory(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'DEMO_MODE', True)
    monkeypatch.setattr(settings, 'APP_ENV', 'test')
    monkeypatch.delenv('LABELHUB_SEED_MODE', raising=False)
    engine = create_engine(f'sqlite:///{tmp_path / "guard.sqlite"}')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE preserved (id INTEGER PRIMARY KEY, payload TEXT)'))
    yield sessionmaker(bind=engine)
    engine.dispose()


def add_data(factory):
    with factory.begin() as session:
        session.execute(text("INSERT INTO preserved VALUES (1, 'original')"))


def test_empty_initialization_then_default_refusal(factory):
    with guarded_seed_session(factory) as session:
        session.execute(text("INSERT INTO preserved VALUES (1, 'original')"))
        session.commit()
    with pytest.raises(SeedRefused, match='已有数据'):
        with guarded_seed_session(factory):
            pytest.fail('不应进入写入区')
    assert _marker.name not in inspect(factory.kw['bind']).get_table_names()


@pytest.mark.parametrize('mode', ['initialize', 'disposable', 'invalid'])
def test_explicit_flag_cannot_authorize_nonempty_database(factory, monkeypatch, mode):
    add_data(factory)
    monkeypatch.setenv('LABELHUB_SEED_MODE', mode)
    with pytest.raises(SeedRefused):
        with guarded_seed_session(factory):
            pytest.fail('不应进入写入区')
    with factory() as session:
        assert session.execute(text('SELECT * FROM preserved')).all() == [(1, 'original')]
    assert _marker.name not in inspect(factory.kw['bind']).get_table_names()


def test_disposable_marker_requires_explicit_mode_every_time(factory, monkeypatch):
    monkeypatch.setenv('LABELHUB_SEED_MODE', 'disposable')
    with guarded_seed_session(factory):
        pass
    add_data(factory)
    with guarded_seed_session(factory):
        pass
    monkeypatch.delenv('LABELHUB_SEED_MODE')
    with pytest.raises(SeedRefused, match='重复播种'):
        with guarded_seed_session(factory):
            pass


def test_marker_from_another_database_is_refused(factory, monkeypatch):
    monkeypatch.setenv('LABELHUB_SEED_MODE', 'disposable')
    with guarded_seed_session(factory):
        pass
    with factory.begin() as session:
        session.execute(_marker.update().values(identity='wrong-database'))
    with pytest.raises(SeedRefused, match='标记'):
        with guarded_seed_session(factory):
            pass


@pytest.mark.parametrize('module,args', [
    ('seed', []), ('seed_demo', []), ('seed_e2e', []), ('seed_competition', []),
    ('clean_demo', ['--apply']), ('seed_demo_pipeline', []),
])
def test_all_mutating_entrypoints_refuse_before_writes(factory, monkeypatch, module, args):
    add_data(factory)
    imported = importlib.import_module(f'scripts.{module}')
    monkeypatch.setattr(imported, 'SessionLocal', factory)
    if module == 'seed_e2e':
        monkeypatch.setattr(importlib.import_module('scripts.seed_demo'), 'SessionLocal', factory)
    monkeypatch.setattr('sys.argv', [f'{module}.py', *args])
    with pytest.raises(SeedRefused, match='已有数据'):
        imported.main()
    with factory() as session:
        assert session.execute(text('SELECT * FROM preserved')).all() == [(1, 'original')]


@pytest.mark.parametrize('environment,demo', [('production', True), ('test', False)])
def test_demo_gate_remains_required(factory, monkeypatch, environment, demo):
    monkeypatch.setattr(settings, 'APP_ENV', environment)
    monkeypatch.setattr(settings, 'DEMO_MODE', demo)
    with pytest.raises(RuntimeError, match='DEMO_MODE'):
        with guarded_seed_session(factory):
            pass
