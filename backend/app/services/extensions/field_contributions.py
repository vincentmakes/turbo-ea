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


def _is_custom_section(section: Any) -> bool:
    """Does this section occupy a ``custom:N`` slot?

    Card detail filters out only the magic ``__description`` section and then
    indexes what remains POSITIONALLY (``CardDetailContent`` /
    ``CardLayoutEditor``), so every other entry counts — a malformed non-dict
    one included, since it still shifts the sections after it.
    """
    return not (isinstance(section, dict) and section.get("section") == "__description")


def _custom_section_index(schema: list[dict], section: dict) -> int | None:
    """The ``custom:N`` index the frontend will address this section by.

    Computed exactly the way card detail computes it (see
    :func:`_is_custom_section`) or an inserted order entry would point at a
    different section.
    """
    customs = [s for s in schema if _is_custom_section(s)]
    for idx, candidate in enumerate(customs):
        if candidate is section:
            return idx
    return None


def _place_section_before_relations(ct, schema: list[dict], section: dict) -> None:
    """Give a NEWLY created contributed section a place in ``__order``.

    Card detail appends any ``custom:N`` missing from a stored ``__order`` to
    the very end — i.e. *below* Relations — while ``tags``/``successors`` are
    spliced in before it. A contributed section belongs with the card's own
    content, so insert it before ``relations`` too.

    Two deliberate limits:
    - **no-op when no ``__order`` is stored.** That branch already renders
      custom sections above hierarchy/tags/relations, and writing an order
      where none existed would freeze a layout the admin never chose.
    - **first creation only** (the caller). A re-apply or version update must
      never move a section the admin has since dragged somewhere else.
    """
    config = dict(ct.section_config or {})
    order = list(config.get("__order") or [])
    if not order:
        return
    index = _custom_section_index(schema, section)
    if index is None:
        return
    key = f"custom:{index}"
    if key in order:
        return
    at = order.index("relations") if "relations" in order else len(order)
    order.insert(at, key)
    config["__order"] = order
    ct.section_config = config
    flag_modified(ct, "section_config")


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
    from app.services.derived_writes import derived_maintenance

    # Installing an extension is not an edit to every card of the type — the
    # scores move, the Modified dates do not.
    with derived_maintenance(db):
        for type_key in type_keys:
            cards = (
                (
                    await db.execute(
                        select(Card).where(Card.type == type_key, Card.status == "ACTIVE")
                    )
                )
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
            _place_section_before_relations(ct, schema, target)
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


# ---------------------------------------------------------------------------
# Subtype contributions — the same additive merge/strip lifecycle, applied to
# a card type's ``subtypes`` list. An extension may declare::
#
#     "metamodel": {
#       "subtypes": [
#         {"card_type": "Organization",
#          "subtypes": [{"key": "branch", "label": "Branch",
#                        "translations": {"de": "Zweigniederlassung"}}]}
#       ]
#     }
#
# Contributed subtypes are stamped ``"ext": "<key>"``; a key that already
# exists outside the extension is skipped (never hijacked); disable/uninstall
# strips the stamped entries while ``cards.subtype`` VALUES are untouched —
# rendering degrades to the raw key (never gated), and re-enabling restores
# the label. No data-quality recompute: subtypes carry no weights.
# ---------------------------------------------------------------------------

_ALLOWED_SUBTYPE_PROPS = ("key", "label", "color", "translations")


def subtype_contributions_from_manifest(manifest: dict[str, Any] | None) -> list[dict]:
    """The ``metamodel.subtypes`` list, or ``[]``."""
    block = (manifest or {}).get("metamodel") or {}
    rows = block.get("subtypes")
    return rows if isinstance(rows, list) else []


async def apply_subtype_contributions(
    db: AsyncSession, ext_key: str, manifest: dict[str, Any] | None
) -> int:
    """Merge the manifest's subtype contributions into their target card types.

    Idempotent upsert mirroring :func:`apply_field_contributions`: stamped
    entries are replaced from the manifest on every apply; subtypes owned by
    core/admins/other extensions are never touched. Returns the number of
    subtypes now contributed. The caller commits.
    """
    contributions = subtype_contributions_from_manifest(manifest)
    applied = 0
    touched_types: set[str] = set()
    for contrib in contributions:
        if not isinstance(contrib, dict):
            continue
        type_key = contrib.get("card_type")
        wanted = contrib.get("subtypes") or []
        if not type_key or not isinstance(wanted, list) or not wanted:
            continue
        ct = (
            await db.execute(select(CardType).where(CardType.key == type_key))
        ).scalar_one_or_none()
        if ct is None:
            logger.warning(
                "Extension %s contributes subtypes to missing card type %r — skipped",
                ext_key,
                type_key,
            )
            continue

        existing = [dict(s) if isinstance(s, dict) else s for s in (ct.subtypes or [])]
        foreign = {
            s.get("key")
            for s in existing
            if isinstance(s, dict) and s.get("key") and s.get("ext") != ext_key
        }
        stamped: list[dict] = []
        for s in wanted:
            if not isinstance(s, dict) or not s.get("key") or not s.get("label"):
                continue
            if s["key"] in foreign:
                logger.warning(
                    "Extension %s: subtype %r already exists on %s outside the "
                    "extension — skipped (never hijack an existing subtype)",
                    ext_key,
                    s["key"],
                    type_key,
                )
                continue
            out = {k: v for k, v in s.items() if k in _ALLOWED_SUBTYPE_PROPS}
            out["ext"] = ext_key
            stamped.append(out)
        kept = [s for s in existing if not (isinstance(s, dict) and s.get("ext") == ext_key)]
        if not stamped and kept == existing:
            continue
        ct.subtypes = kept + stamped
        flag_modified(ct, "subtypes")
        touched_types.add(type_key)
        applied += len(stamped)

    # Clean stamped subtypes off types the current manifest no longer targets
    # (same retarget handling as field sections — scans stamps).
    stale = await remove_subtype_contributions(db, ext_key, except_types=touched_types)
    if stale:
        logger.info(
            "Extension %s: removed %d stale contributed subtype(s) from retargeted types",
            ext_key,
            stale,
        )
    if touched_types:
        await db.flush()
    return applied


async def remove_subtype_contributions(
    db: AsyncSession, ext_key: str, *, except_types: AbstractSet[str] = frozenset()
) -> int:
    """Strip this extension's stamped subtypes from every card type.

    ``cards.subtype`` values are deliberately preserved — a card keeps its
    subtype key and the UI degrades to rendering the raw key until the
    extension is re-enabled. Returns the number removed. The caller commits.
    """
    removed = 0
    all_types = (await db.execute(select(CardType))).scalars().all()
    for ct in all_types:
        if ct.key in except_types:
            continue
        subtypes = ct.subtypes or []
        kept = [s for s in subtypes if not (isinstance(s, dict) and s.get("ext") == ext_key)]
        if len(kept) != len(subtypes):
            removed += len(subtypes) - len(kept)
            ct.subtypes = kept
            flag_modified(ct, "subtypes")
    if removed:
        await db.flush()
    return removed


def _reindex_section_order(ct, kept_flags: list[bool]) -> None:
    """Keep ``__order``'s ``custom:N`` keys pointing at the same sections.

    ``custom:N`` is a POSITIONAL index into ``fields_schema`` (minus
    ``__description``), so dropping a section shifts every later one down by
    one and a stored order silently starts addressing the wrong sections.

    ``kept_flags`` is one boolean per *pre-removal* custom section, in schema
    order — it must come from the removal loop rather than be recovered by
    comparing the two schemas, because that loop rebuilds every edited section
    as a NEW dict, which makes identity comparison read them all as removed.
    """
    config = dict(ct.section_config or {})
    order = list(config.get("__order") or [])
    if not order:
        return
    new_index_of: dict[int, int] = {}
    cursor = 0
    for old_index, kept in enumerate(kept_flags):
        if kept:
            new_index_of[old_index] = cursor
            cursor += 1
    remapped: list[str] = []
    for key in order:
        if not key.startswith("custom:"):
            remapped.append(key)
            continue
        try:
            old_index = int(key.split(":", 1)[1])
        except ValueError:
            continue
        new_index = new_index_of.get(old_index)
        if new_index is None:
            continue  # already stale, or the section it pointed at was removed
        remapped.append(f"custom:{new_index}")
    if remapped != order:
        config["__order"] = remapped
        ct.section_config = config
        flag_modified(ct, "section_config")


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
        kept_flags: list[bool] = []
        changed = False
        for section in ct.fields_schema or []:
            custom = _is_custom_section(section)
            if not isinstance(section, dict):
                schema.append(section)
                if custom:
                    kept_flags.append(True)
                continue
            fields = section.get("fields", [])
            kept = [f for f in fields if not (isinstance(f, dict) and f.get("ext") == ext_key)]
            removed += len(fields) - len(kept)
            if len(kept) != len(fields):
                changed = True
            if section.get("ext") == ext_key and not kept:
                # drop the now-empty contributed section entirely
                changed = True
                if custom:
                    kept_flags.append(False)
                continue
            if custom:
                kept_flags.append(True)
            if len(kept) != len(fields):
                section = {**section, "fields": kept}
            schema.append(section)
        if changed:
            _reindex_section_order(ct, kept_flags)
            ct.fields_schema = schema
            flag_modified(ct, "fields_schema")
            touched_types.add(ct.key)

    if touched_types:
        await db.flush()
        await _recompute_data_quality(db, touched_types)
        await db.flush()
    return removed
