"""The edit history of decisions and SoAWs: snapshots, change detection,
recording a draft's saves and restoring a version.

Pure rules first (no database), then the session side.
"""

from __future__ import annotations

import json
import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_card import ArchitectureDecisionCard
from app.models.architecture_decision_person import ArchitectureDecisionPerson
from app.models.document_history import DocumentHistoryEntry
from app.models.soaw import SoAW
from app.services import adr_service, decision_people_service, document_collab, soaw_service
from app.services import decision_standing as ds
from app.services import document_history_service as history
from app.services.card_read_scope import CardReadScope
from tests.conftest import create_card, create_card_type, create_user

U1 = "00000000-0000-4000-8000-000000000001"
C1 = "00000000-0000-4000-8000-0000000000c1"
C2 = "00000000-0000-4000-8000-0000000000c2"


def span(mention_id: str, label: str = "", kind: str = "card") -> str:
    return f'<span data-type="mention" data-kind="{kind}" data-id="{mention_id}">{label}</span>'


def _adr_doc(**fields) -> SimpleNamespace:
    base = {
        "id": uuid.uuid4(),
        "title": "Use Postgres",
        "context": "<p>c</p>",
        "decision": f"<p>{span(C1)}</p>",
        "consequences": None,
        "alternatives_considered": "<p>a</p>",
        "decided_on": date(2026, 1, 2),
        "effective_from": None,
        "valid_until": date(2027, 3, 4),
        "change_summary": "Why",
        # Never part of a snapshot:
        "status": "draft",
        "signatories": [{"user_id": U1, "email": "secret@x.test", "status": "pending"}],
        "attributes": {"ext.x": 1},
        "reference_number": "ADR-001",
    }
    return SimpleNamespace(**{**base, **fields})


def _soaw_doc(**fields) -> SimpleNamespace:
    base = {
        "id": uuid.uuid4(),
        "name": "Plan",
        "document_info": {"prepared_by": "Ada"},
        "version_history": [{"version": "1"}],
        "sections": {"1.1": {"content": "<p>s</p>", "hidden": False}},
        "status": "draft",
        "initiative_id": uuid.uuid4(),
        "signatories": [{"user_id": U1, "email": "secret@x.test"}],
    }
    return SimpleNamespace(**{**base, **fields})


# ---------------------------------------------------------------------------
# Snapshots
# ---------------------------------------------------------------------------


class TestSnapshot:
    def test_the_field_lists(self):
        assert history.SNAPSHOT_FIELDS == {
            "adr": (
                "title",
                "context",
                "decision",
                "consequences",
                "alternatives_considered",
                "decided_on",
                "effective_from",
                "valid_until",
                "change_summary",
                "decision_makers",
                "participants",
            ),
            "soaw": ("name", "document_info", "version_history", "sections"),
        }
        assert history.CONTENT_KINDS == ("created", "baseline", "save", "restored", "revised")

    def test_a_decision(self):
        people = {
            "decision_makers": [
                {"user_id": U1, "display_name": "Ada"},
                {"user_id": None, "display_name": "Free text"},
            ],
            "participants": [{"user_id": uuid.UUID(U1), "name": "Ada"}],
        }
        snap = history.snapshot_of("adr", _adr_doc(), people)
        assert snap == {
            "title": "Use Postgres",
            "context": "<p>c</p>",
            "decision": f"<p>{span(C1)}</p>",
            "consequences": None,
            "alternatives_considered": "<p>a</p>",
            "decided_on": "2026-01-02",
            "effective_from": None,
            "valid_until": "2027-03-04",
            "change_summary": "Why",
            "decision_makers": [
                {"user_id": U1, "name": "Ada"},
                {"user_id": None, "name": "Free text"},
            ],
            "participants": [{"user_id": U1, "name": "Ada"}],
        }
        assert list(snap) == list(history.SNAPSHOT_FIELDS["adr"])

    def test_a_decision_without_people_has_empty_parts(self):
        snap = history.snapshot_of("adr", _adr_doc())
        assert (snap["decision_makers"], snap["participants"]) == ([], [])
        partial = history.snapshot_of("adr", _adr_doc(), {"participants": None})
        assert partial["participants"] == []

    def test_a_soaw_is_a_deep_copy(self):
        doc = _soaw_doc()
        snap = history.snapshot_of("soaw", doc)
        assert snap == {
            "name": "Plan",
            "document_info": {"prepared_by": "Ada"},
            "version_history": [{"version": "1"}],
            "sections": {"1.1": {"content": "<p>s</p>", "hidden": False}},
        }
        doc.sections["1.1"]["content"] = "changed"
        doc.document_info["prepared_by"] = "Bob"
        doc.version_history.append({})
        assert snap["sections"]["1.1"]["content"] == "<p>s</p>"
        assert snap["document_info"] == {"prepared_by": "Ada"}
        assert snap["version_history"] == [{"version": "1"}]

    def test_an_empty_soaw(self):
        doc = _soaw_doc(document_info=None, version_history=None, sections=None)
        assert history.snapshot_of("soaw", doc) == {
            "name": "Plan",
            "document_info": {},
            "version_history": [],
            "sections": {},
        }

    @pytest.mark.parametrize("kind", ["adr", "soaw"])
    def test_never_an_email_signatories_or_filing(self, kind):
        doc = _adr_doc() if kind == "adr" else _soaw_doc()
        snap = history.snapshot_of(kind, doc)
        text = json.dumps(snap)
        assert "secret@x.test" not in text
        assert not {"signatories", "attributes", "initiative_id", "status", "id"} & set(snap)

    def test_an_unknown_kind_is_refused(self):
        with pytest.raises(ValueError):
            history.snapshot_of("card", _adr_doc())
        with pytest.raises(ValueError):
            history.restore_fields("card", {})

    @pytest.mark.parametrize(
        "kind, expected",
        [
            ("created", True),
            ("baseline", True),
            ("save", True),
            ("restored", True),
            ("revised", True),
            ("sent_for_review", False),
            ("signature", False),
            ("signed", False),
            ("rejected", False),
            ("recalled", False),
            ("recorded", False),
        ],
    )
    def test_has_content(self, kind, expected):
        assert history.has_content(kind) is expected


