from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "EA Turbo"
    VERSION: str = "0.1.0"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str = "postgresql+asyncpg://eaturbo:changeme@localhost:5432/eaturbo"

    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    BACKEND_CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:8920",
    ]

    model_config = {"env_file": ".env", "case_sensitive": True}


settings = Settings()
