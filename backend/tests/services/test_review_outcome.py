"""The one definition of a document's review outcome and of *closed* (pure, no DB)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.architecture_decision import ArchitectureDecision
from app.models.soaw import SoAW
from app.services import review_outcome as ro

U1 = uuid.UUID("00000000-0000-4000-8000-000000000001")
AT = datetime(2026, 11, 27, 10, 15, tzinfo=timezone.utc)


def _doc(status="draft", outcome=None, **fields):
    return SimpleNamespace(
        status=status,
        outcome=outcome,
        outcome_at=fields.get("outcome_at"),
        outcome_by=fields.get("outcome_by"),
        outcome_by_name=fields.get("outcome_by_name"),
        outcome_note=fields.get("outcome_note"),
    )


def test_the_vocabulary():
    assert ro.OUTCOMES == ("changes_requested", "rejected", "withdrawn")
    assert ro.CLOSED_OUTCOMES == frozenset({"rejected", "withdrawn"})
    assert (ro.CHANGES_REQUESTED, ro.REJECTED, ro.WITHDRAWN) == ro.OUTCOMES
    assert ro.NOTE_MAX == 4000


@pytest.mark.parametrize(
    "kind, closed",
    [("rejected", True), ("withdrawn", True), ("changes_requested", False), (None, False)],
)
def test_closed(kind, closed):
    assert ro.is_closed_kind(kind) is closed
    assert ro.is_closed(_doc(outcome=kind)) is closed


def test_an_object_without_an_outcome_is_not_closed():
    assert ro.is_closed(object()) is False


@pytest.mark.parametrize("model", [ArchitectureDecision, SoAW])
def test_set_and_clear_on_both_documents(model):
    doc = model()
    user = SimpleNamespace(id=U1, display_name="Ada Lovelace")
    ro.set_outcome(doc, "rejected", user=user, note="  Too costly  ", now=AT)
    assert (doc.outcome, doc.outcome_at, doc.outcome_by) == ("rejected", AT, U1)
    assert (doc.outcome_by_name, doc.outcome_note) == ("Ada Lovelace", "Too costly")
    assert ro.is_closed(doc) is True

    ro.clear_outcome(doc)
    assert (doc.outcome, doc.outcome_at, doc.outcome_by) == (None, None, None)
    assert (doc.outcome_by_name, doc.outcome_note) == (None, None)
    assert ro.outcome_payload(doc) is None


def test_set_outcome_defaults():
    doc = _doc()
    before = datetime.now(timezone.utc)
    ro.set_outcome(doc, "withdrawn", user=None, note="   ")
    assert doc.outcome == "withdrawn"
    assert doc.outcome_at >= before
    assert (doc.outcome_by, doc.outcome_by_name, doc.outcome_note) == (None, None, None)

    ro.set_outcome(doc, "changes_requested", user=None, note=None, now=AT)
    assert doc.outcome_note is None


def test_a_long_note_is_cut_at_the_limit():
    doc = _doc()
    ro.set_outcome(doc, "rejected", user=None, note="x" * 4001, now=AT)
    assert doc.outcome_note == "x" * 4000


def test_an_unknown_outcome_is_refused():
    with pytest.raises(ValueError, match=r"^Unknown review outcome 'bogus'$"):
        ro.set_outcome(_doc(), "bogus", user=None, note=None)


class TestPayload:
    def test_none_without_an_outcome(self):
        assert ro.outcome_payload(_doc()) is None
        assert ro.outcome_payload(_doc(outcome="")) is None

    def test_full(self):
        doc = _doc(
            outcome="rejected",
            outcome_at=AT,
            outcome_by=U1,
            outcome_by_name="Ada",
            outcome_note="No",
        )
        assert ro.outcome_payload(doc) == {
            "kind": "rejected",
            "at": "2026-11-27T10:15:00+00:00",
            "by": {"id": str(U1), "display_name": "Ada"},
            "note": "No",
        }

    def test_a_deleted_user_keeps_the_name(self):
        doc = _doc(outcome="withdrawn", outcome_at=AT, outcome_by_name="Ada")
        assert ro.outcome_payload(doc)["by"] == {"id": None, "display_name": "Ada"}

    def test_nobody_known(self):
        doc = _doc(outcome="changes_requested")
        assert ro.outcome_payload(doc) == {
            "kind": "changes_requested",
            "at": None,
            "by": None,
            "note": None,
        }

    def test_an_id_without_a_name(self):
        doc = _doc(outcome="rejected", outcome_by=U1)
        assert ro.outcome_payload(doc)["by"] == {"id": str(U1), "display_name": None}


class TestFilter:
    def test_absent_or_blank_is_no_filter(self):
        assert ro.parse_outcome_filter(None) is None
        assert ro.parse_outcome_filter("") is None
        assert ro.parse_outcome_filter(" , ") is None

    def test_comma_separated(self):
        assert ro.parse_outcome_filter("rejected, withdrawn") == frozenset(
            {"rejected", "withdrawn"}
        )
        assert ro.parse_outcome_filter("changes_requested") == frozenset({"changes_requested"})

    def test_unknown_is_400_naming_it(self):
        with pytest.raises(HTTPException) as err:
            ro.parse_outcome_filter("rejected,closed,draft")
        assert err.value.status_code == 400
        assert err.value.detail == {"error": "unknown_outcome", "values": ["closed", "draft"]}

    @pytest.mark.parametrize(
        "kind, include_closed, outcomes, kept",
        [
            ("rejected", True, None, True),
            ("rejected", False, None, False),
            ("withdrawn", False, None, False),
            ("changes_requested", False, None, True),
            (None, False, None, True),
            ("rejected", True, frozenset({"rejected"}), True),
            ("rejected", False, frozenset({"rejected"}), False),
            (None, True, frozenset({"rejected"}), False),
            ("withdrawn", True, frozenset({"rejected"}), False),
        ],
    )
    def test_keep_in_list(self, kind, include_closed, outcomes, kept):
        assert ro.keep_in_list(kind, include_closed=include_closed, outcomes=outcomes) is kept


class TestRefusals:
    def test_closed_refusal(self):
        assert ro.closed_refusal(_doc(outcome="rejected")) == (
            409,
            {"error": "closed", "outcome": "rejected"},
        )
        assert ro.closed_refusal(_doc(outcome="withdrawn")) == (
            409,
            {"error": "closed", "outcome": "withdrawn"},
        )
        assert ro.closed_refusal(_doc(outcome="changes_requested")) is None
        assert ro.closed_refusal(_doc()) is None

    def test_withdraw(self):
        assert ro.withdraw_refusal(_doc("draft")) is None
        assert ro.withdraw_refusal(_doc("draft", "changes_requested")) is None
        assert ro.withdraw_refusal(_doc("in_review")) is None
        assert ro.withdraw_refusal(_doc("signed")) == (
            400,
            "A signed document cannot be withdrawn",
        )
        assert ro.withdraw_refusal(_doc("draft", "rejected")) == (
            409,
            {"error": "closed", "outcome": "rejected"},
        )
        assert ro.withdraw_refusal(_doc("approved")) == (
            400,
            "Only a draft or a document in review can be withdrawn",
        )

    def test_reopen(self):
        for kind in ("rejected", "withdrawn"):
            assert ro.reopen_refusal(_doc(outcome=kind)) is None
        for kind in ("changes_requested", None):
            assert ro.reopen_refusal(_doc(outcome=kind)) == (409, {"error": "not_closed"})

    def test_closed_message(self):
        assert ro.closed_message("decision", "rejected") == (
            "This decision was rejected and is closed. Reopen it to edit it."
        )
        assert ro.closed_message("document", "withdrawn") == (
            "This document was withdrawn and is closed. Reopen it to edit it."
        )
