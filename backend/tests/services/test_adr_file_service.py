"""Files on a decision: pointer rows over shared bytes, and their cleanup.

A revision copies pointer rows, never bytes; the bytes go only when the last
pointer does. Helpers flush and never commit.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import func, inspect, select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_file import (
    ArchitectureDecisionFile,
    ArchitectureDecisionFileContent,
)
from app.services import adr_file_service, adr_service
from app.services import decision_standing as ds
from tests.conftest import create_user

PDF = b"%PDF-1.7\nfile one\n"
PDF2 = b"%PDF-1.4\nfile two\n"


async def _decision(db, title="Decision", **extra) -> ArchitectureDecision:
    adr = ArchitectureDecision(
        reference_number=extra.pop("reference_number", f"ADR-{uuid.uuid4().hex[:6]}"),
        title=title,
        **extra,
    )
    db.add(adr)
    await db.flush()
    return adr


async def _count(db, model) -> int:
    return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _add(db, adr, name="a.pdf", data=PDF, created_by=None):
    return await adr_file_service.add_file(
        db, adr, name=name, mime_type="application/pdf", data=data, created_by=created_by
    )


class TestAddAndList:
    async def test_add_writes_one_content_and_one_file(self, db):
        adr = await _decision(db)
        f = await _add(db, adr, "plan.pdf")

        assert await _count(db, ArchitectureDecisionFileContent) == 1
        assert await _count(db, ArchitectureDecisionFile) == 1
        assert f.architecture_decision_id == adr.id
        assert f.name == "plan.pdf"
        assert f.mime_type == "application/pdf"
        assert f.size == len(PDF)
        content = await db.get(ArchitectureDecisionFileContent, f.content_id)
        assert content.size == len(PDF)

    async def test_list_rows_with_their_creator(self, db):
        user = await create_user(db, email="author@test.com", display_name="Ada Author")
        adr = await _decision(db)
        first = await _add(db, adr, "one.pdf", created_by=user.id)
        second = await _add(db, adr, "two.pdf", data=PDF2)

        # Oldest first; within one test transaction ``now()`` ties, so sort by name.
        rows = sorted(await adr_file_service.list_files(db, adr.id), key=lambda r: r["name"])

        assert rows == [
            {
                "id": str(first.id),
                "name": "one.pdf",
                "mime_type": "application/pdf",
                "size": len(PDF),
                "created_at": first.created_at.isoformat(),
                "created_by": {"user_id": str(user.id), "display_name": "Ada Author"},
            },
            {
                "id": str(second.id),
                "name": "two.pdf",
                "mime_type": "application/pdf",
                "size": len(PDF2),
                "created_at": second.created_at.isoformat(),
                "created_by": None,
            },
        ]

    async def test_files_payload_keys_every_decision(self, db):
        a = await _decision(db, "A")
        b = await _decision(db, "B")
        await _add(db, a, "a.pdf")

        out = await adr_file_service.files_payload(db, [a.id, b.id])

        assert set(out) == {a.id, b.id}
        assert [row["name"] for row in out[a.id]] == ["a.pdf"]
        assert out[b.id] == []
        assert await adr_file_service.files_payload(db, []) == {}

    async def test_listing_never_loads_the_bytes(self, db):
        adr = await _decision(db)
        f = await _add(db, adr)
        content_id = f.content_id
        db.expunge_all()

        await adr_file_service.list_files(db, adr.id)
        content = await db.get(ArchitectureDecisionFileContent, content_id)

        # ``data`` is deferred: neither the list nor a plain get loads it.
        assert "data" in inspect(content).unloaded


class TestDownload:
    async def test_loads_name_type_and_bytes(self, db):
        adr = await _decision(db)
        f = await _add(db, adr, "doc.pdf")
        db.expunge_all()

        found = await adr_file_service.load_for_download(db, adr.id, f.id)

        assert found == adr_file_service.Download(
            name="doc.pdf", mime_type="application/pdf", data=PDF
        )

    async def test_a_file_of_another_decision_is_not_found(self, db):
        a = await _decision(db, "A")
        b = await _decision(db, "B")
        f = await _add(db, a)

        assert await adr_file_service.load_for_download(db, b.id, f.id) is None
        assert await adr_file_service.load_for_download(db, a.id, uuid.uuid4()) is None


class TestRemove:
    async def test_removing_the_last_pointer_removes_the_bytes(self, db):
        adr = await _decision(db)
        f = await _add(db, adr)

        assert await adr_file_service.remove_file(db, adr.id, f.id) is True

        assert await _count(db, ArchitectureDecisionFile) == 0
        assert await _count(db, ArchitectureDecisionFileContent) == 0

    async def test_shared_bytes_stay_while_another_pointer_holds_them(self, db):
        signed = await _decision(db, "Signed", status="signed")
        f = await _add(db, signed)
        draft = await _decision(db, "Draft")
        assert await adr_service.copy_file_pointers(db, signed.id, draft.id) == 1
        copy = (
            await db.execute(
                select(ArchitectureDecisionFile).where(
                    ArchitectureDecisionFile.architecture_decision_id == draft.id
                )
            )
        ).scalar_one()
        assert copy.content_id == f.content_id

        assert await adr_file_service.remove_file(db, draft.id, copy.id) is True

        assert await _count(db, ArchitectureDecisionFile) == 1
        assert await _count(db, ArchitectureDecisionFileContent) == 1
        found = await adr_file_service.load_for_download(db, signed.id, f.id)
        assert found is not None and found.data == PDF

    async def test_a_file_of_another_decision_is_not_removed(self, db):
        a = await _decision(db, "A")
        b = await _decision(db, "B")
        f = await _add(db, a)

        assert await adr_file_service.remove_file(db, b.id, f.id) is False
        assert await _count(db, ArchitectureDecisionFile) == 1


class TestOrphans:
    async def test_sweeps_only_unreferenced_candidates(self, db):
        adr = await _decision(db)
        kept = await _add(db, adr)
        lone = ArchitectureDecisionFileContent(size=3, data=b"abc")
        other = ArchitectureDecisionFileContent(size=3, data=b"xyz")
        db.add_all([lone, other])
        await db.flush()

        assert await adr_file_service.delete_orphan_contents(db, [lone.id, kept.content_id]) == 1
        ids = set((await db.execute(select(ArchitectureDecisionFileContent.id))).scalars())
        assert ids == {kept.content_id, other.id}

        assert await adr_file_service.delete_orphan_contents(db, []) == 0
        assert await adr_file_service.delete_orphan_contents(db) == 1
        ids = set((await db.execute(select(ArchitectureDecisionFileContent.id))).scalars())
        assert ids == {kept.content_id}


class TestDeleteDraft:
    async def test_cleans_unshared_contents_and_keeps_shared_ones(self, db):
        signed = await _decision(db, "Signed", status="signed")
        shared = await _add(db, signed, "shared.pdf")
        draft = await _decision(db, "Draft", parent_id=signed.id, reference_number="ADR-900")
        await adr_service.copy_file_pointers(db, signed.id, draft.id)
        own = await _add(db, draft, "own.pdf", data=PDF2)

        await adr_service.delete_draft(db, draft)

        assert await db.get(ArchitectureDecision, draft.id) is None
        files = list((await db.execute(select(ArchitectureDecisionFile.id))).scalars())
        assert files == [shared.id]
        ids = set((await db.execute(select(ArchitectureDecisionFileContent.id))).scalars())
        assert ids == {shared.content_id}
        assert own.content_id not in ids

    async def test_leaves_an_orphan_it_never_held(self, db):
        stray = ArchitectureDecisionFileContent(size=3, data=b"abc")
        db.add(stray)
        draft = await _decision(db, "Draft")
        own = await _add(db, draft, "own.pdf")

        await adr_service.delete_draft(db, draft)

        ids = set((await db.execute(select(ArchitectureDecisionFileContent.id))).scalars())
        assert ids == {stray.id}
        assert own.content_id not in ids


class TestFileEdges:
    def test_an_unsaved_file_row_has_no_time_and_no_creator(self):
        f = ArchitectureDecisionFile(
            id=uuid.UUID(int=1), name="a.pdf", mime_type="application/pdf", size=3
        )
        assert adr_file_service.file_row(f, None) == {
            "id": str(uuid.UUID(int=1)),
            "name": "a.pdf",
            "mime_type": "application/pdf",
            "size": 3,
            "created_at": None,
            "created_by": None,
        }

    async def test_files_are_listed_oldest_first_then_by_id(self, db):
        from datetime import datetime, timezone

        adr = await _decision(db)
        content = ArchitectureDecisionFileContent(size=len(PDF), data=PDF)
        db.add(content)
        await db.flush()
        early = datetime(2026, 1, 1, tzinfo=timezone.utc)
        late = datetime(2026, 2, 1, tzinfo=timezone.utc)
        # Stored largest id first; the newest has the smallest id.
        for n, name, at in ((3, "tie-b.pdf", early), (2, "tie-a.pdf", early), (1, "new.pdf", late)):
            db.add(
                ArchitectureDecisionFile(
                    id=uuid.UUID(int=n),
                    architecture_decision_id=adr.id,
                    content_id=content.id,
                    name=name,
                    mime_type="application/pdf",
                    size=len(PDF),
                    created_at=at,
                )
            )
            await db.flush()

        files = await adr_file_service.list_files(db, adr.id)

        assert [f["name"] for f in files] == ["tie-a.pdf", "tie-b.pdf", "new.pdf"]

    async def test_files_carry_their_creators_name(self, db):
        alice = await create_user(db, email="file-alice@test.com", display_name="Alice")
        adr = await _decision(db)
        await _add(db, adr, "mine.pdf", created_by=alice.id)
        await _add(db, adr, "anon.pdf", data=PDF2)

        files = await adr_file_service.list_files(db, adr.id)

        assert sorted((f["name"], f["created_by"]) for f in files) == [
            ("anon.pdf", None),
            ("mine.pdf", {"user_id": str(alice.id), "display_name": "Alice"}),
        ]

    async def test_removing_a_file_leaves_an_orphan_it_never_held(self, db):
        stray = ArchitectureDecisionFileContent(size=3, data=b"abc")
        db.add(stray)
        adr = await _decision(db)
        f = await _add(db, adr)

        assert await adr_file_service.remove_file(db, adr.id, f.id) is True

        ids = set((await db.execute(select(ArchitectureDecisionFileContent.id))).scalars())
        assert ids == {stray.id}


class TestRecordHelpers:
    def test_no_problem(self):
        assert (
            adr_service.record_problems(
                decided_on=date(2026, 1, 10),
                today=date(2026, 1, 10),
                decision_maker_count=1,
                parent_decided=date(2026, 1, 10),
            )
            == []
        )

    def test_decided_on_allows_one_day_ahead_of_utc(self):
        def problems(decided_on):
            return adr_service.record_problems(
                decided_on=decided_on,
                today=date(2026, 1, 10),
                decision_maker_count=1,
                parent_decided=None,
            )

        assert problems(date(2026, 1, 11)) == []
        assert problems(date(2026, 1, 12)) == [ds.DECIDED_ON_FUTURE]

    def test_every_problem_in_order(self):
        assert adr_service.record_problems(
            decided_on=date(2026, 1, 12),
            today=date(2026, 1, 10),
            decision_maker_count=0,
            parent_decided=date(2026, 1, 13),
        ) == ["no_decision_maker", ds.DECIDED_ON_FUTURE, "decided_before_parent"]

    def test_no_parent_date_means_no_parent_rule(self):
        assert (
            adr_service.record_problems(
                decided_on=date(2020, 1, 1),
                today=date(2026, 1, 10),
                decision_maker_count=2,
                parent_decided=None,
            )
            == []
        )

    def test_record_decision_sets_the_recorded_stamp(self):
        from datetime import datetime, timezone

        adr = ArchitectureDecision(
            reference_number="ADR-001",
            title="T",
            status="draft",
            signatories=[{"user_id": "x"}],
        )
        now = datetime(2026, 1, 10, 9, 0, tzinfo=timezone.utc)
        uid = uuid.uuid4()
        adr_service.record_decision(
            adr, decided_on=date(2026, 1, 5), effective_from=None, recorded_by=uid, now=now
        )
        assert adr.status == "signed"
        assert adr.decided_on == date(2026, 1, 5)
        assert adr.effective_from == date(2026, 1, 5)
        assert adr.recorded_by == uid
        assert adr.recorded_at == now
        assert adr.signed_at is None
        assert adr.signatories == []

        adr_service.record_decision(
            adr,
            decided_on=date(2026, 1, 5),
            effective_from=date(2026, 2, 1),
            recorded_by=uid,
            now=now,
        )
        assert adr.effective_from == date(2026, 2, 1)


def _link(target, kind):
    return ds.LinkRow(source_id="src", target_id=target, kind=kind)


class TestStandingNotices:
    def test_one_notice_per_hard_kind_author(self):
        u1, u2 = uuid.uuid4(), uuid.uuid4()
        notices = adr_service.standing_notices(
            [_link("a", "replaces"), _link("b", "amends"), _link("c", "revokes")],
            {"a": u1, "b": u2, "c": u1},
            actor_id=None,
        )
        assert notices == [
            adr_service.StandingNotice(u1, "a", "replaces"),
            adr_service.StandingNotice(u2, "b", "amends"),
            adr_service.StandingNotice(u1, "c", "revokes"),
        ]

    def test_skips_soft_kinds_the_actor_and_missing_authors(self):
        actor, other = uuid.uuid4(), uuid.uuid4()
        notices = adr_service.standing_notices(
            [
                _link("a", "relates"),
                _link("b", "consolidates"),
                _link("c", "replaces"),
                _link("d", "replaces"),
                _link("e", "revokes"),
            ],
            {"a": other, "b": other, "c": actor, "d": None},
            actor_id=actor,
        )
        assert notices == []

    def test_dedupes_per_recipient_and_target(self):
        u = uuid.uuid4()
        notices = adr_service.standing_notices(
            [_link("a", "replaces"), _link("a", "amends")], {"a": u}, actor_id=None
        )
        assert notices == [adr_service.StandingNotice(u, "a", "replaces")]

    def test_a_skipped_link_does_not_stop_the_ones_after_it(self):
        u = uuid.uuid4()
        notices = adr_service.standing_notices(
            [
                _link("a", "relates"),
                _link("b", "replaces"),
                _link("b", "amends"),
                _link("c", "revokes"),
            ],
            {"a": u, "b": u, "c": u},
            actor_id=None,
        )
        assert notices == [
            adr_service.StandingNotice(u, "b", "replaces"),
            adr_service.StandingNotice(u, "c", "revokes"),
        ]

    def test_message_says_the_kind_in_words(self):
        assert (
            adr_service.standing_notice_message("ADR-051 — New", "replaces", "ADR-012 — Old")
            == '"ADR-051 — New" replaces "ADR-012 — Old"'
        )
        assert adr_service.standing_notice_message("A", "amends", "B") == '"A" amends "B"'
        assert adr_service.standing_notice_message("A", "revokes", "B") == '"A" revokes "B"'
