"""Environment-based configuration for the Extension Store server.

This service is deployed by the VENDOR only — it is never part of a
customer's Turbo EA stack. Customers talk to it through the redeem-code
flow in Admin → Extensions, or simply receive files by email and never
touch it at all.
"""

from __future__ import annotations

import os
from pathlib import Path


class Settings:
    # Public base URL of this store (used in Stripe redirect URLs).
    STORE_PUBLIC_URL: str = os.getenv("STORE_PUBLIC_URL", "http://localhost:8010")
    STORE_PORT: int = int(os.getenv("STORE_PORT", "8010"))

    # Persistence. SQLite by default; point at Postgres for production
    # (e.g. postgresql+asyncpg://user:pass@host/store).
    DATA_DIR: Path = Path(os.getenv("STORE_DATA_DIR", "data"))
    DATABASE_URL: str = os.getenv("STORE_DATABASE_URL", "")

    # Stripe (test-mode keys work; webhook secret from `stripe listen` or the
    # dashboard endpoint config). Empty STRIPE_API_KEY disables checkout.
    STRIPE_API_KEY: str = os.getenv("STRIPE_API_KEY", "")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")

    # License issuing key (base64 raw 32-byte Ed25519 private key) and the
    # key id customers' cores know it by. Generate with `teax keygen`; the
    # matching PUBLIC key must be baked into core's
    # DEFAULT_VENDOR_PUBLIC_KEYS under the same key id.
    STORE_SIGNING_KEY: str = os.getenv("STORE_SIGNING_KEY", "")
    STORE_SIGNING_KEY_ID: str = os.getenv("STORE_SIGNING_KEY_ID", "store-1")

    # Grace window written into issued licenses.
    LICENSE_GRACE_DAYS: int = int(os.getenv("STORE_LICENSE_GRACE_DAYS", "30"))

    # Bearer token protecting the /admin publish API (products + releases).
    STORE_ADMIN_TOKEN: str = os.getenv("STORE_ADMIN_TOKEN", "")

    # Redeem codes expire if unused (days).
    REDEEM_CODE_TTL_DAYS: int = int(os.getenv("STORE_REDEEM_CODE_TTL_DAYS", "30"))

    @property
    def database_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        self.DATA_DIR.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.DATA_DIR / 'store.db'}"

    @property
    def artifacts_dir(self) -> Path:
        path = self.DATA_DIR / "artifacts"
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
