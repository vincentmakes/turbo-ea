"""Apply a parsed workspace bundle into the live database.

Two entry points share one engine:

* :func:`apply_bundle` writes the bundle, each section isolated in its own
  savepoint so one bad row can't poison the rest, then commits.
* :func:`diff_bundle` runs the *same* engine inside an outer savepoint that is
  rolled back at the end, so the returned counts reflect exactly what an apply
  would do (including same-batch parent/endpoint resolution) without persisting
  anything — the dry-run preview.

Idempotent upsert-by-natural-key throughout: metamodel/config by key, settings
by merge, users by email, cards by ``external_id``/``(type, parent, name)``,
relations by ``(type, source, target)``. Re-importing the same bundle is a
no-op (all-skip).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.role import Role
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.services.card_resolver import CardResolver
from app.services.workspace_io import exporter as exp
from app.services.workspace_io import schema
from app.services.workspace_io.bundle import WorkspaceBundle, from_cell
from app.services.workspace_io.secrets import GENERAL_SECRET_PATHS

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

    def as_dict(self) -> dict[str, Any]:
        return {
            "sheet": self.sheet,
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "conflict": self.conflict,
            "failed": self.failed,
            "errors": self.errors[:20],
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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def apply_bundle(db: AsyncSession, bundle: WorkspaceBundle, user: User) -> ApplyResult:
    return await _run(db, bundle, user, dry_run=False)


async def diff_bundle(db: AsyncSession, bundle: WorkspaceBundle, user: User) -> ApplyResult:
    return await _run(db, bundle, user, dry_run=True)


async def _run(
    db: AsyncSession, bundle: WorkspaceBundle, user: User, *, dry_run: bool
) -> ApplyResult:
    result = ApplyResult(dry_run=dry_run)
    outer = await db.begin_nested() if dry_run else None

    # Each section runs in a savepoint; failures are recorded, not fatal.
    await _section(db, result, schema.SHEET_CARD_TYPES, _apply_card_types, bundle, dry_run)
    await _section(db, result, schema.SHEET_RELATION_TYPES, _apply_relation_types, bundle, dry_run)
    for sec in schema.CONFIG_SECTIONS:
        await _section(db, result, sec.sheet, _make_config_applier(sec), bundle, dry_run)
    await _section(db, result, schema.SHEET_TAG_GROUPS, _apply_tag_groups, bundle, dry_run)
    await _section(db, result, schema.SHEET_TAGS, _apply_tags, bundle, dry_run)
    await _section(db, result, schema.SHEET_USERS, _apply_users, bundle, dry_run)
    await _section(db, result, schema.SHEET_SETTINGS, _apply_settings, bundle, dry_run)
    await _section(db, result, schema.SHEET_CARDS, _make_cards_applier(user), bundle, dry_run)
    await _section(db, result, schema.SHEET_CARD_TAGS, _apply_card_tags, bundle, dry_run)
    await _section(db, result, schema.SHEET_RELATIONS, _apply_relations, bundle, dry_run)

    if dry_run:
        assert outer is not None
        await outer.rollback()
    else:
        await db.commit()
    return result


async def _section(db, result: ApplyResult, sheet: str, applier, bundle, dry_run: bool) -> None:
    """Run one section in its own savepoint, collecting a SectionResult."""
    sr = SectionResult(sheet=sheet)
    result.sections.append(sr)
    sp = await db.begin_nested()
    try:
        await applier(db, bundle, sr, dry_run)
        # Release the savepoint (keep the writes) — the outer txn commits later.
        await sp.commit()
    except Exception as exc:  # noqa: BLE001
        await sp.rollback()
        sr.failed += 1
        sr.errors.append(f"section aborted: {exc}")


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
            for col in exp.CARD_TYPE_COLUMNS:
                if col in ("key", "built_in"):
                    continue
                setattr(current, col, data.get(col))
            sr.updated += 1
    await db.flush()


async def _apply_relation_types(
    db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool
) -> None:
    existing = {rt.key: rt for rt in (await db.execute(select(RelationType))).scalars().all()}
    # One relation type per ordered (source, target) pair — enforced here too.
    pair_owner = {(rt.source_type_key, rt.target_type_key): rt.key for rt in existing.values()}
    for row in bundle.rows(schema.SHEET_RELATION_TYPES):
        data = _coerce(row, exp.RELATION_TYPE_COLUMNS, exp.RELATION_TYPE_JSON)
        key = data.get("key")
        if not key:
            sr.failed += 1
            continue
        current = existing.get(key)
        pair = (data.get("source_type_key"), data.get("target_type_key"))
        if current is None:
            owner = pair_owner.get(pair)
            if owner is not None and owner != key:
                sr.conflict += 1
                sr.errors.append(
                    f"relation_type {key!r}: pair {pair} already used by {owner!r} — skipped"
                )
                continue
            rt = RelationType(**{k: v for k, v in data.items()})
            db.add(rt)
            existing[key] = rt
            pair_owner[pair] = key
            sr.created += 1
        else:
            for col in exp.RELATION_TYPE_COLUMNS:
                if col in ("key", "built_in"):
                    continue
                setattr(current, col, data.get(col))
            sr.updated += 1
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
                for col in sec.columns:
                    if col in sec.natural_key:
                        continue
                    setattr(current, col, data.get(col))
                sr.updated += 1
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
            for col in exp.TAG_GROUP_COLUMNS:
                if col == "name":
                    continue
                setattr(current, col, data.get(col))
            sr.updated += 1
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
                color=row.get("color"),
                sort_order=row.get("sort_order") or 0,
            )
            db.add(tag)
            existing[nk] = tag
            sr.created += 1
        else:
            current.color = row.get("color")
            current.sort_order = row.get("sort_order") or 0
            sr.updated += 1
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
            sr.skipped += 1
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
        row_obj.general_settings = merged
        sr.updated += 1
    if "email_settings" in incoming and isinstance(incoming["email_settings"], dict):
        email = dict(row_obj.email_settings or {})
        # smtp_password is never in the bundle; preserve whatever the target has.
        for k, v in incoming["email_settings"].items():
            if k == "smtp_password":
                continue
            email[k] = v
        row_obj.email_settings = email
        sr.updated += 1
    if incoming.get("custom_logo_mime"):
        row_obj.custom_logo_mime = incoming["custom_logo_mime"]
    if incoming.get("custom_favicon_mime"):
        row_obj.custom_favicon_mime = incoming["custom_favicon_mime"]
    await db.flush()


def _merge_settings(
    target: dict[str, Any], incoming: dict[str, Any], secret_paths: tuple[tuple[str, ...], ...]
) -> dict[str, Any]:
    """Shallow-merge ``incoming`` into ``target`` but keep the target's value at
    every secret path (e.g. ``sso.client_secret``) untouched."""
    merged = dict(target)
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            sub_secrets = tuple(p[1:] for p in secret_paths if p and p[0] == key)
            merged[key] = _merge_settings(merged[key], value, sub_secrets)
        else:
            merged[key] = value
    # Restore any direct secret leaf at this level from the original target.
    for path in secret_paths:
        if len(path) == 1 and path[0] in target:
            merged[path[0]] = target[path[0]]
    return merged


# ---------------------------------------------------------------------------
# Cards (topological create-or-skip)
# ---------------------------------------------------------------------------


def _make_cards_applier(user: User):
    async def _apply(db, bundle: WorkspaceBundle, sr: SectionResult, dry_run: bool) -> None:
        from app.api.v1.cards import (
            _check_hierarchy_depth,
            _sync_capability_level,
            _validate_url_attributes,
        )
        from app.services.calculation_engine import run_calculations_for_card
        from app.services.data_quality import calc_data_quality
        from app.services.event_bus import event_bus

        rows = bundle.rows(schema.SHEET_CARDS)
        type_keys = {r.get("type") for r in rows if r.get("type")}
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
                sr.skipped += 1
                continue
            if external_id and await _card_by_external_id(db, type_key, external_id):
                sr.skipped += 1
                continue
            existing = resolver.resolve(type_key, own_ref)
            if existing.status in ("resolved", "ambiguous"):
                sr.skipped += 1
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
                await _sync_capability_level(db, card)
                card.data_quality = await calc_data_quality(db, card)
                await run_calculations_for_card(db, card)
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
    type_keys = {r.get("card_type") for r in rows if r.get("card_type")}
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
            continue
        tag = tag_index.get((group.id, row.get("tag_name")))
        res = resolver.resolve(ctype, cref) if cref else None
        if tag is None or res is None or res.status != "resolved":
            sr.conflict += 1
            continue
        link = (res.card_id, tag.id)
        if link in existing_links:
            sr.skipped += 1
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
        s_res = resolver.resolve(data.get("source_type"), data.get("source_ref") or "")
        t_res = resolver.resolve(data.get("target_type"), data.get("target_ref") or "")
        if not rtype or s_res.status != "resolved" or t_res.status != "resolved":
            sr.conflict += 1
            sr.errors.append(
                f"relation {rtype!r}: endpoint(s) unresolved "
                f"({data.get('source_ref')!r} -> {data.get('target_ref')!r})"
            )
            continue
        key = (rtype, s_res.card_id, t_res.card_id)
        if key in existing:
            sr.skipped += 1
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
