"""Pure helpers of ``services/survey_apply.py`` — the survey field kinds,
answer parsing and the provenance every survey-applied event carries — plus
the two shared write-path seams the apply leans on: ``update_card``'s
``event_extra`` and the rollback of pre-2.162.0 ``attr_<key>`` changes."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.event import Event
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

    def test_ref_ids_accepts_refs_and_bare_ids_and_drops_junk(self):
        a, b = uuid.uuid4(), uuid.uuid4()
        got = sa.ref_ids([{"id": str(a)}, str(b), {"id": ""}, {"name": "x"}, "nope", None, 7])
        assert got == {a, b}
        assert sa.ref_ids("not a list") == set()
        assert sa.ref_ids(None) == set()


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
        "row, match",
        [
            ("not a dict", "object"),
            ({"kind": "tag"}, "kind"),
            ({"kind": "lifecycle", "phase": "later"}, "phase"),
            ({"kind": "lifecycle"}, "phase"),
            ({"kind": "stakeholder", "role": "nobody"}, "role"),
            ({"kind": "stakeholder"}, "role"),
        ],
    )
    async def test_refuses(self, db, row, match):
        await create_card_type(db, key="Application", label="Application")
        await create_stakeholder_role_def(db, key="observer", label="Observer")
        with pytest.raises(sa.SurveyFieldError, match=match):
            await sa.validate_field_rows(db, "Application", [row])

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
