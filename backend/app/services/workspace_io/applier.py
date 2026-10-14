"""Apply a parsed workspace bundle into the live database.

Two entry points share one engine:

* :func:`apply_bundle` writes the bundle flat in the caller's transaction and
  commits once. Sections run in dependency order; per-row failures are recorded
  on the section result (not raised), while an unexpected section error aborts
  the whole import so the job handler can roll back and mark it failed.
* :func:`diff_bundle` runs the *same* engine inside a single savepoint that is
  rolled back at the end, so the returned counts reflect exactly what an apply
  would do (including same-batch parent/endpoint resolution) without persisting
  anything — the dry-run preview.

Running every section in one transaction scope (no per-section savepoint
released mid-run) keeps cards created in the cards pass visible to the
relations/tags passes.

Idempotent upsert-by-natural-key throughout: metamodel/config by key, settings
by merge, users by email, cards by ``external_id``/``(type, parent, name)``,
relations by ``(type, source, target)``. Re-importing the same bundle is a
no-op (all-skip).
"""

from __future__ import annotations

import functools
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    migrate_legacy_app_permissions,
    strip_legacy_card_permissions,
)
from app.models.app_settings import AppSettings
from app.models.bookmark import Bookmark, bookmark_shares
from app.models.card import Card
from app.models.card_type import CardType
from app.models.diagram import Diagram, diagram_cards
from app.models.diagram_group import DiagramGroup, diagram_group_members
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.services import card_reference
from app.services.card_resolver import CardResolver
from app.services.email_backends.runtime import apply_email_settings_to_runtime
from app.services.relation_orientation import oriented
from app.services.workspace_io import exporter as exp
from app.services.workspace_io import remap as rm
from app.services.workspace_io import schema
from app.services.workspace_io.bundle import WorkspaceBundle, from_cell
from app.services.workspace_io.entities import apply_entity_section
from app.services.workspace_io.secrets import (
    EMAIL_SECRET_PATHS,
    GENERAL_SECRET_PATHS,
    strip_secrets,
)
from app.services.workspace_io.sections import (
    ENTITY_SECTIONS,
    SHEET_BOOKMARK_SHARES,
    SHEET_DIAGRAM_CARDS,
    SHEET_DIAGRAM_GROUP_MEMBERS,
)

# Roles a synthetic (auto-created) user may take. Anything else falls back to
# ``member`` so an export from a customised role set can't grant elevated
# access on the target.
_SAFE_SYNTHETIC_ROLE = "member"


@dataclass
class SectionResult:
    sheet: str
    created: int = 0
    updated: int = 0
    skipped: int = 0
    conflict: int = 0
    failed: int = 0
    errors: list[str] = field(default_factory=list)
    # Reason-keyed skip counters (e.g. {"identical": 30}). Keys are stable
    # snake_case identifiers translated client-side; a skip is almost always
    # "already present on this instance — no action needed".
    skip_reasons: dict[str, int] = field(default_factory=dict)
    # What translating the ids inside this section's blobs did (#1246):
    # remapped / relinked_by_name / unresolved / ambiguous / … / healed.
    references: dict[str, int] = field(default_factory=dict)
    # How many of ``errors`` are reference notes (a diagram card the name
    # fallback could not place). Capped so they cannot crowd out a row failure.
    reference_notes: int = field(default=0, repr=False)

    def skip(self, reason: str = "already_present") -> None:
        self.skipped += 1
        self.skip_reasons[reason] = self.skip_reasons.get(reason, 0) + 1

    def note_references(self, tally: rm.RewriteTally, *, healed: bool = False) -> None:
        """Fold one row's rewrite into the section. A healed row — an earlier
        import's row whose stale ids were rewritten in place — counts as an
        update and is named as such."""
        for key, n in tally.counts.items():
            self.references[key] = self.references.get(key, 0) + n
        room = rm.MAX_MESSAGES - self.reference_notes
        if room > 0 and tally.messages:
            self.errors.extend(tally.messages[:room])
            self.reference_notes += min(room, len(tally.messages))
        if healed:
            self.updated += 1
            self.references["healed"] = self.references.get("healed", 0) + 1

    def as_dict(self) -> dict[str, Any]:
        return {
            "sheet": self.sheet,
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "conflict": self.conflict,
            "failed": self.failed,
            "errors": self.errors[:50],
            "errors_total": len(self.errors),
            "skip_reasons": dict(self.skip_reasons),
            "references": dict(self.references),
        }


@dataclass
class ApplyResult:
    dry_run: bool
    sections: list[SectionResult] = field(default_factory=list)

    @property
    def total_failed(self) -> int:
        return sum(s.failed for s in self.sections)

    @property
    def total_conflict(self) -> int:
        return sum(s.conflict for s in self.sections)

    def as_dict(self) -> dict[str, Any]:
        return {
            "dry_run": self.dry_run,
            "sections": [s.as_dict() for s in self.sections],
            "totals": {
                "created": sum(s.created for s in self.sections),
                "updated": sum(s.updated for s in self.sections),
                "skipped": sum(s.skipped for s in self.sections),
                "conflict": self.total_conflict,
                "failed": self.total_failed,
            },
        }


def _coerce(row: dict[str, Any], columns: tuple[str, ...], json_cols: frozenset[str]) -> dict:
    """Coerce one sheet row into column values.

    A column the sheet does not carry is left out of the result entirely,
    rather than coerced to None. "This bundle has nothing to say about the
    column" is not the same statement as "set this column to NULL": a bundle
    written before the column existed, or a hand-authored content pack that
    lists only the columns it cares about, must not blank it — and for a
    NOT NULL column with a default, writing None fails the insert outright.
    An empty *cell* in a column the sheet does declare still clears the value,
    so exports keep their ability to blank a field.
    """
    out: dict[str, Any] = {}
    for col in columns:
        if col not in row:
            continue
        out[col] = from_cell(row[col], is_json=col in json_cols)
    return out


