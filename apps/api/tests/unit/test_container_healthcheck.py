"""OPT-14：容器健康检查必须覆盖服务自身与关键依赖。"""

from scripts import container_healthcheck


def test_api_healthcheck_covers_api_database_and_redis(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(container_healthcheck, "check_api", lambda: calls.append("api"))
    monkeypatch.setattr(container_healthcheck, "check_database", lambda: calls.append("database"))
    monkeypatch.setattr(container_healthcheck, "check_redis", lambda: calls.append("redis"))
    monkeypatch.setattr(container_healthcheck.sys, "argv", ["healthcheck", "api"])

    assert container_healthcheck.main() == 0
    assert calls == ["api", "database", "redis"]


def test_worker_healthcheck_covers_database_and_redis(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(container_healthcheck, "check_database", lambda: calls.append("database"))
    monkeypatch.setattr(container_healthcheck, "check_redis", lambda: calls.append("redis"))
    monkeypatch.setattr(container_healthcheck.sys, "argv", ["healthcheck", "worker"])

    assert container_healthcheck.main() == 0
    assert calls == ["database", "redis"]
