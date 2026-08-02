# 应用配置：从环境变量（或本地 .env 文件）读取所有运行时参数，使用 pydantic-settings 做类型校验。
# 其他模块通过 from app.config import settings 获取单例配置对象，禁止在此文件硬编码任何真实值。
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    # 运行环境。production 会启用启动期安全校验，禁止弱密钥、默认数据库密码和 Demo 模式。
    APP_ENV: Literal["development", "test", "demo", "production"] = "development"
    DEMO_MODE: bool = False

    # 数据库与缓存
    DATABASE_URL: str
    REDIS_URL: str

    # JWT 鉴权
    JWT_SECRET: str
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # 登录限流。生产环境必须使用 Redis，确保多进程 / 多副本共享计数。
    LOGIN_RATE_LIMIT_BACKEND: Literal["memory", "redis"] = "memory"
    LOGIN_RATE_LIMIT_ATTEMPTS: int = 5
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300

    # Host 与安全响应头
    TRUSTED_HOSTS: str = "localhost,127.0.0.1,testserver,api"
    ENABLE_HSTS: bool = False

    # 豆包 / OpenAI 兼容接口
    DOUBAO_API_KEY: str
    DOUBAO_BASE_URL: str
    DOUBAO_MODEL: str

    # 文件存储
    FILE_STORAGE_DRIVER: str = "local"
    LOCAL_STORAGE_DIR: str = "/workspace/.storage/files"
    MAX_UPLOAD_SIZE_BYTES: int = 20 * 1024 * 1024
    FILE_ALLOWED_EXTENSIONS: str = (
        ".csv,.json,.jsonl,.txt,.pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"
    )
    FILE_ALLOWED_MIME_TYPES: str = (
        "text/csv,application/json,application/x-ndjson,text/plain,"
        "application/pdf,image/png,image/jpeg,image/webp,"
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
        "application/vnd.ms-excel"
    )

    # AI 预审：置信度感知路由阈值。
    # LLM 返回 PASS 但 confidence 低于该阈值时，降级为转人工复核（human-in-the-loop），
    # 避免把"不确定的通过"当作确定结论自动放行。仅收紧、不放宽：永不因此自动通过更多。
    AI_REVIEW_CONFIDENCE_THRESHOLD: float = 0.6

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def trusted_hosts(self) -> list[str]:
        return [host.strip() for host in self.TRUSTED_HOSTS.split(",") if host.strip()]

    @property
    def allowed_file_extensions(self) -> set[str]:
        return {
            extension.strip().lower()
            for extension in self.FILE_ALLOWED_EXTENSIONS.split(",")
            if extension.strip()
        }

    @property
    def allowed_file_mime_types(self) -> set[str]:
        return {
            mime_type.strip().lower()
            for mime_type in self.FILE_ALLOWED_MIME_TYPES.split(",")
            if mime_type.strip()
        }

    @model_validator(mode="after")
    def validate_runtime_security(self) -> "Settings":
        if self.JWT_ACCESS_TOKEN_EXPIRE_MINUTES <= 0:
            raise ValueError("JWT_ACCESS_TOKEN_EXPIRE_MINUTES 必须大于 0")
        if self.LOGIN_RATE_LIMIT_ATTEMPTS <= 0:
            raise ValueError("LOGIN_RATE_LIMIT_ATTEMPTS 必须大于 0")
        if self.LOGIN_RATE_LIMIT_WINDOW_SECONDS <= 0:
            raise ValueError("LOGIN_RATE_LIMIT_WINDOW_SECONDS 必须大于 0")
        if self.MAX_UPLOAD_SIZE_BYTES <= 0:
            raise ValueError("MAX_UPLOAD_SIZE_BYTES 必须大于 0")
        if not self.trusted_hosts:
            raise ValueError("TRUSTED_HOSTS 不能为空")

        if self.APP_ENV != "production":
            return self

        weak_jwt_values = {
            "dev_jwt_secret_change_in_production",
            "change_me_to_a_long_random_secret",
            "your_jwt_secret_here",
            "test_jwt_secret",
        }
        if len(self.JWT_SECRET) < 32 or self.JWT_SECRET in weak_jwt_values:
            raise ValueError("生产环境 JWT_SECRET 必须是至少 32 字符的非默认随机密钥")
        if self.DEMO_MODE:
            raise ValueError("生产环境禁止启用 DEMO_MODE")
        if any("*" in host for host in self.trusted_hosts):
            raise ValueError("生产环境 TRUSTED_HOSTS 禁止使用通配符")
        if self.LOGIN_RATE_LIMIT_BACKEND != "redis":
            raise ValueError("生产环境 LOGIN_RATE_LIMIT_BACKEND 必须为 redis")

        database_url = make_url(self.DATABASE_URL)
        weak_database_passwords = {
            "labelhub",
            "root",
            "password",
            "changeme",
            "change_me",
        }
        database_password = database_url.password
        if (
            not database_password
            or database_password.lower() in weak_database_passwords
        ):
            raise ValueError("生产环境禁止使用默认数据库密码")
        return self


# 全局单例，启动时从环境变量初始化；字段缺失时 pydantic-settings 抛出 ValidationError
settings = Settings()