def _update_if_changed(current: Any, data: dict[str, Any], cols, sr: SectionResult) -> None:
    """Write only the columns that actually differ. Counts the row as
    ``updated`` when something changed and ``skipped`` when it's identical, so
    re-importing an unchanged export into the same instance is a true no-op."""
    # A column the bundle does not carry is left alone — see _coerce.
    changed = [c for c in cols if c in data and getattr(current, c) != data[c]]
    for col in changed:
        setattr(current, col, data[col])
    if changed:
        sr.updated += 1
    else:
        sr.skip("identical")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def apply_bundle(db: AsyncSession, bundle: WorkspaceBundle, user: User) -> ApplyResult:
    return await _run(db, bundle, user, dry_run=False)


async def diff_bundle(db: AsyncSession, bundle: WorkspaceBundle, user: User) -> ApplyResult:
    return await _run(db, bundle, user, dry_run=True)


async def apply_selected(
    db: AsyncSession,
    bundle: WorkspaceBundle,
    user: User,
    *,
    sheets: set[str],
    dry_run: bool,
) -> ApplyResult:
    """Run the apply engine over a subset of sheets.

    Public facade for callers outside workspace transfer (the Extension
    Store's content packs) that reuse the idempotent upsert engine —
    built-in protection, topo-sorted cards, dry-run via savepoint — over an in-memory
    :class:`WorkspaceBundle` carrying only the listed sheets.
    """
    return await _run(db, bundle, user, dry_run=dry_run, sheets=sheets)


async def _run(
    db: AsyncSession,
    bundle: WorkspaceBundle,
    user: User,
    *,
    dry_run: bool,
    sheets: set[str] | None = None,
) -> ApplyResult:
    result = ApplyResult(dry_run=dry_run)

    # Mirror the proven bulk-create dry-run pattern: ONE savepoint for the whole
    # preview, rolled back at the end. The real apply runs flat in the caller's
    # transaction and commits once. Either way every section runs in the SAME
    # transaction scope, so cards created in the cards pass are visible to the
    # relations/tags passes (a per-section savepoint that releases mid-run would
    # break that visibility under the test harness's savepoint-restart fixture).
    root = await db.begin_nested() if dry_run else None

    def _wanted(sheet: str) -> bool:
        return sheets is None or sheet in sheets

    # Source-instance id → target id for every card, relation and tag the core
    # passes create or match, so the entity sections can translate the ids
    # their blobs hold (#1246).
    id_map = rm.IdMap()

    sections = [
        (schema.SHEET_CARD_TYPES, _apply_card_types),
        (schema.SHEET_RELATION_TYPES, _apply_relation_types),
        *((sec.sheet, _make_config_applier(sec)) for sec in schema.CONFIG_SECTIONS),
        (schema.SHEET_TAG_GROUPS, _apply_tag_groups),
        (schema.SHEET_TAGS, functools.partial(_apply_tags, id_map=id_map)),
        (schema.SHEET_USERS, _apply_users),
        (schema.SHEET_SETTINGS, _apply_settings),
        (schema.SHEET_CARDS, _make_cards_applier(user, id_map)),
        (schema.SHEET_CARD_TAGS, functools.partial(_apply_card_tags, id_map=id_map)),
        (schema.SHEET_RELATIONS, functools.partial(_apply_relations, id_map=id_map)),
    ]

    try:
        for sheet, applier in sections:
            if not _wanted(sheet):
                continue
            sr = SectionResult(sheet=sheet)
            result.sections.append(sr)
            await applier(db, bundle, sr, dry_run)

        # --- Generic entity sections (module + card-context tables) -----
        # Built after the cards pass so every card FK resolves. Cards never
        # preserve UUIDs; module rows do, so intra-module FKs copy verbatim.
        wanted_entity_sections = [ent for ent in ENTITY_SECTIONS if _wanted(ent.sheet)]
        needs_resolver = bool(wanted_entity_sections) or _wanted(SHEET_DIAGRAM_CARDS)
        # Only these sections read the card resolver and the email map, so
        # nothing is loaded for a run that applies none of them.
        if needs_resolver or _wanted(SHEET_BOOKMARK_SHARES):
            ent_resolver, email_to_id = await _load_entity_context(db)
        remap_ctx = None
        if wanted_entity_sections:
            remap_ctx = await _load_remap_context(
                db, bundle, id_map, ent_resolver, wanted_entity_sections
            )
        for ent in wanted_entity_sections:
            sr = SectionResult(sheet=ent.sheet)
            result.sections.append(sr)
            await apply_entity_section(db, ent, bundle, sr, ent_resolver, email_to_id, remap_ctx)

        if _wanted(SHEET_DIAGRAM_CARDS):
            sr = SectionResult(sheet=SHEET_DIAGRAM_CARDS)
            result.sections.append(sr)
            await _apply_diagram_cards(db, bundle, sr, ent_resolver, id_map)

        if _wanted(SHEET_DIAGRAM_GROUP_MEMBERS):
            sr = SectionResult(sheet=SHEET_DIAGRAM_GROUP_MEMBERS)
            result.sections.append(sr)
            await _apply_diagram_group_members(db, bundle, sr)

        if _wanted(SHEET_BOOKMARK_SHARES):
            sr = SectionResult(sheet=SHEET_BOOKMARK_SHARES)
            result.sections.append(sr)
            await _apply_bookmark_shares(db, bundle, sr, email_to_id)

        # --- Final calculation + data-quality pass --------------------------
        # Re-run calculated fields and rescore every active card, now that
        # tags, relations, stakeholders, and PPM data are all in place.
        # Running during the cards pass would evaluate relation-dependent
        # formulas against an empty landscape (clobbering exported values) and
        # score the relation/tag/stakeholder buckets as unfilled. Covering ALL
        # cards (not just imported ones) also heals rows mis-scored by earlier
        # importer versions. Runs in dry-run too (the savepoint rolls it back)
        # so a preview exercises the same code path as an apply. Skipped for
        # selective runs that touch no card-affecting sheet.
        if sheets is None or sheets & {
            schema.SHEET_CARDS,
            schema.SHEET_CARD_TAGS,
            schema.SHEET_RELATIONS,
            schema.SHEET_CALCULATIONS,
        }:
            await _finalize_cards(db)
    finally:
        if root is not None:
            await root.rollback()

    if not dry_run:
        from app.services.permission_service import PermissionService

        await db.commit()
        # An import can rewrite roles and card types, both of which the
        # permission checks read through a per-process cache. Drop them so the
        # imported RBAC takes effect immediately rather than up to a TTL later.
        PermissionService.invalidate_role_cache()
        PermissionService.invalidate_srd_cache()
        PermissionService.invalidate_type_permission_cache()
    return result


