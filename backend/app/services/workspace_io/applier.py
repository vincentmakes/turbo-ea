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

import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.bookmark import Bookmark, bookmark_shares
from app.models.card import Card
from app.models.card_type import CardType
from app.models.diagram import Diagram, diagram_cards
from app.models.diagram_group import DiagramGroup, diagram_group_members
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.services.card_resolver import CardResolver
from app.services.email_backends.runtime import apply_email_settings_to_runtime
from app.services.workspace_io import exporter as exp
from app.services.workspace_io import schema
from app.services.workspace_io.bundle import WorkspaceBundle, from_cell
from app.services.workspace_io.entities import apply_entity_section
from app.services.workspace_io.secrets import EMAIL_SECRET_PATHS, GENERAL_SECRET_PATHS
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

    def skip(self, reason: str = "already_present") -> None:
        self.skipped += 1
        self.skip_reasons[reason] = self.skip_reasons.get(reason, 0) + 1

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
    out: dict[str, Any] = {}
    for col in columns:
        raw = row.get(col)
        out[col] = from_cell(raw, is_json=col in json_cols)
    return out


def _update_if_changed(current: Any, data: dict[str, Any], cols, sr: SectionResult) -> None:
    """Write only the columns that actually differ. Counts the row as
    ``updated`` when something changed and ``skipped`` when it's identical, so
    re-importing an unchanged export into the same instance is a true no-op."""
    changed = False
    for col in cols:
        if getattr(current, col) != data.get(col):
            setattr(current, col, data.get(col))
            changed = True
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
    built-in protection, one-relation-type-per-pair enforcement,
    topo-sorted cards, dry-run via savepoint — over an in-memory
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

    sections = [
        (schema.SHEET_CARD_TYPES, _apply_card_types),
        (schema.SHEET_RELATION_TYPES, _apply_relation_types),
        *((sec.sheet, _make_config_applier(sec)) for sec in schema.CONFIG_SECTIONS),
        (schema.SHEET_TAG_GROUPS, _apply_tag_groups),
        (schema.SHEET_TAGS, _apply_tags),
        (schema.SHEET_USERS, _apply_users),
        (schema.SHEET_SETTINGS, _apply_settings),
        (schema.SHEET_CARDS, _make_cards_applier(user)),
        (schema.SHEET_CARD_TAGS, _apply_card_tags),
        (schema.SHEET_RELATIONS, _apply_relations),
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
        ent_resolver = None
        email_to_id: dict[str, uuid.UUID] = {}
        if needs_resolver or _wanted(SHEET_BOOKMARK_SHARES):
            all_types = {str(k) for (k,) in (await db.execute(select(CardType.key))).all()}
            ent_resolver = await CardResolver.load(db, all_types)
            email_to_id = {
                u.email.lower(): u.id for u in (await db.execute(select(User))).scalars().all()
            }
        for ent in wanted_entity_sections:
            # needs_resolver is True whenever this loop has items, so the
            # resolver was loaded above.
            assert ent_resolver is not None
            sr = SectionResult(sheet=ent.sheet)
            result.sections.append(sr)
            await apply_entity_section(
                db, ent, bundle, sr, ent_resolver, email_to_id, dry_run=dry_run
            )

        if _wanted(SHEET_DIAGRAM_CARDS):
            sr = SectionResult(sheet=SHEET_DIAGRAM_CARDS)
            result.sections.append(sr)
            await _apply_diagram_cards(db, bundle, sr, ent_resolver)

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
        if dry_run:
            assert root is not None
            await root.rollback()

    if not dry_run:
        await db.commit()
    return result


async def _apply_diagram_cards(db, bundle: WorkspaceBundle, sr: SectionResult, resolver) -> None:
    """Bespoke Diagram↔Card association (preserved diagram_id + resolved card)."""
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
        res = resolver.resolve(str(ctype), str(cref))
        if diag_uuid not in existing_diagrams or res.status != "resolved":
            sr.conflict += 1
            continue
        pair = (diag_uuid, res.card_id)
        if pair in existing:
            sr.skip("already_present")
            continue
        await db.execute(diagram_cards.insert().values(diagram_id=diag_uuid, card_id=res.card_id))
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
            cols = [c for c in exp.CARD_TYPE_COLUMNS if c not in ("key", "built_in")]
            _update_if_changed(current, data, cols, sr)
    await db.flush()


async def _apply_relation_types(
    db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool
) -> None:
    existing = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars().all()}
    # One relation type per ordered (source, target) pair — enforced here too.
    # Successor (lineage) relation types are exempt (see below), so they never claim
    # a pair.
    pair_owner = {
        (rt.source_type_key, rt.target_type_key): rt.key
        for rt in existing.values()
        if not rt.key.endswith("Successor")
    }
    for row in bundle.rows(schema.SHEET_RELATION_TYPES):
        data = _coerce(row, exp.RELATION_TYPE_COLUMNS, exp.RELATION_TYPE_JSON)
        key = data.get("key")
        if not key:
            sr.failed += 1
            continue
        current = existing.get(key)
        pair = (data.get("source_type_key"), data.get("target_type_key"))
        # Successor (lineage) relation types are a separate, UI-isolated category and
        # are exempt from the one-relation-type-per-pair rule (mirrors the API in
        # metamodel.py) — a self-referential rel{Key}Successor must be able to coexist
        # with a custom self-relation on the same pair.
        is_successor = bool(key) and key.endswith("Successor")
        if current is None:
            owner = pair_owner.get(pair)
            if not is_successor and owner is not None and owner != key:
                sr.conflict += 1
                sr.errors.append(
                    f"relation_type {key!r}: pair {pair} already used by {owner!r} — skipped"
                )
                continue
            rt = RelationType(**{k: v for k, v in data.items()})
            db.add(rt)
            existing[key] = rt
            if not is_successor:
                pair_owner[pair] = key
            sr.created += 1
        else:
            cols = [c for c in exp.RELATION_TYPE_COLUMNS if c not in ("key", "built_in")]
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
            cols = [c for c in exp.TAG_GROUP_COLUMNS if c != "name"]
            _update_if_changed(current, data, cols, sr)
    await db.flush()


