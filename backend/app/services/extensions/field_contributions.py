"""Declarative field-section contributions from extension manifests.

An extension may declare, in its manifest::

    "capabilities": [..., "metamodel"],
    "metamodel": {
      "field_sections": [
        {
          "card_type": "Application",
          "section": "ESG Metrics",
          "columns": 1,
          "translations": {"de": "ESG-Kennzahlen"},
          "fields": [
            {"key": "esgRating", "label": "ESG Rating",
             "type": "ext.esg-pack.rating", "config": {"min": 1, "max": 5},
             "weight": 1, "translations": {"de": "ESG-Bewertung"}}
          ]
        }
      ]
    }

and the installer MERGES those sections into the target card types'
``fields_schema`` — additively, never overwriting admin customisations
(unlike a content-pack ``CardTypes`` row, which replaces the whole column
and is therefore unsafe for existing types).

Ownership + lifecycle:

- Every contributed section and field is stamped ``"ext": "<key>"`` so
  they can be found again. Admin-added fields inside a contributed
  section (no stamp) are always preserved.
- **Install / enable / update** → :func:`apply_field_contributions`
  upserts the sections (idempotent; re-running changes nothing).
- **Disable / uninstall** → :func:`remove_field_contributions` strips the
  extension's fields from the schema so the card detail visibly
  deactivates — but the *values* in ``cards.attributes`` are deliberately
  left untouched (never call the metamodel API's removed-field cleanup
  here). Re-enabling re-adds the section and every value reappears.
  Exactly the content-pack soft-hide semantics, applied to fields.
- A field key that already exists on the type outside this extension's
  ownership is **skipped** (never hijack an admin's or core's field).
- License lapse does NOT remove contributions (lapse is a licensing
  state, not a deactivation): rendering is never gated, and the fields
  degrade like any ``ext.*`` value when the UI plugin isn't loaded.

Data-quality scores are recomputed for affected card types on both apply
and remove, since contributed fields carry weights.
"""

from __future__ import annotations

import logging
from collections.abc import Set as AbstractSet
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.card import Card
from app.models.card_type import CardType

logger = logging.getLogger(__name__)

# Field properties an extension may declare; anything else is dropped so a
# manifest can't smuggle unexpected keys into the schema.
_ALLOWED_FIELD_PROPS = (
    "key",
    "label",
    "type",
    "options",
    "config",
    "required",
    "weight",
    "readonly",
    "group",
    "column",
    "translations",
    "help",
    "helpTranslations",
    "badge",
    "badgeTranslations",
)


def contributions_from_manifest(manifest: dict[str, Any] | None) -> list[dict]:
    """The ``metamodel.field_sections`` list, or ``[]``."""
    block = (manifest or {}).get("metamodel") or {}
    sections = block.get("field_sections")
    return sections if isinstance(sections, list) else []


def _sanitize_field(ext_key: str, field: dict) -> dict:
    out = {k: v for k, v in field.items() if k in _ALLOWED_FIELD_PROPS}
    out["ext"] = ext_key
    return out


def _own_sections(schema: list, ext_key: str) -> list[dict]:
    return [s for s in schema if isinstance(s, dict) and s.get("ext") == ext_key]


def _foreign_field_keys(schema: list, ext_key: str) -> set[str]:
    """Every field key on the type NOT owned by this extension."""
    keys: set[str] = set()
    for section in schema:
        if not isinstance(section, dict):
            continue
        for f in section.get("fields", []):
            if isinstance(f, dict) and "key" in f and f.get("ext") != ext_key:
                keys.add(f["key"])
    return keys


async def _recompute_data_quality(db: AsyncSession, type_keys: set[str]) -> None:
    """Contributed fields carry weights — refresh affected cards' scores."""
    from app.services.data_quality import calc_data_quality

    for type_key in type_keys:
        cards = (
            (await db.execute(select(Card).where(Card.type == type_key, Card.status == "ACTIVE")))
            .scalars()
            .all()
        )
        for card in cards:
            score = await calc_data_quality(db, card)
            if card.data_quality != score:
                card.data_quality = score