async def _load_entity_context(db) -> tuple[CardResolver, dict[str, uuid.UUID]]:
    """The card resolver and email → user id map the entity sections share."""
    all_types = {str(k) for (k,) in (await db.execute(select(CardType.key))).all()}
    resolver = await CardResolver.load(db, all_types)
    users = (await db.execute(select(User))).scalars().all()
    return resolver, {u.email.lower(): u.id for u in users}


def _card_end(
    ids: rm.IdMap, resolver: CardResolver, ctype: Any, cref: Any, source_card_id: Any
) -> uuid.UUID | None:
    """The card a row names: by its id on the source first — exact, and the only
    way to reach an archived card, which the reference resolver never sees —
    then by reference."""
    mapped = ids.lookup(rm.CARDS, source_card_id)
    if mapped is not None:
        return uuid.UUID(mapped)
    if not ctype or not cref:
        return None
    res = resolver.resolve(str(ctype), str(cref))
    return res.card_id if res.status == "resolved" else None


def _relation_key(
    row: dict[str, Any], ids: rm.IdMap, resolver: CardResolver, rt_by_key: dict[str, Any]
) -> tuple[str, uuid.UUID, uuid.UUID] | None:
    """``(type, source_id, target_id)`` for a Relations row, in the relation
    type's direction — the one rule both the relations pass and the id-map
    backfill resolve an end by. None when an end cannot be found."""
    rtype = row.get("type")
    source_type, source_ref, target_type, target_ref = (
        row.get(k) for k in ("source_type", "source_ref", "target_type", "target_ref")
    )
    if not rtype or not all((source_type, source_ref, target_type, target_ref)):
        return None
    s_id = _card_end(ids, resolver, source_type, source_ref, row.get("source_card_id"))
    t_id = _card_end(ids, resolver, target_type, target_ref, row.get("target_card_id"))
    if s_id is None or t_id is None:
        return None
    # A bundle from an instance that still held a relation stored the other
    # way round lands in the relation type's direction here (#1140).
    source_id, target_id = oriented(
        rt_by_key.get(str(rtype)), s_id, t_id, str(source_type), str(target_type)
    )
    return str(rtype), source_id, target_id


def _card_row_ref(row: dict[str, Any]) -> str:
    return schema.build_ref_string(
        schema.split_escaped_path(row.get("parent_path") or ""), str(row.get("name") or "")
    )


async def _load_remap_context(
    db,
    bundle: WorkspaceBundle,
    id_map: rm.IdMap,
    resolver: CardResolver,
    wanted_sections,
) -> rm.RemapContext:
    """Everything the entity sections' blob rewriters consult (#1246).

    The core passes already recorded what they created or matched; this fills
    in what a run did not apply (a selective run over module sheets only) by
    resolving each bundle row's natural key, and — for a bundle written before
    ``source_id`` existed — builds the indexes the diagram name fallback reads.
    """
    ctx = rm.RemapContext(ids=id_map)
    card_rows = bundle.rows(schema.SHEET_CARDS)
    sheets = {sec.sheet for sec in wanted_sections}
    wants_diagrams = "Diagrams" in sheets

    def _resolve(ctype: str, ref: str) -> uuid.UUID | None:
        res = resolver.resolve(ctype, ref)
        return res.card_id if res.status == "resolved" else None

    rm.backfill(
        card_rows,
        id_map,
        rm.CARDS,
        lambda row: _resolve(str(row.get("type") or ""), _card_row_ref(row)),
    )

    tag_rows = bundle.rows(schema.SHEET_TAGS)
    if any(rm.canonical_uuid(r.get(schema.SOURCE_ID_COLUMN)) for r in tag_rows):
        group_name = {g.id: g.name for g in (await db.execute(select(TagGroup))).scalars().all()}
        tag_index = {
            (group_name.get(t.tag_group_id), t.name): t.id
            for t in (await db.execute(select(Tag))).scalars().all()
        }
        rm.backfill(
            tag_rows,
            id_map,
            rm.TAGS,
            lambda row: tag_index.get((row.get("group_name"), row.get("name"))),
        )

    ctx.legacy = not rm.bundle_carries_source_ids(card_rows)
    if ctx.legacy and "ProcessElements" in sheets:
        rm.harvest_legacy_process_refs(bundle.rows("ProcessElements"), id_map, _resolve)

    # Relation ids only live in diagram XML, so nothing else needs them.
    if not wants_diagrams:
        return ctx
    rt_by_key = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars().all()}
    rel_rows = (
        await db.execute(select(Relation.type, Relation.source_id, Relation.target_id, Relation.id))
    ).all()
    ctx.relations_by_ends = {
        (rel.type, str(rel.source_id), str(rel.target_id)): str(rel.id) for rel in rel_rows
    }

    def _resolve_relation(row: dict[str, Any]) -> uuid.UUID | None:
        key = _relation_key(row, id_map, resolver, rt_by_key)
        if key is None:
            return None
        rel_id = ctx.relations_by_ends.get((key[0], str(key[1]), str(key[2])))
        return uuid.UUID(rel_id) if rel_id else None

    rm.backfill(bundle.rows(schema.SHEET_RELATIONS), id_map, rm.RELATIONS, _resolve_relation)

    if ctx.legacy:
        cards = (await db.execute(select(Card.id, Card.type, Card.name, Card.status))).all()
        ctx.live_card_ids = {str(c.id) for c in cards}
        for c in cards:
            if c.status == "ACTIVE":
                key = (c.type, (c.name or "").strip().lower())
                ctx.cards_by_type_name.setdefault(key, []).append(str(c.id))
        for row in bundle.rows(SHEET_DIAGRAM_CARDS):
            found = _card_end(
                id_map, resolver, row.get("card_type"), row.get("card_ref"), row.get("card_id")
            )
            if found is not None and row.get("diagram_id"):
                hints = ctx.diagram_card_hints.setdefault(str(row["diagram_id"]).lower(), set())
                hints.add(str(found))
    return ctx


