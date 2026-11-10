"""Turn the legacy ``related_decisions`` JSON list into ``relates`` link pairs.

Before the decision register (migration 167), a decision's related decisions
were an untyped JSONB list holding three shapes: a decision id (MCP, the
spreadsheet import), a reference number such as ``"ADR-001"`` (the demo seed),
or a dict pointing at something that is not a decision (a TurboLens
assessment). Only the first two name a decision.

:func:`plan_relates_links` is the one place that reads that list, for a bundle
exported before the register (the workspace importer's older-bundle step).
Migration 167 carries its own copy of the same function: a migration must not
import app code that changes later, and app code must not import a migration.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any


def _as_uuid_text(value: str) -> str | None:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def plan_relates_links(rows: Iterable[tuple[Any, Any, Any]]) -> list[tuple[Any, Any]]:
    """Plan the ``(source_id, target_id)`` pairs of ``relates`` links.

    ``rows`` carry ``(id, reference_number, related_decisions)`` for every
    decision that can be linked. A string entry becomes a pair when it is the
    id of one of those decisions, or their reference number (case and
    surrounding spaces ignored). A reference shared by more than one row names
    no single decision and is dropped. Dict entries, non-strings, unknown ids
    and references, and self links are dropped; a target named twice (as an id
    and as a reference, say) yields one pair. Pairs come out in row order, then
    entry order. The returned ids are the row ids as given.
    """
    rows = list(rows)
    by_id: dict[str, Any] = {}
    by_ref: dict[str, Any] = {}
    shared_refs: set[str] = set()
    for row_id, reference, _related in rows:
        by_id[str(row_id)] = row_id
        if isinstance(reference, str) and reference.strip():
            key = reference.strip().upper()
            if key in by_ref:
                shared_refs.add(key)
            by_ref[key] = row_id
    for key in shared_refs:
        del by_ref[key]

    pairs: list[tuple[Any, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row_id, _reference, related in rows:
        if not isinstance(related, list):
            continue
        for entry in related:
            if not isinstance(entry, str) or not entry.strip():
                continue
            text = entry.strip()
            as_id = _as_uuid_text(text)
            target = by_id.get(as_id) if as_id is not None else by_ref.get(text.upper())
            if target is None or str(target) == str(row_id):
                continue
            key = (str(row_id), str(target))
            if key in seen:
                continue
            seen.add(key)
            pairs.append((row_id, target))
    return pairs