# ---------------------------------------------------------------------------
# Change detection
# ---------------------------------------------------------------------------


def _adr_content(**fields) -> dict:
    return {**history.snapshot_of("adr", _adr_doc()), **fields}


class TestNormaliseDecision:
    def test_key_order_does_not_matter(self):
        content = _adr_content()
        reordered = dict(reversed(list(content.items())))
        assert history.differs(content, reordered) is False
        assert list(history.normalise(reordered)) == sorted(content)

    def test_a_mention_label_is_not_a_change(self):
        labelled = _adr_content(decision=f"<p>{span(C1, '@Billing')}</p>")
        assert history.differs(_adr_content(), labelled) is False
        assert history.normalise(labelled)["decision"] == f"<p>{span(C1)}</p>"

    def test_another_mention_target_is_a_change(self):
        assert history.differs(_adr_content(), _adr_content(decision=f"<p>{span(C2)}</p>"))

    @pytest.mark.parametrize("blank", ["", "<p></p>", "  <p> </p><br>", "<p>&nbsp;</p>", None])
    def test_blank_text_is_none(self, blank):
        assert history.normalise(_adr_content(context=blank))["context"] is None
        assert history.differs(_adr_content(context=None), _adr_content(context=blank)) is False

    def test_text_is_compared_by_its_html(self):
        assert history.differs(_adr_content(), _adr_content(context="<p><b>c</b></p>"))
        assert history.normalise(_adr_content(context="<p>x</p>"))["context"] == "<p>x</p>"

    def test_a_blank_change_summary_is_none(self):
        assert history.normalise(_adr_content(change_summary=""))["change_summary"] is None
        assert history.normalise(_adr_content(change_summary="x"))["change_summary"] == "x"

    def test_scalars_and_people_count(self):
        assert history.differs(_adr_content(), _adr_content(title="Other"))
        assert history.differs(_adr_content(), _adr_content(valid_until=None))
        guest = [{"user_id": None, "name": "Guest"}]
        assert history.differs(_adr_content(), _adr_content(participants=guest))
        assert (
            history.differs(_adr_content(participants=guest), _adr_content(participants=guest))
            is False
        )

    @pytest.mark.parametrize("value", [None, [], "x"])
    def test_a_non_map_is_returned_as_it_is(self, value):
        assert history.normalise(value) is value


def _soaw_content(**fields) -> dict:
    base = {
        "name": "Plan",
        "document_info": {},
        "version_history": [],
        "sections": {"1.1": {"content": "<p>a</p>"}},
    }
    return {**base, **fields}


