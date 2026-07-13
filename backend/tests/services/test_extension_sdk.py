"""Guard the extension SDK surface (the semver'd contract).

Backend extensions may import ONLY from ``app.services.extensions.sdk``
(AST-enforced in the vendor repo's CI), so anything an extension route
needs must be re-exported here. These tests pin the SDK 1.1 route
dependencies to the exact core objects — a rename or removal in core
must consciously update the SDK (and its version), never silently break
installed extensions.
"""

from __future__ import annotations

from app.api import deps as core_deps
from app.database import get_db as core_get_db
from app.services.extensions import sdk


def test_sdk_version_is_1_1():
    assert sdk.SDK_VERSION == "1.1"


def test_sdk_reexports_route_dependencies_verbatim():
    # SDK 1.1 — extension route handlers authenticate, check permissions,
    # and open DB sessions exclusively through these re-exports.
    assert sdk.get_current_user is core_deps.get_current_user
    assert sdk.require_permission is core_deps.require_permission
    assert sdk.get_db is core_get_db


def test_sdk_compatibility_is_major_only():
    # An extension built for 1.0 keeps loading on a 1.1 core (additive minor).
    assert sdk.sdk_compatible("1.0")
    assert sdk.sdk_compatible("1.1")
    assert not sdk.sdk_compatible("2.0")
