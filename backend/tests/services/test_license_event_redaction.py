"""License values in event feeds: who loses them, the summary text, the rollback decline."""

from __future__ import annotations

import uuid

from sqlalchemy import event as sa_event

from app.models.event import Event
from app.services import card_licenses as cl
from app.services import cost_event_redaction as red
from app.services import rollback_service
from app.services.audit_labels import license_type_labels
from tests.conftest import (
    create_card,
    create_card_type,
    create_license_metric,
    create_license_type,
    create_role,
    create_user,
)


def _legacy_diff():
    return {
        "changes": {
            "attributes": {
                "old": {"licensedUsers": 5, "name": "x"},
                "new": {"licensedUsers": 9, "name": "x"},
            },
            "actualInstallations": {"old": 1, "new": 2},
            "description": {"old": "a", "new": "b"},
        }
    }


def _types_list():
    return {"fiscal_year": 2026, "changes": {cl.LIST_KEY: {"old": [], "new": ["users:admin"]}}}


async def _card_and_user(db, permissions):
    await create_card_type(db, key="Application")
    await create_role(db, key="r_test", permissions=permissions)
    user = await create_user(db, email=f"{uuid.uuid4().hex[:8]}@lic-red.com", role="r_test")
    return await create_card(db), user


async def test_legacy_diff_of_old_keys_redacted_without_license_access(db):
    card, user = await _card_and_user(db, {"costs.view": True})
    out = await red.redact_cost_events(
        db, user, [Event(card_id=card.id, event_type="card.updated")], [_legacy_diff()]
    )
    assert out[0]["changes"] == {
        "attributes": {"old": {"name": "x"}, "new": {"name": "x"}},
        "description": {"old": "a", "new": "b"},
    }
    await create_role(db, key="admin", permissions={"*": True})
    keeper = await create_user(db, email="k@lic-red.com", role="admin")
    kept = await red.redact_cost_events(
        db, keeper, [Event(card_id=card.id, event_type="card.updated")], [_legacy_diff()]
    )
    assert kept[0] == _legacy_diff()


async def test_license_types_list_redacted_without_access(db):
    card, user = await _card_and_user(db, {"licenses.view": True})
    await create_role(db, key="viewer", permissions={"inventory.view": True})
    other = await create_user(db, email="o@lic-red.com", role="viewer")
    ev = Event(card_id=card.id, event_type=cl.LICENSE_EVENT)
    assert (await red.redact_cost_events(db, user, [ev], [_types_list()]))[0] == _types_list()
    out = (await red.redact_cost_events(db, other, [ev], [_types_list()]))[0]
    assert out == {"fiscal_year": 2026, "changes": {}}


async def test_cost_keys_redacted_for_a_license_only_reader(db):
    card, user = await _card_and_user(db, {"licenses.view": True})
    payload = {"changes": {"costTotalAnnual": {"old": 1, "new": 2}, "cost_items": {"new": ["a"]}}}
    out = await red.redact_cost_events(
        db, user, [Event(card_id=card.id, event_type="card.costs_updated")], [payload]
    )
    assert out[0]["changes"] == {}


async def test_summary_names_year_and_labels(db):
    await create_license_type(db, "admin", "Admin users")
    await create_license_type(db, "prod", "Production")
    await create_license_type(db, "admin", "Admin devices", metric_key="installations")
    full = {
        "fiscal_year": 2026,
        "changes": {cl.LIST_KEY: {"old": ["users:admin"], "new": ["users:admin", "users:prod"]}},
    }
    redacted = {"fiscal_year": 2026, "changes": {}}
    out = await red.add_cost_summaries(
        db,
        "ERP",
        [Event(event_type=cl.LICENSE_EVENT), Event(event_type=cl.LICENSE_EVENT)],
        [full, redacted],
    )
    assert (
        out[0]["summary"]
        == "Licensing of ERP changed (FY26; license types: Users / Admin users, Users / Production)"
    )
    assert out[1]["summary"] == "Licensing of ERP changed (FY26)"
    assert "summary" not in full


async def test_summary_resolves_the_pair_not_the_bare_key(db):
    await create_license_type(db, "admin", "Admin users")
    await create_license_type(db, "admin", "Admin devices", metric_key="installations")
    payload = {"changes": {cl.LIST_KEY: {"old": [], "new": ["installations:admin"]}}}
    out = await red.add_cost_summaries(db, "ERP", [Event(event_type=cl.LICENSE_EVENT)], [payload])
    assert (
        out[0]["summary"]
        == "Licensing of ERP changed (license types: Installations / Admin devices)"
    )


async def test_summary_still_reads_an_old_event_with_plain_keys(db):
    await create_license_type(db, "admin", "Admin users")
    old = {"fiscal_year": 2026, "changes": {cl.LIST_KEY: {"old": [], "new": ["admin"]}}}
    out = await red.add_cost_summaries(db, "ERP", [Event(event_type=cl.LICENSE_EVENT)], [old])
    assert out[0]["summary"] == "Licensing of ERP changed (FY26; license types: Admin users)"


