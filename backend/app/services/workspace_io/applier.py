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
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timezone
from typing import Any, cast

from sqlalchemy import exists, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    migrate_legacy_app_permissions,
    strip_legacy_card_permissions,
    with_legacy_cost_grant,
)
from app.models.app_settings import AppSettings
from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.models.bookmark import Bookmark, bookmark_shares
from app.models.card import Card
from app.models.card_type import CardType
from app.models.card_type_category import CardTypeCategory
from app.models.diagram import Diagram, diagram_cards
from app.models.diagram_group import DiagramGroup, diagram_group_members
from app.models.license_metric import LicenseMetric
from app.models.license_type import LicenseType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.schemas.licenses import (
    LicenseMetricCreate,
    LicenseMetricUpdate,
    LicenseTypeCreate,
    LicenseTypeUpdate,
)
from app.services import card_reference, card_type_categories, decision_links_legacy
from app.services.bo_relationship_constants import (
    APPLICATION_RELATION,
    APPLICATION_TYPE,
    BO_RELATIONSHIP_KIND,
    BO_TYPE,
    ER_RELATION,
    MASTER,
    OWNERSHIP_KEY,
)
from app.services.card_resolver import CardResolver
from app.services.card_write_service import lock_bo_relation_writes
from app.services.email_backends.runtime import apply_email_settings_to_runtime
from app.services.licensing_migration import LICENSING_TYPES, MODEL_KEY, without_model_field
from app.services.principle_service import ensure_principle_references
from app.services.relation_orientation import oriented
from app.services.workspace_io import exporter as exp
from app.services.workspace_io import license_compat, schema
from app.services.workspace_io import remap as rm
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
    """Apply every sheet. Changes ``bundle``: its ``CardLicenses`` rows are replaced by the
    rows without the cells of an unknown metric or type (``_apply_license_catalogue``)."""
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
    :class:`WorkspaceBundle` carrying only the listed sheets. Changes ``bundle`` like
    :func:`apply_bundle` when ``CardLicenses`` is selected.
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
        # Categories first: the card types name them, and a built-in one on the
        # target must win over whatever the bundle carries.
        (schema.SHEET_CARD_TYPE_CATEGORIES, _apply_card_type_categories),
        (schema.SHEET_CARD_TYPES, _apply_card_types),
        (schema.SHEET_RELATION_TYPES, _apply_relation_types),
        *(
            (sec.sheet, _make_config_applier(sec))
            for sec in schema.CONFIG_SECTIONS
            if sec.sheet not in _BESPOKE_CONFIG_SHEETS
        ),
        (schema.SHEET_TAG_GROUPS, _apply_tag_groups),
        (schema.SHEET_TAGS, functools.partial(_apply_tags, id_map=id_map)),
        (schema.SHEET_USERS, functools.partial(_apply_users, id_map=id_map)),
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
        # The license catalogue also runs for a CardLicenses-only import: it is what drops the
        # cells whose metric or type exists nowhere.
        dropped_license_cells: list[str] = []
        invalid_license_cells: list[str] = []
        if any(_wanted(s) for s in (*_LICENSE_CATALOGUE_SHEETS, SHEET_CARD_LICENSES)):
            dropped_license_cells, invalid_license_cells = await _apply_license_catalogue(
                db, bundle, result, _wanted
            )
        # The Principles sheet does not carry the source's references (each
        # instance numbers its own), so number whatever that section created.
        await ensure_principle_references(db)

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
        # An older bundle's decisions carry ``related_decisions``: note which
        # decisions exist before the entity pass, so only the ones it creates
        # are given their links and dates afterwards.
        adr_ids_before = await _legacy_adr_baseline(db, bundle) if _wanted(SHEET_ADRS) else None
        for ent in wanted_entity_sections:
            sr = SectionResult(sheet=ent.sheet)
            result.sections.append(sr)
            if ent.sheet == SHEET_CARD_LICENSES:
                sr.errors.extend(
                    f"license cell {name}: its metric or type is on neither this instance "
                    "nor in the bundle, skipped"
                    for name in dropped_license_cells
                )
                sr.errors.extend(
                    f"license cell {name}: not a valid license count, skipped"
                    for name in invalid_license_cells
                )
            await apply_entity_section(db, ent, bundle, sr, ent_resolver, email_to_id, remap_ctx)
        if adr_ids_before is not None:
            await _apply_legacy_decisions(db, bundle, result, adr_ids_before)

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
            "CardCosts",
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