#: The same document as the SoAW editor sends it back after a load: every
#: template section merged over its defaults, empty document info and an empty
#: version-history row (``soawStateFromLoaded`` + ``soawEditorFields``).
EDITOR_ROUND_TRIP = {
    "name": "Plan",
    "document_info": {"prepared_by": "", "reviewed_by": "", "review_date": ""},
    "version_history": [{"version": "", "date": "", "revised_by": "", "description": ""}],
    "sections": {
        "1.1": {"content": "<p>a</p>", "hidden": False},
        "1.2": {"content": "", "hidden": False},
        "2.1": {
            "content": "",
            "hidden": False,
            "table_data": {"columns": ["Name", "Role"], "rows": [["", ""]]},
        },
        "3.1": {"content": "<p></p>", "hidden": False, "togaf_data": {"a": "", "b": ""}},
    },
}


class TestNormaliseSoaw:
    def test_the_template_defaults_the_editor_adds_are_not_a_change(self):
        assert history.differs(_soaw_content(), EDITOR_ROUND_TRIP) is False
        assert history.normalise(EDITOR_ROUND_TRIP) == {
            "document_info": {},
            "name": "Plan",
            "sections": {"1.1": {"content": "<p>a</p>"}},
            "version_history": [],
        }

    def test_what_holds_a_value_is_kept(self):
        content = {
            "name": "Plan",
            "document_info": {"prepared_by": "Ada", "reviewed_by": ""},
            "version_history": [{"version": "1", "date": ""}, {"version": ""}],
            "sections": {
                "1.1": {"content": "<p>a</p>", "hidden": True},
                "2.1": {"content": "", "table_data": {"columns": ["A"], "rows": [["x"]]}},
                "3.1": {"content": "", "togaf_data": {"a": "", "b": "phase"}},
                "custom_1": {"content": "", "title": "Extra", "insertAfter": "1.1"},
            },
        }
        assert history.normalise(content) == {
            "document_info": {"prepared_by": "Ada"},
            "name": "Plan",
            "sections": {
                "1.1": {"content": "<p>a</p>", "hidden": True},
                "2.1": {"table_data": {"columns": ["A"], "rows": [["x"]]}},
                "3.1": {"togaf_data": {"a": "", "b": "phase"}},
                "custom_1": {"insertAfter": "1.1", "title": "Extra"},
            },
            "version_history": [{"date": "", "version": "1"}],
        }

    @pytest.mark.parametrize(
        "change",
        [
            {"1.1": {"content": "<p>b</p>"}},
            {"1.1": {"content": "<p>a</p>", "hidden": True}},
            {"1.1": {"content": "<p>a</p>"}, "2.1": {"table_data": {"rows": [["x"]]}}},
            {"1.1": {"content": "<p>a</p>"}, "custom_1": {"content": "", "title": "T"}},
        ],
    )
    def test_a_real_section_change_is_a_change(self, change):
        assert history.differs(_soaw_content(), _soaw_content(sections=change)) is True

    def test_a_mention_label_in_a_section_is_not_a_change(self):
        labelled = _soaw_content(sections={"1.1": {"content": f"<p>{span(C1, '@X')}</p>"}})
        plain = _soaw_content(sections={"1.1": {"content": f"<p>{span(C1)}</p>"}})
        assert history.differs(plain, labelled) is False

    def test_document_info_and_version_history_count(self):
        assert history.differs(_soaw_content(), _soaw_content(document_info={"prepared_by": "A"}))
        assert history.differs(_soaw_content(), _soaw_content(version_history=[{"v": "1"}]))
        assert history.differs(_soaw_content(), _soaw_content(name="Other"))

    def test_odd_shapes_pass_through(self):
        odd = {"name": "P", "document_info": "x", "version_history": "y", "sections": ["z"]}
        assert history.normalise(odd) == odd
        assert history.normalise(_soaw_content(sections={"1.1": "plain"}))["sections"] == {
            "1.1": "plain"
        }


# ---------------------------------------------------------------------------
# Restore mapping
# ---------------------------------------------------------------------------


