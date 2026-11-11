"""Decision standing: the one definition of where an architecture decision stands.

A decision's *standing* (scheduled, in force, amended, superseded, revoked,
expired) is never stored. It is derived from the decisions' revision chains,
their dates and the typed links between them, and this module is the only place
that derives it. Every endpoint, exporter, importer, extension bridge and MCP
answer asks this module; none re-derives a rule. If two callers disagreed, a
register filtered on "in force" would list a decision its own page calls
revoked.

The core is pure: callers build :class:`DecisionRow` and :class:`LinkRow`
values, and :func:`build_register` turns them into a :class:`Register` that
answers per decision id. The database loader (:func:`load_register`) lives in
this module too, beside the pure core it feeds, and is its only database code.

Definitions (chains come from :mod:`app.services.revision_chain`, built from
``parent_id`` only):

* *locked*: ``status == "signed"``; *effective*: locked and ``effective_from``
  unset or on or before ``today``.
* A link is *active* when its source row is effective, whatever the source's
  own standing later becomes. ``revokes`` and ``replaces`` act one hop, on the
  target's whole chain, and are never undone.
* Standing of a locked row, first match wins:

  1. an earlier revision in its chain: ``superseded`` (by the chain's current);
  2. its chain is targeted by an active ``revokes``: ``revoked``;
  3. its chain is targeted by an active ``replaces``: ``superseded`` (by the
     replacing decision);
  4. not effective: ``scheduled``;
  5. ``today`` after ``valid_until``: ``expired`` (in force through that day);
  6. an open amendment: ``amended``;
  7. otherwise ``in_force``.

  When an active ``revokes`` and an active ``replaces`` both target a chain,
  the link whose source has the earliest ``effective_from`` wins (unset counts
  as earliest); then ``revokes`` before ``replaces``; then the earliest link
  ``created_at`` (unset first); then the source id.
* An ``amends`` link is *open* while (a) it is active, (b) the amending
  chain is in force: its CURRENT revision's standing by rules 1-5 alone is
  ``in_force`` (a revoked, replaced or expired amending decision no longer
  amends; the linking revision merely becoming an earlier revision of its
  chain does not close the link), and (c) no effective revision of the
  target chain holds a ``consolidates`` link to the amender revision that
  made the link or to a later revision in the amender's chain. An amended
  decision's ``amended_by`` names each amending chain once, by its current
  revision.
* Unlocked rows have no standing (``None``).
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.services.revision_chain import (
    LOCKED_STATUS,
    Chain,
    RevisionNode,
    build_chains,
    is_effective,
)

# --- link kinds -------------------------------------------------------------

REPLACES = "replaces"
AMENDS = "amends"
REVOKES = "revokes"
RELATES = "relates"
CONSOLIDATES = "consolidates"

#: Every link kind a decision may hold.
LINK_KINDS: tuple[str, ...] = (REPLACES, AMENDS, REVOKES, RELATES, CONSOLIDATES)
#: Kinds that change another decision's standing (all but ``relates``).
HARD_KINDS: tuple[str, ...] = (REPLACES, AMENDS, REVOKES, CONSOLIDATES)

# --- standings --------------------------------------------------------------

SCHEDULED = "scheduled"
IN_FORCE = "in_force"
AMENDED = "amended"
SUPERSEDED = "superseded"
REVOKED = "revoked"
EXPIRED = "expired"

STANDINGS: tuple[str, ...] = (SCHEDULED, IN_FORCE, AMENDED, SUPERSEDED, REVOKED, EXPIRED)

#: ``UpcomingChange.kind`` for a later revision that is signed but not yet effective.
UPCOMING_REVISION = "revision"

# --- problem codes ----------------------------------------------------------

UNKNOWN_KIND = "unknown_kind"
TARGET_MISSING = "target_missing"
SAME_CHAIN = "same_chain"
CONSOLIDATES_NEEDS_REVISION = "consolidates_needs_revision"
CONSOLIDATES_NOT_AMENDER = "consolidates_not_amender"
VALID_UNTIL_BEFORE_EFFECTIVE = "valid_until_before_effective"
VALID_UNTIL_PAST = "valid_until_past"
DECIDED_ON_FUTURE = "decided_on_future"
LINK_TARGET_NOT_LOCKED = "link_target_not_locked"
CHAIN_CLOSED = "chain_closed"

#: The lock-time date checks' allowance for the timezone spread: the dates are
#: date-only, the browser picks them in its local day and ``today`` is the
#: server's UTC day, which can be one day behind or ahead of the author's.
LOCK_DATE_TOLERANCE = timedelta(days=1)

# ``revokes`` wins a tie against ``replaces``.
_CLOSING_RANK: dict[str, int] = {REVOKES: 0, REPLACES: 1}


# --- inputs -----------------------------------------------------------------


@dataclass(frozen=True)
class DecisionRow:
    """One decision revision, reduced to what standing needs."""

    id: Any
    reference_number: str
    revision_number: int
    status: str
    parent_id: Any
    created_at: datetime
    title: str
    decided_on: date | None = None
    effective_from: date | None = None
    valid_until: date | None = None
    recorded: bool = False


@dataclass(frozen=True)
class LinkRow:
    """One typed link from ``source_id`` to ``target_id``."""

    source_id: Any
    target_id: Any
    kind: str
    created_at: datetime | None = None
    note: str | None = None
    id: Any = None


# --- outputs ----------------------------------------------------------------


@dataclass(frozen=True)
class DecisionRef:
    """How one decision points at another: enough to label and link it."""

    id: Any
    reference_number: str
    revision_number: int
    title: str


def decision_ref(row: DecisionRow) -> DecisionRef:
    """The :class:`DecisionRef` of ``row``."""
    return DecisionRef(
        id=row.id,
        reference_number=row.reference_number,
        revision_number=row.revision_number,
        title=row.title,
    )


@dataclass(frozen=True)
class UpcomingChange:
    """A signed change to a chain that has not taken effect yet.

    ``kind`` is ``"revision"`` (a later revision of the chain), ``"replaces"``
    or ``"revokes"``.
    """

    kind: str
    by: DecisionRef
    effective_from: date | None


@dataclass(frozen=True)
class Standing:
    """Everything derived about one decision revision."""

    id: Any
    standing: str | None
    is_current: bool
    is_earlier_revision: bool
    superseded_by: DecisionRef | None = None
    revoked_by: DecisionRef | None = None
    amended_by: tuple[DecisionRef, ...] = ()
    open_revision: DecisionRef | None = None
    upcoming: tuple[UpcomingChange, ...] = ()
    consolidated_into: DecisionRef | None = None
    chain: tuple[DecisionRef, ...] = ()


class Register:
    """The derived standing of every decision, plus the inputs it came from."""

    def __init__(
        self,
        *,
        today: date,
        rows: dict[Any, DecisionRow],
        links: tuple[LinkRow, ...],
        chains: dict[Any, Chain],
        standings: dict[Any, Standing],
        closures: dict[int, tuple[LinkRow, DecisionRow]],
    ) -> None:
        self._today = today
        self._rows = rows
        self._links = links
        self._chains = chains
        self._standings = standings
        self._closures = closures

    @property
    def today(self) -> date:
        return self._today

    @property
    def links(self) -> tuple[LinkRow, ...]:
        """Every input link, in deterministic order."""
        return self._links

    def __contains__(self, decision_id: object) -> bool:
        return decision_id in self._rows

    def __getitem__(self, decision_id: Any) -> Standing:
        return self._standings[decision_id]

    def ids(self) -> tuple[Any, ...]:
        """Every decision id in the register."""
        return tuple(self._rows)

    def get(self, decision_id: Any) -> Standing | None:
        return self._standings.get(decision_id)

    def row(self, decision_id: Any) -> DecisionRow:
        return self._rows[decision_id]

    def chain(self, decision_id: Any) -> Chain:
        return self._chains[decision_id]

    def outgoing(self, decision_id: Any) -> tuple[LinkRow, ...]:
        return tuple(lk for lk in self._links if lk.source_id == decision_id)

    def incoming(self, decision_id: Any) -> tuple[LinkRow, ...]:
        return tuple(lk for lk in self._links if lk.target_id == decision_id)

    def closing_link(self, decision_id: Any) -> tuple[LinkRow, DecisionRow] | None:
        """The active ``revokes`` / ``replaces`` that closed this row's chain."""
        return self._closures.get(id(self._chains[decision_id]))


