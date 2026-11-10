"""Unit tests for decision standing (``app/services/decision_standing.py``).

Pure: no database. This file carries the mutation score for the decision
register's central rules, so every assertion names exact standings and refs,
and every comparison is tested on both sides.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.services.decision_standing import (
    AMENDED,
    AMENDS,
    CHAIN_CLOSED,
    CONSOLIDATES,
    CONSOLIDATES_NEEDS_REVISION,
    CONSOLIDATES_NOT_AMENDER,
    DECIDED_ON_FUTURE,
    EXPIRED,
    HARD_KINDS,
    IN_FORCE,
    LINK_KINDS,
    LINK_TARGET_NOT_LOCKED,
    LOCK_DATE_TOLERANCE,
    RELATES,
    REPLACES,
    REVOKED,
    REVOKES,
    SAME_CHAIN,
    SCHEDULED,
    STANDINGS,
    SUPERSEDED,
    TARGET_MISSING,
    UNKNOWN_KIND,
    VALID_UNTIL_BEFORE_EFFECTIVE,
    VALID_UNTIL_PAST,
    DecisionRef,
    DecisionRow,
    LinkRow,
    Register,
    Standing,
    UpcomingChange,
    amendment_open,
    build_register,
    chain_closed_by,
    decision_ref,
    validate_dates,
    validate_link_draft,
    validate_lock,
)

TODAY = date(2026, 11, 10)
YESTERDAY = TODAY - timedelta(days=1)
TOMORROW = TODAY + timedelta(days=1)
LAST_YEAR = date(2025, 1, 1)
T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# builders
# ---------------------------------------------------------------------------


def dec(
    did: str,
    rev: int = 1,
    status: str = "signed",
    parent: str | None = None,
    *,
    eff: date | None = None,
    until: date | None = None,
    minutes: int = 0,
) -> DecisionRow:
    """A decision row; the reference is ``ADR-`` + the id's first letter, so
    ``a1`` / ``a2`` share ``ADR-A``."""
    return DecisionRow(
        id=did,
        reference_number=f"ADR-{did[0].upper()}",
        revision_number=rev,
        status=status,
        parent_id=parent,
        created_at=T0 + timedelta(minutes=minutes),
        title=f"Title {did}",
        effective_from=eff,
        valid_until=until,
    )


def lk(src: str, tgt: str, kind: str, *, minutes: int | None = None) -> LinkRow:
    created = None if minutes is None else T0 + timedelta(minutes=minutes)
    return LinkRow(source_id=src, target_id=tgt, kind=kind, created_at=created)


def reg(rows: list[DecisionRow], links: list[LinkRow] | None = None) -> Register:
    return build_register(rows, links or [], today=TODAY)


def ref(row: DecisionRow) -> DecisionRef:
    return decision_ref(row)


def standing_of(register: Register, did: str) -> str | None:
    return register[did].standing


# ---------------------------------------------------------------------------
# constants and refs
# ---------------------------------------------------------------------------


def test_kind_and_standing_vocabularies():
    assert LINK_KINDS == ("replaces", "amends", "revokes", "relates", "consolidates")
    assert HARD_KINDS == ("replaces", "amends", "revokes", "consolidates")
    assert RELATES not in HARD_KINDS
    assert STANDINGS == ("scheduled", "in_force", "amended", "superseded", "revoked", "expired")


def test_decision_ref_copies_the_identifying_fields():
    row = dec("a1", 3)
    assert decision_ref(row) == DecisionRef(
        id="a1", reference_number="ADR-A", revision_number=3, title="Title a1"
    )


# ---------------------------------------------------------------------------
# rules 1-7, one each
# ---------------------------------------------------------------------------


def test_unlocked_rows_have_no_standing():
    r = reg([dec("a1", status="draft"), dec("b1", status="in_review")])
    assert r["a1"].standing is None
    assert r["b1"].standing is None
    assert r["a1"].is_current is True


def test_lone_signed_decision_is_in_force_with_nothing_else_set():
    a = dec("a1")
    assert reg([a])["a1"] == Standing(
        id="a1",
        standing=IN_FORCE,
        is_current=True,
        is_earlier_revision=False,
        superseded_by=None,
        revoked_by=None,
        amended_by=(),
        open_revision=None,
        upcoming=(),
        consolidated_into=None,
        chain=(ref(a),),
    )


def test_rule1_earlier_revision_is_superseded_by_the_current():
    a1, a2 = dec("a1", eff=LAST_YEAR), dec("a2", 2, parent="a1", minutes=1, eff=YESTERDAY)
    r = reg([a1, a2])
    assert r["a1"].standing == SUPERSEDED
    assert r["a1"].superseded_by == ref(a2)
    assert r["a1"].is_earlier_revision is True
    assert r["a1"].is_current is False
    assert r["a2"].standing == IN_FORCE
    assert r["a2"].superseded_by is None
    assert r["a2"].is_earlier_revision is False
    assert r["a2"].is_current is True
    assert r["a1"].chain == (ref(a1), ref(a2))
    assert r["a2"].chain == (ref(a1), ref(a2))


def test_rule2_revoked():
    a, b = dec("a1"), dec("b1")
    r = reg([a, b], [lk("b1", "a1", REVOKES)])
    assert r["a1"].standing == REVOKED
    assert r["a1"].revoked_by == ref(b)
    assert r["a1"].superseded_by is None
    assert r["b1"].standing == IN_FORCE
    assert r["b1"].revoked_by is None


def test_rule3_replaced_is_superseded_by_the_replacer():
    a, b = dec("a1"), dec("b1")
    r = reg([a, b], [lk("b1", "a1", REPLACES)])
    assert r["a1"].standing == SUPERSEDED
    assert r["a1"].superseded_by == ref(b)
    assert r["a1"].revoked_by is None
    assert r["a1"].is_current is True
    assert r["a1"].is_earlier_revision is False


def test_rule4_scheduled_boundary():
    r = reg([dec("a1", eff=TOMORROW), dec("b1", eff=TODAY), dec("c1", eff=None)])
    assert r["a1"].standing == SCHEDULED
    assert r["b1"].standing == IN_FORCE
    assert r["c1"].standing == IN_FORCE


def test_rule5_expired_boundary_in_force_through_the_day_itself():
    r = reg([dec("a1", until=YESTERDAY), dec("b1", until=TODAY), dec("c1", until=TOMORROW)])
    assert r["a1"].standing == EXPIRED
    assert r["b1"].standing == IN_FORCE
    assert r["c1"].standing == IN_FORCE


def test_rule6_amended_names_the_amender():
    a, b = dec("a1"), dec("b1")
    r = reg([a, b], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == AMENDED
    assert r["a1"].amended_by == (ref(b),)
    assert r["b1"].standing == IN_FORCE
    assert r["b1"].amended_by == ()


def test_relates_changes_nothing():
    r = reg([dec("a1"), dec("b1")], [lk("b1", "a1", RELATES)])
    assert r["a1"].standing == IN_FORCE
    assert r["b1"].standing == IN_FORCE


# ---------------------------------------------------------------------------
# precedence between rules
# ---------------------------------------------------------------------------


def test_earlier_revision_of_a_revoked_chain_stays_superseded_by_current():
    a1, a2, b = dec("a1"), dec("a2", 2, parent="a1", minutes=1), dec("b1")
    r = reg([a1, a2, b], [lk("b1", "a1", REVOKES)])
    assert r["a1"].standing == SUPERSEDED
    assert r["a1"].superseded_by == ref(a2)
    assert r["a1"].revoked_by is None
    assert r["a2"].standing == REVOKED
    assert r["a2"].revoked_by == ref(b)


def test_earlier_revision_of_a_replaced_chain_points_at_its_current():
    a1, a2, b = dec("a1"), dec("a2", 2, parent="a1", minutes=1), dec("b1")
    r = reg([a1, a2, b], [lk("b1", "a2", REPLACES)])
    assert r["a1"].superseded_by == ref(a2)
    assert r["a2"].standing == SUPERSEDED
    assert r["a2"].superseded_by == ref(b)


def test_revoked_beats_scheduled_and_expired():
    r = reg(
        [dec("a1", eff=TOMORROW), dec("c1", until=YESTERDAY), dec("b1")],
        [lk("b1", "a1", REVOKES), lk("b1", "c1", REVOKES)],
    )
    assert r["a1"].standing == REVOKED
    assert r["c1"].standing == REVOKED


def test_replaced_beats_scheduled_and_expired():
    b = dec("b1")
    r = reg(
        [dec("a1", eff=TOMORROW), dec("c1", until=YESTERDAY), b],
        [lk("b1", "a1", REPLACES), lk("b1", "c1", REPLACES)],
    )
    assert r["a1"].standing == SUPERSEDED
    assert r["a1"].superseded_by == ref(b)
    assert r["c1"].standing == SUPERSEDED


def test_scheduled_beats_expired():
    assert standing_of(reg([dec("a1", eff=TOMORROW, until=YESTERDAY)]), "a1") == SCHEDULED


def test_expired_beats_amended():
    r = reg([dec("a1", until=YESTERDAY), dec("b1")], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == EXPIRED
    assert r["a1"].amended_by == ()


def test_revoked_beats_amended():
    r = reg(
        [dec("a1"), dec("b1"), dec("c1")],
        [lk("b1", "a1", AMENDS), lk("c1", "a1", REVOKES)],
    )
    assert r["a1"].standing == REVOKED
    assert r["a1"].amended_by == ()


def test_scheduled_row_is_not_amended():
    r = reg([dec("a1", eff=TOMORROW), dec("b1")], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == SCHEDULED
    assert r["a1"].amended_by == ()


# ---------------------------------------------------------------------------
# link activity
# ---------------------------------------------------------------------------


def test_closing_link_from_an_unlocked_source_does_nothing():
    for status in ("draft", "in_review"):
        for kind in (REVOKES, REPLACES):
            r = reg([dec("a1"), dec("b1", status=status)], [lk("b1", "a1", kind)])
            assert r["a1"].standing == IN_FORCE
            assert r["a1"].upcoming == ()
            assert chain_closed_by(r, "a1") is None


def test_scheduled_revokes_does_nothing_yet_and_is_upcoming():
    b = dec("b1", eff=TOMORROW)
    r = reg([dec("a1"), b], [lk("b1", "a1", REVOKES)])
    assert r["a1"].standing == IN_FORCE
    assert r["a1"].revoked_by is None
    assert r["a1"].upcoming == (UpcomingChange("revokes", ref(b), TOMORROW),)
    assert r["b1"].standing == SCHEDULED
    assert chain_closed_by(r, "a1") is None


def test_scheduled_replaces_is_upcoming_with_its_kind():
    b = dec("b1", eff=TOMORROW)
    r = reg([dec("a1"), b], [lk("b1", "a1", REPLACES)])
    assert r["a1"].standing == IN_FORCE
    assert r["a1"].upcoming == (UpcomingChange("replaces", ref(b), TOMORROW),)


def test_closing_link_effective_today_applies():
    r = reg([dec("a1"), dec("b1", eff=TODAY)], [lk("b1", "a1", REVOKES)])
    assert r["a1"].standing == REVOKED
    assert r["a1"].upcoming == ()


def test_effect_persists_after_the_source_is_itself_revoked():
    b = dec("b1")
    r = reg([dec("a1"), b, dec("c1")], [lk("b1", "a1", REVOKES), lk("c1", "b1", REVOKES)])
    assert r["b1"].standing == REVOKED
    assert r["a1"].standing == REVOKED
    assert r["a1"].revoked_by == ref(b)


def test_effect_persists_after_the_source_is_superseded_by_its_revision():
    b1, b2 = dec("b1"), dec("b2", 2, parent="b1", minutes=1)
    r = reg([dec("a1"), b1, b2], [lk("b1", "a1", REPLACES)])
    assert r["b1"].standing == SUPERSEDED
    assert r["a1"].standing == SUPERSEDED
    assert r["a1"].superseded_by == ref(b1)


def test_link_to_an_earlier_revision_closes_the_whole_chain():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    a3 = dec("a3", 3, parent="a2", minutes=2, eff=TOMORROW)
    a4 = dec("a4", 4, parent="a3", minutes=3, status="draft")
    b = dec("b1")
    r = reg([a1, a2, a3, a4, b], [lk("b1", "a1", REVOKES)])
    assert r["a1"].standing == SUPERSEDED
    assert r["a2"].standing == REVOKED
    assert r["a3"].standing == REVOKED
    assert r["a3"].revoked_by == ref(b)
    assert r["a4"].standing is None
    assert r["a4"].revoked_by is None
    # The current row of a closed chain announces no upcoming changes.
    assert r["a2"].upcoming == ()
    assert r["a2"].open_revision == ref(a4)
    assert chain_closed_by(r, "a4") == ref(b)


def test_links_that_cannot_act_are_ignored_but_listed():
    links = [
        lk("b1", "a1", "obsoletes"),
        lk("b1", "zz", REVOKES),
        lk("zz", "a1", REVOKES),
        lk("a2", "a1", REVOKES),
    ]
    r = reg([dec("a1"), dec("a2", 2, parent="a1", minutes=1), dec("b1")], links)
    assert r["a1"].standing == SUPERSEDED
    assert r["a2"].standing == IN_FORCE
    assert len(r.links) == 4


# ---------------------------------------------------------------------------
# revokes vs replaces
# ---------------------------------------------------------------------------


def _closed(links: list[LinkRow], *rows: DecisionRow) -> Standing:
    return reg([dec("a1"), *rows], links)["a1"]


def test_earlier_effective_source_wins_revokes_first():
    rv, rp = dec("r1", eff=LAST_YEAR), dec("p1", eff=YESTERDAY)
    s = _closed([lk("r1", "a1", REVOKES), lk("p1", "a1", REPLACES)], rv, rp)
    assert s.standing == REVOKED
    assert s.revoked_by == ref(rv)
    assert s.superseded_by is None


def test_earlier_effective_source_wins_replaces_first():
    rv, rp = dec("r1", eff=YESTERDAY), dec("p1", eff=LAST_YEAR)
    s = _closed([lk("r1", "a1", REVOKES), lk("p1", "a1", REPLACES)], rv, rp)
    assert s.standing == SUPERSEDED
    assert s.superseded_by == ref(rp)
    assert s.revoked_by is None


def test_unset_effective_from_counts_as_earliest():
    rv, rp = dec("r1", eff=LAST_YEAR), dec("p1", eff=None)
    s = _closed([lk("r1", "a1", REVOKES), lk("p1", "a1", REPLACES)], rv, rp)
    assert s.standing == SUPERSEDED
    assert s.superseded_by == ref(rp)


def test_same_date_revokes_beats_replaces_even_when_created_later():
    rv, rp = dec("r1", eff=YESTERDAY), dec("p1", eff=YESTERDAY)
    s = _closed([lk("r1", "a1", REVOKES, minutes=9), lk("p1", "a1", REPLACES, minutes=1)], rv, rp)
    assert s.standing == REVOKED
    assert s.revoked_by == ref(rv)


def test_same_date_same_kind_earliest_link_created_at_wins():
    x, y = dec("x1", eff=YESTERDAY), dec("y1", eff=YESTERDAY)
    s = _closed([lk("x1", "a1", REVOKES, minutes=5), lk("y1", "a1", REVOKES, minutes=2)], x, y)
    assert s.revoked_by == ref(y)
    s = _closed([lk("x1", "a1", REVOKES, minutes=2), lk("y1", "a1", REVOKES, minutes=5)], x, y)
    assert s.revoked_by == ref(x)


def test_unset_link_created_at_counts_as_earliest():
    x, y = dec("x1"), dec("y1")
    s = _closed([lk("x1", "a1", REVOKES, minutes=1), lk("y1", "a1", REVOKES)], x, y)
    assert s.revoked_by == ref(y)
    s = _closed([lk("x1", "a1", REVOKES), lk("y1", "a1", REVOKES, minutes=1)], x, y)
    assert s.revoked_by == ref(x)


def test_full_tie_falls_back_to_source_id():
    x, y = dec("x1"), dec("y1")
    s = _closed([lk("y1", "a1", REPLACES, minutes=1), lk("x1", "a1", REPLACES, minutes=1)], x, y)
    assert s.superseded_by == ref(x)


def test_a_scheduled_closing_link_listed_first_does_not_stop_the_next_one():
    """A ``revokes`` whose source is not effective yet sorts before an
    effective one on another chain: it is skipped, and the next still acts."""
    rows = [dec("a1"), dec("b1", eff=TOMORROW), dec("c1"), dec("x1")]
    r = reg(rows, [lk("b1", "a1", REVOKES), lk("c1", "x1", REVOKES)])
    assert r["a1"].standing == IN_FORCE
    assert r["x1"].standing == REVOKED
    assert r["x1"].revoked_by == ref(rows[2])


def test_a_scheduled_amendment_listed_first_does_not_stop_the_next_one():
    rows = [dec("a1"), dec("b1", eff=TOMORROW), dec("c1"), dec("x1")]
    r = reg(rows, [lk("b1", "a1", AMENDS), lk("c1", "x1", AMENDS)])
    assert r["a1"].standing == IN_FORCE
    assert r["x1"].standing == AMENDED
    assert r["x1"].amended_by == (ref(rows[2]),)


def test_a_link_of_another_kind_listed_first_does_not_hide_an_upcoming_change():
    soon = dec("c1", eff=TOMORROW)
    rows = [dec("a1"), dec("b1"), soon, dec("x1")]
    r = reg(rows, [lk("b1", "x1", RELATES), lk("c1", "a1", REVOKES)])
    assert r["a1"].standing == IN_FORCE
    assert r["a1"].upcoming == (UpcomingChange(REVOKES, ref(soon), TOMORROW),)


def test_of_two_identical_closing_links_the_first_listed_is_kept():
    """A strict comparison: an exact tie keeps the link already held."""
    first = LinkRow(source_id="r1", target_id="a1", kind=REVOKES, created_at=T0, id="L1")
    second = LinkRow(source_id="r1", target_id="a1", kind=REVOKES, created_at=T0, id="L2")
    r = reg([dec("a1"), dec("r1")], [first, second])
    held, source = r.closing_link("a1")
    assert held.id == "L1"
    assert source.id == "r1"


def test_chain_closed_by_returns_the_winner():
    rv, rp = dec("r1", eff=YESTERDAY), dec("p1", eff=LAST_YEAR)
    r = reg([dec("a1"), rv, rp], [lk("r1", "a1", REVOKES), lk("p1", "a1", REPLACES)])
    assert chain_closed_by(r, "a1") == ref(rp)
    assert chain_closed_by(r, "r1") is None


# ---------------------------------------------------------------------------
# revisions and upcoming changes
# ---------------------------------------------------------------------------


def test_effective_revision_supersedes_its_predecessor():
    a1, a2 = dec("a1"), dec("a2", 2, parent="a1", minutes=1, eff=TODAY)
    r = reg([a1, a2])
    assert r["a1"].standing == SUPERSEDED
    assert r["a1"].superseded_by == ref(a2)
    assert r["a2"].standing == IN_FORCE
    assert r["a2"].upcoming == ()


def test_scheduled_revision_leaves_predecessor_current_and_is_upcoming():
    a1, a2 = dec("a1"), dec("a2", 2, parent="a1", minutes=1, eff=TOMORROW)
    r = reg([a1, a2])
    assert r["a1"].standing == IN_FORCE
    assert r["a1"].is_current is True
    assert r["a1"].upcoming == (UpcomingChange("revision", ref(a2), TOMORROW),)
    assert r["a1"].open_revision is None
    assert r["a2"].standing == SCHEDULED
    assert r["a2"].is_current is False
    assert r["a2"].is_earlier_revision is False
    assert r["a2"].upcoming == ()


def test_draft_revision_is_the_open_revision_of_the_current_row():
    a1, a2 = dec("a1"), dec("a2", 2, parent="a1", minutes=1, status="draft")
    r = reg([a1, a2])
    assert r["a1"].standing == IN_FORCE
    assert r["a1"].open_revision == ref(a2)
    assert r["a1"].upcoming == ()
    assert r["a2"].standing is None
    assert r["a2"].open_revision is None
    assert r["a2"].is_current is False


def test_upcoming_is_sorted_soonest_first():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1, eff=TODAY + timedelta(days=5))
    b = dec("b1", eff=TODAY + timedelta(days=2))
    c = dec("c1", eff=TODAY + timedelta(days=9))
    r = reg([a1, a2, b, c], [lk("c1", "a1", REPLACES), lk("b1", "a1", REVOKES)])
    assert r["a1"].upcoming == (
        UpcomingChange("revokes", ref(b), TODAY + timedelta(days=2)),
        UpcomingChange("revision", ref(a2), TODAY + timedelta(days=5)),
        UpcomingChange("replaces", ref(c), TODAY + timedelta(days=9)),
    )


def test_upcoming_same_date_sorted_by_reference():
    a1 = dec("a1")
    c, b = dec("c1", eff=TOMORROW), dec("b1", eff=TOMORROW)
    r = reg([a1, c, b], [lk("c1", "a1", REVOKES), lk("b1", "a1", REPLACES)])
    assert [u.by.id for u in r["a1"].upcoming] == ["b1", "c1"]


def test_chain_with_only_scheduled_rows_has_the_first_as_current():
    a1 = dec("a1", eff=TOMORROW)
    a2 = dec("a2", 2, parent="a1", minutes=1, eff=TODAY + timedelta(days=3))
    r = reg([a1, a2])
    assert r["a1"].is_current is True
    assert r["a1"].standing == SCHEDULED
    assert r["a1"].upcoming == (UpcomingChange("revision", ref(a2), TODAY + timedelta(days=3)),)
    assert r["a2"].standing == SCHEDULED


def test_exactly_one_current_per_chain_and_chain_order():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    a3 = dec("a3", 3, parent="a2", minutes=2, eff=TOMORROW)
    a4 = dec("a4", 4, parent="a3", minutes=3, status="draft")
    b1 = dec("b1")
    r = reg([a4, a2, b1, a3, a1])
    assert [x for x in ("a1", "a2", "a3", "a4") if r[x].is_current] == ["a2"]
    assert [x for x in ("a1", "a2", "a3", "a4") if r[x].is_earlier_revision] == ["a1"]
    assert r["a3"].chain == (ref(a1), ref(a2), ref(a3), ref(a4))
    assert r["a2"].open_revision == ref(a4)
    assert r["a1"].open_revision is None
    assert r["b1"].is_current is True
    assert r["b1"].chain == (ref(b1),)


def test_legacy_fork_does_not_crash():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    a2b = dec("a3", 2, parent="a1", minutes=2)
    r = reg([a1, a2, a2b])
    assert [x for x in ("a1", "a2", "a3") if r[x].is_current] == ["a3"]
    assert r["a1"].standing == SUPERSEDED
    assert r["a2"].standing == SUPERSEDED
    assert r["a3"].standing == IN_FORCE


def test_a_fork_orders_same_numbered_revisions_by_creation_before_id():
    """Two revisions 2 of one parent: the one created first comes first, even
    when its id sorts after the other's."""
    a1 = dec("a1")
    late = dec("a2", 2, parent="a1", minutes=9)
    early = dec("a3", 2, parent="a1", minutes=1)
    r = reg([a1, late, early])
    assert r["a1"].chain == (ref(a1), ref(early), ref(late))
    assert r["a2"].is_current is True
    assert r["a3"].standing == SUPERSEDED
    assert r["a3"].superseded_by == ref(late)


