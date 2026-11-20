"""Keep an active extension's contributions through a whole-row card-type write.

A card-type save (``PATCH /metamodel/types/{key}``) and a workspace import
(the ``CardTypes`` sheet) both replace ``fields_schema``, ``subtypes`` and
``section_config`` with what they are sent. What an extension's manifest
contributed to that type (``field_contributions``) is stamped ``"ext": "<key>"``
on its sections, fields and subtypes, and those writes are where it used to be
lost: a stale editor copy, an API client or another instance's bundle simply
did not carry it.

What is guaranteed, exactly:

- **Stamps are the stored ones.** A field or subtype takes the stamp the stored
  entry of the same key carries, or none; a section takes the stamp of the
  stored section it stands for (same name, else a renamed one holding its
  stamped fields), or none. A body can neither drop a stamp nor mint one. On an
  import (``mode="import"``) a stamp on a key NEW to this instance is kept as the
  bundle has it when it names an extension not installed here — another
  instance's extension field stays an extension field (a locked one) — and,
  when it names one installed here, only if that extension's manifest
  contributes the key (or section name) to the type; a stamp on a key this
  instance holds unstamped is stripped: a bundle cannot claim an admin field.
- **An ACTIVE extension's contributions cannot be deleted** (active = installed,
  enabled, not ``disabled``/``removed``; the licence plays no part —
  :func:`active_extension_keys`). A stamped field missing from the body comes
  back; a stamped section missing from the body comes back with its stamped
  fields and the admin fields it held that the body does not carry elsewhere; a
  stamped subtype comes back with its stored definition. A stored UNSTAMPED
  section is never restored whole — only the active extension's fields it held
  come back (into it if the body still has it, else into that extension's own
  section, else into a re-created stamped section holding just those fields).
- **Everything else is the body's.** A body may still change a contributed
  field's label, type or options and a section's name, and may delete what an
  extension that is NOT active stamped (a leftover section kept for an admin
  field after an uninstall, stamps an import brought along) — the stamp itself
  is carried as stored for whatever the body keeps.
- **Section order stays truthful.** ``section_config`` addresses custom
  sections positionally (``custom:N``), so a restored section shifts the ones
  after it: :func:`preserve_ext_section_config` re-addresses the ``__order``
  list and the per-section entries with one index map, puts a restored section
  back next to its surviving stored neighbours (else at the default
  placement), and gives every active contributed section a key in a sent
  ``__order`` that lacks it, rather than letting it sink to the end.

Pure functions over plain JSON; the caller passes the active keys. The
transient ``ext_locked`` / ``ext_protected`` flags ``GET /metamodel/types``
adds are stripped from every entry, so they are never persisted.
"""

from __future__ import annotations

import copy
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

from app.services.extensions.field_contributions import (
    contributions_from_manifest,
    is_custom_section,
    resolve_placement,
    subtype_contributions_from_manifest,
)
from app.services.extensions.registry import ExtensionRegistry, extension_registry

Mode = Literal["save", "import"]
_MODES: tuple[Mode, ...] = ("save", "import")

#: Read-only flags a metamodel read adds; never stored.
TRANSIENT_FLAGS = ("ext_locked", "ext_protected")

_INACTIVE_STATUSES = ("disabled", "removed")


def active_extension_keys(registry: ExtensionRegistry | None = None) -> frozenset[str]:
    """Keys of the extensions whose contributions a write may not delete:
    installed, enabled, not ``disabled`` / ``removed``. Same predicate as
    ``field_contributions.heal_contributions``; the licence is irrelevant."""
    reg = extension_registry if registry is None else registry
    return frozenset(
        info.key for info in reg.all() if info.enabled and info.status not in _INACTIVE_STATUSES
    )


@dataclass(frozen=True)
class Contributed:
    """What one installed extension's manifest contributes to one card type:
    field keys, section names and subtype keys."""

    fields: frozenset[str] = frozenset()
    sections: frozenset[str] = frozenset()
    subtypes: frozenset[str] = frozenset()


def _keys(rows: Any, name: str) -> set[str]:
    """The non-empty string ``name`` of every dict in ``rows``."""
    if not isinstance(rows, list):
        return set()
    return {
        r[name] for r in rows if isinstance(r, dict) and isinstance(r.get(name), str) and r[name]
    }