async def test_a_plain_key_under_two_metrics_reads_the_first_metric_s_type(db):
    await create_license_metric(db, "users", "Users", sort_order=0)
    await create_license_metric(db, "installations", "Installations", sort_order=1)
    await create_license_type(db, "admin", "Admin users")
    await create_license_type(db, "admin", "Admin devices", metric_key="installations")
    assert await license_type_labels(db, ["admin"]) == {"admin": "Admin users"}


async def test_labels_of_unknown_keys_take_one_query(db):
    statements: list[str] = []
    bind = db.sync_session.get_bind()

    def record(conn, cursor, statement, *args):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    sa_event.listen(bind, "before_cursor_execute", record)
    try:
        assert await license_type_labels(db, ["users:ghost", "ghost"]) == {}
    finally:
        sa_event.remove(bind, "before_cursor_execute", record)
    assert len(statements) == 1


def test_rollback_declines_license_event():
    plan = rollback_service._plan_inverse(
        Event(
            id=uuid.uuid4(),
            event_type=cl.LICENSE_EVENT,
            data={"changes": {cl.LIST_KEY: {"old": [], "new": ["a"]}}},
        )
    )
    assert plan["op"] == "unsupported"
    assert "edit the licenses instead" in plan["reason"]


def test_touches_looks_at_top_level_and_attribute_sides_only():
    keys = frozenset({"licensedUsers"})
    touches = red._touches
    assert touches({"changes": {"licensedUsers": {"new": 1}}}, keys) is True
    assert touches({"changes": {"attributes": {"old": {"licensedUsers": 1}}}}, keys) is True
    assert touches({"changes": {"attributes": {"new": {"licensedUsers": 1}}}}, keys) is True
    assert touches({"changes": {"attributes": {"new": {"other": 1}}}}, keys) is False
    assert touches({"changes": {"attributes": {"licensedUsers": 1}}}, keys) is False  # not a side
    assert touches({"changes": {"attributes": {"new": 5, "old": {"x": 1}}}}, keys) is False
    assert touches({"changes": {"attributes": "licensedUsers"}}, keys) is False
    assert touches({"changes": ["licensedUsers"]}, keys) is False
    assert touches({"changes": None}, keys) is False
    assert touches({}, keys) is False
    assert touches(None, keys) is False
    assert touches("licensedUsers", keys) is False  # type: ignore[arg-type]


async def test_reader_drop_keys_per_grant(db):
    from app.services.cost_field_filter import COST_ITEMS_KEY

    await create_role(db, key="only_costs", permissions={"costs.view": True})
    await create_role(db, key="only_lic", permissions={"licenses.view": True})
    await create_role(db, key="both", permissions={"costs.view": True, "licenses.view": True})
    await create_role(db, key="none", permissions={"inventory.view": True})
    users = {
        k: await create_user(db, email=f"{k}@lic-drop.com", role=k)
        for k in ("only_costs", "only_lic", "both", "none")
    }
    assert await red.reader_drop_keys(db, users["both"]) == frozenset()
    only_costs = await red.reader_drop_keys(db, users["only_costs"])
    assert only_costs == red.LICENSE_KEYS
    only_lic = await red.reader_drop_keys(db, users["only_lic"])
    assert COST_ITEMS_KEY in only_lic and not only_lic & red.LICENSE_KEYS
    none = await red.reader_drop_keys(db, users["none"])
    assert red.LICENSE_KEYS <= none and COST_ITEMS_KEY in none and none > only_lic


async def test_redaction_is_decided_per_event_and_per_domain(db):
    """A cost-only reader loses license keys, a license-only reader loses cost keys, each on
    its own event; an event with no card is never touched."""
    await create_card_type(db, key="Application")
    await create_role(db, key="only_costs", permissions={"costs.view": True})
    await create_role(db, key="only_lic", permissions={"licenses.view": True})
    costs_user = await create_user(db, email="oc@lic-red2.com", role="only_costs")
    lic_user = await create_user(db, email="ol@lic-red2.com", role="only_lic")
    card = await create_card(db)
    mixed = {
        "changes": {
            "licensedUsers": {"old": 1, "new": 2},
            "costTotalAnnual": {"old": 1, "new": 2},
            "cost_items": {"new": ["a"]},
            "description": {"old": "a", "new": "b"},
        }
    }
    events = [
        Event(card_id=card.id, event_type="card.updated"),
        Event(card_id=None, event_type="card.updated"),
    ]
    out = await red.redact_cost_events(db, costs_user, events, [mixed, mixed])
    assert set(out[0]["changes"]) == {"costTotalAnnual", "cost_items", "description"}
    assert out[1] == mixed
    out = await red.redact_cost_events(db, lic_user, events, [mixed, mixed])
    assert set(out[0]["changes"]) == {"licensedUsers", "description"}
    assert out[1] == mixed
    # a payload with no license key never needs the license access lookup
    plain = {"changes": {"description": {"old": "a", "new": "b"}}}
    out = await red.redact_cost_events(db, costs_user, events[:1], [plain])
    assert out == [plain]