async def _apply_diagram_cards(
    db, bundle: WorkspaceBundle, sr: SectionResult, resolver, id_map: rm.IdMap | None = None
) -> None:
    """Bespoke Diagram↔Card association (preserved diagram_id + resolved card)."""
    ids = id_map if id_map is not None else rm.IdMap()
    rows = bundle.rows(SHEET_DIAGRAM_CARDS)
    if not rows:
        return
    existing = {(r.diagram_id, r.card_id) for r in (await db.execute(select(diagram_cards))).all()}
    existing_diagrams = set((await db.execute(select(Diagram.id))).scalars().all())
    for row in rows:
        diagram_id = row.get("diagram_id")
        ctype = row.get("card_type")
        cref = row.get("card_ref")
        if not diagram_id or not ctype or not cref:
            sr.failed += 1
            continue
        diag_uuid = uuid.UUID(str(diagram_id))
        card_id = _card_end(ids, resolver, ctype, cref, row.get("card_id"))
        if diag_uuid not in existing_diagrams or card_id is None:
            sr.conflict += 1
            continue
        pair = (diag_uuid, card_id)
        if pair in existing:
            sr.skip("already_present")
            continue
        await db.execute(diagram_cards.insert().values(diagram_id=diag_uuid, card_id=card_id))
        existing.add(pair)
        sr.created += 1


async def _apply_diagram_group_members(db, bundle: WorkspaceBundle, sr: SectionResult) -> None:
    """Bespoke Diagram↔Group membership — both PKs are preserved on import."""
    rows = bundle.rows(SHEET_DIAGRAM_GROUP_MEMBERS)
    if not rows:
        return
    existing = {
        (r.diagram_id, r.group_id) for r in (await db.execute(select(diagram_group_members))).all()
    }
    existing_diagrams = set((await db.execute(select(Diagram.id))).scalars().all())
    existing_groups = set((await db.execute(select(DiagramGroup.id))).scalars().all())
    for row in rows:
        diagram_id = row.get("diagram_id")
        group_id = row.get("group_id")
        if not diagram_id or not group_id:
            sr.failed += 1
            continue
        diag_uuid = uuid.UUID(str(diagram_id))
        grp_uuid = uuid.UUID(str(group_id))
        if diag_uuid not in existing_diagrams or grp_uuid not in existing_groups:
            sr.conflict += 1
            continue
        pair = (diag_uuid, grp_uuid)
        if pair in existing:
            sr.skip("already_present")
            continue
        await db.execute(
            diagram_group_members.insert().values(diagram_id=diag_uuid, group_id=grp_uuid)
        )
        existing.add(pair)
        sr.created += 1


async def _apply_bookmark_shares(
    db, bundle: WorkspaceBundle, sr: SectionResult, email_to_id: dict[str, Any]
) -> None:
    """Bespoke Bookmark↔User share — preserved bookmark PK + email-matched user."""
    rows = bundle.rows(SHEET_BOOKMARK_SHARES)
    if not rows:
        return
    existing = {
        (r.bookmark_id, r.user_id) for r in (await db.execute(select(bookmark_shares))).all()
    }
    existing_bookmarks = set((await db.execute(select(Bookmark.id))).scalars().all())
    for row in rows:
        bookmark_id = row.get("bookmark_id")
        email = row.get("user_email")
        if not bookmark_id or not email:
            sr.failed += 1
            continue
        bm_uuid = uuid.UUID(str(bookmark_id))
        user_id = email_to_id.get(str(email).lower())
        if bm_uuid not in existing_bookmarks or user_id is None:
            sr.conflict += 1
            sr.errors.append(
                f"bookmark share: bookmark {bookmark_id!r} or user {email!r} not found — skipped"
            )
            continue
        pair = (bm_uuid, user_id)
        if pair in existing:
            sr.skip("already_present")
            continue
        await db.execute(
            bookmark_shares.insert().values(
                bookmark_id=bm_uuid, user_id=user_id, can_edit=bool(row.get("can_edit"))
            )
        )
        existing.add(pair)
        sr.created += 1


# ---------------------------------------------------------------------------
# Metamodel
# ---------------------------------------------------------------------------


async def _apply_card_types(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
    existing = {ct.key: ct for ct in (await db.execute(select(CardType))).scalars().all()}
    for row in bundle.rows(schema.SHEET_CARD_TYPES):
        data = _coerce(row, exp.CARD_TYPE_COLUMNS, exp.CARD_TYPE_JSON)
        # NOT NULL JSONB columns: a hand-authored content pack may declare the
        # column and leave the cell blank, which `from_cell` reads as None and
        # the insert would reject. An absent column is still left alone (see
        # `_coerce`) — this only normalises a declared-but-empty cell.
        for not_null_json in ("reference_config", "role_permissions", "translations"):
            if not_null_json in data and data[not_null_json] is None:
                data[not_null_json] = {}
        key = data.get("key")
        if not key:
            sr.failed += 1
            continue
        current = existing.get(key)
        if current is None:
            ct = CardType(**{k: v for k, v in data.items()})
            db.add(ct)
            existing[key] = ct
            sr.created += 1
        else:
            # Never flip a built-in type's identity; merge mutable schema only.
            # (The row was matched by key, so the key itself never differs.)
            cols = [c for c in exp.CARD_TYPE_COLUMNS if c != "built_in"]
            _update_if_changed(current, data, cols, sr)
    await db.flush()


async def _apply_relation_types(
    db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool
) -> None:
    existing = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars().all()}
    # Relation types are keyed by ``key`` alone. Any number of them may share an
    # ordered (source, target) pair — the bundle is applied as authored, matching
    # what the API (metamodel.py) and the platform-migration importer accept.
    for row in bundle.rows(schema.SHEET_RELATION_TYPES):
        data = _coerce(row, exp.RELATION_TYPE_COLUMNS, exp.RELATION_TYPE_JSON)
        key = data.get("key")
        if not key:
            sr.failed += 1
            continue
        current = existing.get(key)
        if current is None:
            rt = RelationType(**{k: v for k, v in data.items()})
            db.add(rt)
            existing[key] = rt
            sr.created += 1
        else:
            # Matched by key, so only the built-in flag needs keeping out.
            cols = [c for c in exp.RELATION_TYPE_COLUMNS if c != "built_in"]
            _update_if_changed(current, data, cols, sr)
    await db.flush()


