"""Typed links between decisions (``app/services/decision_link_service.py``).

DB-backed where a write is involved; the resolvers and the payload builder are
also exercised on registers built in memory, so every branch carries a value
assertion.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.services import decision_link_service as svc
from app.services import decision_standing as ds
from app.services.decision_link_service import WantedLink

TODAY = date(2026, 11, 10)
T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


def _row(n: int, ref: str, *, rev: int = 1, status: str = "signed", parent: int | None = None):
    return ds.DecisionRow(
        id=uuid.UUID(int=n),
        reference_number=ref,
        revision_number=rev,
        status=status,
        parent_id=uuid.UUID(int=parent) if parent else None,
        created_at=T0 + timedelta(minutes=n),
        title=f"Title {n}",
    )


async def _decision(
    db, ref: str, *, status: str = "signed", rev: int = 1, parent=None, title=None
) -> ArchitectureDecision:
    adr = ArchitectureDecision(
        reference_number=ref,
        title=title or f"Decision {ref}",
        status=status,
        revision_number=rev,
        parent_id=parent.id if parent is not None else None,
    )
    db.add(adr)
    await db.flush()
    return adr


async def _links(db, source_id) -> list[tuple]:
    rows = await db.execute(
        select(
            ArchitectureDecisionLink.id,
            ArchitectureDecisionLink.target_id,
            ArchitectureDecisionLink.kind,
            ArchitectureDecisionLink.note,
        )
        .where(ArchitectureDecisionLink.source_id == source_id)
        .order_by(ArchitectureDecisionLink.kind)
    )
    return [tuple(r) for r in rows.all()]


# ---------------------------------------------------------------------------
# load_register
# ---------------------------------------------------------------------------


class TestLoadRegister:
    async def test_loads_rows_links_and_the_recorded_flag(self, db):
        old = await _decision(db, "ADR-001")
        old.recorded_at = datetime(2026, 1, 2, tzinfo=timezone.utc)
        old.effective_from = date(2026, 1, 2)
        new = await _decision(db, "ADR-002")
        db.add(ArchitectureDecisionLink(source_id=new.id, target_id=old.id, kind="replaces"))
        await db.flush()

        register = await ds.load_register(db, today=TODAY)

        assert register.today == TODAY
        assert set(register.ids()) == {old.id, new.id}
        assert register.row(old.id).recorded is True
        assert register.row(new.id).recorded is False
        assert register.row(old.id).effective_from == date(2026, 1, 2)
        [link] = register.links
        assert (link.source_id, link.target_id, link.kind) == (new.id, old.id, "replaces")
        assert link.id is not None
        assert register[old.id].standing == ds.SUPERSEDED
        assert register[old.id].superseded_by.id == new.id

    async def test_rows_and_links_carry_their_stored_created_at(self, db):
        """The creation times reach the register: they order a forked chain
        and break a tie between two closing links."""
        made = datetime(2025, 6, 7, 8, 9, tzinfo=timezone.utc)
        linked = datetime(2025, 7, 8, 9, 10, tzinfo=timezone.utc)
        old = await _decision(db, "ADR-001")
        old.created_at = made
        new = await _decision(db, "ADR-002")
        db.add(
            ArchitectureDecisionLink(
                source_id=new.id, target_id=old.id, kind="relates", created_at=linked
            )
        )
        await db.flush()

        register = await ds.load_register(db, today=TODAY)

        assert register.row(old.id).created_at == made
        [link] = register.links
        assert link.created_at == linked


# ---------------------------------------------------------------------------
# replace_links
# ---------------------------------------------------------------------------


class TestReplaceLinks:
    async def test_inserts_updates_in_place_and_deletes_by_target(self, db):
        a = await _decision(db, "ADR-001")
        b = await _decision(db, "ADR-002")
        c = await _decision(db, "ADR-003")
        src = await _decision(db, "ADR-004", status="draft")
        register = await ds.load_register(db)
        await svc.replace_links(
            db,
            src,
            [WantedLink(a.id, "relates", " see §3 "), WantedLink(b.id, "relates")],
            register=register,
        )
        before = {target: link_id for link_id, target, _, _ in await _links(db, src.id)}

        await svc.replace_links(
            db,
            src,
            [WantedLink(a.id, "amends", "§3 only"), WantedLink(c.id, "revokes")],
            register=await ds.load_register(db),
        )

        after = await _links(db, src.id)
        assert [(t, k, n) for _, t, k, n in after] == [
            (a.id, "amends", "§3 only"),
            (c.id, "revokes", None),
        ]
        # The kept target kept its primary key; the removed one is gone.
        assert after[0][0] == before[a.id]
        assert b.id not in {t for _, t, _, _ in after}

    async def test_a_blank_note_is_stored_as_none(self, db):
        a = await _decision(db, "ADR-001")
        src = await _decision(db, "ADR-002", status="draft")
        await svc.replace_links(
            db, src, [WantedLink(a.id, "relates", "   ")], register=await ds.load_register(db)
        )
        assert [(t, k, n) for _, t, k, n in await _links(db, src.id)] == [(a.id, "relates", None)]

    async def test_an_empty_set_clears_every_link(self, db):
        a = await _decision(db, "ADR-001")
        src = await _decision(db, "ADR-002", status="draft")
        register = await ds.load_register(db)
        await svc.replace_links(db, src, [WantedLink(a.id, "relates")], register=register)
        await svc.replace_links(db, src, [], register=await ds.load_register(db))
        assert await _links(db, src.id) == []

    async def test_unknown_kind_is_a_400_naming_code_and_target(self, db):
        a = await _decision(db, "ADR-001")
        src = await _decision(db, "ADR-002", status="draft")
        with pytest.raises(HTTPException) as err:
            await svc.replace_links(
                db, src, [WantedLink(a.id, "cancels")], register=await ds.load_register(db)
            )
        assert err.value.status_code == 400
        assert err.value.detail == {
            "error": "unknown_kind",
            "problems": ["unknown_kind"],
            "target_id": str(a.id),
            "message": f"Unknown link kind ({a.id})",
        }
        assert await _links(db, src.id) == []

    async def test_a_link_into_its_own_chain_is_refused(self, db):
        root = await _decision(db, "ADR-001")
        rev = await _decision(db, "ADR-002", status="draft", rev=2, parent=root)
        with pytest.raises(HTTPException) as err:
            await svc.replace_links(
                db, rev, [WantedLink(root.id, "relates")], register=await ds.load_register(db)
            )
        assert err.value.detail["error"] == ds.SAME_CHAIN

    async def test_a_target_named_twice_is_a_400(self, db):
        a = await _decision(db, "ADR-001")
        src = await _decision(db, "ADR-002", status="draft")
        with pytest.raises(HTTPException) as err:
            await svc.replace_links(
                db,
                src,
                [WantedLink(a.id, "relates"), WantedLink(a.id, "amends")],
                register=await ds.load_register(db),
            )
        assert err.value.status_code == 400
        assert err.value.detail["error"] == "duplicate_target"
        assert err.value.detail["target_id"] == str(a.id)

    async def test_a_kept_link_is_not_revalidated_but_a_changed_kind_is(self, db):
        a = await _decision(db, "ADR-001")
        src = await _decision(db, "ADR-002", status="draft")
        # A link that would no longer pass validation (an unknown kind stored
        # by hand) survives a save that keeps it unchanged.
        db.add(ArchitectureDecisionLink(source_id=src.id, target_id=a.id, kind="legacy"))
        await db.flush()
        await svc.replace_links(
            db, src, [WantedLink(a.id, "legacy", "kept")], register=await ds.load_register(db)
        )
        assert [(k, n) for _, _, k, n in await _links(db, src.id)] == [("legacy", "kept")]
        with pytest.raises(HTTPException):
            await svc.replace_links(
                db, src, [WantedLink(a.id, "cancels")], register=await ds.load_register(db)
            )

    async def test_consolidates_on_a_revision_toward_its_amender(self, db):
        target_root = await _decision(db, "ADR-001")
        amender = await _decision(db, "ADR-002")
        db.add(
            ArchitectureDecisionLink(source_id=amender.id, target_id=target_root.id, kind="amends")
        )
        await db.flush()
        revision = await _decision(db, "ADR-003", status="draft", rev=2, parent=target_root)
        await svc.replace_links(
            db,
            revision,
            [WantedLink(amender.id, "consolidates")],
            register=await ds.load_register(db),
        )
        assert [(t, k) for _, t, k, _ in await _links(db, revision.id)] == [
            (amender.id, "consolidates")
        ]


# ---------------------------------------------------------------------------
# resolving references
# ---------------------------------------------------------------------------


class TestResolve:
    def _register(self):
        return ds.build_register(
            [
                _row(1, "ADR-001"),
                _row(2, "ADR-002", rev=2, parent=1),
                _row(3, "ADR-003", status="draft"),
                _row(4, "ADR-009"),
                _row(5, "adr-009"),
            ],
            [],
            today=TODAY,
        )

    def test_an_id_names_that_exact_revision(self):
        register = self._register()
        assert svc.resolve_in_register(register, str(uuid.UUID(int=1))) == uuid.UUID(int=1)
        assert svc.resolve_in_register(register, f"  {uuid.UUID(int=3)} ") == uuid.UUID(int=3)

    def test_a_reference_names_its_chain_current_revision(self):
        register = self._register()
        assert svc.resolve_in_register(register, "adr-001") == uuid.UUID(int=2)
        assert svc.resolve_in_register(register, " ADR-003 ") == uuid.UUID(int=3)

    def test_unknown_ambiguous_blank_and_non_strings_are_none(self):
        register = self._register()
        assert svc.resolve_in_register(register, str(uuid.UUID(int=99))) is None
        assert svc.resolve_in_register(register, "ADR-404") is None
        assert svc.resolve_in_register(register, "ADR-009") is None  # two chains share it
        assert svc.resolve_in_register(register, "  ") is None
        assert svc.resolve_in_register(register, {"type": "assessment"}) is None
        assert svc.resolve_in_register(register, None) is None

    async def test_resolve_decision_ref_loads_from_the_database(self, db):
        a = await _decision(db, "ADR-007")
        assert await svc.resolve_decision_ref(db, "ADR-007") == a.id
        register = await ds.load_register(db)
        assert await svc.resolve_decision_ref(register, str(a.id)) == a.id
        assert await svc.resolve_decision_ref(register, "ADR-008") is None


class TestWantedLinks:
    def _register(self):
        rows = [_row(1, "ADR-001"), _row(2, "ADR-002"), _row(3, "ADR-003", status="draft")]
        links = [
            ds.LinkRow(uuid.UUID(int=3), uuid.UUID(int=1), "amends", note="§1"),
            ds.LinkRow(uuid.UUID(int=3), uuid.UUID(int=2), "relates", note="background"),
        ]
        return ds.build_register(rows, links, today=TODAY)

    def test_links_replace_the_whole_set(self):
        register = self._register()
        wanted = svc.wanted_links(
            register,
            uuid.UUID(int=3),
            links=[{"decision_id": "ADR-002", "kind": "replaces", "note": "all of it"}],
        )
        assert wanted == [WantedLink(uuid.UUID(int=2), "replaces", "all of it")]

    def test_related_only_keeps_hard_links_and_relates_notes(self):
        register = self._register()
        wanted = svc.wanted_links(
            register, uuid.UUID(int=3), links=None, related=["ADR-002", "ADR-001"]
        )
        assert wanted == [
            WantedLink(uuid.UUID(int=1), "amends", "§1"),
            WantedLink(uuid.UUID(int=2), "relates", "background"),
        ]

    def test_related_merges_into_typed_links_once_per_target(self):
        register = self._register()
        wanted = svc.wanted_links(
            register,
            None,
            links=[{"decision_id": str(uuid.UUID(int=1)), "kind": "amends"}],
            related=["ADR-001", "ADR-002", str(uuid.UUID(int=2))],
        )
        assert wanted == [
            WantedLink(uuid.UUID(int=1), "amends", None),
            WantedLink(uuid.UUID(int=2), "relates", None),
        ]

    def test_an_unknown_entry_is_a_404_naming_it(self):
        register = self._register()
        with pytest.raises(HTTPException) as err:
            svc.wanted_links(register, None, links=[], related=["ADR-404"])
        assert err.value.status_code == 404
        assert err.value.detail == {
            "error": "decision_not_found",
            "value": "ADR-404",
            "message": "Decision not found: ADR-404",
        }
        with pytest.raises(HTTPException) as err:
            svc.wanted_links(register, None, links=[{"decision_id": "nope", "kind": "relates"}])
        assert err.value.detail["value"] == "nope"


# ---------------------------------------------------------------------------
# the payload
# ---------------------------------------------------------------------------


class TestLinksPayload:
    def test_both_sides_with_the_current_revision_when_another(self):
        rows = [
            _row(1, "ADR-001"),
            _row(2, "ADR-002", rev=2, parent=1),
            _row(3, "ADR-003"),
            _row(4, "ADR-004", status="draft"),
        ]
        link_a = uuid.UUID(int=101)
        link_b = uuid.UUID(int=102)
        links = [
            ds.LinkRow(uuid.UUID(int=3), uuid.UUID(int=1), "relates", note="old text", id=link_a),
            ds.LinkRow(uuid.UUID(int=4), uuid.UUID(int=3), "amends", id=link_b),
        ]
        register = ds.build_register(rows, links, today=TODAY)

        payload = svc.links_payload(register, uuid.UUID(int=3))

        assert payload == {
            "outgoing": [
                {
                    "id": str(link_a),
                    "kind": "relates",
                    "note": "old text",
                    "decision": {
                        "id": str(uuid.UUID(int=1)),
                        "reference_number": "ADR-001",
                        "revision_number": 1,
                        "title": "Title 1",
                        "status": "signed",
                        "standing": ds.SUPERSEDED,
                        "current": {
                            "id": str(uuid.UUID(int=2)),
                            "reference_number": "ADR-002",
                            "revision_number": 2,
                        },
                    },
                }
            ],
            "incoming": [
                {
                    "id": str(link_b),
                    "kind": "amends",
                    "note": None,
                    "decision": {
                        "id": str(uuid.UUID(int=4)),
                        "reference_number": "ADR-004",
                        "revision_number": 1,
                        "title": "Title 4",
                        "status": "draft",
                        "standing": None,
                    },
                }
            ],
        }

    def test_entries_are_ordered_by_the_other_decision(self):
        rows = [_row(1, "ADR-003"), _row(2, "ADR-001"), _row(3, "ADR-002"), _row(9, "ADR-009")]
        links = [ds.LinkRow(uuid.UUID(int=9), uuid.UUID(int=n), "relates") for n in (1, 2, 3)]
        register = ds.build_register(rows, links, today=TODAY)
        out = svc.links_payload(register, uuid.UUID(int=9))["outgoing"]
        assert [e["decision"]["reference_number"] for e in out] == [
            "ADR-001",
            "ADR-002",
            "ADR-003",
        ]
        assert [e["id"] for e in out] == [None, None, None]

    def test_a_link_to_a_decision_outside_the_register_is_left_out(self):
        rows = [_row(1, "ADR-001")]
        links = [ds.LinkRow(uuid.UUID(int=1), uuid.UUID(int=77), "relates")]
        register = ds.build_register(rows, links, today=TODAY)
        assert svc.links_payload(register, uuid.UUID(int=1)) == {"outgoing": [], "incoming": []}


# ---------------------------------------------------------------------------
# tolerant add and copy
# ---------------------------------------------------------------------------


class TestAddRelatesLinks:
    async def test_adds_resolvable_strings_once_and_drops_the_rest(self, db):
        a = await _decision(db, "ADR-001")
        b = await _decision(db, "ADR-002")
        src = await _decision(db, "ADR-003", status="draft")
        db.add(ArchitectureDecisionLink(source_id=src.id, target_id=b.id, kind="amends"))
        await db.flush()

        added = await svc.add_relates_links(
            db,
            src,
            ["adr-001", str(a.id), str(b.id), "ADR-003", {"id": "x"}, "ADR-404", 7],
            register=await ds.load_register(db),
        )

        assert added == [a.id]
        assert [(t, k) for _, t, k, _ in await _links(db, src.id)] == [
            (b.id, "amends"),
            (a.id, "relates"),
        ]

    async def test_a_target_that_fails_validation_is_dropped(self, db):
        root = await _decision(db, "ADR-001")
        rev = await _decision(db, "ADR-002", status="draft", rev=2, parent=root)
        added = await svc.add_relates_links(
            db, rev, [str(root.id)], register=await ds.load_register(db)
        )
        assert added == []
        assert await _links(db, rev.id) == []


class TestCopyRelatesLinks:
    async def test_copies_only_relates_with_their_notes(self, db):
        a = await _decision(db, "ADR-001")
        b = await _decision(db, "ADR-002")
        src = await _decision(db, "ADR-003")
        new = await _decision(db, "ADR-004", status="draft")
        db.add_all(
            [
                ArchitectureDecisionLink(
                    source_id=src.id, target_id=a.id, kind="relates", note="n"
                ),
                ArchitectureDecisionLink(source_id=src.id, target_id=b.id, kind="replaces"),
                ArchitectureDecisionLink(source_id=src.id, target_id=new.id, kind="relates"),
            ]
        )
        await db.flush()

        copied = await svc.copy_relates_links(db, src.id, new.id)

        assert copied == 1
        assert [(t, k, n) for _, t, k, n in await _links(db, new.id)] == [(a.id, "relates", "n")]
        # The source keeps its own links.
        assert len(await _links(db, src.id)) == 3


# ---------------------------------------------------------------------------
# edges the mutation gate found
# ---------------------------------------------------------------------------


class TestLinkErrorMessage:
    def test_an_unlisted_code_is_its_own_message(self):
        detail = svc.link_error(["odd_problem", "other"], "t-1").detail
        assert detail == {
            "error": "odd_problem",
            "problems": ["odd_problem", "other"],
            "target_id": "t-1",
            "message": "odd_problem (t-1)",
        }


class TestReferenceCaseFolding:
    def test_a_reference_matches_under_full_upper_case_folding(self):
        """``ß`` upper-cases to ``SS``: the reference is compared upper-cased."""
        register = ds.build_register([_row(1, "ADR-STRASSE")], [], today=TODAY)
        assert svc.resolve_in_register(register, "adr-straße") == uuid.UUID(int=1)


class TestWantedLinksFromObjects:
    def test_an_entry_object_without_a_note_attribute_has_no_note(self):
        from types import SimpleNamespace

        register = ds.build_register([_row(1, "ADR-001"), _row(2, "ADR-002")], [], today=TODAY)
        wanted = svc.wanted_links(
            register,
            uuid.UUID(int=2),
            links=[SimpleNamespace(decision_id="ADR-001", kind="relates")],
        )
        assert wanted == [WantedLink(uuid.UUID(int=1), "relates", None)]


class TestLinksPayloadEdges:
    def test_a_missing_decision_listed_first_does_not_hide_the_next(self):
        rows = [_row(5, "ADR-005"), _row(9, "ADR-009")]
        links = [
            ds.LinkRow(uuid.UUID(int=9), uuid.UUID(int=1), "relates"),
            ds.LinkRow(uuid.UUID(int=9), uuid.UUID(int=5), "relates"),
        ]
        register = ds.build_register(rows, links, today=TODAY)
        out = svc.links_payload(register, uuid.UUID(int=9))["outgoing"]
        assert [e["decision"]["id"] for e in out] == [str(uuid.UUID(int=5))]

    def test_two_links_to_one_decision_keep_their_order(self):
        """Only the other decision orders the entries: two links to the same
        decision stay in register order, their payloads never compared."""
        rows = [_row(1, "ADR-001"), _row(9, "ADR-009")]
        links = [
            ds.LinkRow(uuid.UUID(int=9), uuid.UUID(int=1), "relates"),
            ds.LinkRow(uuid.UUID(int=9), uuid.UUID(int=1), "amends"),
        ]
        register = ds.build_register(rows, links, today=TODAY)
        out = svc.links_payload(register, uuid.UUID(int=9))["outgoing"]
        assert [e["kind"] for e in out] == ["amends", "relates"]


class TestRevisionNotYetInTheRegister:
    """A revision created after the register was loaded is read as a revision
    of its parent: a link into the parent's chain is refused."""

    async def _setup(self, db):
        root = await _decision(db, "ADR-001")
        register = await ds.load_register(db)
        rev = await _decision(db, "ADR-001", status="draft", rev=2, parent=root)
        return root, rev, register

    async def test_replace_links_refuses_the_parent_chain(self, db):
        root, rev, register = await self._setup(db)
        with pytest.raises(HTTPException) as exc:
            await svc.replace_links(db, rev, [WantedLink(root.id, "relates")], register=register)
        assert exc.value.detail["error"] == ds.SAME_CHAIN
        assert await _links(db, rev.id) == []

    async def test_add_relates_links_drops_the_parent_chain(self, db):
        root, rev, register = await self._setup(db)
        assert await svc.add_relates_links(db, rev, [str(root.id)], register=register) == []
        assert await _links(db, rev.id) == []


class TestAddRelatesLinksOwnChain:
    async def test_a_later_revision_of_the_decision_itself_is_dropped_not_the_rest(self, db):
        root = await _decision(db, "ADR-001")
        rev = await _decision(db, "ADR-001", status="draft", rev=2, parent=root)
        other = await _decision(db, "ADR-002")

        added = await svc.add_relates_links(
            db, root, [str(rev.id), str(other.id)], register=await ds.load_register(db)
        )

        assert added == [other.id]
        assert [(t, k) for _, t, k, _ in await _links(db, root.id)] == [(other.id, "relates")]


class TestCopyRelatesLinksCount:
    async def test_counts_every_link_copied(self, db):
        a = await _decision(db, "ADR-001")
        b = await _decision(db, "ADR-002")
        src = await _decision(db, "ADR-003")
        new = await _decision(db, "ADR-004", status="draft")
        db.add_all(
            [
                ArchitectureDecisionLink(source_id=src.id, target_id=a.id, kind="relates"),
                ArchitectureDecisionLink(source_id=src.id, target_id=b.id, kind="relates"),
            ]
        )
        await db.flush()

        assert await svc.copy_relates_links(db, src.id, new.id) == 2
