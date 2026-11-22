import asyncio
from datetime import UTC, datetime
from threading import Event

import pytest

from app.services import cost_import_template as template


def snapshot(label):
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return (template.CatalogueItem("item", label, (), False, 0, now, now),)


@pytest.fixture(autouse=True)
def clear_cache():
    template._cache.clear()
    template._inflight.clear()
    yield
    template._cache.clear()
    template._inflight.clear()


async def test_concurrent_requests_share_build_and_revisit_cache(monkeypatch):
    started, release = Event(), Event()
    calls = []

    def build(items):
        calls.append(items)
        started.set()
        assert release.wait(5)
        return b"workbook"

    monkeypatch.setattr(template, "_build", build)
    first = asyncio.create_task(template.template_bytes(snapshot("one")))
    assert await asyncio.to_thread(started.wait, 5)
    second = asyncio.create_task(template.template_bytes(snapshot("one")))
    await asyncio.sleep(0)
    release.set()
    assert await asyncio.gather(first, second) == [b"workbook", b"workbook"]
    assert await template.template_bytes(snapshot("one")) == b"workbook"
    assert len(calls) == 1


async def test_late_old_revision_does_not_replace_new_revision(monkeypatch):
    started, release = Event(), Event()

    def build(items):
        if items[0].label == "old":
            started.set()
            assert release.wait(5)
        return items[0].label.encode()

    monkeypatch.setattr(template, "_build", build)
    old = asyncio.create_task(template.template_bytes(snapshot("old")))
    assert await asyncio.to_thread(started.wait, 5)
    assert await template.template_bytes(snapshot("new")) == b"new"
    release.set()
    assert await old == b"old"
    assert await template.template_bytes(snapshot("new")) == b"new"


async def test_failed_build_can_retry(monkeypatch):
    calls = 0

    def build(items):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise ValueError("failed")
        return b"ok"

    monkeypatch.setattr(template, "_build", build)
    with pytest.raises(ValueError, match="failed"):
        await template.template_bytes(snapshot("one"))
    assert await template.template_bytes(snapshot("one")) == b"ok"
    assert calls == 2


async def test_cancelling_one_waiter_does_not_cancel_shared_build(monkeypatch):
    started, release = Event(), Event()

    def build(items):
        started.set()
        assert release.wait(5)
        return b"ok"

    monkeypatch.setattr(template, "_build", build)
    first = asyncio.create_task(template.template_bytes(snapshot("one")))
    assert await asyncio.to_thread(started.wait, 5)
    second = asyncio.create_task(template.template_bytes(snapshot("one")))
    first.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first
    release.set()
    assert await second == b"ok"


async def test_completed_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(template, "_build", lambda items: items[0].label.encode())
    for index in range(template._CACHE_LIMIT + 1):
        await template.template_bytes(snapshot(str(index)))
    assert len(template._cache) == template._CACHE_LIMIT
    assert snapshot("0") not in template._cache
