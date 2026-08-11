"""Guard the extension SDK surface (the semver'd contract).

Backend extensions may import ONLY from ``app.services.extensions.sdk``
(AST-enforced in the vendor repo's CI), so anything an extension route
needs must be re-exported here. These tests pin each SDK minor's surface
to the exact core objects — a rename or removal in core must consciously
update the SDK (and its version), never silently break installed
extensions.
"""

from __future__ import annotations

from app.api import deps as core_deps
from app.database import get_db as core_get_db
from app.services.extensions import sdk


def test_sdk_version_is_1_4():
    assert sdk.SDK_VERSION == "1.4"


def test_sdk_reexports_route_dependencies_verbatim():
    # SDK 1.1 — extension route handlers authenticate, check permissions,
    # and open DB sessions exclusively through these re-exports.
    assert sdk.get_current_user is core_deps.get_current_user
    assert sdk.require_permission is core_deps.require_permission
    assert sdk.get_db is core_get_db


def test_sdk_1_2_surface_exists():
    # SDK 1.2 — core-data bridge, event subscriptions, encrypted secrets.
    # Presence-pinned so a rename in core is a conscious SDK change.
    assert sdk.ExtensionError is not None
    assert issubclass(sdk.ExtensionPermissionError, sdk.ExtensionError)
    assert issubclass(sdk.ExtensionDataError, sdk.ExtensionError)
    assert sdk.ExtTodo is not None
    assert sdk.TodosBridge is not None
    assert sdk.EventSubscription is not None
    assert sdk.SupportsEventHandlers is not None


def test_sdk_1_3_surface_exists():
    # SDK 1.3 — read-only users bridge for connector extensions.
    assert sdk.ExtUser is not None
    assert sdk.UsersBridge is not None


def test_sdk_1_4_surface_exists():
    # SDK 1.4 — batch settings on the context (one transaction for N keys).
    fields = sdk.ExtensionContext.__dataclass_fields__
    assert "get_settings" in fields
    assert "set_settings" in fields


def test_ext_user_is_frozen_and_wire_shaped():
    user = sdk.ExtUser(id="u1", email="a@b.c", display_name="A", is_active=True)
    assert user.id == "u1"
    try:
        user.email = "x@y.z"  # type: ignore[misc]
        raise AssertionError("ExtUser must be frozen")
    except AttributeError:
        pass


def test_ext_todo_is_frozen_and_wire_shaped():
    todo = sdk.ExtTodo(
        id="t1",
        card_id=None,
        description="d",
        status="open",
        link=None,
        is_system=False,
        assigned_to=None,
        created_by=None,
        due_date=None,
        created_at=None,
        updated_at=None,
        external_ref="PROJ-1",
        external_url="https://tracker/PROJ-1",
        external_source="jira-sync",
        series_id=None,
        recurrence_unit="none",
    )
    assert todo.external_ref == "PROJ-1"


def test_event_subscription_defaults_exclude_self():
    async def handler(ctx, message):
        pass

    sub = sdk.EventSubscription(prefix="todo.", handler=handler)
    # include_self defaults False: an extension does not receive events its
    # own bridge writes caused — the sync-loop breaker.
    assert sub.include_self is False


def test_extension_context_1_1_construction_still_works():
    # 1.1-era code (and tests) construct ExtensionContext without the 1.2
    # fields — they must stay optional.
    ctx = sdk.ExtensionContext(
        key="sample-ext",
        session_factory=lambda: None,  # type: ignore[return-value]
        logger=__import__("logging").getLogger("test"),
        get_setting=None,  # type: ignore[arg-type]
        set_setting=None,  # type: ignore[arg-type]
    )
    assert ctx.todos is None
    assert ctx.get_secret is None
    assert ctx.set_secret is None
    assert ctx.users is None
    assert ctx.get_settings is None
    assert ctx.set_settings is None
    assert ctx.settings_namespace == "ext.sample-ext."


def test_1_1_shaped_instance_still_satisfies_protocol():
    # The loader's isinstance check is attribute-presence-based. An extension
    # WITHOUT the optional 1.2 hooks (get_event_handlers) must keep loading.
    class OldExtension:
        key = "old-ext"
        sdk_version = "1.1"

        def get_router(self):
            return None

        def get_permissions(self):
            return {}

        def get_migrations(self):
            return []

        def get_jobs(self):
            return []

        async def on_startup(self, ctx):
            pass

    assert isinstance(OldExtension(), sdk.TurboExtension)


def test_sdk_compatibility_is_major_only():
    # An extension built for 1.0 keeps loading on a 1.2 core (additive minor).
    assert sdk.sdk_compatible("1.0")
    assert sdk.sdk_compatible("1.1")
    assert sdk.sdk_compatible("1.2")
    assert sdk.sdk_compatible("1.3")
    assert sdk.sdk_compatible("1.4")
    assert not sdk.sdk_compatible("2.0")


def test_sdk_minor_newer_truth_table():
    # Newer minor on the same major → warn (still loads).
    assert sdk.sdk_minor_newer("1.9")
    # Same or older minor → no warning.
    assert not sdk.sdk_minor_newer("1.4")
    assert not sdk.sdk_minor_newer("1.3")
    assert not sdk.sdk_minor_newer("1.2")
    assert not sdk.sdk_minor_newer("1.0")
    # Different major is handled by sdk_compatible, not the minor warning.
    assert not sdk.sdk_minor_newer("2.0")
    # Garbage never warns.
    assert not sdk.sdk_minor_newer("nope")
    assert not sdk.sdk_minor_newer("1")
