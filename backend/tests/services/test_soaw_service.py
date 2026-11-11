"""Unit tests for the SoAW revision service (``app/services/soaw_service.py``).

Pure except :func:`create_revision`, which takes a stub session, and one
:func:`load_chains` test on the database. Every
assertion names exact payloads: CI mutates these lines.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.services import soaw_service as svc
from app.services.soaw_service import SoAWRow

T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
SIGNED_AT = datetime(2026, 2, 3, 4, 5, tzinfo=timezone.utc)


def row(
    rid: str,
    rev: int,
    status: str = "signed",
    parent: str | None = None,
    *,
    name: str = "Doc",
    minutes: int = 0,
    signed_at: datetime | None = None,
) -> SoAWRow:
    return SoAWRow(
        id=rid,
        parent_id=parent,
        revision_number=rev,
        status=status,
        created_at=T0 + timedelta(minutes=minutes),
        name=name,
        signed_at=signed_at,
    )


NOT_IN_A_CHAIN = {
    "is_current": True,
    "is_earlier_revision": False,
    "superseded_by": None,
    "open_revision": None,
}


class TestChainFields:
    def test_a_single_row_is_current(self):
        chains = svc.build([row("a", 1, "draft")])
        assert svc.chain_fields(chains, "a") == NOT_IN_A_CHAIN

    def test_an_unknown_id_reads_as_current(self):
        assert svc.chain_fields(svc.build([]), "x") == NOT_IN_A_CHAIN

    def test_signed_first_and_draft_second(self):
        chains = svc.build([row("a", 1), row("b", 2, "draft", "a", name="Doc v2")])
        assert svc.chain_fields(chains, "a") == {
            "is_current": True,
            "is_earlier_revision": False,
            "superseded_by": None,
            "open_revision": {
                "id": "b",
                "name": "Doc v2",
                "revision_number": 2,
                "status": "draft",
            },
        }
        assert svc.chain_fields(chains, "b") == {
            "is_current": False,
            "is_earlier_revision": False,
            "superseded_by": None,
            "open_revision": None,
        }

    @pytest.mark.parametrize("status", ["in_review", "approved"])
    def test_in_review_and_approved_revisions_are_open(self, status):
        chains = svc.build([row("a", 1), row("b", 2, status, "a")])
        assert svc.chain_fields(chains, "a")["open_revision"] == {
            "id": "b",
            "name": "Doc",
            "revision_number": 2,
            "status": status,
        }

    def test_signed_first_and_signed_second(self):
        chains = svc.build([row("a", 1), row("b", 2, parent="a", name="Doc v2")])
        assert svc.chain_fields(chains, "a") == {
            "is_current": False,
            "is_earlier_revision": True,
            "superseded_by": {"id": "b", "name": "Doc v2", "revision_number": 2},
            "open_revision": None,
        }
        assert svc.chain_fields(chains, "b") == NOT_IN_A_CHAIN

    def test_a_fork_is_one_chain_ordered_by_revision(self):
        chains = svc.build(
            [
                row("root", 1),
                row("x", 3, "draft", "root"),
                row("y", 2, parent="root"),
            ]
        )
        assert svc.chain_ids(chains, "x") == ["root", "y", "x"]
        assert svc.chain_fields(chains, "root")["is_earlier_revision"] is True
        assert svc.chain_fields(chains, "root")["superseded_by"] == {
            "id": "y",
            "name": "Doc",
            "revision_number": 2,
        }
        assert svc.chain_fields(chains, "y")["is_current"] is True
        assert svc.chain_fields(chains, "y")["open_revision"]["id"] == "x"
        assert svc.chain_fields(chains, "x")["is_current"] is False

    def test_a_dangling_parent_is_a_root(self):
        chains = svc.build([row("a", 2, parent="gone"), row("b", 3, "draft", "a")])
        assert svc.chain_ids(chains, "b") == ["a", "b"]
        assert svc.chain_fields(chains, "a")["is_current"] is True
        assert svc.chain_fields(chains, "a")["open_revision"]["id"] == "b"
        assert svc.revise_refusal(chains, "a") == (
            409,
            {"error": "open_revision_exists", "revision_id": "b"},
        )


class TestRevisionsPayload:
    def test_the_chain_in_order_with_status_and_signed_at(self):
        chains = svc.build(
            [
                row("b", 2, "draft", "a", name="New"),
                row("a", 1, signed_at=SIGNED_AT),
            ]
        )
        expected = [
            {
                "id": "a",
                "name": "Doc",
                "revision_number": 1,
                "status": "signed",
                "signed_at": "2026-02-03T04:05:00+00:00",
            },
            {
                "id": "b",
                "name": "New",
                "revision_number": 2,
                "status": "draft",
                "signed_at": None,
            },
        ]
        assert svc.revisions_payload(chains, "a") == expected
        assert svc.revisions_payload(chains, "b") == expected

    def test_unknown_id_has_no_revisions(self):
        assert svc.revisions_payload(svc.build([]), "x") == []
        assert svc.chain_ids(svc.build([]), "x") == ["x"]


class TestKeepInList:
    def test_only_earlier_revisions_drop(self):
        earlier = {"is_earlier_revision": True}
        other = {"is_earlier_revision": False}
        assert svc.keep_in_list(earlier, include_earlier=True) is True
        assert svc.keep_in_list(earlier, include_earlier=False) is False
        assert svc.keep_in_list(other, include_earlier=False) is True
        assert svc.keep_in_list(other, include_earlier=True) is True


class TestReviseRefusal:
    def test_a_draft_is_not_revisable(self):
        chains = svc.build([row("a", 1, "draft")])
        assert svc.revise_refusal(chains, "a") == (400, "Only signed documents can be revised")

    def test_an_unknown_id_is_not_revisable(self):
        assert svc.revise_refusal(svc.build([]), "x") == (
            400,
            "Only signed documents can be revised",
        )

    def test_an_open_revision_blocks(self):
        chains = svc.build([row("a", 1), row("b", 2, "in_review", "a")])
        assert svc.revise_refusal(chains, "a") == (
            409,
            {"error": "open_revision_exists", "revision_id": "b"},
        )

    def test_an_open_revision_before_the_current_one_is_named(self):
        # Legacy: a draft ordered before a later signed revision.
        chains = svc.build([row("a", 1), row("d", 2, "draft", "a"), row("c", 3, parent="a")])
        assert svc.revise_refusal(chains, "c") == (
            409,
            {"error": "open_revision_exists", "revision_id": "d"},
        )

    def test_a_superseded_revision_is_not_latest(self):
        chains = svc.build([row("a", 1), row("b", 2, parent="a")])
        assert svc.revise_refusal(chains, "a") == (
            409,
            {"error": "not_revisable", "reason": "not_latest"},
        )
        assert svc.revise_refusal(chains, "b") is None


def test_content_is_editable_in_every_status_but_in_review_and_signed():
    for status in ("draft", "approved", "anything"):
        assert svc.content_editable(status) is True
    for status in ("in_review", "signed"):
        assert svc.content_editable(status) is False


class TestUpdateRefusal:
    LOCKED = (403, "A document in review is locked. Recall the signature requests to edit it.")

    def test_signed_refuses_everything(self):
        assert svc.update_refusal("signed", None, {"initiative_id"}) == (
            403,
            "Cannot edit a signed document. Create a new revision instead.",
        )

    def test_status_moves_with_their_own_endpoint(self):
        assert svc.update_refusal("draft", "signed", {"status"}) == (
            400,
            "Use the sign endpoint to sign a document",
        )
        assert svc.update_refusal("in_review", "in_review", {"status"}) == (
            400,
            "Use the request-signatures endpoint to send for review",
        )
        assert svc.update_refusal("in_review", "draft", {"status"}) == (
            400,
            "Use the recall-signatures endpoint to reset to draft",
        )

    def test_draft_and_approved_are_editable(self):
        assert svc.update_refusal("draft", "draft", {"status", "name"}) is None
        assert svc.update_refusal("draft", "approved", {"status"}) is None
        assert svc.update_refusal("approved", "draft", {"status"}) is None
        assert svc.update_refusal("approved", None, {"sections"}) is None

    def test_in_review_allows_the_initiative_only(self):
        assert svc.update_refusal("in_review", None, {"initiative_id"}) is None
        assert svc.update_refusal("in_review", None, set()) is None
        assert svc.update_refusal("in_review", None, {"initiative_id", "name"}) == self.LOCKED
        assert svc.update_refusal("in_review", None, ["sections"]) == self.LOCKED
        assert svc.update_refusal("in_review", "approved", {"status"}) == self.LOCKED


class TestRequestAndDeleteRefusals:
    def test_request_signatures(self):
        assert svc.request_refusal("draft") is None
        assert svc.request_refusal("approved") is None
        assert svc.request_refusal("in_review") == (409, {"error": "not_requestable"})
        assert svc.request_refusal("signed") == (400, "Document is already signed")

    def test_delete_drafts_only(self):
        assert svc.delete_refusal("draft") is None
        for status in ("in_review", "approved", "signed"):
            assert svc.delete_refusal(status) == (400, "Only draft documents can be deleted")


class TestLabels:
    def test_revision_shown_from_two(self):
        assert svc.soaw_label("Doc", 1) == "Doc"
        assert svc.soaw_label("Doc", None) == "Doc"
        assert svc.soaw_label("Doc", 2) == "Doc (Rev 2)"
        assert svc.soaw_label("Doc", 10) == "Doc (Rev 10)"

    def test_link(self):
        sid = uuid.UUID("12345678-1234-5678-1234-567812345678")
        assert svc.soaw_link(sid) == "/ea-delivery/soaw/12345678-1234-5678-1234-567812345678"


class _Session:
    def __init__(self):
        self.added: list = []
        self.flushed = 0

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flushed += 1

    async def get(self, model, key):
        # The timeline row looks its actor up; no user is stored here.
        return None


class TestCreateRevision:
    def _source(self, sid: uuid.UUID, rev: int) -> SoAW:
        return SoAW(
            id=sid,
            name="Doc",
            initiative_id=uuid.UUID(int=7),
            status="signed",
            document_info={"version": "1.0"},
            version_history=[{"version": "1.0"}],
            sections={"scope": {"text": "v1"}},
            revision_number=rev,
            signatories=[{"user_id": "u"}],
            created_by=uuid.UUID(int=9),
        )

    async def test_numbered_from_the_chain_maximum_and_content_copied(self):
        root, tip = uuid.UUID(int=1), uuid.UUID(int=3)
        chains = svc.build([row(root, 1), row(tip, 3, parent=root)])
        source = self._source(tip, 3)
        db = _Session()
        author = uuid.UUID(int=5)

        new = await svc.create_revision(db, source, created_by=author, chains=chains)

        # The revision, then its timeline's first row (document_collab.on_workflow).
        assert db.added[0] is new and len(db.added) == 2 and db.flushed == 2
        entry = db.added[1]
        assert isinstance(entry, DocumentHistoryEntry)
        assert (entry.kind, entry.soaw_id, entry.architecture_decision_id) == (
            "revised",
            new.id,
            None,
        )
        assert new.revision_number == 4
        assert new.parent_id == tip
        assert new.status == "draft"
        assert new.name == "Doc"
        assert new.initiative_id == uuid.UUID(int=7)
        assert new.created_by == author
        assert new.document_info == {"version": "1.0"}
        assert new.version_history == [{"version": "1.0"}]
        assert new.sections == {"scope": {"text": "v1"}}
        assert new.signatories is None
        # A copy, not the same objects: editing the draft never touches the signed one.
        new.sections["scope"]["text"] = "v2"
        new.version_history.append({"version": "2.0"})
        new.document_info["version"] = "2.0"
        assert source.sections == {"scope": {"text": "v1"}}
        assert source.version_history == [{"version": "1.0"}]
        assert source.document_info == {"version": "1.0"}

    async def test_a_source_outside_the_loaded_chains_follows_its_own_number(self):
        source = self._source(uuid.UUID(int=4), 6)
        new = await svc.create_revision(_Session(), source, created_by=None, chains=svc.build([]))
        assert new.revision_number == 7
        assert new.created_by is None

    async def test_a_revision_of_an_earlier_row_takes_the_chain_maximum_plus_one(self):
        root, mid, tip = uuid.UUID(int=1), uuid.UUID(int=2), uuid.UUID(int=3)
        chains = svc.build([row(root, 1), row(mid, 3, parent=root), row(tip, 5, parent=mid)])
        new = await svc.create_revision(
            _Session(), self._source(mid, 3), created_by=None, chains=chains
        )
        assert new.revision_number == 6

    async def test_nested_content_is_copied_deeply(self):
        source = self._source(uuid.UUID(int=4), 1)
        source.document_info = {"meta": {"owner": "A"}}
        source.version_history = [{"version": "1.0"}]
        new = await svc.create_revision(_Session(), source, created_by=None, chains=svc.build([]))

        new.document_info["meta"]["owner"] = "B"
        new.version_history[0]["version"] = "2.0"

        assert source.document_info == {"meta": {"owner": "A"}}
        assert source.version_history == [{"version": "1.0"}]


class TestForkOrder:
    def test_same_numbered_revisions_are_ordered_by_creation_before_id(self):
        chains = svc.build(
            [
                row("a", 1),
                row("b", 2, parent="a", minutes=9),
                row("c", 2, parent="a", minutes=1),
            ]
        )
        assert svc.chain_ids(chains, "a") == ["a", "c", "b"]

    async def test_load_chains_carries_the_stored_created_at(self, db):
        made = datetime(2025, 3, 4, 5, 6, tzinfo=timezone.utc)
        soaw = SoAW(name="Loaded", created_at=made)
        db.add(soaw)
        await db.flush()

        chains = await svc.load_chains(db)

        assert chains.rows[soaw.id].created_at == made