def contributed_by_manifest(manifest: Any, type_key: str) -> Contributed:
    """What ``manifest`` contributes to ``type_key``."""
    fields: set[str] = set()
    sections: set[str] = set()
    subtypes: set[str] = set()
    for c in contributions_from_manifest(manifest if isinstance(manifest, dict) else None):
        if isinstance(c, dict) and c.get("card_type") == type_key:
            if isinstance(c.get("section"), str) and c["section"]:
                sections.add(c["section"])
            fields |= _keys(c.get("fields"), "key")
    for c in subtype_contributions_from_manifest(manifest if isinstance(manifest, dict) else None):
        if isinstance(c, dict) and c.get("card_type") == type_key:
            subtypes |= _keys(c.get("subtypes"), "key")
    return Contributed(frozenset(fields), frozenset(sections), frozenset(subtypes))


def installed_contributions(
    type_key: str, registry: ExtensionRegistry | None = None
) -> dict[str, Contributed]:
    """Per extension INSTALLED here (any status but ``removed``), what its
    manifest contributes to ``type_key`` — what an import may stamp with that
    extension's key (:func:`_import_stamp`)."""
    reg = extension_registry if registry is None else registry
    return {
        info.key: contributed_by_manifest(info.manifest, type_key)
        for info in reg.all()
        if info.status != "removed"
    }


def _import_stamp(
    stamp: str | None, name: Any, kind: str, installed: Mapping[str, Contributed]
) -> str | None:
    """The stamp a bundle may keep on an entry new to this instance: an
    orphan stamp (no such extension installed here) as is; a stamp naming an
    installed extension only on what its manifest contributes (``kind`` is
    ``fields`` / ``sections`` / ``subtypes``) — a bundle cannot make a key of
    its own look like that extension's contribution."""
    if stamp is None or stamp not in installed:
        return stamp
    return stamp if name in getattr(installed[stamp], kind) else None


def stamp_of(item: Any) -> str | None:
    """The ``ext`` stamp of a section, field or subtype dict, or ``None``."""
    if not isinstance(item, dict):
        return None
    stamp = item.get("ext")
    return stamp if isinstance(stamp, str) and stamp else None


def _check_mode(mode: Any) -> None:
    """Refuse a mode that is neither a save nor an import: only ``"import"``
    changes what the guard does, so a misspelt mode would silently act as a
    save."""
    if mode not in _MODES:
        raise ValueError(f"unknown contribution guard mode: {mode!r}")


def _key_of(item: Any) -> str | None:
    if not isinstance(item, dict):
        return None
    key = item.get("key")
    return key if isinstance(key, str) and key else None


def _fields(section: Any) -> list:
    fields = section.get("fields") if isinstance(section, dict) else None
    return fields if isinstance(fields, list) else []


def _clean(item: Any) -> Any:
    """A shallow copy of a dict without the transient flags; anything else as is."""
    if not isinstance(item, dict):
        return item
    return {k: v for k, v in item.items() if k not in TRANSIENT_FLAGS}


def _copy_section(section: Any) -> Any:
    if not isinstance(section, dict):
        return section
    out = _clean(section)
    if isinstance(section.get("fields"), list):
        out["fields"] = [_clean(f) for f in section["fields"]]
    return out


def _set_stamp(item: dict, stamp: str | None) -> None:
    if stamp:
        item["ext"] = stamp
    else:
        item.pop("ext", None)


def _stored_stamps(entries: Any) -> dict[str, str | None]:
    """Key → stamp over ``entries`` (fields or subtypes); a stamped entry wins
    over an unstamped one of the same key."""
    out: dict[str, str | None] = {}
    for entry in entries:
        key = _key_of(entry)
        if key is not None and out.get(key) is None:
            out[key] = stamp_of(entry)
    return out


def _incoming_stamp(
    item: dict,
    stored: Mapping[str, str | None],
    mode: Mode,
    kind: str,
    installed: Mapping[str, Contributed],
) -> str | None:
    key = _key_of(item)
    if key is not None and key in stored:
        return stored[key]
    if mode != "import" or key is None:
        return None
    return _import_stamp(stamp_of(item), key, kind, installed)


# ---------------------------------------------------------------------------
# fields_schema
# ---------------------------------------------------------------------------


@dataclass
class SchemaGuard:
    """The guarded ``fields_schema`` and how its custom sections line up.

    ``body_to_final`` / ``stored_to_final`` map a ``custom:N`` index of the body
    (resp. the stored schema) to the index the same section has in ``schema``;
    a stored section the body deleted has no entry. ``restored`` lists
    ``(final index, stored index)`` for each stored section put back whole.
    ``recreated`` lists the final index of each stamped section re-created to
    hold a restored field (a stand-in for a deleted section: it takes that
    section's place in ``__order`` but none of its per-section settings).
    ``inserted`` is true when any section was put back or re-created.
    """

    schema: list
    body_to_final: dict[int, int] = field(default_factory=dict)
    stored_to_final: dict[int, int] = field(default_factory=dict)
    restored: list[tuple[int, int]] = field(default_factory=list)
    recreated: list[int] = field(default_factory=list)
    inserted: bool = False


