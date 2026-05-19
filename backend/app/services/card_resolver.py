"""Resolve cards by human-readable references (`name` or `parent_path/name`).

Used by the bulk-import endpoints (cards + relations) and by
`POST /cards/resolve-refs` to surface ambiguities to the user before any
write happens. The matching rules mirror what `excelImport.ts` does on
the frontend:

- A reference is a `/`-separated path with `\\` and `\\/` escapes, identical
  to `parent_path` on export. The last segment is the card `name`, any
  preceding segments form the ancestor chain from root to immediate parent.
- A single-segment reference (just `"CRM"`) matches any card of the given
  type with that name, irrespective of where it sits in the hierarchy. If
  more than one card matches we return `ambiguous` and the candidate paths
  so the caller can disambiguate.
- Multi-segment references match the **exact** ancestor chain from root —
  the same chain `parent_path` writes on export.

All comparisons are case-insensitive after `.strip()`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card


def decode_ref(ref: str) -> list[str]:
    """Decode a `/`-separated reference into its name segments (root → leaf).

    Mirrors the frontend's `decodePath()` in `excelImport.ts`: `\\` escapes
    the next char so `\\\\` is a literal backslash and `\\/` is a literal
    slash within a name. Empty / blank segments are dropped after split.
    """
    if not ref:
        return []
    segments: list[str] = []
    cur = ""
    i = 0
    while i < len(ref):
        ch = ref[i]
        if ch == "\\" and i + 1 < len(ref):
            cur += ref[i + 1]
            i += 2
            continue
        if ch == "/":
            segments.append(cur.strip())
            cur = ""
        else:
            cur += ch
        i += 1
    segments.append(cur.strip())
    return [s for s in segments if s]


@dataclass(frozen=True)
class Candidate:
    """One resolved-candidate card returned for ambiguity reporting."""

    id: uuid.UUID
    parent_path: tuple[str, ...]  # root → immediate parent (empty for root cards)
    name: str

    @property
    def display_path(self) -> str:
        if not self.parent_path:
            return self.name
        return " / ".join([*self.parent_path, self.name])


@dataclass
class ResolveResult:
    """Outcome of resolving a single reference."""

    status: str  # "resolved" | "ambiguous" | "missing"
    card_id: uuid.UUID | None = None
    candidates: list[Candidate] | None = None


class CardResolver:
    """In-memory resolver built from one pass over the cards of a given type set.

    Build once per request via `await CardResolver.load(db, type_keys)`,
    then call `resolve(type_key, ref)` repeatedly. Active (non-archived)
    cards only — archived cards never match.
    """

    def __init__(
        self,
        by_id: dict[uuid.UUID, Card],
        by_type_name: dict[tuple[str, str], list[Candidate]],
        path_cache: dict[uuid.UUID, tuple[str, ...]],
    ) -> None:
        self._by_id = by_id
        self._by_type_name = by_type_name
        self._path_cache = path_cache

    @classmethod
    async def load(cls, db: AsyncSession, type_keys: set[str]) -> CardResolver:
        """Fetch every active card whose type is in `type_keys` *and* every
        ancestor needed to build their parent paths. We over-fetch slightly
        (all cards of those types, regardless of depth) but in practice the
        parent chain stays within the same type only for hierarchical types;
        for cross-type chains we need to walk via id lookups, so we also
        load any parent that wasn't already in the set."""
        if not type_keys:
            return cls({}, {}, {})

        # First pass: pull every active card of the requested types.
        result = await db.execute(
            select(Card.id, Card.parent_id, Card.type, Card.name).where(
                Card.type.in_(type_keys),
                Card.status == "ACTIVE",
            )
        )
        rows: list[tuple[uuid.UUID, uuid.UUID | None, str, str]] = [
            (r[0], r[1], r[2], r[3]) for r in result.all()
        ]

        # Second pass: walk parent_ids transitively to load ancestors that
        # weren't already pulled (different type than the target leaf).
        needed_parent_ids: set[uuid.UUID] = {pid for (_id, pid, _t, _n) in rows if pid is not None}
        known_ids: set[uuid.UUID] = {r[0] for r in rows}
        missing = needed_parent_ids - known_ids
        while missing:
            ancestor_result = await db.execute(
                select(Card.id, Card.parent_id, Card.type, Card.name).where(Card.id.in_(missing))
            )
            new_rows = [(r[0], r[1], r[2], r[3]) for r in ancestor_result.all()]
            if not new_rows:
                break
            rows.extend(new_rows)
            known_ids.update(r[0] for r in new_rows)
            needed_parent_ids = {pid for (_id, pid, _t, _n) in new_rows if pid is not None}
            missing = needed_parent_ids - known_ids

        # Index for path walking.
        parent_of: dict[uuid.UUID, uuid.UUID | None] = {r[0]: r[1] for r in rows}
        name_of: dict[uuid.UUID, str] = {r[0]: r[3] for r in rows}

        def walk_path(card_id: uuid.UUID) -> tuple[str, ...]:
            """Return the ancestor name chain (root → immediate parent)."""
            segs: list[str] = []
            seen: set[uuid.UUID] = set()
            current = parent_of.get(card_id)
            while current is not None and current not in seen and len(segs) < 32:
                seen.add(current)
                segs.append(name_of.get(current, ""))
                current = parent_of.get(current)
            segs.reverse()
            return tuple(segs)

        path_cache: dict[uuid.UUID, tuple[str, ...]] = {}
        by_type_name: dict[tuple[str, str], list[Candidate]] = {}
        by_id: dict[uuid.UUID, Card] = {}
        for cid, _pid, ctype, cname in rows:
            if ctype not in type_keys:
                continue
            path = walk_path(cid)
            path_cache[cid] = path
            key = (ctype, cname.strip().lower())
            by_type_name.setdefault(key, []).append(Candidate(id=cid, parent_path=path, name=cname))
            # Lazy: don't keep the full Card row, only id is needed downstream.

        return cls(by_id, by_type_name, path_cache)

    def resolve(self, type_key: str, ref: str) -> ResolveResult:
        """Resolve a single ref. See module docstring for matching rules."""
        if ref is None:
            return ResolveResult(status="missing")
        segments = decode_ref(str(ref))
        if not segments:
            return ResolveResult(status="missing")
        name = segments[-1]
        parent_path = tuple(s.lower() for s in segments[:-1])
        candidates = self._by_type_name.get((type_key, name.strip().lower()), [])
        if not candidates:
            return ResolveResult(status="missing", candidates=[])

        # Single-segment ref: name-only, accept the candidate iff there's
        # exactly one across the whole type. Otherwise ambiguous.
        if not parent_path:
            if len(candidates) == 1:
                return ResolveResult(status="resolved", card_id=candidates[0].id)
            return ResolveResult(status="ambiguous", candidates=list(candidates))

        # Multi-segment ref: require an exact parent-chain match.
        matches = [
            c for c in candidates if tuple(seg.lower() for seg in c.parent_path) == parent_path
        ]
        if len(matches) == 1:
            return ResolveResult(status="resolved", card_id=matches[0].id)
        if not matches:
            return ResolveResult(status="missing", candidates=list(candidates))
        return ResolveResult(status="ambiguous", candidates=matches)


async def find_card_by_path(
    db: AsyncSession,
    type_key: str,
    parent_path: list[str],
    name: str,
) -> ResolveResult:
    """Convenience helper for one-off lookups. Builds a resolver scoped to
    the single type, then resolves the path. Prefer `CardResolver.load`
    when resolving many refs in the same request."""
    resolver = await CardResolver.load(db, {type_key})
    ref = " / ".join([*[_encode_segment(s) for s in parent_path], _encode_segment(name)])
    return resolver.resolve(type_key, ref)


def _encode_segment(name: str) -> str:
    """Mirror the frontend's `encodePathSegment()` from `excelExport.ts`."""
    return name.replace("\\", "\\\\").replace("/", "\\/")