SHEET_ADRS = "Adrs"
SHEET_ADR_LINKS = "AdrLinks"


async def _legacy_adr_baseline(db: AsyncSession, bundle: WorkspaceBundle) -> set[uuid.UUID] | None:
    """The decision ids already on this instance, when ``bundle`` is an older
    one whose ``Adrs`` sheet still carries ``related_decisions``; else ``None``."""
    rows = bundle.rows(SHEET_ADRS)
    if not any(decision_links_legacy.LEGACY_COLUMN in row for row in rows):
        return None
    return set((await db.execute(select(ArchitectureDecision.id))).scalars().all())


async def _apply_legacy_decisions(
    db: AsyncSession,
    bundle: WorkspaceBundle,
    result: ApplyResult,
    ids_before: set[uuid.UUID],
) -> None:
    """Bring the decisions an older bundle just created up to the register.

    Each ``related_decisions`` entry that names a decision of the bundle
    becomes a ``relates`` link (``decision_links_legacy.plan_bundle_links``:
    self links, missing targets and pairs already linked are skipped), counted
    as created on the ``AdrLinks`` section; and a signed decision's empty
    ``decided_on`` / ``effective_from`` take the UTC date of ``signed_at``, as
    migration 167 did for the decisions already stored (not counted: those
    rows are counted as created by the ``Adrs`` section). Only decisions this
    import created are touched, so a re-import changes nothing. Runs in the
    dry run too: the preview's savepoint rolls it back.
    """
    present = set((await db.execute(select(ArchitectureDecision.id))).scalars().all())
    created = present - ids_before
    if not created:
        return
    existing = (
        await db.execute(
            select(ArchitectureDecisionLink.source_id, ArchitectureDecisionLink.target_id).where(
                ArchitectureDecisionLink.source_id.in_(created)
            )
        )
    ).all()
    pairs = decision_links_legacy.plan_bundle_links(
        bundle.rows(SHEET_ADRS),
        created_ids=created,
        present_ids=present,
        existing_pairs=[(row[0], row[1]) for row in existing],
    )
    if pairs:
        sr = next((s for s in result.sections if s.sheet == SHEET_ADR_LINKS), None)
        if sr is None:
            sr = SectionResult(sheet=SHEET_ADR_LINKS)
            result.sections.append(sr)
        for source, target in pairs:
            db.add(ArchitectureDecisionLink(source_id=source, target_id=target, kind="relates"))
            sr.created += 1

    signed = (
        (
            await db.execute(
                select(ArchitectureDecision).where(
                    ArchitectureDecision.id.in_(created),
                    ArchitectureDecision.status == "signed",
                    ArchitectureDecision.signed_at.is_not(None),
                )
            )
        )
        .scalars()
        .all()
    )
    for adr in signed:
        signed_on = adr.signed_at.astimezone(timezone.utc).date()
        if adr.decided_on is None:
            adr.decided_on = signed_on
        if adr.effective_from is None:
            adr.effective_from = signed_on
    await db.flush()


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


