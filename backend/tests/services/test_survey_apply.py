"""Pure helpers of ``services/survey_apply.py`` — the survey field kinds,
answer parsing and the provenance every survey-applied event carries — plus
the two shared write-path seams the apply leans on: ``update_card``'s
``event_extra`` and the rollback of pre-2.163.0 ``attr_<key>`` changes."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.event import Event
from app.models.notification import Notification
from app.models.stakeholder import Stakeholder
from app.services import survey_apply as sa
from app.services.card_write_service import WriteActor, update_card
from app.services.rollback_service import _apply_restore_card_fields, _plan_card_updated
from tests.conftest import create_card, create_card_type, create_stakeholder_role_def, create_user


class TestFieldKinds:
    def test_relation_needs_kind_type_and_direction(self):
        base = {"kind": "relation", "relation_type_key": "relX", "direction": "outgoing"}
        assert sa.is_relation_field(base)
        assert sa.is_relation_field({**base, "direction": "incoming"})
        assert not sa.is_relation_field({**base, "direction": "sideways"})
        assert not sa.is_relation_field({**base, "relation_type_key": ""})
        assert not sa.is_relation_field({**base, "kind": None})
        assert not sa.is_relation_field("relX")

    @pytest.mark.parametrize("phase", ["plan", "phaseIn", "active", "phaseOut", "endOfLife"])
    def test_every_phase_is_a_lifecycle_field(self, phase):
        assert sa.is_lifecycle_field({"kind": "lifecycle", "phase": phase})

    def test_lifecycle_needs_kind_and_known_phase(self):
        assert not sa.is_lifecycle_field({"kind": "lifecycle", "phase": "sunset"})
        assert not sa.is_lifecycle_field({"kind": "attribute", "phase": "plan"})
        assert not sa.is_lifecycle_field(None)

    def test_stakeholder_needs_kind_and_a_role_string(self):
        assert sa.is_stakeholder_field({"kind": "stakeholder", "role": "observer"})
        assert not sa.is_stakeholder_field({"kind": "stakeholder", "role": ""})
        assert not sa.is_stakeholder_field({"kind": "stakeholder", "role": 3})
        assert not sa.is_stakeholder_field({"kind": "lifecycle", "role": "observer"})
        assert not sa.is_stakeholder_field([])


class TestAnswerParsing:
    @pytest.mark.parametrize(
        "value, expected",
        [
            (None, None),
            ("", ""),
            ("2030-12-31", "2030-12-31"),
            ("2030-12-31T08:00:00", "2030-12-31"),
        ],
    )
    def test_lifecycle_answer(self, value, expected):
        assert sa.normalise_lifecycle_answer(value) == expected

    @pytest.mark.parametrize("value", ["31/12/2030", "soon", 2030, ["2030-12-31"]])
    def test_lifecycle_answer_refuses_non_dates(self, value):
        with pytest.raises(sa.SurveyFieldError, match="Not a date"):
            sa.normalise_lifecycle_answer(value)

    def test_ref_ids_accepts_refs_and_bare_ids(self):
        a, b = uuid.uuid4(), uuid.uuid4()
        assert sa.ref_ids([{"id": str(a)}, str(b), {"id": a}]) == {a, b}
        assert sa.ref_ids([]) == set()

    @pytest.mark.parametrize(
        "value",
        [
            "not a list",
            None,
            {"id": str(uuid.uuid4())},
            [{"id": ""}],
            [{"name": "x"}],
            ["nope"],
            [None],
            [7],
        ],
    )
    def test_ref_ids_refuses_anything_that_is_not_a_list_of_references(self, value):
        """A trimmed list would be a different answer; a malformed one is
        refused whole so a role is never emptied on its strength."""
        with pytest.raises(sa.SurveyFieldError):
            sa.ref_ids(value)

    def test_snapshot_ids_reads_a_list_and_is_none_otherwise(self):
        a = uuid.uuid4()
        assert sa.snapshot_ids([{"id": str(a), "display_name": "A"}]) == {a}
        assert sa.snapshot_ids([]) == set()
        assert sa.snapshot_ids(None) is None
        assert sa.snapshot_ids("x") is None
        assert sa.snapshot_ids(["junk"]) is None


def test_provenance_names_survey_response_and_respondent():
    survey = SimpleNamespace(id=uuid.uuid4(), name="Q3 review")
    resp = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4())
    got = sa.provenance(survey, resp, SimpleNamespace(display_name="Ada"))
    assert got == {
        "source": "survey_response",
        "survey_id": str(survey.id),
        "survey_name": "Q3 review",
        "response_id": str(resp.id),
        "respondent_id": str(resp.user_id),
        "respondent_name": "Ada",
    }
    # Never ``user_id``: on a stakeholder event that key names the stakeholder.
    assert "user_id" not in got
    assert sa.provenance(survey, resp, None)["respondent_name"] is None


class TestValidateFieldRows:
    async def test_accepts_every_kind_and_legacy_rows(self, db):
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(db, key="observer", label="Observer")
        await sa.validate_field_rows(
            db,
            "Application",
            [
                {"key": "costTotalAnnual"},
                {"key": "a", "kind": "attribute"},
                {"key": "r", "kind": "relation", "relation_type_key": "x", "direction": "outgoing"},
                {"key": "lifecycle:plan", "kind": "lifecycle", "phase": "plan"},
                {"key": "sh:observer", "kind": "stakeholder", "role": "observer"},
            ],
        )

    @pytest.mark.parametrize(
        "row, message",
        [
            ("not a dict", "Each survey field must be an object"),
            ({"kind": "tag"}, "Unknown survey field kind: tag"),
            ({"kind": "lifecycle", "phase": "later"}, "Unknown lifecycle phase: later"),
            ({"kind": "lifecycle"}, "Unknown lifecycle phase: None"),
            (
                {"kind": "stakeholder", "role": "nobody"},
                "Unknown stakeholder role for Application: nobody",
            ),
            ({"kind": "stakeholder"}, "Unknown stakeholder role for Application: None"),
            ({"kind": "stakeholder", "role": ""}, "Unknown stakeholder role for Application: "),
        ],
    )
    async def test_refuses(self, db, row, message):
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(db, key="observer", label="Observer")
        with pytest.raises(sa.SurveyFieldError) as exc:
            await sa.validate_field_rows(db, "Application", [row])
        assert str(exc.value) == message

    async def test_roles_are_looked_up_once_and_only_for_stakeholder_rows(self, db, monkeypatch):
        from app.services import stakeholder_service

        calls: list[str] = []
        real = stakeholder_service.roles_for_type

        async def counting(db_, type_key):
            calls.append(type_key)
            # A role entry that is not a dict, and one without a key, are
            # ignored rather than crashing the lookup.
            return [*(await real(db_, type_key)), "junk", {"label": "no key"}]

        monkeypatch.setattr(stakeholder_service, "roles_for_type", counting)
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(db, key="observer", label="Observer")
        await sa.validate_field_rows(
            db,
            "Application",
            [
                {"key": "a"},
                {"key": "sh:observer", "kind": "stakeholder", "role": "observer"},
                {"key": "sh:observer2", "kind": "stakeholder", "role": "observer"},
            ],
        )
        assert calls == ["Application"]
        await sa.validate_field_rows(
            db, "Application", [{"key": "b"}, {"key": "c", "kind": "attribute"}]
        )
        assert calls == ["Application"]

    async def test_an_empty_list_is_fine(self, db):
        await sa.validate_field_rows(db, "Application", [])
        await sa.validate_field_rows(db, "Application", None)


async def test_update_card_merges_event_extra_without_letting_it_win(db):
    await create_card_type(db, key="Application", label="Application")
    user = await create_user(db, email="extra@test.com")
    card = await create_card(db, name="Extra", lifecycle={"plan": "2024-01-01"})
    changed = await update_card(
        db,
        WriteActor.from_user(user),
        card,
        {"lifecycle": {"plan": "2025-01-01"}},
        event_extra={"survey_id": "s-1", "id": "spoof", "changes": "spoof"},
    )
    assert changed is True
    (ev,) = (
        (
            await db.execute(
                select(Event).where(Event.card_id == card.id, Event.event_type == "card.updated")
            )
        )
        .scalars()
        .all()
    )
    assert ev.data["survey_id"] == "s-1"
    assert ev.data["id"] == str(card.id)
    assert ev.data["changes"]["lifecycle"]["new"] == {"plan": "2025-01-01"}


async def test_update_card_payload_is_unchanged_without_event_extra(db):
    await create_card_type(db, key="Application", label="Application")
    user = await create_user(db, email="plain@test.com")
    card = await create_card(db, name="Plain")
    await update_card(db, WriteActor.from_user(user), card, {"description": "x"})
    (ev,) = (
        (
            await db.execute(
                select(Event).where(Event.card_id == card.id, Event.event_type == "card.updated")
            )
        )
        .scalars()
        .all()
    )
    assert set(ev.data) - {"origin"} == {"id", "changes"}


async def test_rollback_restores_legacy_attr_changes(db):
    await create_card_type(db, key="Application", label="Application")
    card = await create_card(
        db, name="Legacy", attributes={"costTotalAnnual": 75000, "added": "x", "kept": 1}
    )
    event = SimpleNamespace(card_id=card.id)
    op = _plan_card_updated(
        event,
        {
            "id": str(card.id),
            "changes": {
                "attr_costTotalAnnual": {"old": 50000, "new": 75000},
                "attr_added": {"old": None, "new": "x"},
                # Added by the survey and removed again since: nothing to pop,
                # and that must not be an error.
                "attr_vanished": {"old": None, "new": "y"},
                "name": {"old": "Legacy", "new": "Legacy"},
            },
        },
    )
    result = await _apply_restore_card_fields(db, op)
    assert result["status"] == "ok"
    # The value before the survey is back, an attribute the survey added is
    # gone, and one it never touched survives.
    assert card.attributes == {"costTotalAnnual": 50000, "kept": 1}
    assert not hasattr(card, "attr_costTotalAnnual")


# ---------------------------------------------------------------------------
# Deferred notifications on ``update_card``
# ---------------------------------------------------------------------------


async def _card_with_subscribers(db):
    await create_card_type(db, key="Application", label="Application")
    actor = await create_user(db, email="actor@test.com", display_name="Actor")
    sub = await create_user(db, email="sub@test.com", display_name="Sub")
    card = await create_card(db, name="Watched", approval_status="APPROVED")
    # The subscriber holds two roles and the actor one: one nudge per person,
    # none for the actor.
    db.add(Stakeholder(card_id=card.id, user_id=sub.id, role="responsible"))
    db.add(Stakeholder(card_id=card.id, user_id=sub.id, role="observer"))
    db.add(Stakeholder(card_id=card.id, user_id=actor.id, role="observer"))
    await db.flush()
    return actor, sub, card


async def _notification_rows(db, card_id):
    return (
        (await db.execute(select(Notification).where(Notification.card_id == card_id)))
        .scalars()
        .all()
    )


async def test_update_card_with_a_sink_collects_recipients_and_writes_no_rows(db):
    actor, sub, card = await _card_with_subscribers(db)
    sink: list[dict] = []
    changed = await update_card(
        db, WriteActor.from_user(actor), card, {"description": "x"}, deferred_notifications=sink
    )
    assert changed is True
    assert await _notification_rows(db, card.id) == []
    by_type = {}
    for row in sink:
        by_type.setdefault(row["notif_type"], []).append(row)
    # The edit broke the approval, so both nudges are collected, each once.
    assert [r["user_id"] for r in by_type["card_updated"]] == [sub.id]
    updated = by_type["card_updated"][0]
    assert updated["card_id"] == card.id
    assert updated["link"] == f"/cards/{card.id}"
    assert updated["data"] == {"changes": ["description", "approval_status"]}
    assert "Actor" in updated["message"] and "description" in updated["message"]
    assert [r["user_id"] for r in by_type["approval_status_changed"]] == [sub.id]
    assert by_type["approval_status_changed"][0]["data"]["action"] == "broken"
    assert set(by_type) == {"card_updated", "approval_status_changed"}


async def test_update_card_without_a_sink_still_notifies_inline(db):
    actor, sub, card = await _card_with_subscribers(db)
    await update_card(db, WriteActor.from_user(actor), card, {"description": "x"})
    rows = await _notification_rows(db, card.id)
    types = sorted(r.type for r in rows)
    assert types == ["approval_status_changed", "card_updated", "card_updated"]
    assert {r.user_id for r in rows} == {sub.id}


async def test_an_unchanged_update_collects_nothing(db):
    actor, _sub, card = await _card_with_subscribers(db)
    sink: list[dict] = []
    changed = await update_card(
        db,
        WriteActor.from_user(actor),
        card,
        {"description": card.description},
        deferred_notifications=sink,
    )
    assert changed is False
    assert sink == []


# ---------------------------------------------------------------------------
# Stakeholder answers as a diff against the snapshot
# ---------------------------------------------------------------------------


async def _role_env(db):
    await create_card_type(db, key="Application", label="Application")
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", label="Observer"
    )
    actor = await create_user(db, email="apply@test.com", display_name="Applier")
    a = await create_user(db, email="a@test.com", display_name="A")
    b = await create_user(db, email="b@test.com", display_name="B")
    c = await create_user(db, email="c@test.com", display_name="C")
    card = await create_card(db, name="Roles")
    db.add(Stakeholder(card_id=card.id, user_id=a.id, role="observer"))
    await db.flush()
    return actor, a, b, c, card


async def _holders(db, card_id):
    rows = await db.execute(
        select(Stakeholder.user_id).where(
            Stakeholder.card_id == card_id, Stakeholder.role == "observer"
        )
    )
    return set(rows.scalars().all())


def _refs(*users):
    return [{"id": str(u.id), "display_name": u.display_name} for u in users]


async def test_stakeholder_answer_is_a_diff_against_the_snapshot(db):
    actor, a, b, c, card = await _role_env(db)
    # The respondent saw [A] and answered [B]: remove A, add B. C joined after
    # the answer and is nobody's business here.
    db.add(Stakeholder(card_id=card.id, user_id=c.id, role="observer"))
    await db.flush()
    changed = await sa.apply_stakeholder_change(
        db, card, "observer", _refs(b), actor.id, snapshot=_refs(a)
    )
    assert changed is True
    assert await _holders(db, card.id) == {b.id, c.id}


async def test_without_a_snapshot_the_answer_is_the_whole_list(db):
    actor, a, b, c, card = await _role_env(db)
    db.add(Stakeholder(card_id=card.id, user_id=c.id, role="observer"))
    await db.flush()
    changed = await sa.apply_stakeholder_change(db, card, "observer", _refs(b), actor.id)
    assert changed is True
    assert await _holders(db, card.id) == {b.id}


async def test_a_diff_already_applied_changes_nothing(db):
    actor, a, b, _c, card = await _role_env(db)
    # Another path already made the same change; nothing to add or remove twice.
    (await db.execute(select(Stakeholder).where(Stakeholder.user_id == a.id))).scalar_one()
    await sa.apply_stakeholder_change(db, card, "observer", _refs(b), actor.id, snapshot=_refs(a))
    changed = await sa.apply_stakeholder_change(
        db, card, "observer", _refs(b), actor.id, snapshot=_refs(a)
    )
    assert changed is False
    assert await _holders(db, card.id) == {b.id}


async def test_an_unknown_person_refuses_the_answer(db):
    actor, a, _b, _c, card = await _role_env(db)
    with pytest.raises(
        sa.SurveyFieldError, match="1 of the people listed for Observer match no user"
    ):
        await sa.apply_stakeholder_change(
            db, card, "observer", [{"id": str(uuid.uuid4())}], actor.id, snapshot=_refs(a)
        )
    assert await _holders(db, card.id) == {a.id}


async def test_a_deactivated_person_is_skipped_not_added_and_never_removed(db):
    actor, a, b, c, card = await _role_env(db)
    c.is_active = False
    db.add(Stakeholder(card_id=card.id, user_id=c.id, role="observer"))
    await db.flush()
    # The form never showed C, so the snapshot omits them; the answer cannot
    # remove them, and listing a deactivated B adds nobody.
    b.is_active = False
    await db.flush()
    changed = await sa.apply_stakeholder_change(
        db, card, "observer", _refs(b), actor.id, snapshot=_refs(a)
    )
    assert changed is True  # A was removed
    assert await _holders(db, card.id) == {c.id}


# ---------------------------------------------------------------------------
# relation_field_peers — the read half of a relation field
# ---------------------------------------------------------------------------


async def _relation_env(db):
    from app.models.relation import Relation

    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="ITComponent", label="IT Component")
    app = await create_card(db, name="App")
    beta = await create_card(db, card_type="ITComponent", name="Beta")
    alpha = await create_card(db, card_type="ITComponent", name="Alpha")
    gone = await create_card(db, card_type="ITComponent", name="Gone", status="ARCHIVED")
    upstream = await create_card(db, name="Upstream")
    for target in (beta, alpha, gone):
        db.add(Relation(type="relAppToITC", source_id=app.id, target_id=target.id))
    db.add(Relation(type="relAppToApp", source_id=upstream.id, target_id=app.id))
    # Another type between the same cards must not leak into this field.
    db.add(Relation(type="relAppToITCOwns", source_id=app.id, target_id=beta.id))
    await db.flush()
    return app, alpha, beta, upstream


async def test_relation_field_peers_outgoing_lists_active_targets_by_name(db):
    app, alpha, beta, _ = await _relation_env(db)
    field = {"relation_type_key": "relAppToITC", "direction": "outgoing"}
    assert await sa.relation_field_peers(db, app.id, field) == [
        {"id": str(alpha.id), "name": "Alpha"},
        {"id": str(beta.id), "name": "Beta"},
    ]


async def test_relation_field_peers_incoming_lists_sources(db):
    app, _alpha, _beta, upstream = await _relation_env(db)
    field = {"relation_type_key": "relAppToApp", "direction": "incoming"}
    assert await sa.relation_field_peers(db, app.id, field) == [
        {"id": str(upstream.id), "name": "Upstream"}
    ]
    # The same type read the other way round names nothing: App is nobody's target source.
    assert await sa.relation_field_peers(db, app.id, {**field, "direction": "outgoing"}) == []


@pytest.mark.parametrize(
    "field",
    [
        {},
        {"relation_type_key": "relAppToITC"},
        {"relation_type_key": "", "direction": "outgoing"},
        {"relation_type_key": "relAppToITC", "direction": "sideways"},
        {"relation_type_key": None, "direction": "incoming"},
    ],
)
async def test_relation_field_peers_is_empty_for_a_malformed_field(db, field):
    app, *_ = await _relation_env(db)
    assert await sa.relation_field_peers(db, app.id, field) == []


# ---------------------------------------------------------------------------
# event_bus.open_auto_batch — the batch the apply route opens up front
# ---------------------------------------------------------------------------


async def test_open_auto_batch_records_the_request_and_stashes_its_id(db):
    from datetime import datetime, timezone

    from app.models.mutation_batch import MutationBatch
    from app.services.event_bus import (
        event_bus,
        request_batch_id,
        request_endpoint,
        request_origin,
    )

    user = await create_user(db, email="batch@test.com")
    t_origin = request_origin.set("web")
    t_endpoint = request_endpoint.set("POST /api/v1/surveys/x/apply")
    t_batch = request_batch_id.set(None)
    try:
        before = datetime.now(timezone.utc)
        batch_id = await event_bus.open_auto_batch(db, user_id=user.id, event_type="card.updated")
        assert request_batch_id.get() == batch_id
        row = await db.get(MutationBatch, batch_id)
        assert row is not None
        assert row.tool_name == "POST /api/v1/surveys/x/apply"
        assert row.actor_user_id == user.id
        assert row.origin == "web"
        assert row.dry_run is False
        assert row.committed_at is not None
        assert row.committed_at.tzinfo is not None
        assert before <= row.committed_at <= datetime.now(timezone.utc)
    finally:
        request_origin.reset(t_origin)
        request_endpoint.reset(t_endpoint)
        request_batch_id.reset(t_batch)


async def test_open_auto_batch_falls_back_to_the_event_type_and_api_origin(db):
    from app.models.mutation_batch import MutationBatch
    from app.services.event_bus import (
        event_bus,
        request_batch_id,
        request_endpoint,
        request_origin,
    )

    t_origin = request_origin.set(None)
    t_endpoint = request_endpoint.set(None)
    t_batch = request_batch_id.set(None)
    try:
        batch_id = await event_bus.open_auto_batch(db, user_id=None, event_type="card.updated")
        row = await db.get(MutationBatch, batch_id)
        assert row.tool_name == "event:card.updated"
        assert row.origin == "api"
        assert row.actor_user_id is None
    finally:
        request_origin.reset(t_origin)
        request_endpoint.reset(t_endpoint)
        request_batch_id.reset(t_batch)


async def test_open_auto_batch_truncates_a_long_endpoint_to_the_column(db):
    from app.models.mutation_batch import MutationBatch
    from app.services.event_bus import event_bus, request_batch_id, request_endpoint

    long_path = "POST /api/v1/" + "x" * 200
    t_endpoint = request_endpoint.set(long_path)
    t_batch = request_batch_id.set(None)
    try:
        batch_id = await event_bus.open_auto_batch(db, user_id=None, event_type="card.updated")
        row = await db.get(MutationBatch, batch_id)
        assert row.tool_name == long_path[:100]
        assert len(row.tool_name) == 100
    finally:
        request_endpoint.reset(t_endpoint)
        request_batch_id.reset(t_batch)
