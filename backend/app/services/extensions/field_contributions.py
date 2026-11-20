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
  degrade like any ``ext.*`` value when the UI plugin isn't loaded. Their
  values do become read-only until the extension is live again —
  ``field_gate`` gates every write.

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

from app.models.card_type import CardType
from app.services.extensions.bundle import DEFAULT_SECTION_PLACEMENT

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


def is_custom_section(section: Any) -> bool:
    """Does this section occupy a ``custom:N`` slot?

    Card detail filters out only the magic ``__description`` section and then
    indexes what remains POSITIONALLY (``CardDetailContent`` /
    ``CardLayoutEditor``), so every other entry counts — a malformed non-dict
    one included, since it still shifts the sections after it.
    """
    return not (isinstance(section, dict) and section.get("section") == "__description")


def custom_section_index(schema: list[dict], section: dict) -> int | None:
    """The ``custom:N`` index the frontend will address this section by.

    Computed exactly the way card detail computes it (see
    :func:`is_custom_section`) or an inserted order entry would point at a
    different section.
    """
    customs = [s for s in schema if is_custom_section(s)]
    for idx, candidate in enumerate(customs):
        if candidate is section:
            return idx
    return None


def resolve_placement(order: list[str], placement: str | None) -> int:
    """Index in ``order`` at which a contributed section should be inserted.

    Pure and unit-testable. Grammar is ``start`` / ``end`` /
    ``before:<anchor>`` / ``after:<anchor>``; see ``SECTION_ANCHORS``.

    An anchor a given card type does not carry is NOT an error — ``eol`` and
    ``successors`` exist on some types and not others, and a contribution
    targeting several types has one placement for all of them. It degrades to
    the default rather than to the bottom of the card: an author who asked for
    "after:eol" wants the section high, and silently sinking it below Relations
    is the outcome they were most trying to avoid.
    """
    spec = (placement or DEFAULT_SECTION_PLACEMENT).strip()
    for candidate in (spec, DEFAULT_SECTION_PLACEMENT):
        if candidate == "start":
            return 0
        if candidate == "end":
            return len(order)
        prefix, _, anchor = candidate.partition(":")
        if anchor in order:
            return order.index(anchor) + (1 if prefix == "after" else 0)
    return len(order)


def _place_section(ct, schema: list[dict], section: dict, placement: str | None) -> None:
    """Give a contributed section a stored place in ``__order``.

    A ``custom:N`` absent from a stored ``__order`` has no position of its own,
    and both order builders fall back to appending it last — below Relations,
    the longest section on the page, where it reads as missing. So give it a
    real position, chosen by the extension via the manifest's ``placement``
    (default ``before:relations``). Core supplies a sensible default and no
    opinion beyond it: where a contributed section belongs is a property of
    what the extension is, not of the platform.

    **Write the order; never compensate in a renderer.** Card detail and the
    Card Layout editor each build an order from this same config, and they
    disagree about an absent key (the editor appends, card detail splices
    ``tags``/``successors`` before ``relations``). Fixing this in either one
    makes the editor and the card show different positions for a section
    neither has stored. Writing the key leaves both simply reading it, and
    keeps the metamodel config the single source of truth.

    Runs on **every** apply, not only on first creation: an instance whose
    contributed section already exists takes the merge path, never the creation
    path, so a first-creation-only call left every pre-existing install stuck at
    the bottom with no upgrade able to fix it.

    Two guards — not a creation check — are what make that safe:
    - **no-op when no ``__order`` is stored.** That path already renders custom
      sections above hierarchy/tags/relations, and writing an order where none
      existed would freeze a layout the admin never chose.
    - **no-op when the key is already in the order.** A placement is a starting
      point, not a policy: once anything has placed the section — this helper on
      an earlier apply, or an admin dragging it, including deliberately below
      Relations — a re-apply leaves it exactly where it is. That is also what
      stops a manifest edit re-homing a section somebody has since arranged.
    """
    config = dict(ct.section_config or {})
    order = list(config.get("__order") or [])
    if not order:
        return
    index = custom_section_index(schema, section)
    if index is None:
        return
    key = f"custom:{index}"
    if key in order:
        return
    order.insert(resolve_placement(order, placement), key)
    config["__order"] = order
    ct.section_config = config
    flag_modified(ct, "section_config")


def _own_sections(schema: list, ext_key: str) -> list[dict]:
    return [s for s in schema if isinstance(s, dict) and s.get("ext") == ext_key]