class TestRestoreFields:
    def test_a_decision(self):
        content = _adr_content(
            decision_makers=[{"user_id": U1, "name": "Ada"}, "junk", {"name": "Free"}],
        )
        assert history.restore_fields("adr", content) == {
            "title": "Use Postgres",
            "context": "<p>c</p>",
            "decision": f"<p>{span(C1)}</p>",
            "consequences": None,
            "alternatives_considered": "<p>a</p>",
            "decided_on": date(2026, 1, 2),
            "effective_from": None,
            "valid_until": date(2027, 3, 4),
            "change_summary": "Why",
            "decision_makers": [
                {"user_id": U1, "name": "Ada"},
                {"user_id": None, "name": "Free"},
            ],
            "participants": [],
        }

    def test_an_empty_decision_snapshot(self):
        fields = history.restore_fields("adr", {})
        assert fields["title"] is None
        assert (fields["decided_on"], fields["decision_makers"]) == (None, [])

    def test_a_soaw_is_a_deep_copy(self):
        content = _soaw_content(document_info={"prepared_by": "A"})
        fields = history.restore_fields("soaw", content)
        assert fields == {
            "name": "Plan",
            "document_info": {"prepared_by": "A"},
            "version_history": [],
            "sections": {"1.1": {"content": "<p>a</p>"}},
        }
        fields["sections"]["1.1"]["content"] = "x"
        assert content["sections"]["1.1"]["content"] == "<p>a</p>"
        assert history.restore_fields("soaw", {}) == {
            "name": None,
            "document_info": {},
            "version_history": [],
            "sections": {},
        }

    def test_people_entries_keep_the_name_of_a_vanished_user(self):
        people = [
            {"user_id": U1, "name": "Ada"},
            {"user_id": C1, "name": "Gone"},
            {"user_id": None, "name": "Free"},
        ]
        assert history.people_entries(people, {U1}) == [
            {"user_id": U1},
            {"name": "Gone"},
            {"name": "Free"},
        ]

    def test_only_a_draft_decision_is_restored(self):
        assert history.restore_refusal("adr", "draft") is None
        for status in ("in_review", "signed", "approved", "superseded"):
            assert history.restore_refusal("adr", status) == (409, {"error": "not_draft"})

    def test_a_soaw_is_restored_whenever_its_content_may_be_edited(self):
        """A legacy ``approved`` SoAW can be edited, so it can be restored."""
        assert history.restore_refusal("soaw", "draft") is None
        assert history.restore_refusal("soaw", "approved") is None
        for status in ("in_review", "signed"):
            assert history.restore_refusal("soaw", status) == (409, {"error": "not_draft"})

    def test_source_id(self):
        sid = uuid.uuid4()
        assert history.source_id(SimpleNamespace(kind="restored", note=str(sid))) == sid
        assert history.source_id(SimpleNamespace(kind="restored", note="nonsense")) is None
        assert history.source_id(SimpleNamespace(kind="restored", note=None)) is None
        assert history.source_id(SimpleNamespace(kind="rejected", note=str(sid))) is None


# ---------------------------------------------------------------------------
# The session side
# ---------------------------------------------------------------------------


async def _rows(db, doc_id, owner="architecture_decision_id") -> list[DocumentHistoryEntry]:
    return list(
        (
            await db.execute(
                select(DocumentHistoryEntry)
                .where(getattr(DocumentHistoryEntry, owner) == doc_id)
                .order_by(DocumentHistoryEntry.seq)
            )
        )
        .scalars()
        .all()
    )


async def _legacy_decision(db, **fields) -> ArchitectureDecision:
    """A decision as migration 171 left it: a ``created`` row without content."""
    adr = ArchitectureDecision(reference_number="ADR-900", title="Legacy", **fields)
    db.add(adr)
    await db.flush()
    db.add(DocumentHistoryEntry(architecture_decision_id=adr.id, kind="created"))
    await db.flush()
    return adr