def test_chains_ignore_shared_references_without_a_parent_link():
    # Two unrelated decisions may share a reference after an import (R10).
    a, b = dec("a1"), dec("a2", 2, minutes=1)
    r = reg([a, b])
    assert r["a1"].is_current is True
    assert r["a2"].is_current is True
    assert r["a1"].standing == IN_FORCE
    assert r["a1"].chain == (ref(a),)


# ---------------------------------------------------------------------------
# amendments
# ---------------------------------------------------------------------------


def test_amender_not_effective_does_not_amend():
    for b in (dec("b1", status="draft"), dec("b1", status="in_review"), dec("b1", eff=TOMORROW)):
        r = reg([dec("a1"), b], [lk("b1", "a1", AMENDS)])
        assert r["a1"].standing == IN_FORCE
        assert r["a1"].amended_by == ()


def test_amender_effective_today_amends():
    r = reg([dec("a1"), dec("b1", eff=TODAY)], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == AMENDED


def test_amender_no_longer_in_force_does_not_amend():
    # revoked
    r = reg(
        [dec("a1"), dec("b1"), dec("c1")],
        [lk("b1", "a1", AMENDS), lk("c1", "b1", REVOKES)],
    )
    assert r["b1"].standing == REVOKED
    assert r["a1"].standing == IN_FORCE
    # replaced
    r = reg(
        [dec("a1"), dec("b1"), dec("c1")],
        [lk("b1", "a1", AMENDS), lk("c1", "b1", REPLACES)],
    )
    assert r["a1"].standing == IN_FORCE
    # expired
    r = reg([dec("a1"), dec("b1", until=YESTERDAY)], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == IN_FORCE
    # expiring today still amends
    r = reg([dec("a1"), dec("b1", until=TODAY)], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == AMENDED


def test_amendment_open_reads_the_amender_chains_current_base_standing():
    assert amendment_open(IN_FORCE) is True
    for closed in (SUPERSEDED, REVOKED, EXPIRED, SCHEDULED, AMENDED, None):
        assert amendment_open(closed) is False


def test_revising_the_amender_keeps_its_amendment():
    # The original failure: B Rev 1 amends A; B Rev 2 is signed and effective
    # with no amends link of its own. A stays amended, named by B Rev 2.
    a1, b1 = dec("a1"), dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1, eff=TODAY)
    r = reg([a1, b1, b2], [lk("b1", "a1", AMENDS)])
    assert r["b1"].standing == SUPERSEDED
    assert r["b2"].standing == IN_FORCE
    assert r["a1"].standing == AMENDED
    assert r["a1"].amended_by == (ref(b2),)
    assert r["b1"].consolidated_into is None


def test_an_amender_revision_not_yet_effective_names_the_in_force_one():
    # B Rev 2 is scheduled, so B Rev 1 is still the chain's current revision.
    a1, b1 = dec("a1"), dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1, eff=TOMORROW)
    r = reg([a1, b1, b2], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == AMENDED
    assert r["a1"].amended_by == (ref(b1),)


def test_a_revised_amender_chain_closed_or_expired_no_longer_amends():
    a1, b1 = dec("a1"), dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1)
    for closer in (REVOKES, REPLACES):
        r = reg([a1, b1, b2, dec("c1")], [lk("b1", "a1", AMENDS), lk("c1", "b2", closer)])
        assert r["b2"].standing in (REVOKED, SUPERSEDED)
        assert (r["a1"].standing, r["a1"].amended_by) == (IN_FORCE, ())
    expired = dec("b2", 2, parent="b1", minutes=1, until=YESTERDAY)
    r = reg([a1, b1, expired], [lk("b1", "a1", AMENDS)])
    assert r["b2"].standing == EXPIRED
    assert (r["a1"].standing, r["a1"].amended_by) == (IN_FORCE, ())
    last_day = dec("b2", 2, parent="b1", minutes=1, until=TODAY)
    r = reg([a1, b1, last_day], [lk("b1", "a1", AMENDS)])
    assert (r["a1"].standing, r["a1"].amended_by) == (AMENDED, (ref(last_day),))


def test_an_amender_chain_is_named_once():
    a1, b1 = dec("a1"), dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1)
    r = reg([a1, b1, b2], [lk("b1", "a1", AMENDS), lk("b2", "a1", AMENDS)])
    assert r["a1"].amended_by == (ref(b2),)


