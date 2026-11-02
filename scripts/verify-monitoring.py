"""隔离栈验收：真实抓取、告警规则、Grafana 面板及匿名拒绝。不输出凭据。"""
import base64
import json
import os
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError


def fetch(url, headers=None):
    with urlopen(Request(url, headers=headers or {}), timeout=5) as response:
        return response.read().decode()


def wait(check, description):
    for attempt in range(45):
        try:
            check()
            print(description + "：通过")
            return
        except Exception:
            if attempt == 44:
                raise RuntimeError(description + "：验收失败") from None
            time.sleep(1)


api = os.environ.get("MONITOR_API_URL", "http://localhost:3000")
prometheus = os.environ.get("MONITOR_PROMETHEUS_URL", "http://localhost:9090")
grafana = os.environ.get("MONITOR_GRAFANA_URL", "http://localhost:3001")
alertmanager = os.environ.get("MONITOR_ALERTMANAGER_URL", "http://localhost:9093")
token = Path(os.environ["METRICS_TOKEN_FILE"]).read_text().strip()
password = Path(os.environ["GRAFANA_PASSWORD_FILE"]).read_text().strip()


def ready():
    assert json.loads(fetch(api + "/api/v1/ready"))["status"] == "ok"


def scraped():
    data = json.loads(fetch(prometheus + '/api/v1/query?query=up%7Bjob%3D%22labelhub%22%7D'))
    assert data["data"]["result"][0]["value"][1] == "1"
    metrics = fetch(api + "/api/v1/metrics", {"Authorization": "Bearer " + token})
    assert 'labelhub_dependency_up{dependency="database"} 1.0' in metrics
    assert 'labelhub_dependency_up{dependency="redis"} 1.0' in metrics
    assert "labelhub_jobs" in metrics and token not in metrics


def dashboards():
    credential = base64.b64encode(("admin:" + password).encode()).decode()
    data = json.loads(fetch(grafana + "/api/dashboards/uid/labelhub-operations", {"Authorization": "Basic " + credential}))
    assert len(data["dashboard"]["panels"]) == 6


def alerts():
    data = json.loads(fetch(prometheus + "/api/v1/rules"))
    names = {rule["name"] for group in data["data"]["groups"] for rule in group["rules"]}
    assert {"LabelHubUnavailable", "LabelHubDependencyUnavailable", "LabelHubQueueStalled", "LabelHubMigrationFailed"} <= names
    assert json.loads(fetch(alertmanager + "/api/v2/status"))["config"]


wait(ready, "数据库与 Redis 就绪探针")
try:
    fetch(api + "/api/v1/metrics")
    raise AssertionError("指标接口错误地允许匿名访问")
except HTTPError as error:
    assert error.code == 403
wait(scraped, "Prometheus 真实抓取与后台任务指标")
wait(dashboards, "Grafana 自动加载面板")
wait(alerts, "Prometheus 告警与 Alertmanager 配置")