async def apply_field_contributions(
    db: AsyncSession, ext_key: str, manifest: dict[str, Any] | None
) -> int:
    """Merge the manifest's field sections into their target card types.

    Idempotent upsert: contributed sections/fields are stamped
    ``ext=<key>`` and replaced from the manifest on every apply; fields
    other admins/extensions own are never touched. Returns the number of
    fields now contributed. The caller commits.
    """
    contributions = contributions_from_manifest(manifest)
    if not contributions:
        return 0

    applied = 0
    touched_types: set[str] = set()
    for contrib in contributions:
        type_key = contrib.get("card_type")
        section_name = contrib.get("section")
        wanted_fields = contrib.get("fields") or []
        if not type_key or not section_name or not wanted_fields:
            continue
        ct = (
            await db.execute(select(CardType).where(CardType.key == type_key))
        ).scalar_one_or_none()
        if ct is None:
            logger.warning(
                "Extension %s contributes fields to missing card type %r — skipped",
                ext_key,
                type_key,
            )
            continue

        schema = [dict(s) if isinstance(s, dict) else s for s in (ct.fields_schema or [])]
        foreign = _foreign_field_keys(schema, ext_key)

        fields: list[dict] = []
        for f in wanted_fields:
            if not isinstance(f, dict) or not f.get("key"):
                continue
            if f["key"] in foreign:
                logger.warning(
                    "Extension %s: field %r already exists on %s outside the "
                    "extension — skipped (never hijack an existing field)",
                    ext_key,
                    f["key"],
                    type_key,
                )
                continue
            fields.append(_sanitize_field(ext_key, f))
        if not fields:
            continue

        # Find our section: by (marker, name) first; a single unclaimed marked
        # section adopts a manifest rename.
        target = next(
            (s for s in schema if s.get("ext") == ext_key and s.get("section") == section_name),
            None,
        )
        if target is None:
            owned = _own_sections(schema, ext_key)
            wanted_names = {c.get("section") for c in contributions}
            orphans = [s for s in owned if s.get("section") not in wanted_names]
            if len(orphans) == 1:
                target = orphans[0]

        if target is None:
            target = {"section": section_name, "ext": ext_key, "fields": []}
            schema.append(target)
        target["section"] = section_name
        target["ext"] = ext_key
        if "columns" in contrib:
            target["columns"] = contrib["columns"]
        if "translations" in contrib:
            target["translations"] = contrib["translations"]
        if "groupTranslations" in contrib:
            target["groupTranslations"] = contrib["groupTranslations"]
        # Replace our fields; keep admin-added (unstamped) fields in place.
        kept = [
            f for f in target.get("fields", []) if isinstance(f, dict) and f.get("ext") != ext_key
        ]
        target["fields"] = kept + fields

        ct.fields_schema = schema
        flag_modified(ct, "fields_schema")
        touched_types.add(type_key)
        applied += len(fields)

    # An update may have retargeted a contribution to a different card type —
    # clean our stamped fields off every type the current manifest no longer
    # targets (scans stamps, so it works even if the old manifest is gone).
    stale = await remove_field_contributions(db, ext_key, except_types=touched_types)
    if stale:
        logger.info(
            "Extension %s: removed %d stale contributed field(s) from retargeted types",
            ext_key,
            stale,
        )

    if touched_types:
        await db.flush()
        await _recompute_data_quality(db, touched_types)
        await db.flush()
    return applied


async def remove_field_contributions(
    db: AsyncSession, ext_key: str, *, except_types: AbstractSet[str] = frozenset()
) -> int:
    """Strip this extension's stamped fields from every card type.

    Scans stamps rather than the manifest, so it cleans up correctly even
    when the manifest changed between versions. Values in
    ``cards.attributes`` are deliberately preserved (soft deactivation —
    re-applying brings them back). Sections that still hold admin-added
    fields survive without the extension's fields. Returns the number of
    fields removed. The caller commits.
    """
    removed = 0
    touched_types: set[str] = set()
    all_types = (await db.execute(select(CardType))).scalars().all()
    for ct in all_types:
        if ct.key in except_types:
            continue
        schema = []
        changed = False
        for section in ct.fields_schema or []:
            if not isinstance(section, dict):
                schema.append(section)
                continue
            fields = section.get("fields", [])
            kept = [f for f in fields if not (isinstance(f, dict) and f.get("ext") == ext_key)]
            removed += len(fields) - len(kept)
            if len(kept) != len(fields):
                changed = True
            if section.get("ext") == ext_key and not kept:
                continue  # drop the now-empty contributed section entirely
            if len(kept) != len(fields):
                section = {**section, "fields": kept}
            schema.append(section)
        if changed:
            ct.fields_schema = schema
            flag_modified(ct, "fields_schema")
            touched_types.add(ct.key)

    if touched_types:
        await db.flush()
        await _recompute_data_quality(db, touched_types)
        await db.flush()
    return removed
