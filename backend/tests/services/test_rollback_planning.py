"""``rollback_service`` planning, pinned to exact values.

Planning is pure — an event in, the inverse op out — so these tests build
``Event`` objects in memory and compare whole dicts. The nightly mutation run
found the planners' output was barely compared: an op could lose its target id,
or a decline its reason, and every test still passed. ``test_rollback_service``
keeps the end-to-end cases; this file pins the tables and every branch.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.event import Event
from app.services import rollback_service as rs

EID = uuid.UUID("00000000-0000-0000-0000-0000000000e1")
CID = uuid.UUID("00000000-0000-0000-0000-0000000000c1")


def ev(event_type, data=None, *, card_id=CID, event_id=EID):
    return Event(id=event_id, event_type=event_type, data=data, card_id=card_id)


GENERIC = (
    "cannot be reversed automatically — the originating handler does not publish "
    "a structured snapshot the rollback engine can replay."
)


def unsupported(event_type, reason, event_id=EID):
    return {
        "event_id": str(event_id),
        "op": "unsupported",
        "event_type": event_type,
        "reason": reason,
    }


# ── small helpers ───────────────────────────────────────────────────────────


def test_card_id_prefers_the_payload_then_the_event():
    assert rs._card_id_of(ev("card.x"), {"id": "payload"}) == "payload"
    assert rs._card_id_of(ev("card.x"), {}) == str(CID)
    assert rs._card_id_of(ev("card.x", card_id=None), {}) is None
    assert rs._event_card_id(ev("x")) == str(CID)
    assert rs._event_card_id(ev("x", card_id=None)) is None


def test_unsupported_with_and_without_a_reason():
    assert rs._unsupported(ev("comment.added")) == unsupported(
        "comment.added", f"comment.added {GENERIC}"
    )
    assert rs._unsupported(ev("comment.added"), "why") == unsupported("comment.added", "why")
    assert rs._unsupported(ev("comment.added"), "") == unsupported(
        "comment.added", f"comment.added {GENERIC}"
    )


# ── the tables ──────────────────────────────────────────────────────────────


def test_the_inverse_table():
    assert rs._INVERSES == {
        "card.created": rs._plan_card_created,
        "card.archived": rs._plan_card_archived,
        "card.restored": rs._plan_card_restored,
        "card.updated": rs._plan_card_updated,
        "relation.created": rs._plan_relation_created,
        "relation.upserted": rs._plan_relation_created,
        "risk.added": rs._plan_risk_added,
        "risk.updated": rs._plan_risk_updated,
        "stakeholder.added": rs._plan_stakeholder_added,
        "stakeholder.removed": rs._plan_stakeholder_removed,
        "stakeholder.role_changed": rs._plan_stakeholder_role_changed,
        "tag.added": rs._plan_tag_added,
        "tag.removed": rs._plan_tag_removed,
        "adr.created": rs._plan_adr_created,
        "todo.created": rs._plan_todo_created,
        "survey.sent": rs._plan_survey_sent,
    }


def test_the_declined_and_dedupe_tables():
    assert rs._DECLINED == {
        "todo.": "Todos are requests to people; reopening or deleting one is not an undo.",
        "notification.": "A notification has already been delivered.",
        "risk.removed": "A deleted risk cannot be rebuilt — no snapshot is recorded.",
    }
    assert rs._DEDUPE_KEYS == {
        "delete_risk": ("risk_id",),
        "restore_risk_fields": ("risk_id",),
        "delete_relation": ("relation_id",),
        "delete_adr": ("adr_id",),
        "delete_card": ("card_id",),
        "delete_todo": ("todo_id",),
        "close_survey": ("survey_id",),
    }


def test_the_applier_table_covers_every_planned_op():
    assert set(rs._APPLIERS) == {
        "delete_card",
        "restore_card",
        "archive_card",
        "restore_card_fields",
        "delete_relation",
        "delete_risk",
        "unlink_risk_card",
        "restore_risk_fields",
        "remove_stakeholder",
        "assign_stakeholder",
        "restore_stakeholder_role",
        "remove_card_tag",
        "add_card_tag",
        "delete_adr",
        "delete_todo",
        "close_survey",
    }
    assert rs._APPLIERS["delete_card"] is rs._apply_delete_card
    assert rs._APPLIERS["restore_card"] is rs._apply_restore_card
    assert rs._APPLIERS["archive_card"] is rs._apply_archive_card
    assert rs._APPLIERS["restore_card_fields"] is rs._apply_restore_card_fields
    assert rs._APPLIERS["delete_relation"] is rs._apply_delete_relation
    assert rs._APPLIERS["delete_risk"] is rs._apply_delete_risk
    assert rs._APPLIERS["unlink_risk_card"] is rs._apply_unlink_risk_card
    assert rs._APPLIERS["restore_risk_fields"] is rs._apply_restore_risk_fields
    assert rs._APPLIERS["remove_stakeholder"] is rs._apply_remove_stakeholder
    assert rs._APPLIERS["assign_stakeholder"] is rs._apply_assign_stakeholder
    assert rs._APPLIERS["restore_stakeholder_role"] is rs._apply_restore_stakeholder_role
    assert rs._APPLIERS["remove_card_tag"] is rs._apply_remove_card_tag
    assert rs._APPLIERS["add_card_tag"] is rs._apply_add_card_tag
    assert rs._APPLIERS["delete_adr"] is rs._apply_delete_adr
    assert rs._APPLIERS["delete_todo"] is rs._apply_delete_todo
    assert rs._APPLIERS["close_survey"] is rs._apply_close_survey


def test_the_risk_field_tables():
    assert rs._RISK_UUID_FIELDS == {"owner_id", "accepted_by"}
    assert rs._RISK_DATE_FIELDS == {"target_resolution_date"}
    assert rs._RISK_DATETIME_FIELDS == {"accepted_at"}
    assert rs._RISK_RESTORABLE == {
        "title",
        "description",
        "category",
        "initial_probability",
        "initial_impact",
        "residual_probability",
        "residual_impact",
        "owner_id",
        "target_resolution_date",
        "status",
        "acceptance_rationale",
        "accepted_by",
        "accepted_at",
    }


# ── planners ────────────────────────────────────────────────────────────────


def plan(event_type, data=None, **kw):
    return rs._plan_inverse(ev(event_type, data, **kw))


@pytest.mark.parametrize(
    "event_type, op",
    [
        ("card.created", "delete_card"),
        ("card.archived", "restore_card"),
        ("card.restored", "archive_card"),
    ],
)
def test_card_lifecycle_events(event_type, op):
    assert plan(event_type, {"id": "c-9"}) == {"event_id": str(EID), "op": op, "card_id": "c-9"}
    assert plan(event_type, {}) == {"event_id": str(EID), "op": op, "card_id": str(CID)}


def test_card_updated_restores_every_old_value():
    data = {
        "id": "c-9",
        "changes": {"name": {"old": "A", "new": "B"}, "alias": {"new": "x"}},
    }
    assert plan("card.updated", data) == {
        "event_id": str(EID),
        "op": "restore_card_fields",
        "card_id": "c-9",
        "fields": {"name": "A", "alias": None},
    }
    assert plan("card.updated", {"changes": None})["fields"] == {}
    assert plan("card.updated", None)["fields"] == {}


@pytest.mark.parametrize("event_type", ["relation.created", "relation.upserted"])
def test_relation_events(event_type):
    assert plan(event_type, {"id": "r-1"}) == {
        "event_id": str(EID),
        "op": "delete_relation",
        "relation_id": "r-1",
    }


def test_risk_added():
    created = {"risk_id": "k", "created": True, "reference": "R-000001"}
    assert plan("risk.added", created) == {
        "event_id": str(EID),
        "op": "delete_risk",
        "risk_id": "k",
        "detail": "R-000001",
    }
    assert plan("risk.added", {"risk_id": "k"}) == {
        "event_id": str(EID),
        "op": "unlink_risk_card",
        "risk_id": "k",
        "card_id": str(CID),
        "detail": "",
    }
    assert plan("risk.added", {"risk_id": "k", "created": True})["detail"] == ""
    assert plan("risk.added", {}) == unsupported("risk.added", "risk.added carries no risk id")


RISK_UPDATED_OLD = (
    "risk.updated recorded only the names of the changed fields, not their "
    "previous values (rows written before 2.127.0)."
)


@pytest.mark.parametrize(
    "data",
    [
        {"changes": {"title": {"old": "a"}}},  # no risk id
        {"risk_id": "k"},
        {"risk_id": "k", "changes": ["title"]},  # the pre-2.127 shape
        {"risk_id": "k", "changes": {}},
    ],
)
def test_risk_updated_without_old_values_is_declined(data):
    assert plan("risk.updated", data) == unsupported("risk.updated", RISK_UPDATED_OLD)


def test_risk_updated_restores_old_values():
    data = {
        "risk_id": "k",
        "reference": "R-000002",
        "changes": {"title": {"old": "Before", "new": "After"}, "owner_id": None},
    }
    assert plan("risk.updated", data) == {
        "event_id": str(EID),
        "op": "restore_risk_fields",
        "risk_id": "k",
        "fields": {"title": "Before", "owner_id": None},
        "detail": "R-000002",
    }
    data.pop("reference")
    assert plan("risk.updated", data)["detail"] == ""


@pytest.mark.parametrize(
    "extra, detail",
    [
        ({"summary": "S", "role_label": "L"}, "S"),
        ({"role_label": "L"}, "L"),
        ({}, "owner"),
    ],
)
@pytest.mark.parametrize(
    "event_type, op",
    [("stakeholder.added", "remove_stakeholder"), ("stakeholder.removed", "assign_stakeholder")],
)
def test_stakeholder_add_and_remove(event_type, op, extra, detail):
    data = {"user_id": "u-1", "role": "owner", **extra}
    assert plan(event_type, data) == {
        "event_id": str(EID),
        "op": op,
        "card_id": str(CID),
        "stakeholder_user_id": "u-1",
        "role": "owner",
        "detail": detail,
    }


def test_stakeholder_with_nothing_to_name_has_an_empty_detail():
    assert plan("stakeholder.added", {"user_id": "u-1"})["detail"] == ""


def test_stakeholder_role_changed():
    data = {
        "user_id": "u-1",
        "new_role": "reviewer",
        "role": "ignored",
        "old_role": "owner",
        "old_role_label": "Owner",
    }
    assert plan("stakeholder.role_changed", data) == {
        "event_id": str(EID),
        "op": "restore_stakeholder_role",
        "card_id": str(CID),
        "stakeholder_user_id": "u-1",
        "role": "reviewer",
        "old_role": "owner",
        "detail": "Owner",
    }
    fallback = plan("stakeholder.role_changed", {"user_id": "u-1", "role": "r", "old_role": "o"})
    assert (fallback["role"], fallback["detail"]) == ("r", "o")
    assert plan("stakeholder.role_changed", {"user_id": "u-1"}) == unsupported(
        "stakeholder.role_changed", "stakeholder.role_changed carries no previous role"
    )


@pytest.mark.parametrize(
    "event_type, op", [("tag.added", "remove_card_tag"), ("tag.removed", "add_card_tag")]
)
def test_tag_events(event_type, op):
    assert plan(event_type, {"tag_id": "t-1", "tag_name": "Core"}) == {
        "event_id": str(EID),
        "op": op,
        "card_id": str(CID),
        "tag_id": "t-1",
        "detail": "Core",
    }
    assert plan(event_type, {"tag_id": "t-1"})["detail"] == ""


def test_adr_created():
    assert plan("adr.created", {"adr_id": "a-1", "id": "x", "reference_number": "ADR-7"}) == {
        "event_id": str(EID),
        "op": "delete_adr",
        "adr_id": "a-1",
        "detail": "ADR-7",
    }
    assert plan("adr.created", {"id": "a-2"})["adr_id"] == "a-2"
    assert plan("adr.created", {"id": "a-2"})["detail"] == ""
    assert plan("adr.created", {}) == unsupported(
        "adr.created", "adr.created carries no decision id"
    )


def test_survey_sent():
    assert plan("survey.sent", {"survey_id": "s-1", "name": "N" * 100}) == {
        "event_id": str(EID),
        "op": "close_survey",
        "survey_id": "s-1",
        "detail": "N" * 80,
    }
    assert plan("survey.sent", {"survey_id": "s-1"})["detail"] == ""
    assert plan("survey.sent", {}) == unsupported("survey.sent", "survey.sent carries no survey id")


def test_a_todo_an_extension_wrote_is_deleted():
    data = {"ext": "jira", "todo_id": "t-1", "id": "x", "description": "D" * 100}
    assert plan("todo.created", data) == {
        "event_id": str(EID),
        "op": "delete_todo",
        "todo_id": "t-1",
        "detail": "D" * 80,
    }
    assert plan("todo.created", {"ext": "jira", "id": "t-2"})["todo_id"] == "t-2"
    assert plan("todo.created", {"ext": "jira", "id": "t-2"})["detail"] == ""


def test_todos_that_are_not_the_extensions_to_take_back():
    assert plan("todo.created", {"todo_id": "t-1"}) == unsupported(
        "todo.created",
        "todo.created is not reversed: Todos are requests to people; reopening or "
        "deleting one is not an undo.",
    )
    assert plan("todo.created", {"ext": "jira", "todo_id": "t-1", "rolled_forward": True}) == (
        unsupported(
            "todo.created",
            "todo.created is not reversed: the next occurrence of a recurring todo is "
            "opened by Turbo EA, not by the extension.",
        )
    )
    assert plan("todo.created", {"ext": "jira"}) == unsupported(
        "todo.created", "todo.created carries no todo id"
    )


@pytest.mark.parametrize(
    "event_type, reason",
    [
        ("todo.updated", "Todos are requests to people; reopening or deleting one is not an undo."),
        ("notification.created", "A notification has already been delivered."),
        ("risk.removed", "A deleted risk cannot be rebuilt — no snapshot is recorded."),
    ],
)
def test_declined_families(event_type, reason):
    assert plan(event_type, {}) == unsupported(
        event_type, f"{event_type} is not reversed: {reason}"
    )


@pytest.mark.parametrize(
    "event_type", ["risk.removed_later", "todo", "notification", "comment.added"]
)
def test_anything_else_is_unsupported_generically(event_type):
    """A decline without a trailing dot matches its own name only; a family
    prefix needs the dot."""
    assert plan(event_type, {}) == unsupported(event_type, f"{event_type} {GENERIC}")


# ── plan_ops: duplicates collapse on their target ───────────────────────────


def ids(n):
    return [uuid.UUID(int=i + 1) for i in range(n)]


def test_duplicate_reversals_collapse_on_their_target():
    e1, e2, e3, e4, e5 = ids(5)
    events = [
        Event(id=e1, event_type="risk.added", data={"risk_id": "k", "created": True}, card_id=CID),
        Event(id=e2, event_type="risk.added", data={"risk_id": "k", "created": True}, card_id=CID),
        Event(id=e3, event_type="risk.added", data={"risk_id": "j", "created": True}, card_id=CID),
        Event(id=e4, event_type="card.updated", data={"id": "c", "changes": {}}, card_id=CID),
        Event(id=e5, event_type="card.updated", data={"id": "c", "changes": {}}, card_id=CID),
    ]
    got = rs.plan_ops(events)
    assert [(op["event_id"], op["op"]) for op in got] == [
        (str(e1), "delete_risk"),
        (str(e3), "delete_risk"),
        # field restores are not deduped: each event carries its own old values
        (str(e4), "restore_card_fields"),
        (str(e5), "restore_card_fields"),
    ]


def test_unsupported_events_are_all_reported():
    e1, e2 = ids(2)
    events = [
        Event(id=e1, event_type="comment.added", data={}, card_id=CID),
        Event(id=e2, event_type="comment.added", data={}, card_id=CID),
    ]
    assert [op["event_id"] for op in rs.plan_ops(events)] == [str(e1), str(e2)]


@pytest.mark.parametrize(
    "event_type, data, key",
    [
        ("relation.created", {"id": "r"}, "relation_id"),
        ("adr.created", {"adr_id": "a"}, "adr_id"),
        ("card.created", {"id": "c"}, "card_id"),
        ("todo.created", {"ext": "x", "todo_id": "t"}, "todo_id"),
        ("survey.sent", {"survey_id": "s"}, "survey_id"),
        ("risk.updated", {"risk_id": "k", "changes": {"title": {"old": "a"}}}, "risk_id"),
    ],
)
def test_each_dedupe_key(event_type, data, key):
    e1, e2 = ids(2)
    events = [
        Event(id=e1, event_type=event_type, data=data, card_id=CID),
        Event(id=e2, event_type=event_type, data=data, card_id=CID),
    ]
    (op,) = rs.plan_ops(events)
    assert op["event_id"] == str(e1)
    assert key in op


# ── conflict scans: which entity an event wrote to ──────────────────────────


@pytest.mark.parametrize(
    "event_type, data, card_id, expected",
    [
        ("card.updated", {"id": "c-1"}, CID, ("card", "c-1")),
        ("card.updated", {}, CID, ("card", str(CID))),
        ("card.updated", {}, None, None),
        ("relation.created", {"id": "r-1"}, CID, ("relation", "r-1")),
        ("relation.created", {}, CID, None),
        ("risk.updated", {"risk_id": "k"}, CID, ("risk", "k")),
        ("risk.updated", {}, CID, None),
        ("adr.created", {"adr_id": "a", "id": "x"}, CID, ("adr", "a")),
        ("adr.signed", {"id": "x"}, CID, ("adr", "x")),
        ("adr.signed", {}, CID, None),
        ("stakeholder.added", {"id": "x"}, CID, ("card", str(CID))),
        ("tag.added", {}, CID, ("card", str(CID))),
        ("tag.added", {}, None, None),
        ("comment.added", {"id": "x"}, CID, None),
    ],
)
def test_entity_ref(event_type, data, card_id, expected):
    assert rs._entity_ref(ev(event_type, data, card_id=card_id)) == expected


def test_entity_ref_with_no_payload():
    assert rs._entity_ref(ev("card.updated", None)) == ("card", str(CID))


async def test_entities_touched_groups_by_kind():
    events = [
        ev("card.updated", {"id": "c-1"}),
        ev("card.updated", {"id": "c-2"}),
        ev("tag.added", {}),
        ev("risk.updated", {"risk_id": "k"}),
        ev("comment.added", {}),
    ]
    assert await rs._entities_touched(events) == {
        "card": {"c-1", "c-2", str(CID)},
        "risk": {"k"},
    }


# ── small apply helpers ─────────────────────────────────────────────────────


def test_uuid_parsing():
    u = uuid.uuid4()
    assert rs._uuid(None) is None
    assert rs._uuid("") is None
    assert rs._uuid("not-a-uuid") is None
    assert rs._uuid(str(u)) == u
    assert rs._uuid(u) == u


def test_skip_and_ok_keep_the_op():
    op = {"op": "x", "card_id": "c"}
    assert rs._skip(op, "why") == {"op": "x", "card_id": "c", "status": "skipped", "reason": "why"}
    assert rs._ok(op) == {"op": "x", "card_id": "c", "status": "ok"}
    assert op == {"op": "x", "card_id": "c"}  # untouched


def test_coerce_risk_values():
    from datetime import date, datetime, timezone

    u = uuid.uuid4()
    assert rs._coerce_risk_value("title", None) is None
    assert rs._coerce_risk_value("title", "") is None
    assert rs._coerce_risk_value("title", "T") == "T"
    assert rs._coerce_risk_value("initial_impact", 3) == 3
    assert rs._coerce_risk_value("owner_id", str(u)) == u
    assert rs._coerce_risk_value("accepted_by", str(u)) == u
    assert rs._coerce_risk_value("target_resolution_date", "2026-03-04T10:00:00") == date(
        2026, 3, 4
    )
    assert rs._coerce_risk_value("accepted_at", "2026-03-04T10:00:00+00:00") == datetime(
        2026, 3, 4, 10, tzinfo=timezone.utc
    )