# --- helpers ----------------------------------------------------------------


def _row_key(row: DecisionRow) -> tuple[str, int, datetime, Any]:
    return (row.reference_number, row.revision_number, row.created_at, row.id)


def _link_key(link: LinkRow) -> tuple[Any, Any, str]:
    return (link.source_id, link.target_id, link.kind)


def _node(row: DecisionRow) -> RevisionNode:
    return RevisionNode(
        id=row.id,
        parent_id=row.parent_id,
        revision_number=row.revision_number,
        status=row.status,
        created_at=row.created_at,
        group_key=None,
        effective_from=row.effective_from,
    )


def _effective(row: DecisionRow, today: date) -> bool:
    return is_effective(_node(row), today)


def _closing_key(link: LinkRow, source: DecisionRow) -> tuple[Any, ...]:
    return (
        source.effective_from or date.min,
        _CLOSING_RANK[link.kind],
        link.created_at is not None,
        link.created_at or 0,
        source.id,
        link.target_id,
    )


def amendment_open(amender_current_base: str | None) -> bool:
    """Whether an active, unconsolidated ``amends`` link still amends its target.

    Judged on the amending CHAIN, by the base standing (rules 1-5) of that
    chain's current revision: open while it is ``in_force``; closed once the
    amending decision is revoked, replaced or expired (or before its current
    revision is in force). The linking revision being an earlier revision of
    its chain does not close the link: revising the amending decision keeps
    its amendment.
    """
    return amender_current_base == IN_FORCE