def _pair_sections(body: list, stored: list) -> dict[int, dict]:
    """``{stored index: body section}`` for every stored section the body still
    carries: by name and stamp, then by name, then — for a stored section holding stamped fields
    — by those fields, provided the body section's name is not one the stored
    schema already uses (a renamed section; an admin section a contributed
    field was moved into is never taken for the contributed section)."""
    pair: dict[int, dict] = {}
    taken: set[int] = set()
    candidates = [s for s in body if isinstance(s, dict)]
    # Same name AND stamp first: an admin "X" beside a contributed "X" pairs
    # each with its own, whatever order the body sends them in; then name alone.
    for same_stamp in (True, False):
        for i, s in enumerate(stored):
            if i in pair or not isinstance(s, dict):
                continue
            for b in candidates:
                if id(b) in taken or b.get("section") != s.get("section"):
                    continue
                if same_stamp and stamp_of(b) != stamp_of(s):
                    continue
                pair[i] = b
                taken.add(id(b))
                break
    stored_names = {s.get("section") for s in stored if isinstance(s, dict)}
    for i, s in enumerate(stored):
        if i in pair or not isinstance(s, dict):
            continue
        stamped = {_key_of(f) for f in _fields(s) if stamp_of(f)} - {None}
        if not stamped:
            continue
        for b in candidates:
            if id(b) in taken or b.get("section") in stored_names:
                continue
            if stamped & {_key_of(f) for f in _fields(b)}:
                pair[i] = b
                taken.add(id(b))
                break
    return pair


def _index_of(items: list, target: Any) -> int | None:
    for idx, item in enumerate(items):
        if item is target:
            return idx
    return None


def _insert_by_neighbours(
    items: list, origins: list, stored: list, stored_index: int, pair: dict, entry: dict, origin
) -> None:
    """Insert ``entry`` after the nearest earlier stored section still in
    ``items``, else before the nearest later one, else at the end."""
    for j in reversed(range(stored_index)):
        idx = _index_of(items, pair.get(j)) if j in pair else None
        if idx is not None:
            items.insert(idx + 1, entry)
            origins.insert(idx + 1, origin)
            return
    for j in range(stored_index + 1, len(stored)):
        idx = _index_of(items, pair.get(j)) if j in pair else None
        if idx is not None:
            items.insert(idx, entry)
            origins.insert(idx, origin)
            return
    items.append(entry)
    origins.append(origin)


def _insert_field(target: dict, stored_fields: list, position: int, field_def: dict) -> None:
    """Put ``field_def`` into ``target`` right after the nearest field it
    followed in its stored section, else right before the nearest one it
    preceded, else at the end — so the extension's fields keep their order."""
    fields = list(_fields(target))
    keys = [_key_of(f) for f in fields]
    siblings = [_key_of(f) for f in stored_fields]
    index = len(fields)
    before = next((k for k in reversed(siblings[:position]) if k and k in keys), None)
    if before is not None:
        index = keys.index(before) + 1
    else:
        after = next((k for k in siblings[position + 1 :] if k and k in keys), None)
        if after is not None:
            index = keys.index(after)
    fields.insert(index, field_def)
    target["fields"] = fields


def _present_keys(items: list) -> set[str]:
    return {k for s in items for f in _fields(s) if (k := _key_of(f)) is not None}