def test_two_amender_chains_and_one_consolidated():
    a1 = dec("a1")
    b1 = dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1)
    c1 = dec("c1")
    links = [lk("b1", "a1", AMENDS), lk("c1", "a1", AMENDS)]
    r = reg([a1, b1, b2, c1], links)
    assert r["a1"].amended_by == (ref(b2), ref(c1))

    a2 = dec("a2", 2, parent="a1", minutes=1)
    r = reg([a1, a2, b1, b2, c1], [*links, lk("a2", "c1", CONSOLIDATES)])
    assert (r["a2"].standing, r["a2"].amended_by) == (AMENDED, (ref(b2),))
    assert r["c1"].consolidated_into == ref(a2)


def test_consolidating_a_revised_amender_closes_its_earlier_link():
    # The "Create consolidated revision" button names the amender's current
    # revision (B Rev 2), which closes B Rev 1's link (R7); naming B Rev 1
    # closes it too.
    a1, a2 = dec("a1"), dec("a2", 2, parent="a1", minutes=1)
    b1, b2 = dec("b1"), dec("b2", 2, parent="b1", minutes=1)
    for target in ("b2", "b1"):
        r = reg([a1, a2, b1, b2], [lk("b1", "a1", AMENDS), lk("a2", target, CONSOLIDATES)])
        assert (r["a2"].standing, r["a2"].amended_by) == (IN_FORCE, ())
        assert r["b1"].consolidated_into == ref(a2)


