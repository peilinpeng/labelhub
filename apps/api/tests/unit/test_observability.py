"""监控必须拒绝匿名读取，探针失败不泄漏凭据，指标不出现资源 ID。"""
import logging
from app.config import settings
from app import observability


def test_metrics_requires_dedicated_token(client, monkeypatch):
    monkeypatch.setattr(settings, "METRICS_TOKEN", "monitor-test-credential")
    monkeypatch.setattr(settings, "METRICS_TOKEN_FILE", "")
    monkeypatch.setattr(observability, "probe_dependencies", lambda: {"database": True, "redis": True})
    assert client.get("/api/v1/metrics").status_code == 403
    assert client.get("/api/v1/metrics", headers={"Authorization": "Bearer invalid"}).status_code == 403
    result = client.get("/api/v1/metrics", headers={"Authorization": "Bearer monitor-test-credential"})
    assert result.status_code == 200
    assert "labelhub_http_requests_total" in result.text
    assert "monitor-test-credential" not in result.text


def test_readiness_fails_without_connection_details(client, monkeypatch):
    monkeypatch.setattr(observability, "probe_dependencies", lambda: {"database": False, "redis": True})
    result = client.get("/api/v1/ready")
    assert result.status_code == 503
    assert result.json() == {"status": "unavailable", "dependencies": {"database": False, "redis": True}}
    assert client.get("/api/v1/health").status_code == 200


def test_logs_use_templates_and_omit_query_and_credentials(client, auth, caplog):
    with caplog.at_level(logging.INFO, logger="labelhub.requests"):
        result = client.get("/api/v1/tasks/task_secret_identifier?answer=private-answer", headers=auth["OWNER"])
    assert result.headers["x-request-id"]
    log = caplog.text
    assert '"route": "/api/v1/tasks/{task_id}"' in log
    assert "task_secret_identifier" not in log
    assert "private-answer" not in log
    assert auth["OWNER"]["Authorization"] not in log
