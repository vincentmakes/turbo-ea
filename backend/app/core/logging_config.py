"""Structured logging configuration.

In production (ENVIRONMENT != "development"), logs are emitted as JSON lines
for easy ingestion by log aggregators (ELK, Datadog, CloudWatch, etc.).

In development, logs use a human-readable format.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Emit each log record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            log_entry["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "request_id"):
            log_entry["request_id"] = record.request_id
        return json.dumps(log_entry, default=str)


_DEV_FORMAT = "%(asctime)s %(levelname)-8s %(name)s — %(message)s"


def configure_logging(environment: str = "development", level: str = "INFO") -> None:
    """Configure root logger based on environment.

    Call once at application startup, before any log messages are emitted.
    """
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Remove any existing handlers (uvicorn may have added some)
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)

    if environment == "development":
        handler.setFormatter(logging.Formatter(_DEV_FORMAT, datefmt="%H:%M:%S"))
    else:
        handler.setFormatter(JSONFormatter())

    root.addHandler(handler)

    # Quiet noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
    logging.getLogger("alembic").setLevel(logging.INFO)