def preserve_ext_schema(
    body_schema: list | None,
    stored_schema: list | None,
    active_keys: Collection[str],
    *,
    mode: Mode = "save",
    installed: Mapping[str, Contributed] | None = None,
) -> SchemaGuard:
    """Guard a ``fields_schema`` write (see the module docstring for what is
    guaranteed). ``installed`` (:func:`installed_contributions`) bounds the
    stamps an import may bring. Never mutates either argument."""
    _check_mode(mode)
    installed = installed or {}
    stored = list(stored_schema) if isinstance(stored_schema, list) else []
    items = [_copy_section(s) for s in (body_schema if isinstance(body_schema, list) else [])]
    origins: list = [("body", None)] * len(items)
    stored_fields = _stored_stamps(f for s in stored for f in _fields(s))

    # Field stamps: the stored ones, whatever the body says.
    for section in items:
        for f in _fields(section):
            if isinstance(f, dict):
                _set_stamp(f, _incoming_stamp(f, stored_fields, mode, "fields", installed))

    # Section stamps: those of the stored section each body section stands for.
    pair = _pair_sections(items, stored)
    paired = {id(b): stamp_of(stored[i]) for i, b in pair.items()}
    for section in items:
        if not isinstance(section, dict):
            continue
        if id(section) in paired:
            _set_stamp(section, paired[id(section)])
            continue
        claimed = _import_stamp(stamp_of(section), section.get("section"), "sections", installed)
        # A new section keeps a bundle's stamp only alongside a field new to
        # this instance that carries the same one: never on admin fields alone.
        # (On a save every field new here was just unstamped, so a save never
        # keeps one.)
        keeps = claimed and any(
            stamp_of(f) == claimed and _key_of(f) not in stored_fields for f in _fields(section)
        )
        _set_stamp(section, claimed if keeps else None)

    # An active extension's stamped section the body left out comes back.
    present = _present_keys(items)
    restored_ids: set[int] = set()
    for i, s in enumerate(stored):
        if i in pair or stamp_of(s) not in active_keys:
            continue
        section = copy.deepcopy(_copy_section(s))
        section["fields"] = [f for f in _fields(section) if _key_of(f) not in present]
        _insert_by_neighbours(items, origins, stored, i, pair, section, ("restored", i))
        pair[i] = section
        restored_ids.add(id(section))
        present |= _present_keys([section])

    # An active extension's stamped field the body left out comes back.
    stand_in: dict[int, dict] = {}
    for i, s in enumerate(stored):
        for position, f in enumerate(_fields(s)):
            key, stamp = _key_of(f), stamp_of(f)
            if key is None or stamp not in active_keys or key in present:
                continue
            # Into the section that held it, if the body still has it; else
            # into that extension's own section; else into a re-created
            # stamped section (named like the one it was in) holding just it.
            holder = pair.get(i)
            if holder is None:
                holder = next(
                    (x for x in items if isinstance(x, dict) and stamp_of(x) == stamp), None
                )
            if holder is None:
                holder = {"section": s.get("section"), "ext": stamp, "fields": []}
                _insert_by_neighbours(items, origins, stored, i, pair, holder, ("recreated", i))
                # It takes the deleted section's place in the stored order.
                stand_in.setdefault(i, holder)
            _insert_field(holder, _fields(s), position, _clean(copy.deepcopy(f)))
            present.add(key)

    return _line_up(items, origins, stored, {**stand_in, **pair}, restored_ids)


def _line_up(
    items: list, origins: list, stored: list, pair: dict, restored_ids: set[int]
) -> SchemaGuard:
    out = SchemaGuard(schema=items)
    final_of: dict[int, int] = {}  # id(section) -> final custom index
    body_index = 0
    final_index = 0
    for section, origin in zip(items, origins):
        if not is_custom_section(section):
            continue
        final_of[id(section)] = final_index
        if origin[0] == "body":
            out.body_to_final[body_index] = final_index
            body_index += 1
        else:
            out.inserted = True
            if origin[0] == "recreated":
                out.recreated.append(final_index)
        final_index += 1
    stored_index = 0
    for i, s in enumerate(stored):
        if not is_custom_section(s):
            continue
        target = pair.get(i)
        if target is not None and id(target) in final_of:
            out.stored_to_final[stored_index] = final_of[id(target)]
            if id(target) in restored_ids:
                out.restored.append((final_of[id(target)], stored_index))
        stored_index += 1
    return out


# ---------------------------------------------------------------------------
# section_config
# ---------------------------------------------------------------------------


def _custom_index(key: Any) -> int | None:
    """N of a ``custom:N`` key, ``None`` for a malformed one."""
    try:
        index = int(key.split(":", 1)[1])
    except ValueError:
        return None
    return index if index >= 0 else None


def _is_custom_key(key: Any) -> bool:
    return isinstance(key, str) and key.startswith("custom:")