def _today_utc() -> date:
    return datetime.now(timezone.utc).date()


# --- the register -----------------------------------------------------------


def build_register(
    decisions: Iterable[DecisionRow],
    links: Iterable[LinkRow],
    *,
    today: date | None = None,
) -> Register:
    """Derive the standing of every decision in ``decisions``.

    ``today`` defaults to the current UTC date. Links whose source or target is
    not among ``decisions``, whose kind is unknown, or which join two revisions
    of the same chain take no effect (they stay listed in :attr:`Register.links`).
    """
    day = today if today is not None else _today_utc()
    rows: dict[Any, DecisionRow] = {}
    for r in decisions:
        rows[r.id] = r
    chains = build_chains((_node(r) for r in rows.values()), today=day)
    all_links = tuple(sorted(links, key=_link_key))

    def eff(row: DecisionRow) -> bool:
        return _effective(row, day)

    # Links that can take effect: both ends present, known kind, two chains.
    usable = [
        lk
        for lk in all_links
        if lk.kind in LINK_KINDS
        and lk.source_id in rows
        and lk.target_id in rows
        and chains[lk.source_id] is not chains[lk.target_id]
    ]

    # Rules 2/3: the winning active revokes/replaces per target chain.
    closures: dict[int, tuple[LinkRow, DecisionRow]] = {}
    for lk in usable:
        if lk.kind not in _CLOSING_RANK:
            continue
        src = rows[lk.source_id]
        if not eff(src):
            continue
        key = id(chains[lk.target_id])
        held = closures.get(key)
        if held is None or _closing_key(lk, src) < _closing_key(*held):
            closures[key] = (lk, src)

    # Rules 1-5: the base standing of every locked row.
    base: dict[Any, str | None] = {}
    for rid, r in rows.items():
        chain = chains[rid]
        closure = closures.get(id(chain))
        if r.status != LOCKED_STATUS:
            base[rid] = None
        elif chain.role(rid) == "earlier":
            base[rid] = SUPERSEDED
        elif closure is not None:
            base[rid] = REVOKED if closure[0].kind == REVOKES else SUPERSEDED
        elif not eff(r):
            base[rid] = SCHEDULED
        elif r.valid_until is not None and day > r.valid_until:
            base[rid] = EXPIRED
        else:
            base[rid] = IN_FORCE

    # Amendments: open amender chains per target chain (each named by its
    # current revision), consolidations per amending revision.
    open_amenders: dict[int, dict[int, Any]] = {}
    consolidated: dict[Any, list[DecisionRow]] = {}
    for lk in usable:
        if lk.kind != AMENDS:
            continue
        src = rows[lk.source_id]
        if not eff(src):
            continue
        target_chain = chains[lk.target_id]
        amender_chain = chains[lk.source_id]
        amender_pos = amender_chain.position(src.id)
        closers = [
            rows[c.source_id]
            for c in usable
            if c.kind == CONSOLIDATES
            and chains[c.source_id] is target_chain
            and eff(rows[c.source_id])
            and chains[c.target_id] is amender_chain
            and amender_chain.position(c.target_id) >= amender_pos
        ]
        if closers:
            consolidated.setdefault(src.id, []).extend(closers)
        elif amendment_open(base[amender_chain.current.id]):
            open_amenders.setdefault(id(target_chain), {})[id(amender_chain)] = (
                amender_chain.current.id
            )

    # Assemble.
    standings: dict[Any, Standing] = {}
    for rid, r in rows.items():
        chain = chains[rid]
        role = chain.role(rid)
        is_current = role == "current"
        closure = closures.get(id(chain))
        standing = base[rid]
        superseded_by: DecisionRef | None = None
        revoked_by: DecisionRef | None = None
        amended_by: tuple[DecisionRef, ...] = ()
        if standing == SUPERSEDED and role == "earlier":
            superseded_by = decision_ref(rows[chain.current.id])
        elif standing == SUPERSEDED and closure is not None:
            superseded_by = decision_ref(closure[1])
        elif standing == REVOKED and closure is not None:
            revoked_by = decision_ref(closure[1])
        elif standing == IN_FORCE and open_amenders.get(id(chain)):
            standing = AMENDED
            amenders = sorted((rows[a] for a in open_amenders[id(chain)].values()), key=_row_key)
            amended_by = tuple(decision_ref(a) for a in amenders)

        open_revision: DecisionRef | None = None
        upcoming: tuple[UpcomingChange, ...] = ()
        if is_current:
            if chain.open_revision is not None:
                open_revision = decision_ref(rows[chain.open_revision.id])
            if closure is None:
                upcoming = _upcoming(rows, chains, usable, chain)

        closers_of = consolidated.get(rid)
        consolidated_into = decision_ref(min(closers_of, key=_row_key)) if closers_of else None

        standings[rid] = Standing(
            id=rid,
            standing=standing,
            is_current=is_current,
            is_earlier_revision=role == "earlier",
            superseded_by=superseded_by,
            revoked_by=revoked_by,
            amended_by=amended_by,
            open_revision=open_revision,
            upcoming=upcoming,
            consolidated_into=consolidated_into,
            chain=tuple(decision_ref(rows[n.id]) for n in chain.nodes),
        )

    return Register(
        today=day,
        rows=rows,
        links=all_links,
        chains=chains,
        standings=standings,
        closures=closures,
    )