def _matching_relation(existing: dict, key: tuple):
    """BO ER pairs are unordered; all other relations remain directed."""
    found = existing.get(key)
    if found is None and key[0] == ER_RELATION:
        found = existing.get((key[0], key[2], key[1]))
    return found


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
    wants_bo = wants_diagrams and any(
        row.get("kind") == BO_RELATIONSHIP_KIND for row in bundle.rows("Diagrams")
    )

    def _resolve(ctype: str, ref: str) -> uuid.UUID | None:
        res = resolver.resolve(ctype, ref)
        return res.card_id if res.status == "resolved" else None

    if wants_bo:
        type_by_id = {
            str(cid): ctype for cid, ctype in (await db.execute(select(Card.id, Card.type))).all()
        }
        ctx.card_types = type_by_id
        bo_card_rows = [row for row in card_rows if row.get("type") in (BO_TYPE, APPLICATION_TYPE)]
        archived_types = {
            str(row.get("type")) for row in bo_card_rows if row.get("status") == "ARCHIVED"
        }
        archived = (
            await CardResolver.load(db, archived_types, status="ARCHIVED")
            if archived_types
            else None
        )
        for row in bo_card_rows:
            source_id = row.get(schema.SOURCE_ID_COLUMN)
            if rm.canonical_uuid(source_id) is None or id_map.lookup(rm.CARDS, source_id):
                continue
            type_key = str(row.get("type") or "")
            match = _card_by_source_id(type_by_id, type_key, source_id)
            if match is None and row.get("external_id"):
                hit = await _card_by_external_id(db, type_key, str(row["external_id"]))
                match = str(hit[0]) if hit else None
            if match is None and archived is not None and row.get("status") == "ARCHIVED":
                found = await _archived_card_match(
                    db,
                    archived,
                    type_key,
                    _card_row_ref(row),
                    row.get("reference"),
                    row.get("external_id"),
                )
                match = str(found) if found else None
            if match is not None:
                id_map.record(rm.CARDS, source_id, match)

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

    # A selective run that did not apply the Users sheet still maps the users
    # the target already has, by e-mail.
    user_ids = {
        email.lower(): uid
        for email, uid in (await db.execute(select(User.email, User.id))).all()
        if email
    }
    rm.backfill(
        bundle.rows(schema.SHEET_USERS),
        id_map,
        rm.USERS,
        lambda row: user_ids.get(str(row.get("email") or "").strip().lower()),
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
    if wants_bo:
        ctx.relation_details = {
            str(rel.id): (rel.type, str(rel.source_id), str(rel.target_id)) for rel in rel_rows
        }

    def _resolve_relation(row: dict[str, Any]) -> uuid.UUID | None:
        key = _relation_key(row, id_map, resolver, rt_by_key)
        if key is None:
            return None
        rel_id = _matching_relation(ctx.relations_by_ends, (key[0], str(key[1]), str(key[2])))
        return uuid.UUID(rel_id) if rel_id else None

    source_relations = bundle.rows(schema.SHEET_RELATIONS)
    rm.backfill(source_relations, id_map, rm.RELATIONS, _resolve_relation)
    if wants_bo:
        for row in source_relations:
            source_id = rm.canonical_uuid(row.get(schema.SOURCE_ID_COLUMN))
            if source_id is None or row.get("type") != ER_RELATION:
                continue
            relation_key = _relation_key(row, id_map, resolver, rt_by_key)
            if relation_key is not None:
                ctx.source_er_ends[source_id] = str(relation_key[1]), str(relation_key[2])

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
    existing_diagrams = set(
        (await db.execute(select(Diagram.id).where(Diagram.kind != BO_RELATIONSHIP_KIND))).scalars()
    )
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
    existing_diagrams = set(
        (await db.execute(select(Diagram.id).where(Diagram.kind != BO_RELATIONSHIP_KIND))).scalars()
    )
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
    # A row replaces fields_schema / subtypes / section_config whole. What an
    # active extension contributed to a type on THIS instance is kept, by the
    # same guard a metamodel save runs — before the comparison, so a re-import
    # is a no-op and the preview shows exactly what the apply writes.
    from app.services.extensions import contribution_guard
    from app.services.extensions.registry import extension_registry

    await extension_registry.refresh_from_db(db)
    active_keys = contribution_guard.active_extension_keys()
    for row in bundle.rows(schema.SHEET_CARD_TYPES):
        data = _coerce(row, exp.CARD_TYPE_COLUMNS, exp.CARD_TYPE_JSON)
        # An older bundle still carries ``licensingModel``; license metrics replaced it.
        if data.get("fields_schema") is not None:
            data["fields_schema"] = without_model_field(
                cast(str, data.get("key")), data["fields_schema"]
            )
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
        # A type new here is guarded too, against nothing stored: the same
        # stamp rule as for a type this instance has (no forged stamps of an
        # extension installed here), and no transient read flags written.
        contribution_guard.guard_card_type_row(
            data,
            stored_schema=None if current is None else current.fields_schema,
            stored_subtypes=None if current is None else current.subtypes,
            stored_config=None if current is None else current.section_config,
            active_keys=active_keys,
            mode="import",
            installed=contribution_guard.installed_contributions(str(key)),
        )
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
    # A bundle older than the category registry (or a content pack that ships
    # no CardTypeCategories sheet) still names its layers: adopt any the
    # registry lacks, so the type editor never refuses to save such a type.
    await card_type_categories.ensure_categories(db, (ct.category for ct in existing.values()))
    if not dry_run:
        # Fallback only: the guard above already kept every active
        # contribution of the types this instance had, so this finds nothing
        # to do unless a contribution was missing before the import.
        from app.services.extensions.field_contributions import heal_contributions

        await heal_contributions(db)


# The one column of a built-in category a bundle may change: its place in the
# layer order. Label, colour and translations stay locked.
_BUILT_IN_CATEGORY_MOVABLE = frozenset({"sort_order"})
# Columns a bundle never changes on a category it matched: the key is what it
# was matched by, and ``built_in`` is the target instance's own verdict.
_CATEGORY_IMMUTABLE_COLUMNS = frozenset({"key", "built_in"})


async def _apply_card_type_categories(
    db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool
) -> None:
    """Create the categories the target lacks and update its custom ones.

    On a target row that is ``built_in`` only ``sort_order`` is applied: the
    four default layers' label, colour and translations are locked on every
    instance, so a bundle carrying a recoloured default cannot repaint the
    target's, but their place in the layer order is the admin's (a custom
    layer may sit between two defaults) and must survive a transfer. Such a
    row counts as updated when it moved, and is skipped ``built_in_locked``
    only when the bundle wanted to change a locked column and nothing moved.
    ``built_in`` is never flipped either way. A target row the bundle does not
    carry is left alone."""
    sec = next(s for s in schema.CONFIG_SECTIONS if s.sheet == schema.SHEET_CARD_TYPE_CATEGORIES)
    existing = {c.key: c for c in (await db.execute(select(CardTypeCategory))).scalars().all()}
    for row in bundle.rows(schema.SHEET_CARD_TYPE_CATEGORIES):
        data = _coerce(row, sec.columns, sec.json_columns)
        key = data.get("key")
        if not isinstance(key, str) or not key.strip():
            sr.failed += 1
            continue
        key = key.strip()
        data["key"] = key
        if data.get("translations") is None and "translations" in data:
            data["translations"] = {}
        current = existing.get(key)
        if current is None:
            fresh = _not_none(data)
            fresh.setdefault("label", key)
            if "sort_order" not in fresh:
                fresh["sort_order"] = await card_type_categories.next_sort_order(db)
            # A built-in layer exists on every instance; one arriving here is a
            # bundle's own invention and lands as an ordinary custom row — the
            # model's default, like the colour a row does not carry.
            fresh.pop("built_in", None)
            obj = CardTypeCategory(**fresh)
            db.add(obj)
            existing[key] = obj
            await db.flush()
            sr.created += 1
        else:
            cols = [c for c in sec.columns if c not in _CATEGORY_IMMUTABLE_COLUMNS]
            if not current.built_in:
                _update_if_changed(current, data, cols, sr)
                continue
            differs = [c for c in cols if c in data and getattr(current, c) != data[c]]
            moved = [c for c in differs if c in _BUILT_IN_CATEGORY_MOVABLE]
            for col in moved:
                setattr(current, col, data[col])
            if moved:
                sr.updated += 1
            elif differs:
                sr.skip("built_in_locked")
            else:
                sr.skip("identical")
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


# The permission shipped at different versions in upstream and this fork.
VIEW_COSTS_SINCE = (2, 208, 0)
UPSTREAM_VIEW_COSTS_SINCE = (2, 206, 0)


def _predates_view_costs(bundle: WorkspaceBundle) -> bool:
    """Use the source's first release with per-role cost access."""
    version = bundle.app_version
    first_release = (
        VIEW_COSTS_SINCE
        if schema.SHEET_COST_ITEM_TYPES in bundle.sheets
        else UPSTREAM_VIEW_COSTS_SINCE
    )
    return version is not None and version < first_release


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
            #
            # ``card.view_costs`` is the same promise the other way round: a
            # bundle exported before the key existed describes roles that all
            # showed costs, so they keep doing so (Observer excepted) — the rule
            # migration 195 applies to an upgraded install. A bundle that names
            # no older version is taken at its word: no key, no cost access.
            if "permissions" in data:
                if sec.model is StakeholderRoleDefinition:
                    perms = strip_legacy_card_permissions(data["permissions"])
                    if _predates_view_costs(bundle):
                        perms = with_legacy_cost_grant(str(data.get("key")), perms)
                    data["permissions"] = perms
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
# License catalogue (metrics, then the types of each metric)
# ---------------------------------------------------------------------------

SHEET_CARD_LICENSES = "CardLicenses"
_LICENSE_CATALOGUE_SHEETS = (schema.SHEET_LICENSE_METRICS, schema.SHEET_LICENSE_TYPES)
# Config sheets applied by their own applier, not by the generic loop.
_BESPOKE_CONFIG_SHEETS = frozenset({schema.SHEET_CARD_TYPE_CATEGORIES, *_LICENSE_CATALOGUE_SHEETS})
# What a type row derived from an old bundle never changes on a row the target already has.
_DERIVED_TYPE_KEEPS = ("archived", "sort_order")


def _config_section(sheet: str) -> schema.ConfigSection:
    return next(s for s in schema.CONFIG_SECTIONS if s.sheet == sheet)


def _not_none(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if v is not None}


def _fresh(data: dict[str, Any], key: str) -> dict[str, Any]:
    """A new catalogue row's values: an empty cell takes the model default, the label the key."""
    fresh = _not_none(data)
    fresh.setdefault("label", key)
    return fresh


async def _apply_license_catalogue(
    db, bundle: WorkspaceBundle, result: ApplyResult, wanted: Callable[[str], bool]
) -> tuple[list[str], list[str]]:
    """Upsert the license metrics and the types of each metric, and drop from the bundle's
    ``CardLicenses`` the cells whose metric or type is on neither the target nor in the bundle.
    Returns the dropped ``metric:type`` names and the names of the cells the API's cell rules
    refuse, for the ``CardLicenses`` section's report. A metric or type row that breaks the
    API's key / label rules is counted ``failed``, reported and skipped, so its cells drop too.

    A bundle written before license metrics (no ``LicenseMetrics`` sheet — absent, never merely
    empty — or a type row without a ``metric_key`` column) has its catalogue derived as
    migration 192 does (``license_compat.derive_catalogue``). Its metrics are only inserted,
    never changed, and a type row it yields never changes ``archived`` or ``sort_order`` of a
    target row; it is written only when one of the two catalogue sheets is selected, and with
    ``CardLicenses`` alone it only builds the set of known cells. A new-format bundle follows
    the config merge.
    A type whose metric is on neither side is reported and skipped (its cells then drop); one
    whose metric is only in the bundle, its sheet not written, is reported and not created.
    When ``CardLicenses`` is wanted, ``bundle.sheets`` gets the filtered rows in place: the
    caller's bundle object is changed."""
    metric_sec = _config_section(schema.SHEET_LICENSE_METRICS)
    type_sec = _config_section(schema.SHEET_LICENSE_TYPES)
    metric_rows = bundle.rows(metric_sec.sheet)
    type_rows = bundle.rows(type_sec.sheet)
    card_rows = bundle.rows(SHEET_CARD_LICENSES)
    # The column missing, not an empty cell: a new bundle's blank row fails on its own.
    old = metric_sec.sheet not in bundle.sheets or any("metric_key" not in r for r in type_rows)
    if old:
        metric_rows, type_rows = license_compat.derive_catalogue(metric_rows, type_rows, card_rows)
    # An old bundle's types need their derived metrics, so either sheet writes both.
    write_metrics = wanted(metric_sec.sheet) or (old and wanted(type_sec.sheet))
    write_types = wanted(type_sec.sheet) or (old and wanted(metric_sec.sheet))

    metrics = {m.key: m for m in (await db.execute(select(LicenseMetric))).scalars()}
    metric_keys = set(metrics)
    msr = SectionResult(sheet=metric_sec.sheet) if write_metrics else None
    if msr is not None:
        result.sections.append(msr)
    for row in metric_rows:
        data = _coerce(row, metric_sec.columns, metric_sec.json_columns)
        key = data.get("key")
        if not key:
            if msr is not None:
                msr.failed += 1
            continue
        error = license_compat.check_catalogue_row(data, LicenseMetricCreate, LicenseMetricUpdate)
        if error:
            if msr is not None:
                msr.failed += 1
                msr.errors.append(
                    f"license metric {license_compat.clip(repr(key))}: {error}, skipped"
                )
            continue
        metric_keys.add(key)
        if msr is None:
            continue
        current = metrics.get(key)
        if current is None:
            metrics[key] = LicenseMetric(**_fresh(data, key))
            db.add(metrics[key])
            msr.created += 1
        elif old:  # the bundle said nothing about metrics: the target's row stays as it is
            msr.skip("already_present")
        else:
            cols = [c for c in metric_sec.columns if c not in metric_sec.natural_key]
            # An empty cell on a row the target has says nothing: the NOT NULL column stays.
            _update_if_changed(current, _not_none(data), cols, msr)

    types = {(t.metric_key, t.key): t for t in (await db.execute(select(LicenseType))).scalars()}
    known: set[tuple[str, str]] = set(types)
    tsr = SectionResult(sheet=type_sec.sheet) if write_types else None
    if tsr is not None:
        result.sections.append(tsr)
    keeps = type_sec.natural_key + (_DERIVED_TYPE_KEEPS if old else ())
    for row in type_rows:
        data = _coerce(row, type_sec.columns, type_sec.json_columns)
        metric_key, key = data.get("metric_key"), data.get("key")
        if not metric_key or not key:
            if tsr is not None:
                tsr.failed += 1
            continue
        error = license_compat.check_catalogue_row(data, LicenseTypeCreate, LicenseTypeUpdate)
        if error:
            if tsr is not None:
                tsr.failed += 1
                name = license_compat.clip(f"{metric_key}:{key!r}")
                tsr.errors.append(f"license type {name}: {error}, skipped")
            continue
        if metric_key not in metric_keys:
            if tsr is not None:
                tsr.skip("unknown_metric")
                tsr.errors.append(
                    f"license type {license_compat.clip(f'{metric_key}:{key}')}: its metric is "
                    "on neither this instance nor in the bundle, skipped"
                )
            continue
        known.add((metric_key, key))
        if tsr is None:
            continue
        if metric_key not in metrics:  # only in the bundle, and its sheet is not written
            tsr.skip("unknown_metric")
            tsr.errors.append(
                f"license type {license_compat.clip(f'{metric_key}:{key}')}: its metric is not "
                "on this instance and the metrics sheet is not imported, skipped"
            )
            continue
        current = types.get((metric_key, key))
        if current is None:
            types[(metric_key, key)] = LicenseType(**_fresh(data, key))
            db.add(types[(metric_key, key)])
            tsr.created += 1
        else:
            cols = [c for c in type_sec.columns if c not in keeps]
            _update_if_changed(current, _not_none(data), cols, tsr)
    await db.flush()

    if not wanted(SHEET_CARD_LICENSES):
        return [], []
    dropped: set[str] = set()
    invalid: set[str] = set()
    kept_rows: list[dict[str, Any]] = []
    gone: list[str]
    for row in card_rows:
        items = license_compat.items_of(row)
        if items is None:  # bad JSON, or not an object: nothing the entity pass can store
            items, gone, bad = {}, [], ["items"]
        else:  # the known cells first, so a bundle's long key never reaches the cell check
            items, gone = license_compat.keep_known_cells(items, known)
            items, bad = license_compat.drop_invalid_cells(items)
        dropped.update(gone)
        invalid.update(bad)
        # Always the validated items: a cell is stored as the API stores it, extra keys gone.
        kept_rows.append({**row, "items": items})
    # The entity pass reads the sheet from the bundle: hand it the filtered rows.
    bundle.sheets[SHEET_CARD_LICENSES] = kept_rows
    return sorted(dropped), sorted(invalid)


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


async def _apply_users(
    db,
    bundle: WorkspaceBundle,
    sr: SectionResult,
    dry_run: bool,
    *,
    id_map: rm.IdMap | None = None,
) -> None:
    """Create the users the target lacks (matched by e-mail) and record where
    every bundle user's id landed — created or matched, in a dry run too — so
    the user ids inside rich text and signatory lists can follow (2.200.0).
    A bundle without ``source_id`` records nothing."""
    ids = id_map if id_map is not None else rm.IdMap()
    valid_roles = {r for (r,) in (await db.execute(select(Role.key))).all()}
    existing = {u.email.lower(): u.id for u in (await db.execute(select(User))).scalars().all()}
    for row in bundle.rows(schema.SHEET_USERS):
        email = (row.get("email") or "").strip()
        if not email:
            sr.failed += 1
            continue
        if email.lower() in existing:
            ids.record(rm.USERS, row.get(schema.SOURCE_ID_COLUMN), existing[email.lower()])
            sr.skip("user_exists")
            continue
        role = row.get("role")
        if role not in valid_roles:
            role = _SAFE_SYNTHETIC_ROLE
        user = User(
            id=uuid.uuid4(),
            email=email,
            display_name=row.get("display_name") or email,
            role=role,
            is_active=False,  # synthetic users land deactivated; admin enables them
            auth_provider=row.get("auth_provider") or "local",
            locale=row.get("locale") or "en",
        )
        db.add(user)
        existing[email.lower()] = user.id
        ids.record(rm.USERS, row.get(schema.SOURCE_ID_COLUMN), user.id)
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
            # new method/transport takes effect without a restart. Never on a
            # dry run: the rollback restores the row, not this in-memory state.
            if not dry_run:
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
    from app.services.card_costs import recompute_derived
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
                await recompute_derived(db, card)  # first: a formula may read costTotalAnnual
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
            # An older bundle's value of the retired field, dropped as migration 192 does.
            if type_key in LICENSING_TYPES and isinstance(data.get("attributes"), dict):
                data["attributes"] = {k: v for k, v in data["attributes"].items() if k != MODEL_KEY}
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
                    # The exported channel, verbatim. A pre-157 bundle carries
                    # none: None lets ``ProvenanceMixin`` stamp the importing
                    # request's channel instead.
                    created_via=data.get("created_via"),
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
    resolved_rows = []
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
        resolved_rows.append((row, data, resolved))

    await lock_bo_relation_writes(db, (key for _, _, key in resolved_rows))
    existing = {
        (rel.type, rel.source_id, rel.target_id): rel.id
        for rel in (await db.execute(select(Relation))).scalars().all()
    }
    for row, data, resolved in resolved_rows:
        rtype, source_id, target_id = resolved
        key = (rtype, source_id, target_id)
        existing_id = _matching_relation(existing, key)
        if existing_id is not None:
            ids.record(rm.RELATIONS, row.get(schema.SOURCE_ID_COLUMN), existing_id)
            sr.skip("already_present")
            continue
        attributes = data.get("attributes") or {}
        values = dict(
            id=uuid.uuid4(),
            type=rtype,
            source_id=source_id,
            target_id=target_id,
            description=data.get("description"),
            attributes=attributes,
        )
        if rtype == APPLICATION_RELATION and attributes.get(OWNERSHIP_KEY) == MASTER:
            # Keep the target's existing Master and import the incoming CRUD.
            inserted = await db.scalar(
                insert(Relation).values(**values).on_conflict_do_nothing().returning(Relation.id)
            )
            if inserted is None:
                values["attributes"] = {
                    key: value for key, value in attributes.items() if key != OWNERSHIP_KEY
                }
                db.add(Relation(**values))
                tally = rm.RewriteTally()
                tally.bump("bo_master_conflict")
                tally.note("Imported the Application link and kept the target's existing Master")
                sr.note_references(tally)
        else:
            db.add(Relation(**values))
        existing[key] = values["id"]
        ids.record(rm.RELATIONS, row.get(schema.SOURCE_ID_COLUMN), values["id"])
        sr.created += 1
    await db.flush()