def test_amended_amender_still_amends():
    # The amender's own amendment does not stop it amending (base pass only).
    b, c = dec("b1"), dec("c1")
    r = reg([dec("a1"), b, c], [lk("b1", "a1", AMENDS), lk("c1", "b1", AMENDS)])
    assert r["b1"].standing == AMENDED
    assert r["b1"].amended_by == (ref(c),)
    assert r["a1"].amended_by == (ref(b),)


def test_amendment_to_an_earlier_revision_amends_the_current():
    a1, a2, b = dec("a1"), dec("a2", 2, parent="a1", minutes=1), dec("b1")
    r = reg([a1, a2, b], [lk("b1", "a1", AMENDS)])
    assert r["a1"].standing == SUPERSEDED
    assert r["a1"].amended_by == ()
    assert r["a2"].standing == AMENDED
    assert r["a2"].amended_by == (ref(b),)


def test_consolidated_by_an_effective_revision_closes_the_amendment():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1, eff=TODAY)
    b = dec("b1")
    r = reg([a1, a2, b], [lk("b1", "a1", AMENDS), lk("a2", "b1", CONSOLIDATES)])
    assert r["a2"].standing == IN_FORCE
    assert r["a2"].amended_by == ()
    assert r["b1"].standing == IN_FORCE
    assert r["b1"].consolidated_into == ref(a2)
    assert r["a2"].consolidated_into is None


