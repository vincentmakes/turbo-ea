"""The read scope beyond row filters: references, event feeds and payloads.

``test_card_read_scope.py`` pins ``clause`` / ``readable`` / the single-card
guard to one truth. This file pins the other surfaces a hidden card must not
leak through: ``ref_clause`` (a card named by text, e.g. in an event's JSONB),
``event_read_filters`` (activity feeds), ``scrub_event_payloads`` (id lists
inside a payload), ``keep_hidden`` (replace-set writes) and the inventory
browse gate. Scopes are built directly so each case states its rights.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import String, literal, select

from app.models.event import Event
from app.services.card_read_scope import (
    CardReadScope,
    event_read_filters,
    require_inventory_browse,
    scrub_event_payloads,
)
from tests.conftest import create_card, create_card_type, create_role, create_user

HELD = uuid.uuid4()


def scope(
    *,
    base_view: bool = True,
    denied: tuple[str, ...] = (),
    allowed: tuple[str, ...] = (),
    held: tuple[uuid.UUID, ...] = (),
    wildcard: bool = False,
) -> CardReadScope:
    return CardReadScope(
        role_key="r",
        wildcard=wildcard,
        base_view=base_view,
        denied_types=frozenset(denied),
        allowed_types=frozenset(allowed),
        stakeholder_card_ids=frozenset(held),
    )


async def ref(db, read_scope, type_key, card_id, *, mode):
    clause = read_scope.ref_clause(literal(type_key, String), literal(card_id, String), mode=mode)
    if clause is None:
        return "unrestricted"
    return (await db.execute(select(clause))).scalar()


class TestRefClause:
    @pytest.mark.parametrize("mode", ["inventory", "module"])
    async def test_wildcard_and_plain_view_need_no_clause(self, db, mode):
        assert await ref(db, scope(wildcard=True), "X", None, mode=mode) == "unrestricted"
        assert await ref(db, scope(base_view=True), "X", None, mode=mode) == "unrestricted"

    async def test_without_global_view_only_inventory_mode_is_restricted(self, db):
        no_view = scope(base_view=False)
        assert await ref(db, no_view, "X", None, mode="module") == "unrestricted"
        assert await ref(db, no_view, "X", None, mode="inventory") is False

    @pytest.mark.parametrize("mode", ["inventory", "module"])
    async def test_a_denied_type_is_dropped_others_kept(self, db, mode):
        s = scope(denied=("Secret",))
        assert await ref(db, s, "Secret", str(uuid.uuid4()), mode=mode) is False
        assert await ref(db, s, "Open", str(uuid.uuid4()), mode=mode) is True

    @pytest.mark.parametrize("mode", ["inventory", "module"])
    async def test_a_row_naming_no_card_is_kept(self, db, mode):
        # NULL NOT IN (...) is NULL, not TRUE — the explicit IS NULL branch keeps it.
        assert await ref(db, scope(denied=("Secret",)), None, None, mode=mode) is True
        assert await ref(db, scope(base_view=False), None, None, mode="inventory") is True

    async def test_allow_cells_open_their_types_in_inventory_mode(self, db):
        s = scope(base_view=False, allowed=("Open",))
        assert await ref(db, s, "Open", None, mode="inventory") is True
        assert await ref(db, s, "Other", None, mode="inventory") is False

    async def test_module_mode_ignores_allow_cells_and_keeps_undenied_types(self, db):
        s = scope(base_view=False, denied=("Secret",), allowed=("Open",))
        assert await ref(db, s, "Other", None, mode="module") is True
        assert await ref(db, s, "Secret", None, mode="module") is False

    @pytest.mark.parametrize("mode", ["inventory", "module"])
    async def test_a_held_card_of_a_hidden_type_is_kept_by_id(self, db, mode):
        s = scope(denied=("Secret",), held=(HELD,))
        assert await ref(db, s, "Secret", str(HELD), mode=mode) is True
        assert await ref(db, s, "Secret", str(uuid.uuid4()), mode=mode) is False

    async def test_held_cards_survive_without_any_type_grant(self, db):
        s = scope(base_view=False, held=(HELD,))
        assert await ref(db, s, "Open", str(HELD), mode="inventory") is True
        assert await ref(db, s, "Open", str(uuid.uuid4()), mode="inventory") is False


@pytest.fixture
async def landscape(db):
    await create_card_type(db, key="Open", label="Open")
    await create_card_type(db, key="Secret", label="Secret")
    return {
        "open": await create_card(db, card_type="Open", name="Open"),
        "secret": await create_card(db, card_type="Secret", name="Secret"),
        "held": await create_card(db, card_type="Secret", name="Held"),
    }


class TestEventReadFilters:
    def test_unrestricted_scopes_add_nothing(self):
        assert event_read_filters(scope(wildcard=True)) == ()
        assert event_read_filters(scope(base_view=True)) == ()
        # Feeds are module mode: no global View alone hides nothing.
        assert event_read_filters(scope(base_view=False)) == ()

    async def test_events_about_or_naming_hidden_cards_are_dropped(self, db, landscape):
        o, s, h = landscape["open"], landscape["secret"], landscape["held"]
        gone = str(uuid.uuid4())
        rows = {
            "no_card": (None, {}),
            "null_data": (None, None),
            "open": (o.id, {}),
            "secret": (s.id, {}),
            "held": (h.id, {}),
            "deleted_open": (None, {"type": "Open", "id": gone}),
            "deleted_secret": (None, {"type": "Secret", "id": gone}),
            "deleted_but_held": (None, {"type": "Secret", "id": str(h.id)}),
            "peer_open": (o.id, {"peer_type": "Open", "peer_id": gone}),
            "peer_secret": (o.id, {"peer_type": "Secret", "peer_id": str(s.id)}),
            "peer_held": (o.id, {"peer_type": "Secret", "peer_id": str(h.id)}),
        }
        ids = {}
        for name, (card_id, data) in rows.items():
            event = Event(card_id=card_id, event_type=f"t.{name}", data=data)
            db.add(event)
            await db.flush()
            ids[event.id] = name
        filters = event_read_filters(scope(denied=("Secret",), held=(h.id,)))
        kept = (await db.execute(select(Event.id).where(*filters))).scalars().all()
        assert {ids[i] for i in kept if i in ids} == {
            "no_card",
            "null_data",
            "open",
            "held",
            "deleted_open",
            "deleted_but_held",
            "peer_open",
            "peer_held",
        }


class TestScrubEventPayloads:
    async def test_unrestricted_returns_the_payloads_as_stored(self, db):
        payloads = [{"card_id": str(uuid.uuid4())}, None]
        out = await scrub_event_payloads(db, scope(wildcard=True), payloads)
        assert out == payloads
        assert out[0] is payloads[0]

    async def test_nothing_hidden_returns_the_payloads_as_stored(self, db, landscape):
        payloads = [{"card_id": str(landscape["open"].id)}]
        out = await scrub_event_payloads(db, scope(denied=("Secret",)), payloads)
        assert out[0] is payloads[0]

    async def test_hidden_ids_are_removed_from_every_id_key(self, db, landscape):
        o, s, h = (str(landscape[k].id) for k in ("open", "secret", "held"))
        gone = str(uuid.uuid4())
        payloads = [
            None,
            "not a dict",
            {
                "card_id": s,
                "source_card_id": o,
                "linked_card_ids": ["junk", None, o, s, gone, h],
                "affected_related_card_ids": [s],
                "affected_child_ids": [s, o],
                "affected_children": [s],
                "card_ids_note": [s],
                "note": s,
                "title": "kept",
            },
            {"target_card_id": s},
            {"card_id": h},
        ]
        out = await scrub_event_payloads(
            db, scope(denied=("Secret",), held=(landscape["held"].id,)), payloads
        )
        assert out[0] is None
        assert out[1] == "not a dict"
        assert out[2] == {
            "card_id": None,
            "source_card_id": o,
            "linked_card_ids": ["junk", None, o, gone, h],
            "affected_related_card_ids": [],
            "affected_child_ids": [o],
            "affected_children": [s],
            "card_ids_note": [s],
            "note": s,
            "title": "kept",
        }
        assert out[3] == {"target_card_id": None}
        assert out[4] == {"card_id": h}
        # A copy: the stored payload is never edited in place.
        assert payloads[2]["card_id"] == s


class TestKeepHidden:
    def test_hidden_links_are_merged_into_the_desired_set(self):
        o, s, h, new = (uuid.uuid4() for _ in range(4))
        read_scope = scope(denied=("Secret",), held=(h,))
        existing = {o: "Open", s: "Secret", h: "Secret"}
        assert read_scope.keep_hidden(existing, {new}, mode="module") == {new, s}

    def test_the_mode_decides_what_counts_as_hidden(self):
        o = uuid.uuid4()
        read_scope = scope(base_view=False)
        assert read_scope.keep_hidden({o: "Open"}, set(), mode="module") == set()
        assert read_scope.keep_hidden({o: "Open"}, set(), mode="inventory") == {o}


class TestRequireInventoryBrowse:
    async def test_refused_with_403(self, db):
        await create_role(db, key="none", label="None", permissions={})
        user = await create_user(db, email="none@t.com", role="none")
        with pytest.raises(HTTPException) as exc:
            await require_inventory_browse(db, user)
        assert exc.value.status_code == 403
        assert exc.value.detail == "Insufficient permissions"

    async def test_global_view_admits_and_returns_the_scope(self, db):
        await create_role(db, key="v", label="V", permissions={"inventory.view": True})
        user = await create_user(db, email="v@t.com", role="v")
        read_scope = await require_inventory_browse(db, user)
        assert read_scope.base_view is True
        assert read_scope.role_key == "v"
