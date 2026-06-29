"""Pluggable email transport backends.

The active backend is chosen by ``EMAIL_METHOD`` (``smtp_basic`` by default).
``email_service`` builds the message + template and dispatches to the backend
resolved here, so all existing callers stay untouched.
"""

from __future__ import annotations

from app.services.email_backends.base import EmailBackend, EmailConfig, get_backend

__all__ = ["EmailBackend", "EmailConfig", "get_backend"]