def _is_own_field(field: Any, ext_key: str, keys: AbstractSet[str]) -> bool:
    return isinstance(field, dict) and field.get("ext") == ext_key and field.get("key") in keys


def _resync_in_place(
    schema: list, ext_key: str, fields: list[dict], *, skip: dict | None
) -> set[str]:
    """Replace, where it stands, every field of ``fields`` this extension
    already has in a section other than ``skip`` (its own section, if found).

    An admin may move a contributed field into a section of their own; an
    apply then re-syncs its definition from the manifest at that position
    rather than adding the key a second time to the contribution's section.
    Rebuilds each changed section's field list (``schema`` holds copies of the
    stored sections), so the stored schema is never mutated. Returns the keys
    found elsewhere.
    """
    by_key = {f["key"]: f for f in fields}
    found: set[str] = set()
    for section in schema:
        if not isinstance(section, dict) or section is skip:
            continue
        current = section.get("fields")
        if not isinstance(current, list) or not any(
            _is_own_field(f, ext_key, by_key.keys()) for f in current
        ):
            continue
        rebuilt = []
        for f in current:
            if _is_own_field(f, ext_key, by_key.keys()):
                found.add(f["key"])
                rebuilt.append(_resynced_at(f, by_key[f["key"]]))
            else:
                rebuilt.append(f)
        section["fields"] = rebuilt
    return found


#: Where a field sits inside its section — set by the Card Layout editor, so
#: they describe the admin's position, not the field.
_LAYOUT_PROPS = ("column", "group")


def _resynced_at(current: dict, fresh: dict) -> dict:
    """``fresh`` (the manifest definition) for a field that stands where
    ``current`` stands: its layout props are ``current``'s, never the
    manifest's — the manifest's column and group name its own section."""
    out = {k: v for k, v in fresh.items() if k not in _LAYOUT_PROPS}
    out.update({k: current[k] for k in _LAYOUT_PROPS if k in current})
    return out


def _manifest_field_keys(contributions: list, type_key: str) -> set[str]:
    """Every field key the manifest contributes to ``type_key``, whichever
    contribution (section) declares it."""
    keys: set[str] = set()
    for contrib in contributions:
        if not isinstance(contrib, dict) or contrib.get("card_type") != type_key:
            continue
        fields = contrib.get("fields")
        for f in fields if isinstance(fields, list) else []:
            if isinstance(f, dict) and isinstance(f.get("key"), str) and f["key"]:
                keys.add(f["key"])
    return keys


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
    from app.services.data_quality import rescore_card_type

    # The batched scorer (a fixed number of statements per type, whatever the
    # card count), run under derived_maintenance: installing an extension is
    # not an edit to every card of the type — the scores move, the Modified
    # dates do not.
    for type_key in sorted(type_keys):
        await rescore_card_type(db, type_key)


async def apply_field_contributions(
    db: AsyncSession, ext_key: str, manifest: dict[str, Any] | None
) -> int:
    """Merge the manifest's field sections into their target card types.

    Idempotent upsert: contributed sections/fields are stamped
    ``ext=<key>`` and replaced from the manifest on every apply; fields
    other admins/extensions own are never touched. The contribution's section
    is the one stamped by this extension under the manifest's name, else the
    single stamped section of this extension no contribution names (a manifest
    rename); an unstamped (admin) section is never adopted, renamed or
    restamped. A contributed field already stamped by this extension in some
    other section is re-synced there in place and not added again; a section
    is created only when it would hold at least one field. Returns the number
    of fields now contributed. The caller commits.
    """
    contributions = contributions_from_manifest(manifest)
    if not contributions:
        return 0

    applied = 0
    touched_types: set[str] = set()
    for contrib in contributions:
        if not isinstance(contrib, dict):
            continue
        type_key = contrib.get("card_type")
        section_name = contrib.get("section")
        wanted_fields = contrib.get("fields") or []
        if not type_key or not section_name or not isinstance(wanted_fields, list):
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
        own_keys = {f["key"] for f in fields}
        # This manifest's other contributions to the same type: a field of
        # theirs an admin moved into this section belongs here now.
        sibling_keys = _manifest_field_keys(contributions, type_key) - own_keys

        # Find our section: by (marker, name) first; a single unclaimed marked
        # section adopts a manifest rename. An unstamped section is never ours,
        # whatever it holds — that is an admin's section.
        target = next(
            (
                s
                for s in schema
                if isinstance(s, dict)
                and s.get("ext") == ext_key
                and s.get("section") == section_name
            ),
            None,
        )
        if target is None:
            owned = _own_sections(schema, ext_key)
            wanted_names = {c.get("section") for c in contributions if isinstance(c, dict)}
            orphans = [s for s in owned if s.get("section") not in wanted_names]
            if len(orphans) == 1:
                target = orphans[0]

        # A contributed field an admin moved into another section stays there:
        # re-synced from the manifest in place, never added a second time.
        elsewhere = _resync_in_place(schema, ext_key, fields, skip=target)
        own_fields = [f for f in fields if f["key"] not in elsewhere]
        touched_types.add(type_key)
        applied += len(fields)
        if target is None and not own_fields:
            ct.fields_schema = schema
            flag_modified(ct, "fields_schema")
            continue

        if target is None:
            target = {"section": section_name, "ext": ext_key, "fields": []}
            schema.append(target)
        target["section"] = section_name
        target["ext"] = ext_key
        _place_section(ct, schema, target, contrib.get("placement"))
        if "columns" in contrib:
            target["columns"] = contrib["columns"]
        if "translations" in contrib:
            target["translations"] = contrib["translations"]
        if "groupTranslations" in contrib:
            target["groupTranslations"] = contrib["groupTranslations"]
        # Replace our fields; keep admin-added (unstamped) fields in place, and
        # a sibling contribution's field moved here (re-synced by that
        # contribution, before or after this one). Drop only this
        # contribution's own keys (re-added below) and stamped keys the
        # manifest no longer declares.
        kept = [
            f
            for f in target.get("fields", [])
            if isinstance(f, dict) and (f.get("ext") != ext_key or f.get("key") in sibling_keys)
        ]
        target["fields"] = kept + own_fields

        ct.fields_schema = schema
        flag_modified(ct, "fields_schema")

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