def test_consolidation_not_yet_effective_leaves_the_amendment_open():
    a1, b = dec("a1"), dec("b1")
    for a2 in (
        dec("a2", 2, parent="a1", minutes=1, status="draft"),
        dec("a2", 2, parent="a1", minutes=1, status="in_review"),
        dec("a2", 2, parent="a1", minutes=1, eff=TOMORROW),
    ):
        r = reg([a1, a2, b], [lk("b1", "a1", AMENDS), lk("a2", "b1", CONSOLIDATES)])
        assert r["a1"].standing == AMENDED
        assert r["a1"].amended_by == (ref(b),)
        assert r["b1"].consolidated_into is None


def test_consolidation_from_another_chain_does_not_close():
    a1, b, c = dec("a1"), dec("b1"), dec("c2", 2, parent="c0", minutes=1)
    r = reg([a1, b, c], [lk("b1", "a1", AMENDS), lk("c2", "b1", CONSOLIDATES)])
    assert r["a1"].standing == AMENDED
    assert r["b1"].consolidated_into is None


def test_consolidating_another_amender_does_not_close():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    b, c = dec("b1"), dec("c1")
    r = reg(
        [a1, a2, b, c],
        [lk("b1", "a1", AMENDS), lk("c1", "a1", AMENDS), lk("a2", "c1", CONSOLIDATES)],
    )
    assert r["a2"].standing == AMENDED
    assert r["a2"].amended_by == (ref(b),)
    assert r["c1"].consolidated_into == ref(a2)
    assert r["b1"].consolidated_into is None


