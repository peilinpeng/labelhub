"""OPT-07：生产启动保护与安全配置。"""

from datetime import datetime, timezone

import pytest
from jose import jwt
from pydantic import ValidationError

from app.config import Settings, settings
from app.routers.auth import create_access_token
from app.security import require_demo_mode


def _settings(**overrides) -> Settings:
    values = {
        "APP_ENV": "production",
        "DEMO_MODE": False,
        "DATABASE_URL": "mysql+pymysql://app:strong-db-secret@db/prod",
        "REDIS_URL": "redis://:strong-redis-secret@redis:6379/0",
        "JWT_SECRET": "a-strong-random-production-secret-123456789",
        "DOUBAO_API_KEY": "key",
        "DOUBAO_BASE_URL": "https://example.invalid/v1",
        "DOUBAO_MODEL": "model",
        "LOGIN_RATE_LIMIT_BACKEND": "redis",
        "TRUSTED_HOSTS": "api.example.com",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("JWT_SECRET", "short"),
        (
            "DATABASE_URL",
            "mysql+pymysql://labelhub:labelhub@mysql:3306/labelhub",
        ),
        ("DEMO_MODE", True),
        ("TRUSTED_HOSTS", "*"),
        ("TRUSTED_HOSTS", "*.example.com"),
        ("LOGIN_RATE_LIMIT_BACKEND", "memory"),
        ("DATABASE_URL", "mysql+pymysql://app@db/prod"),
    ],
)
def test_invalid_production_security_fails_fast(field, value):
    with pytest.raises(ValidationError):
        _settings(**{field: value})


def test_valid_production_security_configuration_passes():
    production = _settings()
    assert production.APP_ENV == "production"
    assert production.trusted_hosts == ["api.example.com"]


def test_jwt_expiry_uses_configuration(monkeypatch):
    monkeypatch.setattr(settings, "JWT_ACCESS_TOKEN_EXPIRE_MINUTES", 15)
    token = create_access_token("usr_1", "OWNER", "Owner")
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    lifetime = datetime.fromtimestamp(
        payload["exp"], timezone.utc
    ) - datetime.fromtimestamp(payload["iat"], timezone.utc)
    assert lifetime.total_seconds() == 15 * 60


def test_demo_seed_guard_rejects_non_demo_mode():
    with pytest.raises(RuntimeError):
        require_demo_mode("test-seed")