async def _apply_tags(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
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
        if current is None:
            tag = Tag(
                tag_group_id=group.id,
                name=name,
                description=row.get("description"),
                color=row.get("color"),
                sort_order=row.get("sort_order") or 0,
            )
            db.add(tag)
            existing[nk] = tag
            sr.created += 1
        else:
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
    existing = {u.email.lower(): u for u in (await db.execute(select(User))).scalars().all()}
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
            password_hash=None,
        )
        db.add(user)
        existing[email.lower()] = user
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
        row_obj = AppSettings(id="default", general_settings={}, email_settings={})
        db.add(row_obj)

    # The exporter serialises every Settings ``value`` cell as JSON (dicts for
    # general/email, plain strings for the MIME types), so parse them all the
    # same way.
    incoming: dict[str, Any] = {}
    for row in bundle.rows(schema.SHEET_SETTINGS):
        key = row.get("key")
        if key:
            incoming[key] = from_cell(row.get("value"), is_json=True)

    if "general_settings" in incoming and isinstance(incoming["general_settings"], dict):
        general = dict(row_obj.general_settings or {})
        merged = _merge_settings(general, incoming["general_settings"], GENERAL_SECRET_PATHS)
        if merged != (row_obj.general_settings or {}):
            row_obj.general_settings = merged
            sr.updated += 1
        else:
            sr.skip("identical")
    if "email_settings" in incoming and isinstance(incoming["email_settings"], dict):
        email = dict(row_obj.email_settings or {})
        # Secrets (smtp_password, oauth_client_secret, service_account_json) are
        # never in a legit bundle; _merge_settings refuses to write them back.
        merged_email = _merge_settings(email, incoming["email_settings"], EMAIL_SECRET_PATHS)
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
    """Return the first asset whose path matches ``prefix`` (any extension)."""
    for path, data in bundle.assets.items():
        if path == prefix or path.startswith(prefix + "."):
            return data
    return None


def _merge_settings(
    target: dict[str, Any], incoming: dict[str, Any], secret_paths: tuple[tuple[str, ...], ...]
) -> dict[str, Any]:
    """Shallow-merge ``incoming`` into ``target`` but never write a secret path.

    The exporter strips secrets, so a bundle carrying one is hand-edited or
    malicious — an incoming secret leaf is ignored entirely (it would land
    unencrypted), and the target's own value is always preserved.
    """
    secret_leaves = {p[0] for p in secret_paths if len(p) == 1}
    merged = dict(target)
    for key, value in incoming.items():
        if key in secret_leaves:
            continue
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            sub_secrets = tuple(p[1:] for p in secret_paths if p and p[0] == key)
            merged[key] = _merge_settings(merged[key], value, sub_secrets)
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
    from app.api.v1.cards import _get_ppm_exclusions
    from app.services.calculation_engine import run_calculations_for_card
    from app.services.data_quality import calc_data_quality

    ids = list((await db.execute(select(Card.id).where(Card.status != "ARCHIVED"))).scalars().all())
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


