"""``_role_response`` and ``_role_snapshot`` of the roles API: the payload a non-admin may see,
what only an admin gets, and the snapshot an audit row diffs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from app.api.v1.roles import _role_response, _role_snapshot

WHEN = datetime(2026, 11, 3, 10, 30, tzinfo=timezone.utc)
PERMS = {"inventory.view": True, "admin.users": False}


def _role(**over):
    base = {
        "id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
        "key": "auditor",
        "label": "Auditor",
        "description": "reads logs",
        "is_system": False,
        "is_default": True,
        "is_archived": True,
        "color": "#123456",
        "sort_order": 7,
        "created_at": WHEN,
        "updated_at": WHEN,
        "archived_at": WHEN,
        "archived_by": uuid.UUID("22222222-2222-2222-2222-222222222222"),
        "permissions": PERMS,
    }
    base.update(over)
    return SimpleNamespace(**base)


def test_full_payload_adds_the_matrix_and_the_user_count():
    assert _role_response(_role(), 4) == {
        "id": "11111111-1111-1111-1111-111111111111",
        "key": "auditor",
        "label": "Auditor",
        "description": "reads logs",
        "is_system": False,
        "is_default": True,
        "is_archived": True,
        "color": "#123456",
        "sort_order": 7,
        "created_at": WHEN.isoformat(),
        "updated_at": WHEN.isoformat(),
        "archived_at": WHEN.isoformat(),
        "archived_by": "22222222-2222-2222-2222-222222222222",
        "permissions": PERMS,
        "user_count": 4,
    }


def test_full_is_the_default_and_a_zero_count_is_kept():
    out = _role_response(_role(), 0)
    assert out["permissions"] == PERMS
    assert out["user_count"] == 0
    assert "user_count" not in _role_response(_role())
    assert _role_response(_role())["permissions"] == PERMS


def test_the_lite_payload_never_carries_the_matrix_or_the_count():
    out = _role_response(_role(), 4, full=False)
    assert "permissions" not in out and "user_count" not in out
    assert out["key"] == "auditor" and out["label"] == "Auditor" and out["color"] == "#123456"
    assert set(out) == {
        "id",
        "key",
        "label",
        "description",
        "is_system",
        "is_default",
        "is_archived",
        "color",
        "sort_order",
        "created_at",
        "updated_at",
        "archived_at",
        "archived_by",
    }


def test_missing_timestamps_and_archiver_read_as_none():
    out = _role_response(
        _role(created_at=None, updated_at=None, archived_at=None, archived_by=None), full=False
    )
    assert out["created_at"] is None and out["updated_at"] is None
    assert out["archived_at"] is None and out["archived_by"] is None


def test_snapshot_is_the_five_audited_fields_with_a_copied_matrix():
    role = _role()
    snap = _role_snapshot(role)
    assert snap == {
        "label": "Auditor",
        "color": "#123456",
        "permissions": PERMS,
        "is_default": True,
        "sort_order": 7,
    }
    snap["permissions"]["new.key"] = True
    assert "new.key" not in role.permissions  # a copy: a later edit cannot rewrite "before"


def test_snapshot_of_a_role_without_permissions_is_an_empty_matrix():
    assert _role_snapshot(_role(permissions=None))["permissions"] == {}


def test_every_field_is_read_from_its_own_attribute_and_in_the_documented_order():
    role = _role(
        id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        key="other_key",
        label="Other label",
        description="other description",
        is_system=True,
        is_default=False,
        is_archived=False,
        color="#abcdef",
        sort_order=0,
        created_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        updated_at=datetime(2026, 3, 4, tzinfo=timezone.utc),
        archived_at=datetime(2026, 5, 6, tzinfo=timezone.utc),
        archived_by=uuid.UUID("44444444-4444-4444-4444-444444444444"),
        permissions={"*": True},
    )
    out = _role_response(role, 9)
    assert out == {
        "id": "33333333-3333-3333-3333-333333333333",
        "key": "other_key",
        "label": "Other label",
        "description": "other description",
        "is_system": True,
        "is_default": False,
        "is_archived": False,
        "color": "#abcdef",
        "sort_order": 0,
        "created_at": "2026-01-02T00:00:00+00:00",
        "updated_at": "2026-03-04T00:00:00+00:00",
        "archived_at": "2026-05-06T00:00:00+00:00",
        "archived_by": "44444444-4444-4444-4444-444444444444",
        "permissions": {"*": True},
        "user_count": 9,
    }
    assert list(out) == [
        "id",
        "key",
        "label",
        "description",
        "is_system",
        "is_default",
        "is_archived",
        "color",
        "sort_order",
        "created_at",
        "updated_at",
        "archived_at",
        "archived_by",
        "permissions",
        "user_count",
    ]


def test_the_lite_payload_is_the_full_one_minus_exactly_the_two_admin_fields():
    full = _role_response(_role(), 4)
    lite = _role_response(_role(), 4, full=False)
    assert lite == {k: v for k, v in full.items() if k not in ("permissions", "user_count")}
    assert _role_response(_role(), 4, full=True) == full
    assert _role_response(_role(), user_count=4) == full


def test_an_empty_permission_matrix_is_still_returned_to_a_full_reader():
    out = _role_response(_role(permissions={}), 0)
    assert out["permissions"] == {} and out["user_count"] == 0


def test_the_snapshot_has_exactly_five_keys_in_order_and_equal_values_not_shared_ones():
    perms = {"a.b": True}
    snap = _role_snapshot(_role(permissions=perms, label="L", color="#000000", sort_order=2))
    assert list(snap) == ["label", "color", "permissions", "is_default", "sort_order"]
    assert snap == {
        "label": "L",
        "color": "#000000",
        "permissions": {"a.b": True},
        "is_default": True,
        "sort_order": 2,
    }
    assert snap["permissions"] is not perms
    assert _role_snapshot(_role(permissions={}))["permissions"] == {}
    assert _role_snapshot(_role(is_default=False))["is_default"] is False