def test_two_amenders_sorted_by_reference():
    b, c = dec("b1"), dec("c1")
    r = reg([dec("a1"), c, b], [lk("c1", "a1", AMENDS), lk("b1", "a1", AMENDS)])
    assert r["a1"].amended_by == (ref(b), ref(c))


def test_r7_new_amends_from_a_later_amender_revision_reopens():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    b1 = dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1)
    links = [
        lk("b1", "a1", AMENDS),
        lk("a2", "b1", CONSOLIDATES),
        lk("b2", "a2", AMENDS),
    ]
    r = reg([a1, a2, b1, b2], links)
    assert r["a2"].standing == AMENDED
    assert r["a2"].amended_by == (ref(b2),)
    assert r["b1"].consolidated_into == ref(a2)
    assert r["b2"].consolidated_into is None


def test_r7_consolidating_a_later_amender_revision_closes_earlier_ones():
    # b1 is still the current, in-force amender; a2 consolidates the scheduled b2,
    # which closes b1's amendment as well.
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    b1 = dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1, eff=TOMORROW)
    r = reg([a1, a2, b1, b2], [lk("b1", "a1", AMENDS), lk("a2", "b2", CONSOLIDATES)])
    assert r["b1"].standing == IN_FORCE
    assert r["a2"].standing == IN_FORCE
    assert r["b1"].consolidated_into == ref(a2)


def test_r7_consolidating_an_earlier_amender_revision_leaves_later_open():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    b1 = dec("b1")
    b2 = dec("b2", 2, parent="b1", minutes=1)
    r = reg([a1, a2, b1, b2], [lk("b2", "a1", AMENDS), lk("a2", "b1", CONSOLIDATES)])
    assert r["a2"].standing == AMENDED
    assert r["a2"].amended_by == (ref(b2),)
    assert r["b2"].consolidated_into is None


def test_consolidated_into_names_the_first_consolidating_revision():
    a1 = dec("a1")
    a2 = dec("a2", 2, parent="a1", minutes=1)
    a3 = dec("a3", 3, parent="a2", minutes=2)
    b = dec("b1")
    links = [lk("b1", "a1", AMENDS), lk("a3", "b1", CONSOLIDATES), lk("a2", "b1", CONSOLIDATES)]
    r = reg([a1, a2, a3, b], links)
    assert r["b1"].consolidated_into == ref(a2)
    assert r["a3"].standing == IN_FORCE


