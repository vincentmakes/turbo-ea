"""ASGI middleware that records Prometheus metrics for every HTTP request."""

from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.metrics import (
    http_request_duration_seconds,
    http_requests_in_progress,
    http_requests_total,
)

# Paths that are called very frequently or are internal — skip per-path labels
# to avoid high-cardinality explosions.
_SKIP_PATHS = frozenset({"/api/health", "/metrics"})


def _normalise_path(path: str) -> str:
    """Collapse UUID path segments to keep cardinality bounded.

    /api/v1/cards/550e8400-e29b-41d4-a716-446655440000  →  /api/v1/cards/{id}
    """
    parts = path.rstrip("/").split("/")
    out: list[str] = []
    for part in parts:
        # Simple heuristic: 32-hex-char UUIDs (with or without dashes)
        stripped = part.replace("-", "")
        if len(stripped) == 32 and all(c in "0123456789abcdef" for c in stripped.lower()):
            out.append("{id}")
        else:
            out.append(part)
    return "/".join(out) or "/"


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Records request count, duration, and in-progress gauge."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path
        method = request.method

        if path in _SKIP_PATHS:
            return await call_next(request)

        endpoint = _normalise_path(path)

        http_requests_in_progress.labels(method=method).inc()
        start = time.perf_counter()
        try:
            response = await call_next(request)
            status = str(response.status_code)
        except Exception:
            status = "500"
            raise
        finally:
            elapsed = time.perf_counter() - start
            http_requests_total.labels(method=method, endpoint=endpoint, status=status).inc()
            http_request_duration_seconds.labels(method=method, endpoint=endpoint).observe(elapsed)
            http_requests_in_progress.labels(method=method).dec()

        return response
