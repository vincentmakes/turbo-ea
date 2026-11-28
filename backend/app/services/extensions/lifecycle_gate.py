"""Lifecycle phases a licensed extension maintains on a card (SDK 1.22).

An extension holding the grant ``core.cards.maintain_lifecycle`` may claim
chosen phases of a card's ``lifecycle`` through the data bridge
(``ctx.data.maintain_lifecycle``). The claim is stored on the card as
``cards.lifecycle_maintained = {"ext": "<key>", "phases": [...]}`` and, while
it is EFFECTIVE, nobody else may change those phases: every user-driven writer
(REST, bulk edit, MCP, Excel import, the bridge's plain ``update_card``)
refuses a change with a 403 ``lifecycle_maintained``, and the bulk importers
(survey apply, ServiceNow, platform migration, rollback) keep the stored value
and report the phase as skipped.

A claim is effective ONLY while its owning extension currently holds the
grant — installed, enabled, loaded and with a usable entitlement
(``ExtensionRegistry.grants_for``). This is deliberately the INVERSE of
``field_gate``: there an extension's contributed fields lock while the
extension is NOT writable (the pen belongs to the extension and nobody may use
it while it is away); here phases lock while the extension IS active (it holds
the pen). Disable it, let the licence lapse or uninstall it and the marker is
ignored — the phases are editable by hand again and every value stays.
A malformed marker is ignored as well.

Free core has no path to set the marker: only the two bridge calls (through
``card_write_service.update_card(..., lifecycle_maintainer=key)``) and the
uninstall clean-up write it, pinned by ``test_lifecycle_maintained_gating.py``.

Pure helpers only (unit-tested without a database). Like ``field_gate`` this
module imports neither ``field_contributions`` nor ``bundle``:
``card_write_service`` imports it, and ``bundle`` closes an import cycle
through ``catalogue_common``.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, cast

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extensions.registry import ExtensionRegistry, extension_registry
from app.services.lifecycle import PHASE_CHRONOLOGICAL, parse_lifecycle_date

#: The manifest grant that lets an extension maintain lifecycle phases.
MAINTAIN_GRANT = "core.cards.maintain_lifecycle"

#: ``detail.error`` of the 403 a refused user-driven write answers with.
MAINTAINED_ERROR = "lifecycle_maintained"

#: The five phases, in chronological order.
PHASES: tuple[str, ...] = PHASE_CHRONOLOGICAL

#: English labels, for the plain-sentence ``message`` of the 403.
PHASE_LABELS = {
    "plan": "Plan",
    "phaseIn": "Phase In",
    "active": "Active",
    "phaseOut": "Phase Out",
    "endOfLife": "End of Life",
}


@dataclass(frozen=True)
class LifecycleLock:
    """An effective claim: the owning extension's key, its display name, and
    the maintained phases in chronological order."""

    ext: str
    name: str
    phases: tuple[str, ...]


def ordered_phases(phases: Collection[str]) -> tuple[str, ...]:
    """``phases`` deduplicated, in chronological order (unknown names dropped)."""
    wanted = set(phases)
    return tuple(p for p in PHASES if p in wanted)


def parse_marker(marker: Any) -> tuple[str, tuple[str, ...]] | None:
    """``(ext, phases)`` of a well-formed marker, else ``None``.

    Well-formed: a dict whose ``ext`` is a non-empty string and whose
    ``phases`` is a non-empty list of known phase names. Anything else — an
    unknown phase included — is malformed and ignored as a whole.
    """
    if not isinstance(marker, Mapping):
        return None
    ext = marker.get("ext")
    phases = marker.get("phases")
    if not isinstance(ext, str) or not ext:
        return None
    if not isinstance(phases, list) or not phases:
        return None
    if not all(isinstance(p, str) and p in PHASES for p in phases):
        return None
    return ext, ordered_phases(phases)


def _owner_name(ext: str, registry: ExtensionRegistry, now: datetime | None) -> str | None:
    """The display name of ``ext`` while it holds the grant, else ``None``."""
    if MAINTAIN_GRANT not in registry.grants_for(ext, now=now):
        return None
    info = registry.get(ext)
    return (info.name if info is not None else None) or ext


def effective_lock(
    marker: Any,
    registry: ExtensionRegistry | None = None,
    now: datetime | None = None,
    *,
    cache: dict[str, str | None] | None = None,
) -> LifecycleLock | None:
    """The claim ``marker`` makes, when it is in force right now; else ``None``.

    In force only while the owning extension holds :data:`MAINTAIN_GRANT`
    (enabled, loaded, usable entitlement — :meth:`ExtensionRegistry.grants_for`).
    ``cache`` (one dict per request) resolves each owner once, so a list of a
    thousand claimed cards asks the registry once per extension, not per row.
    """
    parsed = parse_marker(marker)
    if parsed is None:
        return None
    ext, phases = parsed
    reg = extension_registry if registry is None else registry
    if cache is None:
        name = _owner_name(ext, reg, now)
    else:
        if ext not in cache:
            cache[ext] = _owner_name(ext, reg, now)
        name = cache[ext]
    if name is None:
        return None
    return LifecycleLock(ext=ext, name=name, phases=phases)


def _is_empty(value: Any) -> bool:
    return value is None or value == ""


def _same(old: Any, new: Any) -> bool:
    return old == new or (_is_empty(old) and _is_empty(new))


def _keep_stored(out: dict[str, Any], current: Mapping[str, Any], phase: str) -> None:
    if phase in current:
        out[phase] = current[phase]
    else:
        out.pop(phase, None)


def apply_lifecycle_lock(
    stored: Mapping[str, Any] | None,
    incoming: Mapping[str, Any] | None,
    phases: Collection[str],
) -> tuple[dict[str, Any], list[str]]:
    """What a write may store over ``stored``, and which locked phases it tried to change.

    ``incoming`` is a whole lifecycle dict (writers replace the column). Each
    locked phase comes back at its stored state: absent from ``incoming`` →
    carried over; present and unchanged (empty / ``None`` / ``""`` equal
    absent) → passes; present and changed → kept at the stored value and
    named, in chronological order, in the second element.
    """
    current = stored or {}
    out = dict(incoming or {})
    refused: list[str] = []
    for phase in ordered_phases(phases):
        if phase in out and not _same(current.get(phase), out[phase]):
            refused.append(phase)
        _keep_stored(out, current, phase)
    return out, refused


def changed_phases(
    stored: Mapping[str, Any] | None,
    answers: Mapping[str, Any],
    phases: Collection[str],
) -> list[str]:
    """The phases of ``phases`` that ``answers`` sets to something other than ``stored``.

    ``answers`` names only the phases a writer was asked to set, each with its
    new value — an empty one (``""`` / ``None``) meaning "clear it", which
    equals an absent stored phase. In chronological order. Unlike
    :func:`apply_lifecycle_lock` this works from the answers, not from a
    merged dict, so a CLEAR of a locked phase is reported as well (in a
    merged dict the cleared phase is simply absent, and absent reads as
    "carried over").
    """
    current = stored or {}
    return [
        phase
        for phase in ordered_phases(phases)
        if phase in answers and not _same(current.get(phase), answers[phase])
    ]


def apply_lifecycle_snapshot_lock(
    current: Mapping[str, Any] | None,
    snapshot: Mapping[str, Any] | None,
    phases: Collection[str],
) -> tuple[dict[str, Any], list[str]]:
    """Restore the lifecycle ``snapshot`` over ``current``, except the locked phases.

    The rollback counterpart of :func:`apply_lifecycle_lock`: a phase absent
    from a snapshot did not exist then, so it is not "carried over" — every
    locked phase stays at its current state and is named in the second element
    whenever that state differs from the snapshot's (absence included).
    """
    now = current or {}
    snap = snapshot or {}
    out = dict(snap)
    differing: list[str] = []
    for phase in ordered_phases(phases):
        if not _same(snap.get(phase), now.get(phase)):
            differing.append(phase)
        _keep_stored(out, now, phase)
    return out, differing


def _bounds(
    lifecycle: Mapping[str, Any], maintained: tuple[str, ...], phase: str
) -> tuple[tuple[date, Any] | None, tuple[date, Any] | None]:
    """Lower and upper bound a manual ``phase`` must respect: the LATEST
    maintained date of an earlier phase, and the EARLIEST maintained date of a
    later phase (each with the stored value it came from)."""
    idx = PHASES.index(phase)
    dated = {
        p: (d, lifecycle[p])
        for p in maintained
        if (d := parse_lifecycle_date(lifecycle.get(p))) is not None
    }
    earlier = [dated[p] for p in PHASES[:idx] if p in dated]
    later = [dated[p] for p in PHASES[idx + 1 :] if p in dated]
    # max / min keep the first of equal dates: the earliest phase's stored
    # string wins a tie.
    lower = max(earlier, key=_bound_date) if earlier else None
    upper = min(later, key=_bound_date) if later else None
    return lower, upper


def _bound_date(bound: tuple[date, Any]) -> date:
    """The date of a ``(date, stored value)`` bound in :func:`_bounds`."""
    return bound[0]


def clamp_to_maintained(lifecycle: Mapping[str, Any], phases: Collection[str]) -> dict[str, Any]:
    """Clamp every manual (non-maintained) date into the order the maintained ones set.

    Order: ``plan ≤ phaseIn ≤ active ≤ phaseOut ≤ endOfLife``. For each manual
    phase with a readable date:

    * earlier than the latest maintained date of an EARLIER phase → set to
      that maintained date;
    * then, later than the earliest maintained date of a LATER phase → set to
      that maintained date (so when the maintained dates contradict each
      other, the later phase's bound wins).

    The clamped value is the maintained neighbour's stored string, verbatim.
    Unreadable manual values, absent phases and maintained phases are left
    alone, and an unreadable maintained date sets no bound.
    """
    maintained = ordered_phases(phases)
    out = dict(lifecycle)
    if not maintained:
        return out
    for phase in PHASES:
        if phase in maintained:
            continue
        mine = parse_lifecycle_date(out.get(phase))
        if mine is None:
            continue
        lower, upper = _bounds(out, maintained, phase)
        if lower is not None and mine < lower[0]:
            out[phase] = lower[1]
            mine = lower[0]
        if upper is not None and mine > upper[0]:
            out[phase] = upper[1]
    return out


def merge_maintained(
    stored: Mapping[str, Any] | None,
    values: Mapping[str, Any],
    phases: Collection[str],
) -> dict[str, Any]:
    """The lifecycle the owning extension's write stores.

    Each phase of ``phases`` is set from ``values`` — a missing, ``None`` or
    ``""`` value removes the phase. Every other phase keeps its stored value,
    except that a manual date breaking the chronological order against a
    maintained one is clamped (:func:`clamp_to_maintained`).
    """
    out = dict(stored or {})
    maintained = ordered_phases(phases)
    for phase in maintained:
        value = values.get(phase)
        if _is_empty(value):
            out.pop(phase, None)
        else:
            out[phase] = value
    return clamp_to_maintained(out, maintained)


def _labels(phases: Collection[str]) -> str:
    return ", ".join(PHASE_LABELS[p] for p in phases)


def maintained_error(refused: list[str], lock: LifecycleLock) -> HTTPException:
    """The 403 a user-driven write answers with when it changed a maintained phase."""
    return HTTPException(
        status_code=403,
        detail={
            "error": MAINTAINED_ERROR,
            "message": (
                f"These lifecycle dates are set automatically by the installed extension "
                f"{lock.name} and cannot be edited by hand: {_labels(refused)}."
            ),
            "phases": list(refused),
            "extension": lock.name,
        },
    )


def checked_lifecycle(
    stored: Mapping[str, Any] | None,
    incoming: Mapping[str, Any] | None,
    lock: LifecycleLock | None,
) -> dict[str, Any]:
    """Gate one user-driven lifecycle write.

    No effective lock → ``incoming`` as a dict, untouched. Otherwise the
    maintained phases are carried over (:func:`apply_lifecycle_lock`), a change
    to one raises :func:`maintained_error`, and when the write changes the
    lifecycle at all its manual dates are clamped against the maintained ones
    (:func:`clamp_to_maintained`) — the stored lifecycle never contradicts the
    dates an extension keeps.
    """
    if lock is None:
        return dict(incoming or {})
    out, refused = apply_lifecycle_lock(stored, incoming, lock.phases)
    if refused:
        raise maintained_error(refused, lock)
    if out == dict(stored or {}):
        return out
    return clamp_to_maintained(out, lock.phases)


def checked_bulk_lifecycle(
    rows: Iterable[tuple[str, Mapping[str, Any] | None, Any]],
    incoming: Mapping[str, Any] | None,
    registry: ExtensionRegistry | None = None,
) -> dict[str, dict[str, Any]]:
    """:func:`checked_lifecycle` for one shared lifecycle written to many cards.

    ``rows`` are ``(card_id, stored lifecycle, lifecycle_maintained marker)``.
    Returns, per card under an EFFECTIVE claim, the lifecycle to store (others
    take ``incoming`` as it is). When the shared value would change a
    maintained phase on ANY card the whole call is refused: the 403 of
    :func:`maintained_error` naming every refused phase, with the refused card
    ids under ``detail["cards"]``.
    """
    out: dict[str, dict[str, Any]] = {}
    refused_cards: list[str] = []
    refused_phases: set[str] = set()
    first_lock: LifecycleLock | None = None
    for card_id, stored, marker in rows:
        lock = effective_lock(marker, registry)
        if lock is None:
            continue
        try:
            out[card_id] = checked_lifecycle(stored, incoming, lock)
        except HTTPException as exc:
            refused_cards.append(card_id)
            refused_phases.update(cast(dict[str, Any], exc.detail)["phases"])
            first_lock = first_lock or lock
    if first_lock is not None:
        err = maintained_error(list(ordered_phases(refused_phases)), first_lock)
        cast(dict[str, Any], err.detail)["cards"] = refused_cards
        raise err
    return out


def lock_payload(
    marker: Any,
    registry: ExtensionRegistry | None = None,
    *,
    cache: dict[str, str | None] | None = None,
) -> dict | None:
    """The card payload's ``lifecycle_maintained``: ``{"ext", "name", "phases"}``
    while the claim is effective, else ``None``. Pass one ``cache`` dict for
    every row of a response (see :func:`effective_lock`)."""
    lock = effective_lock(marker, registry, cache=cache)
    if lock is None:
        return None
    return {"ext": lock.ext, "name": lock.name, "phases": list(lock.phases)}


async def release_extension_claims(db: AsyncSession, key: str) -> int:
    """Clear every lifecycle claim extension ``key`` holds (on uninstall).

    The dates stay; only the marker goes. Derived maintenance: run inside
    ``derived_maintenance`` so no card is re-dated and no event is owed — the
    lifecycle values themselves do not move. Flushes, never commits. Returns
    how many cards were released.
    """
    from app.models.card import Card
    from app.services.derived_writes import derived_maintenance

    cards = (
        (
            await db.execute(
                # A NULL marker has no "ext", so it never equals ``key``.
                select(Card).where(Card.lifecycle_maintained["ext"].astext == key)
            )
        )
        .scalars()
        .all()
    )
    if not cards:
        return 0
    with derived_maintenance(db):
        for card in cards:
            card.lifecycle_maintained = None
        await db.flush()
    return len(cards)