class TestRecordSave:
    async def test_a_legacy_document_gets_a_baseline_then_the_save(self, db):
        user = await create_user(db, display_name="Ada")
        adr = await _legacy_decision(db, context="<p>old</p>")
        before = await history.current_snapshot(db, "adr", adr)
        adr.context = "<p>new</p>"
        saved = await history.record_save(db, "adr", adr, user=user, before=before)
        created, baseline, save = await _rows(db, adr.id)
        assert created.content is None
        assert (baseline.kind, baseline.actor_id, baseline.actor_name, baseline.note) == (
            "baseline",
            None,
            None,
            None,
        )
        assert baseline.content["context"] == "<p>old</p>"
        assert save is saved
        assert (save.kind, save.actor_id, save.actor_name) == ("save", user.id, "Ada")
        assert save.content["context"] == "<p>new</p>"
        assert baseline.seq < save.seq

    async def test_an_unchanged_first_save_writes_the_baseline_only(self, db):
        user = await create_user(db)
        adr = await _legacy_decision(db)
        before = await history.current_snapshot(db, "adr", adr)
        assert await history.record_save(db, "adr", adr, user=user, before=before) is None
        assert [r.kind for r in await _rows(db, adr.id)] == ["created", "baseline"]

    async def test_the_first_save_needs_the_earlier_state(self, db):
        user = await create_user(db)
        adr = await _legacy_decision(db)
        with pytest.raises(ValueError):
            await history.record_save(db, "adr", adr, user=user, before=None)

    async def test_a_save_is_compared_with_the_latest_version(self, db):
        user = await create_user(db)
        adr = await adr_service.create_decision(db, title="T", context="<p>a</p>")
        assert await history.record_save(db, "adr", adr, user=user, before=None) is None
        assert [r.kind for r in await _rows(db, adr.id)] == ["created"]
        adr.context = "<p>b</p>"
        first = await history.record_save(db, "adr", adr, user=user, before=None)
        adr.context = "<p>a</p>"
        second = await history.record_save(db, "adr", adr, user=user, before=None)
        assert (first.content["context"], second.content["context"]) == ("<p>b</p>", "<p>a</p>")
        assert [r.kind for r in await _rows(db, adr.id)] == ["created", "save", "save"]

    async def test_after_save_records_for_a_draft_only(self, db):
        user = await create_user(db)
        adr = await adr_service.create_decision(db, title="T")
        adr.title = "Changed"
        await document_collab.after_save(db, "adr", adr, user=user, was_draft=False, before=None)
        assert [r.kind for r in await _rows(db, adr.id)] == ["created"]
        await document_collab.after_save(db, "adr", adr, user=user, was_draft=True, before=None)
        rows = await _rows(db, adr.id)
        assert [r.kind for r in rows] == ["created", "save"]
        assert rows[1].content["title"] == "Changed"

    async def test_a_soaw_save(self, db):
        user = await create_user(db)
        soaw = SoAW(name="Plan", sections={"1.1": {"content": "<p>a</p>"}})
        db.add(soaw)
        await db.flush()
        before = history.snapshot_of("soaw", soaw)
        # The editor's round trip of an untouched document is no change...
        soaw.sections = EDITOR_ROUND_TRIP["sections"]
        soaw.document_info = EDITOR_ROUND_TRIP["document_info"]
        assert await history.record_save(db, "soaw", soaw, user=user, before=before) is None
        # ...a real one is.
        soaw.name = "Renamed"
        saved = await history.record_save(db, "soaw", soaw, user=user, before=before)
        rows = await _rows(db, soaw.id, owner="soaw_id")
        assert [r.kind for r in rows] == ["baseline", "save"]
        assert rows[0].content == {
            "name": "Plan",
            "document_info": {},
            "version_history": [],
            "sections": {"1.1": {"content": "<p>a</p>"}},
        }
        assert saved.content["name"] == "Renamed"