def _upcoming(
    rows: dict[Any, DecisionRow],
    chains: dict[Any, Chain],
    usable: list[LinkRow],
    chain: Chain,
) -> tuple[UpcomingChange, ...]:
    """Signed-but-not-yet-effective changes to an open chain, soonest first.

    Only called for a chain no active ``revokes`` / ``replaces`` closed, so a
    signed source of one targeting it is necessarily not yet effective; and a
    signed revision after ``current`` is never effective (``current`` is the
    last effective one).
    """
    found: list[tuple[UpcomingChange, DecisionRow]] = []
    cur = chain.position(chain.current.id)
    for n in chain.nodes[cur + 1 :]:
        r = rows[n.id]
        if r.status == LOCKED_STATUS:
            found.append((UpcomingChange(UPCOMING_REVISION, decision_ref(r), r.effective_from), r))
    for lk in usable:
        if lk.kind not in _CLOSING_RANK or chains[lk.target_id] is not chain:
            continue
        src = rows[lk.source_id]
        if src.status == LOCKED_STATUS:
            found.append((UpcomingChange(lk.kind, decision_ref(src), src.effective_from), src))
    found.sort(key=lambda item: (item[0].effective_from or date.min, _row_key(item[1])))
    return tuple(item[0] for item in found)


# --- loading ----------------------------------------------------------------