# ---------------------------------------------------------------------------
# Declarative config sections
# ---------------------------------------------------------------------------


def _make_config_applier(sec: schema.ConfigSection):
    async def _apply(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
        existing_rows = (await db.execute(select(sec.model))).scalars().all()
        index: dict[tuple, Any] = {
            tuple(getattr(r, k) for k in sec.natural_key): r for r in existing_rows
        }
        for row in bundle.rows(sec.sheet):
            data = _coerce(row, sec.columns, sec.json_columns)
            # A bundle exported from an install that predates the permission
            # renames carries keys the validators would reject. This path writes
            # straight onto the model, bypassing Pydantic entirely, so without
            # this an old bundle would silently re-poison a repaired instance
            # and break its role editor — the very bug 140 exists to fix, only
            # reintroduced through the back door and with no migration watching.
            #
            # The two tiers are normalised differently on purpose: dead
            # card-level keys are dropped (they grant nothing), while app-level
            # keys are renamed onto the permissions they still mean, so an
            # import never silently revokes access a role actually had.
            if "permissions" in data:
                if sec.model is StakeholderRoleDefinition:
                    data["permissions"] = strip_legacy_card_permissions(data["permissions"])
                elif sec.model is Role:
                    data["permissions"] = migrate_legacy_app_permissions(data["permissions"])
            nk = tuple(data.get(k) for k in sec.natural_key)
            if any(part is None for part in nk):
                sr.failed += 1
                continue
            current = index.get(nk)
            if current is None:
                obj = sec.model(**{k: v for k, v in data.items()})
                db.add(obj)
                index[nk] = obj
                sr.created += 1
            else:
                cols = [c for c in sec.columns if c not in sec.natural_key]
                _update_if_changed(current, data, cols, sr)
        await db.flush()

    return _apply


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


async def _apply_tag_groups(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
    existing = {g.name: g for g in (await db.execute(select(TagGroup))).scalars().all()}
    for row in bundle.rows(schema.SHEET_TAG_GROUPS):
        data = _coerce(row, exp.TAG_GROUP_COLUMNS, exp.TAG_GROUP_JSON)
        name = data.get("name")
        if not name:
            sr.failed += 1
            continue
        current = existing.get(name)
        if current is None:
            g = TagGroup(**{k: v for k, v in data.items()})
            db.add(g)
            existing[name] = g
            sr.created += 1
        else:
            # Matched by name, so the name itself never differs.
            _update_if_changed(current, data, exp.TAG_GROUP_COLUMNS, sr)
    await db.flush()


async def _apply_tags(
    db,
    bundle: WorkspaceBundle,
    sr: SectionResult,
    dry_run: bool,
    *,
    id_map: rm.IdMap | None = None,
) -> None:
    ids = id_map if id_map is not None else rm.IdMap()
    groups = {g.name: g for g in (await db.execute(select(TagGroup))).scalars().all()}
    existing = {
        (t.tag_group_id, t.name): t for t in (await db.execute(select(Tag))).scalars().all()
    }
    for row in bundle.rows(schema.SHEET_TAGS):
        group_name = row.get("group_name")
        name = row.get("name")
        group = groups.get(group_name)
        if group is None or not name:
            sr.conflict += 1
            sr.errors.append(f"tag {name!r}: group {group_name!r} not found — skipped")
            continue
        nk = (group.id, name)
        current = existing.get(nk)
        source_id = row.get(schema.SOURCE_ID_COLUMN)
        if current is None:
            tag = Tag(
                id=uuid.uuid4(),
                tag_group_id=group.id,
                name=name,
                description=row.get("description"),
                color=row.get("color"),
                sort_order=row.get("sort_order") or 0,
            )
            db.add(tag)
            existing[nk] = tag
            ids.record(rm.TAGS, source_id, tag.id)
            sr.created += 1
        else:
            ids.record(rm.TAGS, source_id, current.id)
            new_desc = row.get("description")
            new_color = row.get("color")
            new_order = row.get("sort_order") or 0
            if (
                current.color != new_color
                or current.sort_order != new_order
                or current.description != new_desc
            ):
                current.description = new_desc
                current.color = new_color
                current.sort_order = new_order
                sr.updated += 1
            else:
                sr.skip("identical")
    await db.flush()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------


async def _apply_users(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
    valid_roles = {r for (r,) in (await db.execute(select(Role.key))).all()}
    existing = {u.email.lower() for u in (await db.execute(select(User))).scalars().all()}
    for row in bundle.rows(schema.SHEET_USERS):
        email = (row.get("email") or "").strip()
        if not email:
            sr.failed += 1
            continue
        if email.lower() in existing:
            sr.skip("user_exists")
            continue
        role = row.get("role")
        if role not in valid_roles:
            role = _SAFE_SYNTHETIC_ROLE
        user = User(
            email=email,
            display_name=row.get("display_name") or email,
            role=role,
            is_active=False,  # synthetic users land deactivated; admin enables them
            auth_provider=row.get("auth_provider") or "local",
            locale=row.get("locale") or "en",
        )
        db.add(user)
        existing.add(email.lower())
        sr.created += 1
    await db.flush()


# ---------------------------------------------------------------------------
# Settings (secrets never written; target's existing secrets preserved)
# ---------------------------------------------------------------------------


async def _apply_settings(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
    row_obj = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    if row_obj is None:
        row_obj = AppSettings()  # the singleton: its id and both blobs take their defaults
        db.add(row_obj)

    # The exporter serialises every Settings ``value`` cell as JSON (dicts for
    # general/email, plain strings for the MIME types), so parse them all the
    # same way.
    incoming: dict[str, Any] = {}
    for row in bundle.rows(schema.SHEET_SETTINGS):
        key = row.get("key")
        if key:
            incoming[key] = from_cell(row.get("value"), is_json=True)

    # Every secret goes before the merge — the exporter's own definition, so a
    # hand-edited bundle cannot plant a credential in plain text or another
    # instance's undecryptable ``enc:`` token. The target keeps its own.
    if "general_settings" in incoming and isinstance(incoming["general_settings"], dict):
        general = dict(row_obj.general_settings or {})
        clean_general, _ = strip_secrets(incoming["general_settings"], None)
        merged = _merge_settings(general, clean_general, GENERAL_SECRET_PATHS)
        if merged != (row_obj.general_settings or {}):
            row_obj.general_settings = merged
            sr.updated += 1
        else:
            sr.skip("identical")
    if "email_settings" in incoming and isinstance(incoming["email_settings"], dict):
        email = dict(row_obj.email_settings or {})
        _, clean_email = strip_secrets(None, incoming["email_settings"])
        merged_email = _merge_settings(email, clean_email, EMAIL_SECRET_PATHS)
        if merged_email != (row_obj.email_settings or {}):
            row_obj.email_settings = merged_email
            sr.updated += 1
            # Mirror the imported settings into the runtime singleton so the
            # new method/transport takes effect without a restart.
            apply_email_settings_to_runtime(merged_email)
        else:
            sr.skip("identical")
    if incoming.get("custom_logo_mime"):
        row_obj.custom_logo_mime = incoming["custom_logo_mime"]
    if incoming.get("custom_favicon_mime"):
        row_obj.custom_favicon_mime = incoming["custom_favicon_mime"]
    # Branding binaries live in assets/branding/logo.<ext> / favicon.<ext>.
    logo = _find_asset(bundle, "branding/logo")
    if logo is not None:
        row_obj.custom_logo = logo
    favicon = _find_asset(bundle, "branding/favicon")
    if favicon is not None:
        row_obj.custom_favicon = favicon
    await db.flush()


def _find_asset(bundle: WorkspaceBundle, prefix: str) -> bytes | None:
    """Return the first asset whose path matches ``prefix`` (any extension).

    Iterates names and reads the one match — the store may be lazy, so asking
    for every value here would inflate the whole assets tree.
    """
    for path in bundle.assets.keys():
        if path == prefix or path.startswith(prefix + "."):
            return bundle.assets.get(path)
    return None


def _merge_settings(
    target: dict[str, Any], incoming: dict[str, Any], secret_paths: tuple[tuple[str, ...], ...]
) -> dict[str, Any]:
    """Merge ``incoming`` into ``target``, block by block, never writing a secret path.

    The exporter strips secrets, so a bundle carrying one is hand-edited or
    malicious — an incoming secret leaf is ignored entirely (it would land
    unencrypted), and the target's own value is always preserved. An incoming
    block is merged into the target's, or into an empty one when the target
    has none: copying it whole is how a secret inside it used to get through.
    """
    secret_leaves = {p[0] for p in secret_paths if len(p) == 1}
    merged = dict(target)
    for key, value in incoming.items():
        if key in secret_leaves:
            continue
        if isinstance(value, dict):
            current = merged.get(key)
            sub_secrets = tuple(p[1:] for p in secret_paths if p and p[0] == key)
            merged[key] = _merge_settings(
                current if isinstance(current, dict) else {}, value, sub_secrets
            )
        else:
            merged[key] = value
    return merged


# ---------------------------------------------------------------------------
# Cards (topological create-or-skip)
# ---------------------------------------------------------------------------


async def _finalize_cards(db) -> None:
    """Re-run calculated fields and rescore data quality for every active card.

    Mirrors the live card routes: calculations run with the same PPM-managed
    field exclusions (``costBudget``/``costActual`` when budget/cost lines
    exist — the PPM entity sections have already been applied at this point),
    then the data-quality score is derived from the final attribute state.
    """
    from app.services.calculation_engine import run_calculations_for_card
    from app.services.card_write_service import _get_ppm_exclusions
    from app.services.data_quality import calc_data_quality
    from app.services.derived_writes import derived_maintenance

    ids = list((await db.execute(select(Card.id).where(Card.status != "ARCHIVED"))).scalars().all())
    # Cards the bundle created carry their own `card.created` event; cards the
    # target already had are only being rescored, so this pass must not re-date
    # the whole inventory to the moment of the import.
    with derived_maintenance(db):
        for i in range(0, len(ids), 500):
            chunk = ids[i : i + 500]
            cards = (await db.execute(select(Card).where(Card.id.in_(chunk)))).scalars().all()
            for card in cards:
                ppm_excl = await _get_ppm_exclusions(db, card)
                await run_calculations_for_card(db, card, exclude_fields=ppm_excl)
                score = await calc_data_quality(db, card)
                if card.data_quality != score:
                    card.data_quality = score
        await db.flush()


def _make_cards_applier(user: User, id_map: rm.IdMap | None = None):
    ids = id_map if id_map is not None else rm.IdMap()

    async def _apply(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
        from app.services.card_write_service import (
            _check_hierarchy_depth,
            _sync_hierarchy_levels,
            _validate_url_attributes,
        )
        from app.services.event_bus import event_bus

        rows = bundle.rows(schema.SHEET_CARDS)
        type_keys: set[str] = {str(r["type"]) for r in rows if r.get("type")}
        resolver = await CardResolver.load(db, type_keys)
        # Archived rows match the archived card they already landed as — the
        # ACTIVE-only resolver above cannot see one — by the same path rule.
        archived: CardResolver | None = None
        if any(r.get("status") == "ARCHIVED" for r in rows):
            archived = await CardResolver.load(db, type_keys, status="ARCHIVED")

        # Parents (shorter parent_path) before children — a valid topo order
        # for trees because a child's parent has exactly one fewer segment.
        def depth(r: dict) -> int:
            return len(schema.split_escaped_path(r.get("parent_path") or ""))

        created_refs: dict[tuple[str, str], Any] = {}
        # Every card already here, any status, by id — one query rather than
        # one per row for the source-id match below.
        type_by_id: dict[str, str] = {
            str(cid): ctype for cid, ctype in (await db.execute(select(Card.id, Card.type))).all()
        }

        for row in sorted(rows, key=depth):
            data = _coerce(row, exp.CARD_COLUMNS, exp.CARD_JSON)
            type_key = data.get("type")
            name = data.get("name")
            if not type_key or not name:
                sr.failed += 1
                continue
            parent_path = data.get("parent_path") or ""
            own_ref = _card_row_ref(data)
            external_id = data.get("external_id")
            source_id = row.get(schema.SOURCE_ID_COLUMN)

            # Skip if already present (idempotency): by created this batch, by
            # the card's own id (a re-import into the instance it came from),
            # by external_id, resolvable in the live DB, or — for an archived
            # row, which neither of the last two can see — by the archived card
            # it already landed as. Every match records where the row's id went.
            if (type_key, own_ref) in created_refs:
                ids.record(rm.CARDS, source_id, created_refs[(type_key, own_ref)])
                sr.skip("duplicate_in_bundle")
                continue
            same = _card_by_source_id(type_by_id, type_key, source_id)
            if same is not None:
                ids.record(rm.CARDS, source_id, same)
                sr.skip("already_present")
                continue
            if external_id:
                hit = await _card_by_external_id(db, type_key, external_id)
                if hit:
                    ids.record(rm.CARDS, source_id, hit[0])
                    sr.skip("already_present")
                    continue
            if archived is not None and data.get("status") == "ARCHIVED":
                gone = await _archived_card_match(
                    db, archived, type_key, own_ref, data.get("reference"), external_id
                )
                if gone is not None:
                    ids.record(rm.CARDS, source_id, gone)
                    sr.skip("already_present")
                    continue
            existing = resolver.resolve(type_key, own_ref)
            if existing.status == "resolved":
                ids.record(rm.CARDS, source_id, existing.card_id)
                sr.skip("already_present")
                continue
            if existing.status == "ambiguous":
                sr.skip("ambiguous_match")
                continue

            # Resolve parent.
            resolved_parent = None
            if parent_path.strip():
                if (type_key, parent_path) in created_refs:
                    resolved_parent = created_refs[(type_key, parent_path)]
                else:
                    pres = resolver.resolve(type_key, parent_path)
                    if pres.status == "resolved":
                        resolved_parent = pres.card_id
                    else:
                        sr.conflict += 1
                        sr.errors.append(f"card {name!r}: parent {parent_path!r} not found")
                        continue

            # One savepoint per row, as bulk create does: a row refused after
            # it was added — the depth check reads the flushed card, a value too
            # long for its column fails at flush — must leave nothing behind and
            # must not take the rows after it down with it.
            row_sp = await db.begin_nested()
            try:
                await _validate_url_attributes(db, type_key, data.get("attributes") or {})
                # Carry the human-readable reference verbatim so IDs stay stable
                # across a move/restore. On a unique-index collision, regenerate
                # from the type config (auto/custom) else drop it, keeping the card
                # importable.
                resolved_reference = data.get("reference") or None
                if resolved_reference:
                    clash = (
                        await db.execute(
                            select(exists().where(Card.reference == resolved_reference))
                        )
                    ).scalar()
                    if clash:
                        ct = (
                            await db.execute(select(CardType).where(CardType.key == type_key))
                        ).scalar_one_or_none()
                        mode = card_reference.get_mode(ct) if ct is not None else "off"
                        if mode != "off":
                            cfg = ct.reference_config or {}
                            resolved_reference = await card_reference.next_reference_for_prefix(
                                db,
                                str(cfg.get("prefix") or ""),
                                int(cfg.get("start", card_reference.DEFAULT_START)),
                                int(cfg.get("padding", card_reference.DEFAULT_PADDING)),
                            )
                        else:
                            resolved_reference = None
                card = Card(
                    type=type_key,
                    subtype=data.get("subtype"),
                    name=name,
                    description=data.get("description"),
                    parent_id=resolved_parent,
                    parent_label=(
                        data.get("parent_label") if resolved_parent is not None else None
                    ),
                    lifecycle=data.get("lifecycle") or {},
                    attributes=data.get("attributes") or {},
                    external_id=external_id,
                    reference=resolved_reference,
                    alias=data.get("alias"),
                    status=data.get("status") or "ACTIVE",
                    approval_status=data.get("approval_status") or "DRAFT",
                    created_by=user.id,
                    updated_by=user.id,
                )
                db.add(card)
                await db.flush()
                if card.parent_id:
                    await _check_hierarchy_depth(db, card, card.parent_id)
                await _sync_hierarchy_levels(db, card)
                # Calculations and data_quality run in the final pass, once the
                # card's relations/tags/stakeholders/PPM data have landed too —
                # running them here would evaluate relation-dependent formulas
                # against an empty landscape and clobber the exported values.
                if not dry_run:
                    await event_bus.publish(
                        "card.created",
                        {"id": str(card.id), "type": card.type, "name": card.name},
                        db=db,
                        card_id=card.id,
                        user_id=user.id,
                    )
            except Exception as exc:  # noqa: BLE001
                await row_sp.rollback()
                sr.failed += 1
                sr.errors.append(f"card {name!r}: {exc}")
            else:
                await row_sp.commit()
                created_refs[(type_key, own_ref)] = card.id
                ids.record(rm.CARDS, source_id, card.id)
                sr.created += 1
        await db.flush()

    return _apply


def _card_by_source_id(type_by_id: dict[str, str], type_key: str, source_id: Any) -> str | None:
    """The card that still carries the row's own id, in any status.

    Card ids are random, so this only ever hits when a bundle is re-imported
    into the instance it was exported from — where it is literally the same
    card. It is what keeps such a re-import a no-op for archived cards, which
    every other matcher deliberately ignores.
    """
    key = rm.canonical_uuid(source_id)
    if key is None or type_by_id.get(key) != type_key:
        return None
    return key


async def _archived_card_match(
    db,
    archived: CardResolver,
    type_key: str,
    own_ref: str,
    reference: Any,
    external_id: Any,
) -> uuid.UUID | None:
    """The archived card an archived row already landed as on this instance.

    Resolved by type + hierarchy path exactly like an active row; several
    archived cards on the same path are told apart by the row's reference or
    external id. Without it every re-import of a bundle that includes archived
    cards created each of them again. Only an archived row reaches this, so an
    archived card never absorbs an active row — that rule stays with
    ``_card_by_external_id``.
    """
    res = archived.resolve(type_key, own_ref)
    if res.status == "resolved":
        return res.card_id
    if res.status != "ambiguous" or not res.candidates:
        return None
    candidate_ids = [c.id for c in res.candidates]
    keys = []
    if reference:
        keys.append(Card.reference == str(reference))
    if external_id:
        keys.append(Card.external_id == str(external_id))
    if not keys:
        return None
    found = (
        await db.execute(
            select(Card.id)
            .where(Card.id.in_(candidate_ids), or_(*keys))
            .order_by(Card.created_at, Card.id)
        )
    ).first()
    return uuid.UUID(str(found[0])) if found else None


async def _card_by_external_id(db, type_key: str, external_id: str):
    return (
        await db.execute(
            select(Card.id).where(
                Card.type == type_key,
                Card.external_id == external_id,
                Card.status != "ARCHIVED",
            )
        )
    ).first()


# ---------------------------------------------------------------------------
# Card tags + relations (resolved against cards created in the cards pass)
# ---------------------------------------------------------------------------


async def _apply_card_tags(
    db,
    bundle: WorkspaceBundle,
    sr: SectionResult,
    dry_run: bool,
    *,
    id_map: rm.IdMap | None = None,
) -> None:
    ids = id_map if id_map is not None else rm.IdMap()
    rows = bundle.rows(schema.SHEET_CARD_TAGS)
    type_keys: set[str] = {str(r["card_type"]) for r in rows if r.get("card_type")}
    resolver = await CardResolver.load(db, type_keys)
    groups = {g.name: g for g in (await db.execute(select(TagGroup))).scalars().all()}
    tags = (await db.execute(select(Tag))).scalars().all()
    tag_index = {(t.tag_group_id, t.name): t for t in tags}
    existing_links = {
        (ct.card_id, ct.tag_id) for ct in (await db.execute(select(CardTag))).scalars().all()
    }
    for row in rows:
        ctype = row.get("card_type")
        cref = row.get("card_ref")
        group = groups.get(row.get("group_name"))
        if not ctype or not cref or group is None:
            sr.conflict += 1
            sr.errors.append(
                f"card tag {row.get('tag_name')!r}: group {row.get('group_name')!r} "
                f"or card ref missing — skipped"
            )
            continue
        tag = tag_index.get((group.id, row.get("tag_name")))
        card_id = _card_end(ids, resolver, ctype, cref, row.get("card_id"))
        if tag is None or card_id is None:
            sr.conflict += 1
            sr.errors.append(
                f"card tag {row.get('tag_name')!r}: tag or card {cref!r} unresolved — skipped"
            )
            continue
        link = (card_id, tag.id)
        if link in existing_links:
            sr.skip("already_present")
            continue
        db.add(CardTag(card_id=card_id, tag_id=tag.id))
        existing_links.add(link)
        sr.created += 1
    await db.flush()


async def _apply_relations(
    db,
    bundle: WorkspaceBundle,
    sr: SectionResult,
    dry_run: bool,
    *,
    id_map: rm.IdMap | None = None,
) -> None:
    ids = id_map if id_map is not None else rm.IdMap()
    rows = bundle.rows(schema.SHEET_RELATIONS)
    type_keys: set[str] = set()
    for r in rows:
        if r.get("source_type"):
            type_keys.add(r["source_type"])
        if r.get("target_type"):
            type_keys.add(r["target_type"])
    resolver = await CardResolver.load(db, type_keys)
    rt_by_key = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars().all()}
    existing = {
        (rel.type, rel.source_id, rel.target_id): rel.id
        for rel in (await db.execute(select(Relation))).scalars().all()
    }

    for row in rows:
        data = _coerce(row, exp.RELATION_COLUMNS, exp.RELATION_JSON)
        resolved = _relation_key({**row, **data}, ids, resolver, rt_by_key)
        if resolved is None:
            sr.conflict += 1
            sr.errors.append(
                f"relation {data.get('type')!r}: endpoint(s) unresolved "
                f"({data.get('source_ref')!r} -> {data.get('target_ref')!r})"
            )
            continue
        rtype, source_id, target_id = resolved
        key = (rtype, source_id, target_id)
        if key in existing:
            ids.record(rm.RELATIONS, row.get(schema.SOURCE_ID_COLUMN), existing[key])
            sr.skip("already_present")
            continue
        relation = Relation(
            id=uuid.uuid4(),
            type=rtype,
            source_id=source_id,
            target_id=target_id,
            description=data.get("description"),
            attributes=data.get("attributes") or {},
        )
        db.add(relation)
        existing[key] = relation.id
        ids.record(rm.RELATIONS, row.get(schema.SOURCE_ID_COLUMN), relation.id)
        sr.created += 1
    await db.flush()
