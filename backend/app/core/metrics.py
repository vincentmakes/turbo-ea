"""Prometheus metric definitions for Turbo EA backend."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, Info

# ── Application info ────────────────────────────────────────────────
app_info = Info("turboea", "Turbo EA application metadata")

# ── HTTP request metrics ────────────────────────────────────────────
http_requests_total = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)

http_request_duration_seconds = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

http_requests_in_progress = Gauge(
    "http_requests_in_progress",
    "Number of HTTP requests currently being processed",
    ["method"],
)

# ── Database pool metrics ───────────────────────────────────────────
db_pool_size = Gauge("db_pool_size", "Current number of connections in the pool")
db_pool_checked_in = Gauge("db_pool_checked_in", "Connections currently idle in the pool")
db_pool_checked_out = Gauge("db_pool_checked_out", "Connections currently in use")
db_pool_overflow = Gauge("db_pool_overflow", "Current overflow connections beyond pool_size")

# ── Background task metrics ─────────────────────────────────────────
bg_task_runs_total = Counter(
    "bg_task_runs_total",
    "Total background task executions",
    ["task_name", "status"],
)

bg_task_last_success = Gauge(
    "bg_task_last_success_timestamp",
    "Timestamp of last successful background task run",
    ["task_name"],
)
