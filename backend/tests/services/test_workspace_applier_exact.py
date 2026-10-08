"""The workspace applier's sections, pinned to exact values.

The round-trip tests prove a bundle survives export → import; these pin what
each section does with every kind of row — what it creates, what it updates,
what it leaves alone, which counter a row lands in and the error a refused row
leaves behind — because the nightly mutation run showed those were the values
no test compared.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.app_settings import AppSettings
from app.models.bookmark import Bookmark, bookmark_shares
from app.models.card_type import CardType
from app.models.diagram import Diagram, diagram_cards
from app.models.diagram_group import DiagramGroup, diagram_group_members
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.tag import Tag, TagGroup
from app.models.user import User
from app.services.card_resolver import CardResolver
from app.services.workspace_io import applier, schema
from app.services.workspace_io.bundle import WorkspaceBundle
from app.services.workspace_io.secrets import EMAIL_SECRET_PATHS, GENERAL_SECRET_PATHS
from app.services.workspace_io.sections import (
    SHEET_BOOKMARK_SHARES,
    SHEET_DIAGRAM_CARDS,
    SHEET_DIAGRAM_GROUP_MEMBERS,
)
from tests.conftest import create_card, create_card_type, create_role, create_user


def bundle(sheet: str, rows: list[dict], assets: dict | None = None) -> WorkspaceBundle:
    return WorkspaceBundle(manifest={}, sheets={sheet: rows}, assets=assets or {})


def section(sheet: str = "X") -> applier.SectionResult:
    return applier.SectionResult(sheet=sheet)


def counts(sr: applier.SectionResult) -> tuple[int, int, int, int, int]:
    return sr.created, sr.updated, sr.skipped, sr.conflict, sr.failed


# ── results ─────────────────────────────────────────────────────────────────


def test_a_skip_is_counted_under_its_reason():
    sr = section("Cards")
    sr.skip()
    sr.skip("identical")
    sr.skip("identical")
    assert sr.skipped == 3
    assert sr.skip_reasons == {"already_present": 1, "identical": 2}


def test_a_section_reports_at_most_fifty_errors_and_a_copy_of_its_reasons():
    sr = applier.SectionResult(sheet="Cards", created=1, updated=2, conflict=3, failed=4)
    sr.errors = [f"e{i}" for i in range(60)]
    sr.skip("identical")
    report = sr.as_dict()
    assert report == {
        "sheet": "Cards",
        "created": 1,
        "updated": 2,
        "skipped": 1,
        "conflict": 3,
        "failed": 4,
        "errors": [f"e{i}" for i in range(50)],
        "errors_total": 60,
        "skip_reasons": {"identical": 1},
    }
    report["skip_reasons"]["x"] = 1
    assert sr.skip_reasons == {"identical": 1}


def test_an_apply_result_totals_its_sections():
    a = applier.SectionResult(sheet="A", created=1, updated=2, conflict=4, failed=8)
    a.skip()
    b = applier.SectionResult(sheet="B", created=16, updated=32, conflict=64, failed=128)
    b.skip()
    b.skip()
    result = applier.ApplyResult(dry_run=True, sections=[a, b])
    assert result.total_failed == 136
    assert result.total_conflict == 68
    assert result.as_dict() == {
        "dry_run": True,
        "sections": [a.as_dict(), b.as_dict()],
        "totals": {"created": 17, "updated": 34, "skipped": 3, "conflict": 68, "failed": 136},
    }
    assert applier.ApplyResult(dry_run=False).as_dict()["totals"] == {
        "created": 0,
        "updated": 0,
        "skipped": 0,
        "conflict": 0,
        "failed": 0,
    }


# ── row helpers ─────────────────────────────────────────────────────────────


def test_coercion_keeps_only_the_columns_the_sheet_carries():
    row = {"key": "A", "translations": '{"de": "x"}', "fields_schema": "", "extra": 1}
    out = applier._coerce(
        row,
        ("key", "label", "translations", "fields_schema"),
        frozenset({"translations", "fields_schema"}),
    )
    assert out == {"key": "A", "translations": {"de": "x"}, "fields_schema": None}


def test_coercion_leaves_a_non_json_column_as_written():
    assert applier._coerce({"key": '{"a": 1}'}, ("key",), frozenset()) == {"key": '{"a": 1}'}


def test_an_update_writes_only_the_columns_that_differ():
    current = SimpleNamespace(a=1, b="x", c="keep")
    sr = section()
    applier._update_if_changed(current, {"a": 1, "b": "y", "z": 9}, ["a", "b", "c"], sr)
    assert (current.a, current.b, current.c) == (1, "y", "keep")
    assert not hasattr(current, "z")
    assert counts(sr) == (0, 1, 0, 0, 0)


def test_an_identical_row_is_skipped_as_identical():
    current = SimpleNamespace(a=1, b="x")
    sr = section()
    applier._update_if_changed(current, {"a": 1, "b": "x"}, ["a", "b"], sr)
    applier._update_if_changed(current, {}, ["a", "b"], sr)
    assert counts(sr) == (0, 0, 2, 0, 0)
    assert sr.skip_reasons == {"identical": 2}


def test_an_asset_is_found_by_its_exact_name_or_with_an_extension():
    assets = {"branding/logo2.png": b"no", "branding/logo.png": b"yes", "branding/favicon": b"f"}
    b = WorkspaceBundle(manifest={}, sheets={}, assets=assets)
    assert applier._find_asset(b, "branding/logo") == b"yes"
    assert applier._find_asset(b, "branding/favicon") == b"f"
    assert applier._find_asset(b, "branding/missing") is None


def test_settings_merge_never_writes_a_secret_at_any_depth():
    target = {
        "sso": {"client_secret": "keep", "enabled": False},
        "ai": {"apiKey": "k"},
        "theme": "dark",
        "nested": {"a": 1},
    }
    incoming = {
        "sso": {"client_secret": "evil", "enabled": True},
        "ai": {"apiKey": "evil", "model": "m"},
        "theme": "light",
        "nested": "flat",
        "new": [1],
    }
    merged = applier._merge_settings(target, incoming, GENERAL_SECRET_PATHS)
    assert merged == {
        "sso": {"client_secret": "keep", "enabled": True},
        "ai": {"apiKey": "k", "model": "m"},
        "theme": "light",
        "nested": "flat",
        "new": [1],
    }
    assert target["sso"] == {"client_secret": "keep", "enabled": False}
    assert target["theme"] == "dark"


def test_settings_merge_protects_top_level_and_deep_secrets():
    assert applier._merge_settings(
        {"smtp_password": "keep"},
        {"smtp_password": "evil", "smtp_host": "h"},
        EMAIL_SECRET_PATHS,
    ) == {"smtp_password": "keep", "smtp_host": "h"}
    deep = (("a", "b", "c"),)
    assert applier._merge_settings(
        {"a": {"b": {"c": "keep", "x": 1}}}, {"a": {"b": {"c": "evil", "d": 2}}}, deep
    ) == {"a": {"b": {"c": "keep", "x": 1, "d": 2}}}


def test_settings_merge_replaces_a_scalar_with_a_dict():
    assert applier._merge_settings({"x": 1}, {"x": {"y": 2}}, ()) == {"x": {"y": 2}}


# ── metamodel ───────────────────────────────────────────────────────────────


async def card_type(db, key):
    return (await db.execute(select(CardType).where(CardType.key == key))).scalar_one_or_none()


async def test_a_new_card_type_is_created_and_blank_json_is_normalised(db):
    rows = [
        {
            "key": "Widget",
            "label": "Widget",
            "color": "#123456",
            "fields_schema": '[{"section": "S", "fields": []}]',
            "reference_config": "",
            "role_permissions": "",
            "translations": "",
            "built_in": False,
        },
        {"label": "No key"},
        {"key": "", "label": "Empty key"},
    ]
    sr = section()
    await applier._apply_card_types(db, bundle(schema.SHEET_CARD_TYPES, rows), sr, False)
    ct = await card_type(db, "Widget")
    assert (ct.label, ct.color, ct.built_in) == ("Widget", "#123456", False)
    assert ct.fields_schema == [{"section": "S", "fields": []}]
    assert (ct.reference_config, ct.role_permissions, ct.translations) == ({}, {}, {})
    assert counts(sr) == (1, 0, 0, 0, 2)


async def test_an_existing_card_type_keeps_its_identity(db):
    await create_card_type(db, key="App", label="Old", built_in=True)
    rows = [{"key": "App", "label": "New", "built_in": False, "translations": ""}]
    sr = section()
    await applier._apply_card_types(db, bundle(schema.SHEET_CARD_TYPES, rows), sr, False)
    ct = await card_type(db, "App")
    assert (ct.label, ct.built_in, ct.translations) == ("New", True, {})
    assert counts(sr) == (0, 1, 0, 0, 0)
    await applier._apply_card_types(db, bundle(schema.SHEET_CARD_TYPES, rows), sr, False)
    assert counts(sr) == (0, 1, 1, 0, 0)
    assert sr.skip_reasons == {"identical": 1}


async def test_a_card_type_listed_twice_is_created_once(db):
    rows = [{"key": "Twin", "label": "One"}, {"key": "Twin", "label": "Two"}]
    sr = section()
    await applier._apply_card_types(db, bundle(schema.SHEET_CARD_TYPES, rows), sr, False)
    assert (await card_type(db, "Twin")).label == "Two"
    assert counts(sr) == (1, 1, 0, 0, 0)


async def relation_type(db, key):
    return (
        await db.execute(select(RelationType).where(RelationType.key == key))
    ).scalar_one_or_none()


async def test_relation_types_are_created_updated_and_keyed(db):
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    db.add(
        RelationType(
            key="old",
            label="was",
            reverse_label="was by",
            source_type_key="Application",
            target_type_key="ITComponent",
            built_in=True,
        )
    )
    await db.flush()
    rows = [
        {
            "key": "uses",
            "label": "uses",
            "reverse_label": "used by",
            "source_type_key": "Application",
            "target_type_key": "ITComponent",
            "attributes_schema": '[{"key": "k"}]',
        },
        {"key": "old", "label": "now", "built_in": False},
        {"key": "uses", "label": "uses"},
        {"label": "keyless"},
    ]
    sr = section()
    await applier._apply_relation_types(db, bundle(schema.SHEET_RELATION_TYPES, rows), sr, False)
    uses = await relation_type(db, "uses")
    assert (uses.label, uses.reverse_label, uses.attributes_schema) == (
        "uses",
        "used by",
        [{"key": "k"}],
    )
    old = await relation_type(db, "old")
    assert (old.label, old.built_in) == ("now", True)
    assert counts(sr) == (1, 1, 1, 0, 1)


# ── config sections ─────────────────────────────────────────────────────────


def config(sheet: str):
    (sec,) = [s for s in schema.CONFIG_SECTIONS if s.sheet == sheet]
    return applier._make_config_applier(sec)


async def test_an_imported_role_has_its_legacy_permissions_renamed(db):
    rows = [
        {
            "key": "auditor",
            "label": "Auditor",
            "permissions": '{"subscriptions.view": true, "inventory.view": true}',
        },
        {"key": "plain", "label": "Plain"},
        {"label": "keyless"},
    ]
    sr = section()
    await config(schema.SHEET_ROLES)(db, bundle(schema.SHEET_ROLES, rows), sr, False)
    roles = {r.key: r for r in (await db.execute(select(Role))).scalars().all()}
    assert roles["auditor"].permissions == {"stakeholders.view": True, "inventory.view": True}
    assert roles["plain"].permissions == {}
    assert counts(sr) == (2, 0, 0, 0, 1)


async def test_an_existing_role_takes_the_bundle_values_but_not_a_new_key(db):
    await create_role(db, key="auditor", label="Old", permissions={"inventory.view": True})
    rows = [
        {"key": "auditor", "label": "New", "permissions": '{"inventory.quality_seal": true}'},
        {"key": "auditor", "label": "New", "permissions": '{"inventory.approval_status": true}'},
    ]
    sr = section()
    await config(schema.SHEET_ROLES)(db, bundle(schema.SHEET_ROLES, rows), sr, False)
    role = (await db.execute(select(Role).where(Role.key == "auditor"))).scalar_one()
    assert (role.label, role.permissions) == ("New", {"inventory.approval_status": True})
    assert counts(sr) == (0, 1, 1, 0, 0)


async def test_an_imported_stakeholder_role_loses_its_dead_card_keys(db):
    await create_card_type(db, key="Application", label="Application")
    rows = [
        {
            "card_type_key": "Application",
            "key": "owner",
            "label": "Owner",
            "permissions": '{"card.quality_seal": true, "card.view": true}',
        },
        {"key": "half", "label": "No type"},
        {"card_type_key": "Application", "label": "No key"},
    ]
    sr = section()
    sheet = schema.SHEET_STAKEHOLDER_ROLES
    await config(sheet)(db, bundle(sheet, rows), sr, False)
    srd = (await db.execute(select(StakeholderRoleDefinition))).scalars().all()
    assert [(d.card_type_key, d.key, d.permissions) for d in srd] == [
        ("Application", "owner", {"card.view": True})
    ]
    assert counts(sr) == (1, 0, 0, 0, 2)


# ── tags ────────────────────────────────────────────────────────────────────


async def test_tag_groups_are_created_updated_and_named(db):
    db.add(TagGroup(name="Old", mode="multi", description="d"))
    await db.flush()
    rows = [
        {
            "name": "Domain",
            "mode": "single",
            "restrict_to_types": '["Application"]',
            "mandatory": True,
            "description": "Where it lives",
        },
        {"name": "Old", "mode": "single"},
        {"name": "Old", "mode": "single"},
        {"description": "nameless"},
    ]
    sr = section()
    await applier._apply_tag_groups(db, bundle(schema.SHEET_TAG_GROUPS, rows), sr, False)
    groups = {g.name: g for g in (await db.execute(select(TagGroup))).scalars().all()}
    domain = groups["Domain"]
    assert (domain.mode, domain.restrict_to_types, domain.mandatory, domain.description) == (
        "single",
        ["Application"],
        True,
        "Where it lives",
    )
    assert (groups["Old"].mode, groups["Old"].description) == ("single", "d")
    assert counts(sr) == (1, 1, 1, 0, 1)


async def tags_in(db):
    return {t.name: t for t in (await db.execute(select(Tag))).scalars().all()}


async def test_a_tag_needs_its_group_and_a_name(db):
    db.add(TagGroup(name="Domain"))
    await db.flush()
    rows = [
        {"group_name": "Domain", "name": "Finance", "color": "#111111", "description": "money"},
        {"group_name": "Nope", "name": "Lost"},
        {"group_name": "Domain", "name": ""},
    ]
    sr = section()
    await applier._apply_tags(db, bundle(schema.SHEET_TAGS, rows), sr, False)
    finance = (await tags_in(db))["Finance"]
    assert (finance.color, finance.description, finance.sort_order) == ("#111111", "money", 0)
    assert counts(sr) == (1, 0, 0, 2, 0)
    assert sr.errors == [
        "tag 'Lost': group 'Nope' not found — skipped",
        "tag '': group 'Domain' not found — skipped",
    ]


@pytest.mark.parametrize(
    "change",
    [{"color": "#222222"}, {"sort_order": 3}, {"description": "new"}],
)
async def test_any_one_changed_tag_field_updates_all_three(db, change):
    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    db.add(Tag(tag_group_id=group.id, name="Finance", color="#111111", sort_order=0))
    await db.flush()
    row = {"group_name": "Domain", "name": "Finance", "color": "#111111", "sort_order": 0}
    sr = section()
    await applier._apply_tags(db, bundle(schema.SHEET_TAGS, [{**row, **change}]), sr, False)
    finance = (await tags_in(db))["Finance"]
    expected = {"color": "#111111", "sort_order": 0, "description": None, **change}
    assert (finance.color, finance.sort_order, finance.description) == (
        expected["color"],
        expected["sort_order"],
        expected["description"],
    )
    assert counts(sr) == (0, 1, 0, 0, 0)


async def test_an_unchanged_tag_is_skipped_and_a_missing_order_reads_zero(db):
    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    db.add(Tag(tag_group_id=group.id, name="Finance", color="#111111", sort_order=0))
    await db.flush()
    rows = [
        {"group_name": "Domain", "name": "Finance", "color": "#111111"},
        {"group_name": "Domain", "name": "New"},
        {"group_name": "Domain", "name": "New", "sort_order": 0},
    ]
    sr = section()
    await applier._apply_tags(db, bundle(schema.SHEET_TAGS, rows), sr, False)
    assert counts(sr) == (1, 0, 2, 0, 0)
    assert sr.skip_reasons == {"identical": 2}


# ── users ───────────────────────────────────────────────────────────────────


async def users_by_email(db):
    return {u.email: u for u in (await db.execute(select(User))).scalars().all()}


async def test_imported_users_land_deactivated_with_safe_defaults(db):
    await create_role(db, key="member", label="Member")
    await create_role(db, key="viewer", label="Viewer")
    await create_user(db, email="existing@test.com")
    rows = [
        {
            "email": "  New@X.com ",
            "display_name": "",
            "role": "viewer",
            "auth_provider": "",
            "locale": "",
        },
        {"email": "boss@x.com", "role": "superuser", "display_name": "Boss"},
        {"email": "sso@x.com", "auth_provider": "sso", "locale": "de", "display_name": "S"},
        {"email": "EXISTING@test.com"},
        {"email": "new@x.com"},
        {"email": ""},
        {"display_name": "No email"},
    ]
    sr = section()
    await applier._apply_users(db, bundle(schema.SHEET_USERS, rows), sr, False)
    users = await users_by_email(db)
    new = users["New@X.com"]
    assert (new.display_name, new.role, new.is_active) == ("New@X.com", "viewer", False)
    assert (new.auth_provider, new.locale, new.password_hash) == ("local", "en", None)
    assert (users["boss@x.com"].role, users["boss@x.com"].display_name) == ("member", "Boss")
    sso = users["sso@x.com"]
    assert (sso.auth_provider, sso.locale, sso.display_name) == ("sso", "de", "S")
    assert counts(sr) == (3, 0, 2, 0, 2)
    assert sr.skip_reasons == {"user_exists": 2}


# ── settings ────────────────────────────────────────────────────────────────


@pytest.fixture
def runtime(monkeypatch):
    applied = []
    monkeypatch.setattr(applier, "apply_email_settings_to_runtime", applied.append)
    return applied


async def settings_row(db):
    return (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()


async def test_settings_create_the_row_and_merge_without_secrets(db, runtime):
    rows = [
        {"key": "general_settings", "value": '{"theme": "dark"}'},
        {"key": "email_settings", "value": '{"smtp_host": "mail", "smtp_password": "x"}'},
        {"key": "custom_logo_mime", "value": '"image/png"'},
        {"key": "custom_favicon_mime", "value": '"image/x-icon"'},
        {"value": '{"ignored": true}'},
    ]
    assets = {"branding/logo.png": b"LOGO", "branding/favicon.ico": b"FAV"}
    sr = section()
    await applier._apply_settings(db, bundle(schema.SHEET_SETTINGS, rows, assets), sr, False)
    row = await settings_row(db)
    assert row.general_settings == {"theme": "dark"}
    assert row.email_settings == {"smtp_host": "mail"}
    assert (row.custom_logo_mime, row.custom_favicon_mime) == ("image/png", "image/x-icon")
    binaries = (await db.execute(select(AppSettings.custom_logo, AppSettings.custom_favicon))).one()
    assert tuple(binaries) == (b"LOGO", b"FAV")
    assert runtime == [{"smtp_host": "mail"}]
    assert counts(sr) == (0, 2, 0, 0, 0)


async def test_unchanged_settings_are_skipped_and_the_runtime_is_left_alone(db, runtime):
    db.add(
        AppSettings(
            id="default",
            general_settings={"theme": "dark"},
            email_settings={"smtp_host": "mail"},
            custom_logo_mime="image/svg+xml",
        )
    )
    await db.flush()
    rows = [
        {"key": "general_settings", "value": '{"theme": "dark"}'},
        {"key": "email_settings", "value": '{"smtp_host": "mail"}'},
        {"key": "custom_logo_mime", "value": ""},
    ]
    sr = section()
    await applier._apply_settings(db, bundle(schema.SHEET_SETTINGS, rows), sr, False)
    row = await settings_row(db)
    assert row.custom_logo_mime == "image/svg+xml"
    assert runtime == []
    assert counts(sr) == (0, 0, 2, 0, 0)
    assert sr.skip_reasons == {"identical": 2}


async def test_settings_that_are_not_objects_are_ignored(db, runtime):
    db.add(AppSettings(id="default", general_settings={"theme": "dark"}, email_settings={}))
    await db.flush()
    rows = [
        {"key": "general_settings", "value": '"flat"'},
        {"key": "email_settings", "value": "[1]"},
    ]
    sr = section()
    await applier._apply_settings(db, bundle(schema.SHEET_SETTINGS, rows), sr, False)
    assert (await settings_row(db)).general_settings == {"theme": "dark"}
    assert counts(sr) == (0, 0, 0, 0, 0)


# ── associations ────────────────────────────────────────────────────────────


@pytest.fixture
async def diagram_env(db):
    await create_card_type(db, key="Application", label="Application")
    app = await create_card(db, name="Billing")
    await create_card(db, name="Twin")
    await create_card(db, name="Twin")
    diagram = Diagram(name="Landscape", data={})
    group = DiagramGroup(name="Folder")
    db.add_all([diagram, group])
    await db.flush()
    resolver = await CardResolver.load(db, {"Application"})
    return SimpleNamespace(app=app, diagram=diagram, group=group, resolver=resolver)


async def test_diagram_card_links_resolve_their_card_and_skip_repeats(db, diagram_env):
    env = diagram_env
    d = str(env.diagram.id)
    rows = [
        {"diagram_id": d, "card_type": "Application", "card_ref": "Billing"},
        {"diagram_id": d, "card_type": "Application", "card_ref": "Billing"},
        {"diagram_id": d, "card_type": "Application", "card_ref": "Twin"},  # ambiguous
        {"diagram_id": d, "card_type": "Application", "card_ref": "Nobody"},
        {"diagram_id": str(uuid.uuid4()), "card_type": "Application", "card_ref": "Billing"},
        {"diagram_id": d, "card_type": "Application"},
        {"diagram_id": d, "card_ref": "Billing"},
        {"card_type": "Application", "card_ref": "Billing"},
    ]
    sr = section()
    await applier._apply_diagram_cards(db, bundle(SHEET_DIAGRAM_CARDS, rows), sr, env.resolver)
    links = (await db.execute(select(diagram_cards))).all()
    assert [(r.diagram_id, r.card_id) for r in links] == [(env.diagram.id, env.app.id)]
    assert counts(sr) == (1, 0, 1, 3, 3)
    sr2 = section()
    await applier._apply_diagram_cards(db, bundle(SHEET_DIAGRAM_CARDS, rows[:1]), sr2, env.resolver)
    assert counts(sr2) == (0, 0, 1, 0, 0)
    assert sr2.skip_reasons == {"already_present": 1}


async def test_no_diagram_card_rows_touch_nothing(db, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("queried")

    monkeypatch.setattr(db, "execute", boom)
    sr = section()
    await applier._apply_diagram_cards(db, bundle(SHEET_DIAGRAM_CARDS, []), sr, None)
    await applier._apply_diagram_group_members(db, bundle(SHEET_DIAGRAM_GROUP_MEMBERS, []), sr)
    await applier._apply_bookmark_shares(db, bundle(SHEET_BOOKMARK_SHARES, []), sr, {})
    assert counts(sr) == (0, 0, 0, 0, 0)


async def test_group_members_need_both_ends_to_exist(db, diagram_env):
    env = diagram_env
    d, g = str(env.diagram.id), str(env.group.id)
    rows = [
        {"diagram_id": d, "group_id": g},
        {"diagram_id": d, "group_id": g},
        {"diagram_id": d, "group_id": str(uuid.uuid4())},
        {"diagram_id": str(uuid.uuid4()), "group_id": g},
        {"diagram_id": d},
        {"group_id": g},
    ]
    sr = section()
    await applier._apply_diagram_group_members(db, bundle(SHEET_DIAGRAM_GROUP_MEMBERS, rows), sr)
    members = (await db.execute(select(diagram_group_members))).all()
    assert [(m.diagram_id, m.group_id) for m in members] == [(env.diagram.id, env.group.id)]
    assert counts(sr) == (1, 0, 1, 2, 2)
    sr2 = section()
    await applier._apply_diagram_group_members(
        db, bundle(SHEET_DIAGRAM_GROUP_MEMBERS, rows[:1]), sr2
    )
    assert sr2.skip_reasons == {"already_present": 1}


async def test_bookmark_shares_match_the_user_by_email(db):
    owner = await create_user(db, email="owner@test.com")
    friend = await create_user(db, email="friend@test.com")
    other = await create_user(db, email="other@test.com")
    bm = Bookmark(user_id=owner.id, name="My view")
    db.add(bm)
    await db.flush()
    emails = {"friend@test.com": friend.id, "other@test.com": other.id}
    b = str(bm.id)
    rows = [
        {"bookmark_id": b, "user_email": "Friend@Test.com", "can_edit": 1},
        {"bookmark_id": b, "user_email": "other@test.com"},
        {"bookmark_id": b, "user_email": "friend@test.com"},
        {"bookmark_id": b, "user_email": "ghost@test.com"},
        {"bookmark_id": str(uuid.uuid4()), "user_email": "friend@test.com"},
        {"bookmark_id": b},
        {"user_email": "friend@test.com"},
    ]
    sr = section()
    await applier._apply_bookmark_shares(db, bundle(SHEET_BOOKMARK_SHARES, rows), sr, emails)
    shares = {(s.user_id, s.can_edit) for s in (await db.execute(select(bookmark_shares))).all()}
    assert shares == {(friend.id, True), (other.id, False)}
    assert counts(sr) == (2, 0, 1, 2, 2)
    assert sr.skip_reasons == {"already_present": 1}
    assert sr.errors[0] == (
        f"bookmark share: bookmark {b!r} or user 'ghost@test.com' not found — skipped"
    )
    assert len(sr.errors) == 2


# ── counters accumulate, and a refused row never ends a section ─────────────


def test_every_changed_row_adds_to_the_updated_count():
    sr = section()
    applier._update_if_changed(SimpleNamespace(a=1), {"a": 2}, ["a"], sr)
    applier._update_if_changed(SimpleNamespace(a=1), {"a": 3}, ["a"], sr)
    assert counts(sr) == (0, 2, 0, 0, 0)


def test_a_secret_name_is_protected_only_under_its_own_parent():
    merged = applier._merge_settings(
        {"sso": {"client_secret": "keep"}},
        {"sso": {"apiKey": "not a secret here", "client_secret": "evil"}},
        GENERAL_SECRET_PATHS,
    )
    assert merged == {"sso": {"client_secret": "keep", "apiKey": "not a secret here"}}


async def test_card_types_after_a_refused_row_are_still_created(db):
    rows = [
        {"label": "No key"},
        {"key": "Widget", "label": "W"},
        {"key": ""},
        {"key": "Gadget", "label": "G"},
    ]
    sr = section()
    await applier._apply_card_types(db, bundle(schema.SHEET_CARD_TYPES, rows), sr, False)
    assert (await card_type(db, "Widget")).label == "W"
    assert (await card_type(db, "Gadget")) is not None
    assert counts(sr) == (2, 0, 0, 0, 2)


async def test_relation_types_after_a_refused_row_are_still_created(db):
    await create_card_type(db, key="Application", label="Application")
    rows = [
        {"label": "keyless"},
        {
            "key": "a",
            "label": "a",
            "source_type_key": "Application",
            "target_type_key": "Application",
        },
        {"key": ""},
        {
            "key": "b",
            "label": "b",
            "source_type_key": "Application",
            "target_type_key": "Application",
        },
    ]
    sr = section()
    await applier._apply_relation_types(db, bundle(schema.SHEET_RELATION_TYPES, rows), sr, False)
    assert (await relation_type(db, "b")) is not None
    assert counts(sr) == (2, 0, 0, 0, 2)


async def test_a_role_listed_twice_is_created_once(db):
    rows = [{"key": "auditor", "label": "First"}, {"key": "auditor", "label": "Second"}]
    sr = section()
    await config(schema.SHEET_ROLES)(db, bundle(schema.SHEET_ROLES, rows), sr, False)
    roles = (await db.execute(select(Role).where(Role.key == "auditor"))).scalars().all()
    assert [r.label for r in roles] == ["Second"]
    assert counts(sr) == (1, 1, 0, 0, 0)


async def test_tag_groups_after_a_refused_row_are_created_once_each(db):
    rows = [
        {"description": "nameless"},
        {"name": "Domain", "mode": "single"},
        {"name": ""},
        {"name": "Region"},
        {"name": "Domain", "mode": "multi"},
    ]
    sr = section()
    await applier._apply_tag_groups(db, bundle(schema.SHEET_TAG_GROUPS, rows), sr, False)
    groups = (await db.execute(select(TagGroup))).scalars().all()
    assert sorted(g.name for g in groups) == ["Domain", "Region"]
    assert {g.name: g.mode for g in groups}["Domain"] == "multi"
    assert counts(sr) == (2, 1, 0, 0, 2)


async def test_several_tags_are_created_and_updated_in_one_pass(db):
    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    db.add_all(
        [
            Tag(tag_group_id=group.id, name="A", color="#000000", sort_order=0),
            Tag(tag_group_id=group.id, name="B", color="#000000", sort_order=0),
        ]
    )
    await db.flush()
    rows = [
        {"group_name": "Domain", "name": "A", "color": "#111111"},
        {"group_name": "Domain", "name": "B", "color": "#222222"},
        {"group_name": "Domain", "name": "C", "sort_order": 5},
        {"group_name": "Domain", "name": "D", "sort_order": 7},
    ]
    sr = section()
    await applier._apply_tags(db, bundle(schema.SHEET_TAGS, rows), sr, False)
    tags = await tags_in(db)
    assert (tags["C"].sort_order, tags["D"].sort_order) == (5, 7)
    assert counts(sr) == (2, 2, 0, 0, 0)


async def test_settings_keep_what_the_bundle_does_not_mention(db, runtime):
    db.add(
        AppSettings(
            id="default",
            general_settings={"theme": "dark", "keep": 1},
            email_settings={"smtp_host": "old", "smtp_port": 25},
        )
    )
    await db.flush()
    rows = [
        {"key": "general_settings", "value": '{"theme": "light"}'},
        {"key": "email_settings", "value": '{"smtp_host": "new"}'},
    ]
    sr = applier.SectionResult(sheet=schema.SHEET_SETTINGS, updated=3)
    await applier._apply_settings(db, bundle(schema.SHEET_SETTINGS, rows), sr, False)
    row = await settings_row(db)
    assert row.general_settings == {"theme": "light", "keep": 1}
    assert row.email_settings == {"smtp_host": "new", "smtp_port": 25}
    assert sr.updated == 5


async def test_several_diagram_links_and_members_are_created(db, diagram_env):
    env = diagram_env
    second_card = await create_card(db, name="Payroll")
    second_group = DiagramGroup(name="Other folder")
    db.add(second_group)
    await db.flush()
    resolver = await CardResolver.load(db, {"Application"})
    d = str(env.diagram.id)
    cards_rows = [
        {"diagram_id": d, "card_type": "Application", "card_ref": "Billing"},
        {"diagram_id": d, "card_type": "Application", "card_ref": "Payroll"},
    ]
    sr = section()
    await applier._apply_diagram_cards(db, bundle(SHEET_DIAGRAM_CARDS, cards_rows), sr, resolver)
    assert counts(sr) == (2, 0, 0, 0, 0)
    assert {r.card_id for r in (await db.execute(select(diagram_cards))).all()} == {
        env.app.id,
        second_card.id,
    }
    member_rows = [
        {"diagram_id": d, "group_id": str(env.group.id)},
        {"diagram_id": d, "group_id": str(second_group.id)},
    ]
    sr2 = section()
    await applier._apply_diagram_group_members(
        db, bundle(SHEET_DIAGRAM_GROUP_MEMBERS, member_rows), sr2
    )
    assert counts(sr2) == (2, 0, 0, 0, 0)