class TestInitialContent:
    async def test_created_carries_the_content_and_the_people(self, db):
        user = await create_user(db, display_name="Ada")
        adr = await adr_service.create_decision(
            db,
            title="T",
            context="<p>c</p>",
            decided_on=date(2026, 1, 1),
            change_summary="s",
            created_by=user.id,
            decision_makers=[{"user_id": str(user.id)}],
            participants=[{"name": "Guest"}],
        )
        (row,) = await _rows(db, adr.id)
        assert (row.kind, row.actor_id) == ("created", user.id)
        assert row.content == {
            "title": "T",
            "context": "<p>c</p>",
            "decision": None,
            "consequences": None,
            "alternatives_considered": None,
            "decided_on": "2026-01-01",
            "effective_from": None,
            "valid_until": None,
            "change_summary": "s",
            "decision_makers": [{"user_id": str(user.id), "name": "Ada"}],
            "participants": [{"user_id": None, "name": "Guest"}],
        }

    async def test_a_duplicate_and_a_revision_carry_the_copied_people(self, db):
        user = await create_user(db, display_name="Ada")
        source = await adr_service.create_decision(
            db, title="Src", decision_makers=[{"name": "Boss"}]
        )
        dup = await adr_service.duplicate_decision(db, source, created_by=user.id)
        (row,) = await _rows(db, dup.id)
        assert (row.kind, row.content["title"], row.content["decision_makers"]) == (
            "created",
            "Src (copy)",
            [{"user_id": None, "name": "Boss"}],
        )
        source.status = "signed"
        await db.flush()
        revision = await adr_service.create_revision(
            db, source, created_by=user.id, register=await ds.load_register(db)
        )
        (row,) = await _rows(db, revision.id)
        assert (row.kind, row.content["title"], row.content["decision_makers"]) == (
            "revised",
            "Src",
            [{"user_id": None, "name": "Boss"}],
        )

    async def test_a_soaw_revision_carries_its_content(self, db):
        user = await create_user(db)
        soaw = SoAW(
            name="Plan", status="signed", sections={"1.1": {"content": "x"}}, document_info={}
        )
        db.add(soaw)
        await db.flush()
        revision = await soaw_service.create_revision(
            db, soaw, created_by=user.id, chains=await soaw_service.load_chains(db)
        )
        (row,) = await _rows(db, revision.id, owner="soaw_id")
        assert (row.kind, row.content) == (
            "revised",
            {
                "name": "Plan",
                "document_info": {},
                "version_history": [],
                "sections": {"1.1": {"content": "x"}},
            },
        )


async def _version(db, adr, content: dict, kind="save") -> DocumentHistoryEntry:
    entry = DocumentHistoryEntry(architecture_decision_id=adr.id, kind=kind, content=content)
    db.add(entry)
    await db.flush()
    return entry