def _merge_subtypes(existing: list, stamped: list[dict], ext_key: str) -> list:
    """``existing`` with this extension's subtypes re-synced from ``stamped``.

    A stamped subtype the manifest still declares keeps its place and every
    property the manifest does not own (``hidden_fields``,
    ``optional_relations`` and whatever else an admin set on it); the
    manifest-owned properties (``_ALLOWED_SUBTYPE_PROPS``) are replaced from
    the manifest, so one it no longer declares is dropped. A stamped subtype
    the manifest no longer declares is removed; a new one is appended.
    """
    wanted = {s["key"]: s for s in stamped}
    out: list = []
    placed: set[str] = set()
    for s in existing:
        if not (isinstance(s, dict) and s.get("ext") == ext_key):
            out.append(s)
            continue
        fresh = wanted.get(s.get("key"))
        if fresh is None or fresh["key"] in placed:
            continue
        admin_props = {k: v for k, v in s.items() if k not in _ALLOWED_SUBTYPE_PROPS}
        out.append({**fresh, **admin_props})
        placed.add(fresh["key"])
    out.extend(s for s in stamped if s["key"] not in placed)
    return out


async def apply_subtype_contributions(
    db: AsyncSession, ext_key: str, manifest: dict[str, Any] | None
) -> int:
    """Merge the manifest's subtype contributions into their target card types.

    Idempotent upsert mirroring :func:`apply_field_contributions`: the
    manifest-owned properties of stamped entries are re-synced on every apply
    (:func:`_merge_subtypes` — what an admin set on a contributed subtype
    stays); subtypes owned by core/admins/other extensions are never touched.
    Writes only when the list changes. Returns the number of subtypes now
    contributed. The caller commits.
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
        merged = _merge_subtypes(existing, stamped, ext_key)
        if not stamped and merged == existing:
            continue
        touched_types.add(type_key)
        applied += len(stamped)
        if merged != existing:
            ct.subtypes = merged
            flag_modified(ct, "subtypes")

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
            custom = is_custom_section(section)
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


# ---------------------------------------------------------------------------
# Self-heal. Contributions are re-applied on install, update and enable only,
# so anything that removed them in between — a card-type save from a stale
# editor copy before saves preserved them, a workspace import overwriting the
# type — left them gone until someone toggled the extension. Startup (and the
# workspace importer) re-applies what is MISSING, and only that: an apply
# rescores every card of each touched type, which must not run on every boot.
# ---------------------------------------------------------------------------


def _type_field_keys(ct: CardType) -> set[str]:
    """Every field key on the type, in any section, whoever owns it."""
    keys: set[str] = set()
    for section in ct.fields_schema if isinstance(ct.fields_schema, list) else []:
        fields = section.get("fields") if isinstance(section, dict) else None
        for f in fields if isinstance(fields, list) else []:
            if isinstance(f, dict) and isinstance(f.get("key"), str) and f["key"]:
                keys.add(f["key"])
    return keys


def field_sections_missing(
    types: dict[str, CardType], ext_key: str, manifest: dict[str, Any] | None
) -> bool:
    """Would :func:`apply_field_contributions` put a field back?

    Field-centric: a contribution is missing only when one of its field keys
    is absent from the whole target type. A key present anywhere counts as
    present — stamped by this extension in any section (an admin may rename
    the contributed section or move its fields into a section of their own;
    neither is undone), or held unstamped or by another extension, which apply
    never takes over (or every boot would re-apply to no effect). ``ext_key``
    is kept for the call shape; ownership does not decide presence.
    """
    for contrib in contributions_from_manifest(manifest):
        if not isinstance(contrib, dict):
            continue
        ct = types.get(str(contrib.get("card_type")))
        fields = contrib.get("fields")
        if ct is None or not contrib.get("section") or not isinstance(fields, list):
            continue
        present = _type_field_keys(ct)
        for f in fields:
            if isinstance(f, dict) and isinstance(f.get("key"), str) and f["key"]:
                if f["key"] not in present:
                    return True
    return False


def subtypes_missing(
    types: dict[str, CardType], ext_key: str, manifest: dict[str, Any] | None
) -> bool:
    """Would :func:`apply_subtype_contributions` put a subtype back? Only an
    absent key counts; one present outside the extension is never taken over."""
    for contrib in subtype_contributions_from_manifest(manifest):
        if not isinstance(contrib, dict):
            continue
        ct = types.get(str(contrib.get("card_type")))
        if ct is None or not isinstance(contrib.get("subtypes"), list):
            continue
        present = {s.get("key") for s in ct.subtypes or [] if isinstance(s, dict)}
        for s in contrib["subtypes"]:
            if isinstance(s, dict) and s.get("key") and s.get("label") and s["key"] not in present:
                return True
    return False


def _target_type_keys(manifest: dict[str, Any] | None) -> set[str]:
    rows = contributions_from_manifest(manifest) + subtype_contributions_from_manifest(manifest)
    return {
        r["card_type"] for r in rows if isinstance(r, dict) and isinstance(r.get("card_type"), str)
    }


async def _target_types(db: AsyncSession, manifest: dict[str, Any] | None) -> dict[str, CardType]:
    keys = _target_type_keys(manifest)
    if not keys:
        return {}
    rows = (await db.execute(select(CardType).where(CardType.key.in_(keys)))).scalars().all()
    return {ct.key: ct for ct in rows}


async def contributions_missing(
    db: AsyncSession, ext_key: str, manifest: dict[str, Any] | None
) -> bool:
    """Is any field section, field or subtype this manifest contributes gone
    from its (existing) target card type? Read-only."""
    types = await _target_types(db, manifest)
    return field_sections_missing(types, ext_key, manifest) or subtypes_missing(
        types, ext_key, manifest
    )


async def heal_contributions(db: AsyncSession) -> list[str]:
    """Re-apply the contributions of every active extension that lost some.

    Active means enabled and neither ``disabled`` nor ``removed``; the licence
    plays no part, since a lapse never removes contributions. Each half (field
    sections, subtypes) is applied only when it is missing, so an intact
    instance is not written to and no data quality is recomputed.

    Each extension runs in its own savepoint: one that raises (a malformed
    manifest, a junk row) is rolled back, logged, and the next one is still
    healed, so neither boot nor a workspace import fails on it. Flushes, never
    commits: the caller owns the session. Returns the healed keys.
    """
    from app.models.extension import Extension

    rows = (
        (
            await db.execute(
                select(Extension)
                .where(
                    Extension.enabled.is_(True),
                    Extension.status.not_in(("disabled", "removed")),
                )
                .order_by(Extension.key)
            )
        )
        .scalars()
        .all()
    )
    # Plain values up front: a rolled-back savepoint expires what it touched.
    candidates = [(row.key, row.manifest or {}) for row in rows]
    healed: list[str] = []
    for key, manifest in candidates:
        try:
            async with db.begin_nested():
                types = await _target_types(db, manifest)
                fields_gone = field_sections_missing(types, key, manifest)
                subtypes_gone = subtypes_missing(types, key, manifest)
                if fields_gone:
                    await apply_field_contributions(db, key, manifest)
                if subtypes_gone:
                    await apply_subtype_contributions(db, key, manifest)
        except Exception:
            logger.exception("Extension %s: restoring its metamodel contributions failed", key)
            continue
        if fields_gone or subtypes_gone:
            healed.append(key)
    return healed
