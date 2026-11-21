"""cost_event_redaction: who loses cost values, which keys count, which events get a summary."""

from __future__ import annotations

import uuid

from app.models.event import Event
from app.services import cost_event_redaction as red
from app.services import cost_item_types
from app.services.cost_items_migration import LEGACY_ITEMS
from tests.conftest import create_card_type


def _event(card_id, event_type="card.updated"):
    return Event(card_id=card_id, event_type=event_type, data={})


def _payload(tag):
    return {
        "tag": tag,
        "changes": {"costTotalAnnual": {"old": 1, "new": 2}, "name": {"old": "a", "new": "b"}},
    }


async def test_all_cost_keys_unions_total_legacy_catalogue_and_cost_typed_fields(db):
    await create_card_type(
        db,
        key="Application",
        fields_schema=[
            {
                "section": "Cost",
                "fields": [
                    {"key": "budget", "type": "cost"},
                    {"key": "note", "type": "text"},
                ],
            }
        ],
    )
    await create_card_type(db, key="Provider", label="Provider", fields_schema=None)
    await cost_item_types.create_item(db, "lic", "Licences")
    keys = await red.all_cost_keys(db)
    assert keys == frozenset({"costTotalAnnual", "budget", "lic", *(k for k, _ in LEGACY_ITEMS)})
    assert "note" not in keys


async def test_nobody_is_redacted_when_everyone_has_access(db, monkeypatch):
    a, b = uuid.uuid4(), uuid.uuid4()
    events = [_event(a), _event(b), _event(None)]
    payloads = [_payload(1), _payload(2), None]

    async def access(_db, _user, ids):
        return set(ids)

    async def no_keys(_db):
        raise AssertionError("the key set is only needed when somebody is redacted")

    async def scrub(_db, _user, items):
        return [payload for _, payload in items]

    monkeypatch.setattr(red.PermissionService, "card_ids_with_cost_access", access)
    monkeypatch.setattr(red, "all_cost_keys", no_keys)
    monkeypatch.setattr(red, "scrub_event_costs", scrub)
    assert await red.redact_cost_events(db, object(), events, payloads) == payloads
    assert await red.redact_cost_events(db, object(), [_event(None)], [None]) == [None]


async def test_only_the_events_of_cards_without_cost_access_are_redacted(db, monkeypatch):
    allowed, hidden = uuid.uuid4(), uuid.uuid4()
    events = [_event(allowed), _event(hidden), _event(None)]
    payloads = [_payload("a"), _payload("h"), _payload("none")]

    async def access(_db, _user, ids):
        return {allowed}

    async def scrub(_db, _user, items):
        return [
            {**payload, "changes": {"name": payload["changes"]["name"]}}
            if card_id == hidden
            else payload
            for card_id, payload in items
        ]

    monkeypatch.setattr(red.PermissionService, "card_ids_with_cost_access", access)
    monkeypatch.setattr(red, "scrub_event_costs", scrub)
    out = await red.redact_cost_events(db, object(), events, payloads)
    assert out[0] == payloads[0]  # costs readable
    assert out[1] == {"tag": "h", "changes": {"name": {"old": "a", "new": "b"}}}
    assert out[2] == payloads[2]  # card-less event: nothing to hide it from


async def test_summaries_go_only_to_cost_events_with_a_dict_payload(db, monkeypatch):
    seen = []

    async def summaries(_db, card_name, payloads):
        seen.append((card_name, payloads))
        return [f"summary {i}" for i, _ in enumerate(payloads)]

    monkeypatch.setattr(red, "cost_event_summaries", summaries)
    events = [
        _event(None, red.COST_EVENT),
        _event(None, "card.updated"),
        _event(None, red.COST_EVENT),
        _event(None, red.COST_EVENT),
    ]
    payloads = [{"n": 0}, {"n": 1}, None, {"n": 3}]
    out = await red.add_cost_summaries(db, "ERP", events, payloads)
    assert seen == [("ERP", [{"n": 0}, {"n": 3}])]
    assert out == [
        {"n": 0, "summary": "summary 0"},
        {"n": 1},
        None,
        {"n": 3, "summary": "summary 1"},
    ]
    assert payloads[0] == {"n": 0}  # the input list is not edited