# ---------------------------------------------------------------------------
# the register object
# ---------------------------------------------------------------------------


def test_register_accessors():
    a, b = dec("a1"), dec("b1")
    links = [lk("b1", "a1", RELATES), lk("a1", "b1", AMENDS)]
    r = reg([a, b], links)
    assert r.today == TODAY
    assert "a1" in r
    assert "zz" not in r
    assert r.get("zz") is None
    assert r.get("a1") == r["a1"]
    assert r.row("b1") is b
    assert [n.id for n in r.chain("a1").nodes] == ["a1"]
    assert r.links == (links[1], links[0])
    assert r.outgoing("a1") == (links[1],)
    assert r.incoming("a1") == (links[0],)
    assert r.closing_link("a1") is None


def test_today_defaults_to_the_utc_date():
    r = build_register([dec("a1", eff=datetime.now(timezone.utc).date())], [])
    assert r.today == datetime.now(timezone.utc).date()
    assert r["a1"].standing == IN_FORCE


def test_today_is_the_utc_date_whatever_the_server_zone():
    """At any instant UTC+14 or UTC-12 is on another calendar day than UTC,
    so reading the local date in either zone would show."""
    import os
    import time

    from app.services.decision_standing import _today_utc

    saved = os.environ.get("TZ")
    try:
        for zone in ("Pacific/Kiritimati", "Etc/GMT+12"):
            os.environ["TZ"] = zone
            time.tzset()
            assert _today_utc() == datetime.now(timezone.utc).date()
    finally:
        if saved is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = saved
        time.tzset()


def test_today_is_injectable():
    r = build_register([dec("a1", eff=TOMORROW)], [], today=TOMORROW)
    assert r["a1"].standing == IN_FORCE


# ---------------------------------------------------------------------------
# validate_link_draft
# ---------------------------------------------------------------------------


def _vreg() -> Register:
    return reg(
        [
            dec("a1"),
            dec("a2", 2, parent="a1", minutes=1, status="draft"),
            dec("b1"),
            dec("c1"),
        ],
        [lk("b1", "a1", AMENDS)],
    )


def test_link_draft_fine():
    r = _vreg()
    for kind in (REPLACES, AMENDS, REVOKES, RELATES):
        assert validate_link_draft(r, "c1", "a1", kind) == []
    assert validate_link_draft(r, "a2", "b1", CONSOLIDATES) == []


def test_link_draft_unknown_kind():
    assert validate_link_draft(_vreg(), "c1", "a1", "obsoletes") == [UNKNOWN_KIND]


def test_link_draft_target_missing_stops_early():
    assert validate_link_draft(_vreg(), "c1", "zz", "obsoletes") == [UNKNOWN_KIND, TARGET_MISSING]
    assert validate_link_draft(_vreg(), "c1", "zz", CONSOLIDATES) == [TARGET_MISSING]


def test_link_draft_same_chain():
    assert validate_link_draft(_vreg(), "a2", "a1", REVOKES) == [SAME_CHAIN]
    assert validate_link_draft(_vreg(), "a1", "a1", RELATES) == [SAME_CHAIN]


def test_consolidates_needs_a_revision():
    # c1 has no parent; b1 does not amend c1's chain either.
    assert validate_link_draft(_vreg(), "c1", "b1", CONSOLIDATES) == [
        CONSOLIDATES_NEEDS_REVISION,
        CONSOLIDATES_NOT_AMENDER,
    ]


def test_consolidates_needs_an_amender_of_this_chain():
    r = _vreg()
    assert validate_link_draft(r, "a2", "c1", CONSOLIDATES) == [CONSOLIDATES_NOT_AMENDER]
    # An amends link pointing the other way does not count.
    r2 = reg(
        [dec("a1"), dec("a2", 2, parent="a1", minutes=1, status="draft"), dec("b1")],
        [lk("a1", "b1", AMENDS)],
    )
    assert validate_link_draft(r2, "a2", "b1", CONSOLIDATES) == [CONSOLIDATES_NOT_AMENDER]
    # A relates link does not count.
    r3 = reg(
        [dec("a1"), dec("a2", 2, parent="a1", minutes=1, status="draft"), dec("b1")],
        [lk("b1", "a1", RELATES)],
    )
    assert validate_link_draft(r3, "a2", "b1", CONSOLIDATES) == [CONSOLIDATES_NOT_AMENDER]


def test_consolidates_toward_a_later_amender_revision_is_fine():
    # The amends link is held by b1; the consolidation targets the chain's b2.
    r = reg(
        [
            dec("a1"),
            dec("a2", 2, parent="a1", minutes=1, status="draft"),
            dec("b1"),
            dec("b2", 2, parent="b1", minutes=1),
        ],
        [lk("b1", "a1", AMENDS)],
    )
    assert validate_link_draft(r, "a2", "b2", CONSOLIDATES) == []


def test_link_draft_source_not_yet_in_the_register():
    r = _vreg()
    # A revision of a1 about to be created.
    assert validate_link_draft(r, "new", "b1", CONSOLIDATES, source_parent_id="a1") == []
    assert validate_link_draft(r, "new", "a1", REVOKES, source_parent_id="a1") == [SAME_CHAIN]
    # A brand-new decision.
    assert validate_link_draft(r, "new", "a1", REVOKES) == []
    assert validate_link_draft(r, "new", "b1", CONSOLIDATES) == [
        CONSOLIDATES_NEEDS_REVISION,
        CONSOLIDATES_NOT_AMENDER,
    ]
    # A parent that is not in the register: a revision, but of no known chain.
    assert validate_link_draft(r, "new", "b1", CONSOLIDATES, source_parent_id="gone") == [
        CONSOLIDATES_NOT_AMENDER
    ]