class TestRestore:
    async def test_text_scalars_and_people_come_back_links_stay(self, db):
        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Billing")
        user = await create_user(db, display_name="Ada")
        adr = await adr_service.create_decision(
            db,
            title="Now",
            context="<p>now</p>",
            linked_card_ids=[card.id],
            attributes={"ext.k": "v"},
            decision_makers=[{"name": "Current"}],
        )
        vanished = str(uuid.uuid4())
        old = await _version(
            db,
            adr,
            {
                **history.snapshot_of("adr", adr),
                "title": "Then",
                "context": f"<p>then {span(str(card.id))}</p>",
                "decided_on": "2026-01-05",
                "change_summary": "old",
                "decision_makers": [
                    {"user_id": str(user.id), "name": "Ada (then)"},
                    {"user_id": vanished, "name": "Gone"},
                ],
                "participants": [{"user_id": None, "name": "Guest"}],
            },
        )
        restored = await history.restore(
            db, "adr", adr, str(old.id), user=user, read_scope=CardReadScope.everything()
        )
        assert (adr.title, adr.context, adr.decided_on, adr.change_summary) == (
            "Then",
            f"<p>then {span(str(card.id))}</p>",
            date(2026, 1, 5),
            "old",
        )
        people = (await decision_people_service.people_payload(db, [adr.id]))[adr.id]
        assert people == {
            "decision_makers": [
                {"user_id": str(user.id), "display_name": "Ada"},
                {"user_id": None, "display_name": "Gone"},
            ],
            "participants": [{"user_id": None, "display_name": "Guest"}],
        }
        links = (
            (
                await db.execute(
                    select(ArchitectureDecisionCard.card_id).where(
                        ArchitectureDecisionCard.architecture_decision_id == adr.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert links == [card.id]
        assert adr.attributes == {"ext.k": "v"}
        assert (restored.kind, restored.note, restored.actor_id, restored.actor_name) == (
            "restored",
            str(old.id),
            user.id,
            "Ada",
        )
        assert restored.content == await history.current_snapshot(db, "adr", adr)
        assert [r.kind for r in await _rows(db, adr.id)] == ["created", "save", "restored"]

    async def test_refusals(self, db):
        user = await create_user(db)
        adr = await adr_service.create_decision(db, title="T")
        other = await adr_service.create_decision(db, title="Other")
        foreign = await _version(db, other, history.snapshot_of("adr", other))
        workflow = DocumentHistoryEntry(architecture_decision_id=adr.id, kind="recalled")
        db.add(workflow)
        await db.flush()
        for bad in (str(foreign.id), str(workflow.id), "not-a-uuid", str(uuid.uuid4())):
            with pytest.raises(HTTPException) as exc:
                await history.restore(db, "adr", adr, bad, user=user, read_scope=None)
            assert (exc.value.status_code, exc.value.detail) == (404, "History entry not found")
        (created,) = [r for r in await _rows(db, adr.id) if r.kind == "created"]
        adr.status = "in_review"
        with pytest.raises(HTTPException) as exc:
            await history.restore(db, "adr", adr, str(created.id), user=user, read_scope=None)
        assert (exc.value.status_code, exc.value.detail) == (409, {"error": "not_draft"})

    async def test_invalid_dates_are_a_400_and_nothing_changes(self, db):
        user = await create_user(db)
        adr = await adr_service.create_decision(db, title="Now")
        bad = await _version(
            db,
            adr,
            {
                **history.snapshot_of("adr", adr),
                "title": "Then",
                "effective_from": "2026-05-01",
                "valid_until": "2026-04-01",
            },
        )
        with pytest.raises(HTTPException) as exc:
            await history.restore(db, "adr", adr, str(bad.id), user=user, read_scope=None)
        assert exc.value.status_code == 400
        assert exc.value.detail["error"] == ds.VALID_UNTIL_BEFORE_EFFECTIVE
        assert adr.title == "Now"

    async def test_a_soaw(self, db):
        user = await create_user(db)
        soaw = SoAW(name="Now", sections={"1.1": {"content": "now"}}, initiative_id=None)
        db.add(soaw)
        await db.flush()
        then = DocumentHistoryEntry(
            soaw_id=soaw.id,
            kind="baseline",
            content={
                "name": "Then",
                "document_info": {"prepared_by": "A"},
                "version_history": [{"version": "0.1"}],
                "sections": {"1.1": {"content": "then"}},
            },
        )
        db.add(then)
        await db.flush()
        restored = await history.restore(db, "soaw", soaw, str(then.id), user=user, read_scope=None)
        assert (soaw.name, soaw.document_info, soaw.version_history, soaw.sections) == (
            "Then",
            {"prepared_by": "A"},
            [{"version": "0.1"}],
            {"1.1": {"content": "then"}},
        )
        assert restored.content == then.content
        assert restored.soaw_id == soaw.id


class TestTimelineAndVersion:
    async def test_newest_first_paged_with_the_restore_source(self, db):
        user = await create_user(db, display_name="Ada")
        adr = await adr_service.create_decision(db, title="T", created_by=user.id)
        (created,) = await _rows(db, adr.id)
        restored = await history.restore(
            db, "adr", adr, str(created.id), user=user, read_scope=None
        )
        await document_collab.on_workflow(db, "adr", adr, "recalled", user=None)
        total, entries = await history.timeline(db, "adr", adr.id, page=1, page_size=2)
        assert total == 3
        assert [e["kind"] for e in entries] == ["recalled", "restored"]
        assert entries[0]["restored_from"] is None
        assert entries[1]["restored_from"] == {
            "id": str(created.id),
            "kind": "created",
            "created_at": created.created_at.isoformat(),
        }
        assert entries[1]["id"] == str(restored.id)
        _, rest = await history.timeline(db, "adr", adr.id, page=2, page_size=2)
        assert [(e["kind"], e["actor"]) for e in rest] == [
            ("created", {"id": str(user.id), "display_name": "Ada"})
        ]

    def test_the_timeline_query_never_selects_the_snapshot(self):
        stmt = history.timeline_query("soaw", uuid.uuid4(), page=2, page_size=5)
        assert [c.key for c in stmt.selected_columns] == [
            "id",
            "kind",
            "actor_id",
            "actor_name",
            "note",
            "created_at",
            "has_content",
            "display_name",
        ]
        assert all(c is not DocumentHistoryEntry.__table__.c.content for c in stmt.selected_columns)
        sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "document_history.content AS" not in sql
        assert "document_history.content," not in sql
        assert "jsonb_typeof(document_history.content)" in sql
        assert "document_history.soaw_id" in sql
        assert "ORDER BY document_history.seq DESC" in sql
        assert "LIMIT 5 OFFSET 5" in sql

    async def test_the_timeline_reads_no_snapshot_and_still_says_which_rows_have_one(self, db):
        """The page is read without ``content``; ``has_content`` is true for a
        snapshot (even an empty one) and false for SQL NULL and JSON null."""
        from sqlalchemy import event

        adr = ArchitectureDecision(reference_number="ADR-077", title="T")
        db.add(adr)
        await db.flush()
        owner = {"architecture_decision_id": adr.id}
        db.add(DocumentHistoryEntry(**owner, kind="created", content={"title": "T"}))
        await db.flush()
        db.add(DocumentHistoryEntry(**owner, kind="save", content={}))
        await db.flush()
        db.add(DocumentHistoryEntry(**owner, kind="sent_for_review"))
        await db.flush()
        # An explicit ``None`` is stored as JSON null (what an import writes).
        db.add(DocumentHistoryEntry(**owner, kind="recalled", content=None))
        await db.flush()

        statements: list[str] = []

        def spy(conn, cursor, statement, *args):
            statements.append(statement)

        engine = db.bind.sync_engine
        event.listen(engine, "before_cursor_execute", spy)
        try:
            total, entries = await history.timeline(db, "adr", adr.id, page=1, page_size=10)
        finally:
            event.remove(engine, "before_cursor_execute", spy)

        stored_null = (
            await db.execute(
                select(DocumentHistoryEntry.kind, DocumentHistoryEntry.content.is_(None))
                .where(DocumentHistoryEntry.architecture_decision_id == adr.id)
                .where(DocumentHistoryEntry.kind.in_(("sent_for_review", "recalled")))
                .order_by(DocumentHistoryEntry.seq)
            )
        ).all()
        assert [tuple(r) for r in stored_null] == [("sent_for_review", True), ("recalled", False)]
        assert total == 4
        assert [(e["kind"], e["has_content"]) for e in entries] == [
            ("recalled", False),
            ("sent_for_review", False),
            ("save", True),
            ("created", True),
        ]
        page_sql = [s for s in statements if "ORDER BY document_history.seq DESC" in s]
        assert len(page_sql) == 1
        assert "document_history.content AS" not in page_sql[0]
        assert "document_history.content," not in page_sql[0]

    async def test_a_version_is_rendered_for_the_reader(self, db):
        await create_card_type(db, key="Application", label="Application")
        card = await create_card(db, card_type="Application", name="Billing")
        user = await create_user(db, display_name="Ada")
        adr = await adr_service.create_decision(
            db,
            title="T",
            decision=f"<p>{span(str(card.id))}</p>",
            created_by=user.id,
            decision_makers=[{"user_id": str(user.id)}],
        )
        (created,) = await _rows(db, adr.id)
        payload = await history.version_payload(
            db, "adr", adr, created, user=user, read_scope=CardReadScope.everything()
        )
        assert payload["content"]["decision"] == f"<p>{span(str(card.id), '@Billing')}</p>"
        assert payload["content"]["decision_makers"] == [
            {"user_id": str(user.id), "display_name": "Ada"}
        ]
        assert payload["entry"]["kind"] == "created"
        assert payload["entry"]["actor"] == {"id": str(user.id), "display_name": "Ada"}
        # The stored row is left as it is.
        assert created.content["decision"] == f"<p>{span(str(card.id))}</p>"

    async def test_a_version_without_mentions_or_actor(self, db):
        user = await create_user(db)
        soaw = SoAW(name="P", sections={"1.1": {"content": "x"}})
        db.add(soaw)
        await db.flush()
        entry = DocumentHistoryEntry(
            soaw_id=soaw.id, kind="baseline", content=history.snapshot_of("soaw", soaw)
        )
        db.add(entry)
        await db.flush()
        payload = await history.version_payload(db, "soaw", soaw, entry, user=user, read_scope=None)
        assert payload["content"] == {
            "name": "P",
            "document_info": {},
            "version_history": [],
            "sections": {"1.1": {"content": "x"}},
        }
        assert (payload["entry"]["actor"], payload["entry"]["restored_from"]) == (None, None)

    async def test_people_payload_of_a_person_row(self, db):
        """A person keeps its stored name in a version even after a rename."""
        user = await create_user(db, display_name="Before")
        adr = await adr_service.create_decision(
            db, title="T", decision_makers=[{"user_id": str(user.id)}]
        )
        user.display_name = "After"
        await db.flush()
        (created,) = await _rows(db, adr.id)
        payload = await history.version_payload(db, "adr", adr, created, user=user, read_scope=None)
        assert payload["content"]["decision_makers"] == [
            {"user_id": str(user.id), "display_name": "Before"}
        ]
        stored = (await db.execute(select(ArchitectureDecisionPerson.name))).scalars().all()
        assert stored == ["Before"]
