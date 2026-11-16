"""``require_extension`` called straight from the test body, aimed at surviving mutants.

The dependency is built and awaited inside each test (not in a fixture, not through an ASGI
app), so the factory and its inner check both run in the test's own call phase, and the
raised ``HTTPException`` is compared attribute by attribute.
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.services.extensions.gate import require_extension
from app.services.extensions.license import Entitlement
from app.services.extensions.registry import extension_registry
from tests.services.test_extension_registry import NOW, make_info, make_license

KEY = "sample-ext"


@pytest.fixture(autouse=True)
def _clean_registry():
    extension_registry.clear()
    yield
    extension_registry.clear()


def _license(**kwargs):
    extension_registry.set_license(
        make_license(Entitlement(extension_key=kwargs.pop("key", KEY), **kwargs))
    )


async def _denial(key: str = KEY) -> HTTPException:
    check = require_extension(key)
    with pytest.raises(HTTPException) as exc:
        await check()
    return exc.value


async def test_an_unknown_extension_is_a_404_not_found():
    denied = await _denial()
    assert (denied.status_code, denied.detail) == (404, "Not found")


async def test_a_removed_extension_is_a_404_not_found_whatever_else_is_true():
    extension_registry.load_installed([make_info(status="removed", enabled=False)])
    _license(expires_at=None)
    denied = await _denial()
    assert (denied.status_code, denied.detail) == (404, "Not found")


async def test_the_key_passed_to_the_factory_is_the_one_looked_up():
    extension_registry.load_installed([make_info(key="other-ext")])
    _license(key="other-ext", expires_at=None)
    assert (await _denial(KEY)).status_code == 404
    assert await require_extension("other-ext")() is None


@pytest.mark.parametrize(
    ("enabled", "status"),
    [(False, "installed"), (True, "disabled"), (False, "disabled")],
)
async def test_a_disabled_extension_is_a_403_before_its_licence_is_read(enabled, status):
    extension_registry.load_installed([make_info(enabled=enabled, status=status)])
    denied = await _denial()  # no licence at all: the disabled answer must come first
    assert (denied.status_code, denied.detail) == (403, "Extension is disabled")
    _license(expires_at=None)
    denied = await _denial()
    assert (denied.status_code, denied.detail) == (403, "Extension is disabled")


async def test_an_unlicensed_extension_is_a_403_licence_message():
    extension_registry.load_installed([make_info()])
    denied = await _denial()
    assert (denied.status_code, denied.detail) == (
        403,
        "Extension license is expired or missing",
    )


async def test_a_licence_for_another_extension_does_not_unlock_this_one():
    extension_registry.load_installed([make_info()])
    _license(key="other-ext", expires_at=None)
    denied = await _denial()
    assert (denied.status_code, denied.detail) == (
        403,
        "Extension license is expired or missing",
    )


async def test_an_expired_entitlement_past_grace_is_denied():
    extension_registry.load_installed([make_info()])
    _license(expires_at=NOW - timedelta(days=400))
    denied = await _denial()
    assert (denied.status_code, denied.detail) == (
        403,
        "Extension license is expired or missing",
    )


async def test_active_and_free_extensions_pass_and_return_nothing():
    extension_registry.load_installed([make_info()])
    _license(expires_at=None)
    assert await require_extension(KEY)() is None
    extension_registry.clear()
    extension_registry.load_installed([make_info(manifest={"free": True})])
    assert await require_extension(KEY)() is None


async def test_each_factory_call_returns_its_own_check_bound_to_its_key():
    extension_registry.load_installed([make_info(key="a-ext"), make_info(key="b-ext")])
    extension_registry.set_license(
        make_license(Entitlement(extension_key="a-ext", expires_at=None))
    )
    check_a, check_b = require_extension("a-ext"), require_extension("b-ext")
    assert await check_a() is None
    with pytest.raises(HTTPException) as exc:
        await check_b()
    assert exc.value.status_code == 403