def _make_cards_applier(user: User):
    async def _apply(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
        from app.api.v1.cards import (
            _check_hierarchy_depth,
            _sync_hierarchy_levels,
            _validate_url_attributes,
        )
        from app.services.event_bus import event_bus

        rows = bundle.rows(schema.SHEET_CARDS)
        type_keys: set[str] = {str(r["type"]) for r in rows if r.get("type")}
        resolver = await CardResolver.load(db, type_keys)

        # Parents (shorter parent_path) before children — a valid topo order
        # for trees because a child's parent has exactly one fewer segment.
        def depth(r: dict) -> int:
            return len(schema.split_escaped_path(r.get("parent_path") or ""))

        created_refs: dict[tuple[str, str], Any] = {}

        for row in sorted(rows, key=depth):
            data = _coerce(row, exp.CARD_COLUMNS, exp.CARD_JSON)
            type_key = data.get("type")
            name = data.get("name")
            if not type_key or not name:
                sr.failed += 1
                continue
            parent_path = data.get("parent_path") or ""
            own_ref = schema.build_ref_string(schema.split_escaped_path(parent_path), name)
            external_id = data.get("external_id")

            # Skip if already present (idempotency): by external_id, by created
            # this batch, or resolvable in the live DB.
            if (type_key, own_ref) in created_refs:
                sr.skip("duplicate_in_bundle")
                continue
            if external_id and await _card_by_external_id(db, type_key, external_id):
                sr.skip("already_present")
                continue
            existing = resolver.resolve(type_key, own_ref)
            if existing.status == "resolved":
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

            try:
                await _validate_url_attributes(db, type_key, data.get("attributes") or {})
                card = Card(
                    type=type_key,
                    subtype=data.get("subtype"),
                    name=name,
                    description=data.get("description"),
                    parent_id=resolved_parent,
                    lifecycle=data.get("lifecycle") or {},
                    attributes=data.get("attributes") or {},
                    external_id=external_id,
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
                created_refs[(type_key, own_ref)] = card.id
                sr.created += 1
            except Exception as exc:  # noqa: BLE001
                sr.failed += 1
                sr.errors.append(f"card {name!r}: {exc}")
        await db.flush()

    return _apply


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


async def _apply_card_tags(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
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
        res = resolver.resolve(ctype, cref) if cref else None
        if tag is None or res is None or res.status != "resolved":
            sr.conflict += 1
            sr.errors.append(
                f"card tag {row.get('tag_name')!r}: tag or card {cref!r} unresolved — skipped"
            )
            continue
        link = (res.card_id, tag.id)
        if link in existing_links:
            sr.skip("already_present")
            continue
        db.add(CardTag(card_id=res.card_id, tag_id=tag.id))
        existing_links.add(link)
        sr.created += 1
    await db.flush()


async def _apply_relations(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
    rows = bundle.rows(schema.SHEET_RELATIONS)
    type_keys: set[str] = set()
    for r in rows:
        if r.get("source_type"):
            type_keys.add(r["source_type"])
        if r.get("target_type"):
            type_keys.add(r["target_type"])
    resolver = await CardResolver.load(db, type_keys)
    existing = {
        (rel.type, rel.source_id, rel.target_id)
        for rel in (await db.execute(select(Relation))).scalars().all()
    }
    for row in rows:
        data = _coerce(row, exp.RELATION_COLUMNS, exp.RELATION_JSON)
        rtype = data.get("type")
        s_res = resolver.resolve(
            str(data.get("source_type") or ""), str(data.get("source_ref") or "")
        )
        t_res = resolver.resolve(
            str(data.get("target_type") or ""), str(data.get("target_ref") or "")
        )
        if not rtype or s_res.status != "resolved" or t_res.status != "resolved":
            sr.conflict += 1
            sr.errors.append(
                f"relation {rtype!r}: endpoint(s) unresolved "
                f"({data.get('source_ref')!r} -> {data.get('target_ref')!r})"
            )
            continue
        key = (rtype, s_res.card_id, t_res.card_id)
        if key in existing:
            sr.skip("already_present")
            continue
        db.add(
            Relation(
                type=rtype,
                source_id=s_res.card_id,
                target_id=t_res.card_id,
                description=data.get("description"),
                attributes=data.get("attributes") or {},
            )
        )
        existing.add(key)
        sr.created += 1
    await db.flush()
