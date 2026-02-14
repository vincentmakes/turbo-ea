from __future__ import annotations

import os


class Settings:
    PROJECT_NAME: str = "Turbo EA"
    API_V1_PREFIX: str = "/api/v1"

    POSTGRES_HOST: str = os.getenv("POSTGRES_HOST", "localhost")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5432")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "turboea")
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "turboea")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "turboea")

    RESET_DB: bool = os.getenv("RESET_DB", "").lower() in ("1", "true", "yes")
    SEED_DEMO: bool = os.getenv("SEED_DEMO", "").lower() in ("1", "true", "yes")
    SEED_BPM: bool = os.getenv("SEED_BPM", "").lower() in ("1", "true", "yes")

    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me-in-production")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

    # Email / SMTP (optional — if not configured, email notifications are skipped)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "noreply@turboea.local")
    SMTP_TLS: bool = os.getenv("SMTP_TLS", "true").lower() in ("1", "true", "yes")

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )


settings = Settings()