# ---------------------------------------------------------------------------
# validate_dates
# ---------------------------------------------------------------------------


def test_dates_all_unset_are_fine():
    assert validate_dates(None, None, None, today=TODAY, at_lock=True) == []


def test_valid_until_before_effective_from():
    assert validate_dates(None, TODAY, YESTERDAY, today=TODAY, at_lock=False) == [
        VALID_UNTIL_BEFORE_EFFECTIVE
    ]
    assert validate_dates(None, TODAY, TODAY, today=TODAY, at_lock=False) == []
    assert validate_dates(None, None, YESTERDAY, today=TODAY, at_lock=False) == []
    assert validate_dates(None, TODAY, None, today=TODAY, at_lock=False) == []


IN_TWO_DAYS = TODAY + timedelta(days=2)
TWO_DAYS_AGO = TODAY - timedelta(days=2)


def test_lock_checks_only_at_lock():
    assert validate_dates(IN_TWO_DAYS, None, TWO_DAYS_AGO, today=TODAY, at_lock=False) == []
    assert validate_dates(IN_TWO_DAYS, None, TWO_DAYS_AGO, today=TODAY, at_lock=True) == [
        VALID_UNTIL_PAST,
        DECIDED_ON_FUTURE,
    ]


def test_lock_date_tolerance_is_one_day():
    assert LOCK_DATE_TOLERANCE == timedelta(days=1)


def test_lock_date_boundaries_allow_one_day_of_timezone_spread():
    assert validate_dates(TODAY, None, TODAY, today=TODAY, at_lock=True) == []
    assert validate_dates(YESTERDAY, None, TOMORROW, today=TODAY, at_lock=True) == []
    # decided_on: today + 1 passes (an author ahead of UTC), today + 2 does not.
    assert validate_dates(TOMORROW, None, None, today=TODAY, at_lock=True) == []
    assert validate_dates(IN_TWO_DAYS, None, None, today=TODAY, at_lock=True) == [DECIDED_ON_FUTURE]
    # valid_until: today - 1 passes (an author behind UTC), today - 2 does not.
    assert validate_dates(None, None, YESTERDAY, today=TODAY, at_lock=True) == []
    assert validate_dates(None, None, TWO_DAYS_AGO, today=TODAY, at_lock=True) == [VALID_UNTIL_PAST]


def test_standing_keeps_the_utc_day():
    # The tolerance is for the lock checks only: a decision effective tomorrow
    # is still scheduled today, and one valid until yesterday has expired.
    r = reg([dec("a1", eff=TOMORROW), dec("b1", eff=LAST_YEAR, until=YESTERDAY)])
    assert r.get("a1").standing == SCHEDULED
    assert r.get("b1").standing == EXPIRED


def test_all_three_date_problems_together():
    assert validate_dates(IN_TWO_DAYS, TODAY, TWO_DAYS_AGO, today=TODAY, at_lock=True) == [
        VALID_UNTIL_BEFORE_EFFECTIVE,
        VALID_UNTIL_PAST,
        DECIDED_ON_FUTURE,
    ]


# ---------------------------------------------------------------------------
# validate_lock
# ---------------------------------------------------------------------------


def test_lock_fine_when_every_target_is_signed():
    r = reg(
        [dec("d1", status="draft"), dec("a1"), dec("b1")],
        [lk("d1", "a1", REVOKES), lk("d1", "b1", RELATES)],
    )
    assert validate_lock(r, "d1") == []


def test_lock_refused_for_any_unlocked_target_relates_included():
    for status in ("draft", "in_review"):
        for kind in (RELATES, REPLACES, AMENDS):
            r = reg(
                [dec("d1", status="draft"), dec("a1"), dec("b1", status=status)],
                [lk("d1", "a1", REVOKES), lk("d1", "b1", kind)],
            )
            assert validate_lock(r, "d1") == [LINK_TARGET_NOT_LOCKED]


def test_lock_refused_for_a_missing_target():
    r = reg([dec("d1", status="draft")], [lk("d1", "zz", RELATES)])
    assert validate_lock(r, "d1") == [LINK_TARGET_NOT_LOCKED]


def test_incoming_links_from_drafts_do_not_block_a_lock():
    r = reg([dec("d1", status="draft"), dec("e1", status="draft")], [lk("e1", "d1", RELATES)])
    assert validate_lock(r, "d1") == []


def test_lock_refused_when_the_chain_is_closed():
    for kind in (REVOKES, REPLACES):
        r = reg(
            [dec("a1"), dec("a2", 2, parent="a1", minutes=1, status="draft"), dec("b1")],
            [lk("b1", "a1", kind)],
        )
        assert validate_lock(r, "a2") == [CHAIN_CLOSED]
        assert chain_closed_by(r, "a2") == ref(r.row("b1"))


def test_lock_not_refused_by_a_scheduled_closure_or_an_amendment():
    r = reg(
        [dec("a1"), dec("a2", 2, parent="a1", minutes=1, status="draft"), dec("b1", eff=TOMORROW)],
        [lk("b1", "a1", REVOKES)],
    )
    assert validate_lock(r, "a2") == []
    r = reg(
        [dec("a1"), dec("a2", 2, parent="a1", minutes=1, status="draft"), dec("b1")],
        [lk("b1", "a1", AMENDS)],
    )
    assert validate_lock(r, "a2") == []


def test_lock_reports_both_problems():
    r = reg(
        [
            dec("a1"),
            dec("a2", 2, parent="a1", minutes=1, status="draft"),
            dec("b1"),
            dec("c1", status="draft"),
        ],
        [lk("b1", "a1", REVOKES), lk("a2", "c1", RELATES)],
    )
    assert validate_lock(r, "a2") == [LINK_TARGET_NOT_LOCKED, CHAIN_CLOSED]