def _place_missing(
    order: list,
    final_schema: list,
    active_keys: Collection[str],
    stored_order: Any,
    stored_to_final: Mapping[int, int],
) -> None:
    """Give every active contributed section of ``final_schema`` a key in
    ``order``: next to its surviving neighbours in the stored order when the
    stored order listed it, else where the apply path would put it."""
    final_to_stored = {f: s for s, f in stored_to_final.items()}
    stored_list = stored_order if isinstance(stored_order, list) else []

    def translate(key: Any) -> Any:
        if not _is_custom_key(key):
            return key
        index = _custom_index(key)
        if index is None or index not in stored_to_final:
            return None
        return f"custom:{stored_to_final[index]}"

    customs = [s for s in final_schema if is_custom_section(s)]
    for final_index, section in enumerate(customs):
        key = f"custom:{final_index}"
        if stamp_of(section) not in active_keys or key in order:
            continue
        at = None
        stored_index = final_to_stored.get(final_index)
        stored_key = f"custom:{stored_index}"
        if stored_index is not None and stored_key in stored_list:
            p = stored_list.index(stored_key)
            for k in reversed(stored_list[:p]):
                if (t := translate(k)) is not None and t in order:
                    at = order.index(t) + 1
                    break
            if at is None:
                for k in stored_list[p + 1 :]:
                    if (t := translate(k)) is not None and t in order:
                        at = order.index(t)
                        break
        order.insert(resolve_placement(order, None) if at is None else at, key)


def _remap_order(order: list, index_map: Mapping[int, int]) -> list:
    out: list = []
    for key in order:
        if not _is_custom_key(key):
            out.append(key)
            continue
        index = _custom_index(key)
        if index is not None and index in index_map:
            out.append(f"custom:{index_map[index]}")
    return out


def preserve_ext_section_config(
    config: dict,
    *,
    final_schema: list,
    active_keys: Collection[str],
    stored_config: Any,
    index_map: Mapping[int, int] | None,
    stored_to_final: Mapping[int, int],
    restored: Collection[tuple[int, int]] = (),
    recreated: Collection[int] = (),
) -> dict:
    """``config`` addressed to ``final_schema``. Never mutates its arguments.

    ``index_map`` maps the ``custom:N`` indices ``config`` was written against
    to the final ones — the body's map when the body sent its own schema, the
    stored one when ``config`` IS the stored config, ``None`` when the schema
    did not change (keys are kept as they are). It re-addresses the ``__order``
    entries and the per-section entries (``hidden``, ``defaultExpanded``…)
    alike; a key whose section is gone is dropped. Each ``restored`` section
    gets back its own stored per-section entry, never another section's; a
    ``recreated`` stand-in gets none (a ``hidden`` of the admin section it
    replaces must not hide the field it was re-created for). Then
    every active contributed section missing from a non-empty ``__order`` is
    placed (:func:`_place_missing`).
    """
    stored = stored_config if isinstance(stored_config, dict) else {}
    out: dict = {}
    for key, value in config.items():
        if not _is_custom_key(key) or index_map is None:
            out[key] = copy.deepcopy(value)
            continue
        index = _custom_index(key)
        if index is not None and index in index_map and index_map[index] not in recreated:
            out[f"custom:{index_map[index]}"] = copy.deepcopy(value)
    for final_index, stored_index in restored:
        own = stored.get(f"custom:{stored_index}")
        if own is not None:
            out[f"custom:{final_index}"] = copy.deepcopy(own)
    order = out.get("__order")
    if isinstance(order, list):
        if index_map is not None:
            order = _remap_order(order, index_map)
        else:
            order = list(order)
        if order:
            _place_missing(order, final_schema, active_keys, stored.get("__order"), stored_to_final)
        out["__order"] = order
    return out


def identity_index_map(schema: Any) -> dict[int, int]:
    """``custom:N`` → itself for every custom section of ``schema``."""
    count = sum(1 for s in (schema if isinstance(schema, list) else []) if is_custom_section(s))
    return {i: i for i in range(count)}


# ---------------------------------------------------------------------------
# subtypes
# ---------------------------------------------------------------------------


def preserve_ext_subtypes(
    body_subtypes: list | None,
    stored_subtypes: list | None,
    active_keys: Collection[str],
    *,
    mode: Mode = "save",
    installed: Mapping[str, Contributed] | None = None,
) -> list:
    """Guard a ``subtypes`` write: stamps carried by key as stored (on an
    import, a stamp on a key new to this instance is kept, within
    :func:`_import_stamp`'s rule), and an active
    extension's stamped subtype the body left out re-appended with its stored
    definition. Never mutates either argument."""
    _check_mode(mode)
    stored = stored_subtypes if isinstance(stored_subtypes, list) else []
    stamps = _stored_stamps(stored)
    installed = installed or {}
    out: list = []
    for entry in body_subtypes if isinstance(body_subtypes, list) else []:
        entry = _clean(entry)
        if isinstance(entry, dict):
            _set_stamp(entry, _incoming_stamp(entry, stamps, mode, "subtypes", installed))
        out.append(entry)
    present = {k for e in out if (k := _key_of(e)) is not None}
    for entry in stored:
        key = _key_of(entry)
        if key is not None and key not in present and stamp_of(entry) in active_keys:
            out.append(_clean(copy.deepcopy(entry)))
            present.add(key)
    return out


