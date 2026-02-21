"""Unit tests for app.core.metrics — Prometheus metric definitions.

These tests do NOT require a database; they verify metric objects exist and
are correctly typed.
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, Info

from app.core.metrics import (
    app_info,
    bg_task_last_success,
    bg_task_runs_total,
    db_pool_checked_in,
    db_pool_checked_out,
    db_pool_overflow,
    db_pool_size,
    http_request_duration_seconds,
    http_requests_in_progress,
    http_requests_total,
)


class TestMetricTypes:
    """Verify that each exported metric is the expected Prometheus type."""

    def test_app_info_is_info(self):
        assert isinstance(app_info, Info)

    def test_http_requests_total_is_counter(self):
        assert isinstance(http_requests_total, Counter)

    def test_http_request_duration_is_histogram(self):
        assert isinstance(http_request_duration_seconds, Histogram)

    def test_http_requests_in_progress_is_gauge(self):
        assert isinstance(http_requests_in_progress, Gauge)

    def test_db_pool_gauges(self):
        assert isinstance(db_pool_size, Gauge)
        assert isinstance(db_pool_checked_in, Gauge)
        assert isinstance(db_pool_checked_out, Gauge)
        assert isinstance(db_pool_overflow, Gauge)

    def test_bg_task_runs_total_is_counter(self):
        assert isinstance(bg_task_runs_total, Counter)

    def test_bg_task_last_success_is_gauge(self):
        assert isinstance(bg_task_last_success, Gauge)


class TestMetricLabels:
    """Verify that metrics accept their expected label combinations."""

    def test_http_requests_total_labels(self):
        # Should not raise
        http_requests_total.labels(method="GET", endpoint="/api/v1/cards", status="200")

    def test_http_request_duration_labels(self):
        http_request_duration_seconds.labels(method="GET", endpoint="/api/v1/cards")

    def test_http_requests_in_progress_labels(self):
        http_requests_in_progress.labels(method="GET")

    def test_bg_task_runs_total_labels(self):
        bg_task_runs_total.labels(task_name="purge_archived", status="success")

    def test_bg_task_last_success_labels(self):
        bg_task_last_success.labels(task_name="purge_archived")
