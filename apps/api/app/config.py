# 应用配置：从环境变量（或本地 .env 文件）读取所有运行时参数，使用 pydantic-settings 做类型校验。
# 其他模块通过 from app.config import settings 获取单例配置对象，禁止在此文件硬编码任何真实值。
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 数据库与缓存
    DATABASE_URL: str
    REDIS_URL: str

    # JWT 鉴权
    JWT_SECRET: str

    # 豆包 / OpenAI 兼容接口
    DOUBAO_API_KEY: str
    DOUBAO_BASE_URL: str
    DOUBAO_MODEL: str

    # 文件存储
    FILE_STORAGE_DRIVER: str = "local"
    LOCAL_STORAGE_DIR: str = "/workspace/.storage/files"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


# 全局单例，启动时从环境变量初始化；字段缺失时 pydantic-settings 抛出 ValidationError
settings = Settings()