# ---------------------------------------------------------------------------
# Read-side flags
# ---------------------------------------------------------------------------


def protected_fields_and_sections(
    schema: Any, active_keys: Collection[str]
) -> tuple[set[str], set[int]]:
    """Field keys and section positions (in ``schema``) an active extension
    stamped — what a write cannot delete."""
    fields: set[str] = set()
    sections: set[int] = set()
    for index, section in enumerate(schema if isinstance(schema, list) else []):
        if stamp_of(section) in active_keys:
            sections.add(index)
        for f in _fields(section):
            key = _key_of(f)
            if key is not None and stamp_of(f) in active_keys:
                fields.add(key)
    return fields, sections


def flag_protected_subtypes(subtypes: Any, active_keys: Collection[str]) -> list:
    """``subtypes`` with ``ext_protected: true`` on each one an active
    extension stamped. Copies; the input is never mutated."""
    entries = subtypes if isinstance(subtypes, list) else []
    if not any(stamp_of(s) in active_keys for s in entries):
        return entries
    return [{**s, "ext_protected": True} if stamp_of(s) in active_keys else s for s in entries]


# ---------------------------------------------------------------------------
# One entry point for a whole card-type row
# ---------------------------------------------------------------------------


def guard_card_type_row(
    row: dict,
    *,
    stored_schema: Any,
    stored_subtypes: Any,
    stored_config: Any,
    active_keys: Collection[str],
    mode: Mode,
    installed: Mapping[str, Contributed] | None = None,
) -> None:
    """Guard the ``fields_schema`` / ``subtypes`` / ``section_config`` a write
    carries (a ``PATCH /metamodel/types`` body, a workspace ``CardTypes`` row),
    in place. A column the write does not carry is left out, except that a
    ``fields_schema`` that puts sections back also re-addresses the stored
    ``section_config`` the write leaves standing; ``None`` stays ``None`` when
    there is nothing to put back.

    - ``fields_schema`` + ``section_config``: the config is re-addressed from
      the write's own indices;
    - ``fields_schema`` alone: the stored config, if a section was put back;
    - ``section_config`` alone (a stale editor): keys kept as sent, and every
      active contributed section given a place in a sent ``__order``.

    ``mode`` is required (``"save"`` or ``"import"``; anything else raises
    ``ValueError``): a caller states which write it guards.
    """
    _check_mode(mode)
    if "fields_schema" in row:
        sent = row["fields_schema"]
        guard = preserve_ext_schema(
            sent, stored_schema, active_keys, mode=mode, installed=installed
        )
        if sent is not None or guard.schema:
            row["fields_schema"] = guard.schema
        config = row.get("section_config")
        if isinstance(config, dict):
            row["section_config"] = preserve_ext_section_config(
                config,
                final_schema=guard.schema,
                active_keys=active_keys,
                stored_config=stored_config,
                index_map=guard.body_to_final,
                stored_to_final=guard.stored_to_final,
                # No ``recreated``: the body's indices never name a section
                # the guard re-created, so the body's map cannot reach one.
                restored=guard.restored,
            )
        elif "section_config" not in row and guard.inserted and isinstance(stored_config, dict):
            row["section_config"] = preserve_ext_section_config(
                stored_config,
                final_schema=guard.schema,
                active_keys=active_keys,
                stored_config=stored_config,
                index_map=guard.stored_to_final,
                stored_to_final=guard.stored_to_final,
                recreated=guard.recreated,
            )
    elif isinstance(row.get("section_config"), dict):
        schema = stored_schema if isinstance(stored_schema, list) else []
        row["section_config"] = preserve_ext_section_config(
            row["section_config"],
            final_schema=schema,
            active_keys=active_keys,
            stored_config=stored_config,
            index_map=None,
            stored_to_final=identity_index_map(schema),
        )
    if "subtypes" in row:
        sent = row["subtypes"]
        subtypes = preserve_ext_subtypes(
            sent, stored_subtypes, active_keys, mode=mode, installed=installed
        )
        if sent is not None or subtypes:
            row["subtypes"] = subtypes