async def load_register(db: AsyncSession, *, today: date | None = None) -> Register:
    """The register of every decision in the database, in two queries.

    The only place this module touches the database: one query for the light
    decision columns of the whole table, one for every link.
    """
    adr = ArchitectureDecision
    decision_rows = await db.execute(
        select(
            adr.id,
            adr.reference_number,
            adr.revision_number,
            adr.status,
            adr.parent_id,
            adr.created_at,
            adr.title,
            adr.decided_on,
            adr.effective_from,
            adr.valid_until,
            adr.recorded_at,
        )
    )
    decisions = [
        DecisionRow(
            id=r.id,
            reference_number=r.reference_number,
            revision_number=r.revision_number,
            status=r.status,
            parent_id=r.parent_id,
            created_at=r.created_at,
            title=r.title,
            decided_on=r.decided_on,
            effective_from=r.effective_from,
            valid_until=r.valid_until,
            recorded=r.recorded_at is not None,
        )
        for r in decision_rows.all()
    ]
    lnk = ArchitectureDecisionLink
    link_rows = await db.execute(
        select(lnk.id, lnk.source_id, lnk.target_id, lnk.kind, lnk.created_at, lnk.note)
    )
    links = [
        LinkRow(
            source_id=r.source_id,
            target_id=r.target_id,
            kind=r.kind,
            created_at=r.created_at,
            note=r.note,
            id=r.id,
        )
        for r in link_rows.all()
    ]
    return build_register(decisions, links, today=today)


# --- validation -------------------------------------------------------------


def validate_link_draft(
    register: Register,
    source_id: Any,
    target_id: Any,
    kind: str,
    *,
    source_parent_id: Any = None,
) -> list[str]:
    """Problems with saving a link ``source_id -> target_id`` of ``kind``.

    The source may be a decision not yet in ``register`` (a new decision or a
    revision about to be created): it is then read as a revision of
    ``source_parent_id`` when that is given, else as a new root decision.
    "One link per pair" is enforced by the database, not here.
    """
    problems: list[str] = []
    if kind not in LINK_KINDS:
        problems.append(UNKNOWN_KIND)
    if target_id not in register:
        problems.append(TARGET_MISSING)
        return problems

    if source_id in register:
        source_chain: Chain | None = register.chain(source_id)
        has_parent = register.row(source_id).parent_id is not None
    else:
        has_parent = source_parent_id is not None
        source_chain = register.chain(source_parent_id) if source_parent_id in register else None

    target_chain = register.chain(target_id)
    if source_chain is target_chain:
        problems.append(SAME_CHAIN)

    if kind == CONSOLIDATES:
        if not has_parent:
            problems.append(CONSOLIDATES_NEEDS_REVISION)
        target_ids = {n.id for n in target_chain.nodes}
        source_ids = {n.id for n in source_chain.nodes} if source_chain is not None else set()
        amends_us = any(
            lk.kind == AMENDS and lk.source_id in target_ids and lk.target_id in source_ids
            for lk in register.links
        )
        if not amends_us:
            problems.append(CONSOLIDATES_NOT_AMENDER)
    return problems


def validate_dates(
    decided_on: date | None,
    effective_from: date | None,
    valid_until: date | None,
    *,
    today: date,
    at_lock: bool,
) -> list[str]:
    """Problems with a decision's dates; ``at_lock`` adds the checks made when it locks.

    The lock-time checks allow :data:`LOCK_DATE_TOLERANCE` either side of the
    UTC ``today``, because a date-only field carries no timezone: an author
    ahead of UTC may already be on ``today + 1`` and one behind it still on
    ``today - 1``. ``valid_until_past`` is therefore ``valid_until`` before
    ``today - 1`` and ``decided_on_future`` is ``decided_on`` after
    ``today + 1``. Standing derivation keeps the UTC day.
    """
    problems: list[str] = []
    if valid_until is not None and effective_from is not None and valid_until < effective_from:
        problems.append(VALID_UNTIL_BEFORE_EFFECTIVE)
    if at_lock:
        if valid_until is not None and valid_until < today - LOCK_DATE_TOLERANCE:
            problems.append(VALID_UNTIL_PAST)
        if decided_on is not None and decided_on > today + LOCK_DATE_TOLERANCE:
            problems.append(DECIDED_ON_FUTURE)
    return problems


def chain_closed_by(register: Register, decision_id: Any) -> DecisionRef | None:
    """The decision that revoked or replaced this decision's chain, if any."""
    closure = register.closing_link(decision_id)
    return decision_ref(closure[1]) if closure is not None else None


def validate_lock(register: Register, decision_id: Any) -> list[str]:
    """Problems with locking ``decision_id`` (request-signatures, record, final signature)."""
    problems: list[str] = []
    for lk in register.outgoing(decision_id):
        if lk.target_id not in register or register.row(lk.target_id).status != LOCKED_STATUS:
            problems.append(LINK_TARGET_NOT_LOCKED)
            break
    if chain_closed_by(register, decision_id) is not None:
        problems.append(CHAIN_CLOSED)
    return problems
