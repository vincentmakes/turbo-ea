"""Shared lifecycle-phase helpers.

The phase precedence used here — ``endOfLife`` before ``phaseOut`` before
``active`` … — is the same array the frontend's ``LifecycleBadge`` and the
inventory grid use, so a card's "current phase" is identical everywhere it is
displayed or sorted. Keep the three in sync.
"""

from __future__ import annotations

from datetime import datetime, timezone

# Most-advanced phase first: a card whose endOfLife date has passed is at end
# of life even though its `active` date also passed.
PHASE_PRECEDENCE = ("endOfLife", "phaseOut", "active", "phaseIn", "plan")

# Chronological order, used as the fallback when every date is still ahead.
PHASE_CHRONOLOGICAL = ("plan", "phaseIn", "active", "phaseOut", "endOfLife")


def current_lifecycle_phase(lifecycle: dict | None) -> str | None:
    """Determine which lifecycle phase a card is currently in based on dates."""
    if not lifecycle:
        return None
    today = datetime.now(timezone.utc).date()
    for phase in PHASE_PRECEDENCE:
        date_str = lifecycle.get(phase)
        if date_str:
            try:
                d = (
                    datetime.fromisoformat(date_str).date()
                    if "T" in str(date_str)
                    else datetime.strptime(str(date_str), "%Y-%m-%d").date()
                )
                if d <= today:
                    return phase
            except (ValueError, TypeError):
                continue
    # If all dates are in the future, return the earliest set phase
    for phase in PHASE_CHRONOLOGICAL:
        if lifecycle.get(phase):
            return phase
    return None


def lifecycle_rank(lifecycle: dict | None) -> int:
    """Sort key ordering cards by how urgent their phase is.

    Risk-first: end-of-life and phasing-out cards sort above healthy ones, and
    cards with no lifecycle data sort last. This is the ordering that makes a
    read-only overview list actionable — the rows needing attention are the
    ones you see without scrolling.
    """
    phase = current_lifecycle_phase(lifecycle)
    if phase is None:
        return len(PHASE_PRECEDENCE)
    return PHASE_PRECEDENCE.index(phase)
