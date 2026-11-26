"""The ``metamodel`` namespace of a custom language: every database-held label.

Card types, their subtypes, hierarchy labels, sections, field groups, fields
(label, help, badge) and options, stakeholder roles, relation types and their
attributes, card-type categories, dashboards, compliance regulations, resource
types and the lifecycle phase help all carry their own translations in the
database. A custom language translates them through the same pack, validator
and routes as the UI strings: ``metamodel`` is just one more namespace.

**The text is stored where it already lives** — in the record's own
``translations`` map (or ``helpTranslations`` / ``badgeTranslations`` /
``groupTranslations``), under the custom locale's code — so every existing
resolver on the frontend renders it with no change. :func:`apply` writes
through the ORM, never through the admin routes, and changes nothing but the
custom code's entry of each addressed map: built-in relation attributes, locked
categories and dashboards have no editable translation route, and adding a
language is not editing the record. The ``metamodel`` row of
``custom_locale_strings`` keeps only ``meta`` (source hash + origin), except
the lifecycle phase help: its defaults are code (``lifecycle_phase_help.py``)
and storing a custom locale in the setting would freeze them for every built-in
locale, so a custom language's phase help lives in that row's ``strings`` and
:func:`overlay_phase_help` lays it over the bootstrap payload.

**Keys** are built from stable keys, never ids — ``type.Application.label``,
``type.Application.field.businessCriticality.option.missionCritical``,
``relation.relAppToITC.reverse_label``, ``lifecycle.phaseIn`` (the full table is
in :func:`card_type_slots` and its siblings). Every segment is escaped with
:func:`escape_segment` — ``%`` becomes ``%25`` and ``.`` becomes ``%2E`` — so a
free-text segment (a section name, a group name, a category key such as
``Strategy & Transformation``) can never split a key, and
:func:`split_key` parses a key back unambiguously. A field group is written
under its raw name (the card page reads ``groupTranslations[field.group]``).
Two sections of one card type with the same name share one key: the listing
shows the first, :func:`apply` writes all of them. A built-in locale code is
never written (:func:`apply` refuses it).

**English** is ``translations["en"]`` where the seed writes one (card types,
relation types, subtypes, sections, fields, options), else the column.
"""

from __future__ import annotations

import copy
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings
from app.models.card_type import CardType
from app.models.card_type_category import CardTypeCategory
from app.models.compliance_regulation import ComplianceRegulation
from app.models.dashboard import Dashboard
from app.models.relation_type import RelationType
from app.models.resource_type import ResourceType
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services import language_pack as lp
from app.services.lifecycle import PHASE_CHRONOLOGICAL
from app.services.lifecycle_phase_help import read_phase_help

NAMESPACE = lp.METAMODEL_NAMESPACE
LIFECYCLE_PREFIX = "lifecycle."


# ---------------------------------------------------------------------------
# Keys
# ---------------------------------------------------------------------------


def escape_segment(text: Any) -> str:
    """One key segment: ``%`` → ``%25`` first, then ``.`` → ``%2E``."""
    return str(text).replace("%", "%25").replace(".", "%2E")


def unescape_segment(text: str) -> str:
    return text.replace("%2E", ".").replace("%2e", ".").replace("%25", "%")


def make_key(*segments: Any) -> str:
    return ".".join(escape_segment(s) for s in segments)


def split_key(key: str) -> list[str]:
    """The segments of a key built by :func:`make_key`."""
    return [unescape_segment(part) for part in key.split(".")]


# ---------------------------------------------------------------------------
# Slots: where one translatable text lives inside a record
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Slot:
    """``key``'s English text and the locale map holding its translations:
    ``column`` of the record, then ``path`` inside that column's JSON (``()``
    when the column itself is the map)."""

    key: str
    english: str
    column: str
    path: tuple[Any, ...]


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _english(locale_map: Any, fallback: Any) -> str:
    """``locale_map["en"]`` when it is a non-empty string, else ``fallback``."""
    if isinstance(locale_map, Mapping):
        en = _text(locale_map.get("en"))
        if en:
            return en
    return _text(fallback)


def _get(mapping: Any, key: str) -> Any:
    return mapping.get(key) if isinstance(mapping, Mapping) else None


def _option_slots(
    options: Any, prefix: tuple[Any, ...], column: str, path: tuple[Any, ...]
) -> list[Slot]:
    slots = []
    for i, opt in enumerate(options if isinstance(options, list) else []):
        if not isinstance(opt, Mapping) or not opt.get("key"):
            continue
        english = _english(opt.get("translations"), opt.get("label"))
        if english:
            slots.append(
                Slot(
                    make_key(*prefix, "option", opt["key"]),
                    english,
                    column,
                    (*path, i, "translations"),
                )
            )
    return slots


def card_type_slots(rec: Mapping[str, Any]) -> list[Slot]:
    """A card type's labels.

    ``type.<t>.label`` / ``.description``, ``type.<t>.subtype.<s>``,
    ``type.<t>.hierarchy.<h>``, ``type.<t>.section.<name>``,
    ``type.<t>.section.<name>.group.<group>``, ``type.<t>.field.<f>`` /
    ``.help`` / ``.badge``, ``type.<t>.field.<f>.option.<o>``."""
    t = rec["key"]
    translations = rec.get("translations")
    slots: list[Slot] = []
    label = _english(_get(translations, "label"), rec.get("label"))
    if label:
        slots.append(Slot(make_key("type", t, "label"), label, "translations", ("label",)))
    description = _english(_get(translations, "description"), rec.get("description"))
    if description:
        slots.append(
            Slot(make_key("type", t, "description"), description, "translations", ("description",))
        )
    for i, sub in enumerate(rec.get("subtypes") or []):
        if isinstance(sub, Mapping) and sub.get("key"):
            english = _english(sub.get("translations"), sub.get("label"))
            if english:
                slots.append(
                    Slot(
                        make_key("type", t, "subtype", sub["key"]),
                        english,
                        "subtypes",
                        (i, "translations"),
                    )
                )
    for i, level in enumerate(rec.get("hierarchy_labels") or []):
        if isinstance(level, Mapping) and level.get("key"):
            english = _english(level.get("translations"), level.get("label"))
            if english:
                slots.append(
                    Slot(
                        make_key("type", t, "hierarchy", level["key"]),
                        english,
                        "hierarchy_labels",
                        (i, "translations"),
                    )
                )
    for si, section in enumerate(rec.get("fields_schema") or []):
        if not isinstance(section, Mapping):
            continue
        name = _text(section.get("section"))
        if name and name != "__description":
            english = _english(section.get("translations"), name)
            slots.append(
                Slot(
                    make_key("type", t, "section", name),
                    english,
                    "fields_schema",
                    (si, "translations"),
                )
            )
        raw_fields = section.get("fields")
        fields: list[Any] = raw_fields if isinstance(raw_fields, list) else []
        # A group is addressed by its raw name: the card page looks up
        # ``groupTranslations[field.group]`` exactly as stored.
        groups: list[str] = []
        for f in fields:
            group = _get(f, "group")
            if isinstance(group, str) and group.strip() and group not in groups:
                groups.append(group)
        for group in _get(section, "groupTranslations") or {}:
            if isinstance(group, str) and group.strip() and group not in groups:
                groups.append(group)
        for group in groups:
            slots.append(
                Slot(
                    make_key("type", t, "section", name, "group", group),
                    group.strip(),
                    "fields_schema",
                    (si, "groupTranslations", group),
                )
            )
        for fi, f in enumerate(fields):
            if not isinstance(f, Mapping) or not f.get("key"):
                continue
            base = ("type", t, "field", f["key"])
            path = (si, "fields", fi)
            english = _english(f.get("translations"), f.get("label"))
            if english:
                slots.append(
                    Slot(make_key(*base), english, "fields_schema", (*path, "translations"))
                )
            help_text = _english(f.get("helpTranslations"), f.get("help"))
            if help_text:
                slots.append(
                    Slot(
                        make_key(*base, "help"),
                        help_text,
                        "fields_schema",
                        (*path, "helpTranslations"),
                    )
                )
            badge = _english(f.get("badgeTranslations"), f.get("badge"))
            if badge:
                slots.append(
                    Slot(
                        make_key(*base, "badge"),
                        badge,
                        "fields_schema",
                        (*path, "badgeTranslations"),
                    )
                )
            slots.extend(_option_slots(f.get("options"), base, "fields_schema", (*path, "options")))
    return slots


def role_slots(rec: Mapping[str, Any]) -> list[Slot]:
    """``role.<cardType>.<role>.label`` / ``.description``."""
    base = ("role", rec["card_type_key"], rec["key"])
    translations = rec.get("translations")
    slots = []
    for prop in ("label", "description"):
        english = _english(_get(translations, prop), rec.get(prop))
        if english:
            slots.append(Slot(make_key(*base, prop), english, "translations", (prop,)))
    return slots


def relation_slots(rec: Mapping[str, Any]) -> list[Slot]:
    """``relation.<r>.label`` / ``.reverse_label``, ``relation.<r>.attr.<f>``
    and ``relation.<r>.attr.<f>.option.<o>``."""
    r = rec["key"]
    translations = rec.get("translations")
    slots = []
    for prop in ("label", "reverse_label"):
        english = _english(_get(translations, prop), rec.get(prop))
        if english:
            slots.append(Slot(make_key("relation", r, prop), english, "translations", (prop,)))
    for i, attr in enumerate(rec.get("attributes_schema") or []):
        if not isinstance(attr, Mapping) or not attr.get("key"):
            continue
        base = ("relation", r, "attr", attr["key"])
        english = _english(attr.get("translations"), attr.get("label"))
        if english:
            slots.append(Slot(make_key(*base), english, "attributes_schema", (i, "translations")))
        slots.extend(_option_slots(attr.get("options"), base, "attributes_schema", (i, "options")))
    return slots


def flat_slot(key: str, english: Any) -> list[Slot]:
    """A record whose ``translations`` column is itself ``{locale: text}``."""
    text = _text(english)
    return [Slot(key, text, "translations", ())] if text else []


def category_slots(rec: Mapping[str, Any]) -> list[Slot]:
    return flat_slot(make_key("category", rec["key"]), rec.get("label"))


def dashboard_slots(rec: Mapping[str, Any]) -> list[Slot]:
    return flat_slot(make_key("dashboard", rec["key"]), rec.get("name")) if rec.get("key") else []


def regulation_slots(rec: Mapping[str, Any]) -> list[Slot]:
    return flat_slot(make_key("regulation", rec["key"]), rec.get("label"))


def resource_slots(rec: Mapping[str, Any]) -> list[Slot]:
    return flat_slot(make_key("resource", rec["kind"], rec["key"]), rec.get("label"))


def lifecycle_english(general: Mapping[str, Any] | None) -> dict[str, str]:
    """``{lifecycle.<phase>: English}`` for every phase that has English help
    (a phase saved empty means "no help" and has no entry)."""
    help_ = read_phase_help(general)
    out = {}
    for phase in PHASE_CHRONOLOGICAL:
        english = _text((help_.get(phase) or {}).get("en"))
        if english:
            out[make_key("lifecycle", phase)] = english
    return out


# ---------------------------------------------------------------------------
# Reading the stored translations
# ---------------------------------------------------------------------------

_COLUMNS = {
    CardType: (
        "key",
        "label",
        "description",
        "translations",
        "subtypes",
        "hierarchy_labels",
        "fields_schema",
    ),
    StakeholderRoleDefinition: ("card_type_key", "key", "label", "description", "translations"),
    RelationType: ("key", "label", "reverse_label", "translations", "attributes_schema"),
    CardTypeCategory: ("key", "label", "translations"),
    Dashboard: ("key", "name", "translations"),
    ComplianceRegulation: ("key", "label", "translations"),
    ResourceType: ("kind", "key", "label", "translations"),
}

_SLOTS = {
    CardType: card_type_slots,
    StakeholderRoleDefinition: role_slots,
    RelationType: relation_slots,
    CardTypeCategory: category_slots,
    Dashboard: dashboard_slots,
    ComplianceRegulation: regulation_slots,
    ResourceType: resource_slots,
}

_ORDER = {
    CardType: (CardType.sort_order, CardType.key),
    StakeholderRoleDefinition: (
        StakeholderRoleDefinition.card_type_key,
        StakeholderRoleDefinition.sort_order,
        StakeholderRoleDefinition.key,
    ),
    RelationType: (RelationType.sort_order, RelationType.key),
    CardTypeCategory: (CardTypeCategory.sort_order, CardTypeCategory.key),
    Dashboard: (Dashboard.sort_order, Dashboard.key),
    ComplianceRegulation: (ComplianceRegulation.sort_order, ComplianceRegulation.key),
    ResourceType: (ResourceType.kind, ResourceType.sort_order, ResourceType.key),
}


def record_view(obj: Any) -> dict[str, Any]:
    return {col: getattr(obj, col) for col in _COLUMNS[type(obj)]}


@dataclass
class Snapshot:
    """Every record that carries metamodel labels, with its slots, plus the
    English lifecycle phase help — read once, used for any number of locales."""

    records: list[tuple[Any, list[Slot]]] = field(default_factory=list)
    lifecycle: dict[str, str] = field(default_factory=dict)

    def slots(self) -> Iterable[tuple[Any, Slot]]:
        for obj, slots in self.records:
            for slot in slots:
                yield obj, slot


async def load(db: AsyncSession) -> Snapshot:
    snap = Snapshot()
    for model, build in _SLOTS.items():
        rows = (await db.execute(select(model).order_by(*_ORDER[model]))).scalars().all()
        for obj in rows:
            snap.records.append((obj, build(record_view(obj))))
    row = (
        await db.execute(select(AppSettings).where(AppSettings.id == "default"))
    ).scalar_one_or_none()
    snap.lifecycle = lifecycle_english(row.general_settings if row else None)
    return snap


def locale_map(obj: Any, slot: Slot) -> Mapping[str, Any] | None:
    node: Any = getattr(obj, slot.column)
    for part in slot.path:
        if isinstance(part, int):
            node = node[part] if isinstance(node, list) and part < len(node) else None
        else:
            node = node.get(part) if isinstance(node, Mapping) else None
        if node is None:
            return None
    return node if isinstance(node, Mapping) else None


@dataclass(frozen=True)
class Entry:
    key: str
    english: str
    value: str | None
    #: The key and its English text are exactly the built-in seed's — the
    #: entry may go into a community (share) pack.
    built_in: bool


def entries(
    snap: Snapshot, code: str, pack_strings: Mapping[str, Any] | None = None
) -> list[Entry]:
    """The ``metamodel`` entries for ``code``, first slot per key winning;
    lifecycle values come from the pack row's ``strings``."""
    seed = seed_english()
    out: dict[str, Entry] = {}
    for obj, slot in snap.slots():
        if slot.key in out:
            continue
        found = locale_map(obj, slot)
        value = found.get(code) if found is not None else None
        out[slot.key] = Entry(
            slot.key,
            slot.english,
            value if isinstance(value, str) and value else None,
            seed.get(slot.key) == slot.english,
        )
    stored = pack_strings or {}
    for key, english in snap.lifecycle.items():
        value = stored.get(key)
        out[key] = Entry(
            key,
            english,
            value if isinstance(value, str) and value else None,
            seed.get(key) == english,
        )
    return list(out.values())


async def collect(
    db: AsyncSession, code: str, pack_strings: Mapping[str, Any] | None = None
) -> list[Entry]:
    return entries(await load(db), code, pack_strings)


class MetamodelNamespace(lp.Namespace):
    """The ``metamodel`` namespace as a ``language_pack.Namespace``: its
    English comes from the database, and only its own keys exist (no plural
    siblings)."""

    def source_key(self, key: str) -> str | None:
        return key if key in self.strings else None


def namespace_of(items: Iterable[Entry]) -> MetamodelNamespace:
    strings = {e.key: e.english for e in items}
    return MetamodelNamespace(
        name=NAMESPACE,
        strings=strings,
        hashes={k: lp.source_hash(v) for k, v in strings.items()},
    )


def values_of(items: Iterable[Entry]) -> dict[str, str]:
    return {e.key: e.value for e in items if e.value}


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _prune_empty(data: Any, path: tuple[Any, ...]) -> None:
    """Remove the maps along ``path`` that a clear left empty, deepest first
    (an emptied ``translations`` / ``groupTranslations`` entry is dropped, not
    left behind as ``{}``). A list element and the column itself stay."""
    for depth in range(len(path), 0, -1):
        part = path[depth - 1]
        if isinstance(part, int):
            return
        parent: Any = data
        for step in path[: depth - 1]:
            parent = parent[step]
        # A string step always addresses a dict: the slot was built from it.
        child = parent.get(part)
        if not (isinstance(child, dict) and not child):
            return
        del parent[part]


def _write_slot(obj: Any, slot: Slot, code: str, value: str | None) -> bool:
    """Set (or with ``None`` remove) ``code`` in the slot's locale map,
    reassigning the column as a new object so the change is flushed. Every
    other key of the JSON stays as it was; a map a clear empties is removed.
    ``False`` when nothing changed."""
    current = locale_map(obj, slot)
    before = current.get(code) if current is not None else None
    if before == value:
        return False
    data = copy.deepcopy(getattr(obj, slot.column))
    if data is None:
        data = {}
    node: Any = data
    for part, following in zip(slot.path, (*slot.path[1:], None)):
        if isinstance(part, int) or isinstance(following, int):
            # A list element, or the list holding it (a section's ``fields``,
            # a field's ``options``): it exists, the slot was built from it.
            node = node[part]
            continue
        child = node.get(part)
        if not isinstance(child, dict):
            child = {}
            node[part] = child
        node = child
    if value is None:
        # ``before`` was a value, so the code is there to remove.
        del node[code]
        _prune_empty(data, slot.path)
    else:
        node[code] = value
    setattr(obj, slot.column, data)
    return True


def built_in_locales() -> tuple[str, ...]:
    """The locales the app ships (``settings.SUPPORTED_LOCALES``)."""
    from app.api.v1.settings import SUPPORTED_LOCALES

    return tuple(SUPPORTED_LOCALES)


async def _lock(db: AsyncSession, objs: Iterable[Any]) -> None:
    """Re-read the rows about to be rewritten ``FOR UPDATE``, so a concurrent
    admin edit of the same record cannot be lost between read and write."""
    for obj in objs:
        model = type(obj)
        await db.execute(
            select(model)
            .where(model.id == obj.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )


async def apply(
    db: AsyncSession,
    code: str,
    changes: Mapping[str, str | None],
    snapshot: Snapshot | None = None,
) -> dict[str, str | None]:
    """Write ``changes`` (``{key: translation | None}``) under ``code`` into
    every record slot of each key, through the ORM; never commits. Two
    sections of one card type with the same name share one key: the listing
    shows the first, this writes all of them.

    The rows touched are locked and re-read first, and their slots rebuilt
    from what they hold now. A built-in code (or anything that is not a valid
    custom code) writes nothing: a custom language must never overwrite the
    text of a language the app ships. Returns the lifecycle changes, which
    live in the pack row (the caller stores them). Keys that are neither are
    ignored — the caller validated them."""
    if lp.code_error(code, built_in_locales()) is not None:
        return {}
    snap = snapshot or await load(db)
    lifecycle = {k: v for k, v in changes.items() if k in snap.lifecycle}
    wanted = {k: v for k, v in changes.items() if k not in lifecycle}
    if not wanted:
        return lifecycle
    targets = {id(obj): obj for obj, slot in snap.slots() if slot.key in wanted}
    await _lock(db, targets.values())
    for obj in targets.values():
        for slot in _SLOTS[type(obj)](record_view(obj)):
            if slot.key in wanted:
                _write_slot(obj, slot, code, wanted[slot.key])
    await db.flush()
    return lifecycle


async def clear_code(db: AsyncSession, code: str) -> int:
    """Remove ``code`` from every record's locale maps (a custom language is
    being deleted). Returns how many labels held a translation."""
    snap = await load(db)
    held = [e.key for e in entries(snap, code) if e.value and e.key not in snap.lifecycle]
    await apply(db, code, dict.fromkeys(held), snap)
    return len(held)


# ---------------------------------------------------------------------------
# The built-in seed's keys (the share filter)
# ---------------------------------------------------------------------------


@lru_cache(maxsize=1)
def seed_english() -> dict[str, str]:
    """``{key: English}`` of every label the built-in seed creates, built with
    the same key builders from the ``seed.py`` constants (no database).

    Compliance regulations and resource types come from
    ``seed.BUILTIN_REGULATIONS`` / ``seed.BUILTIN_RESOURCE_TYPES``."""
    from app.services import seed

    out: dict[str, str] = {}

    def add(slots: list[Slot]) -> None:
        for slot in slots:
            out.setdefault(slot.key, slot.english)

    types: list[dict[str, Any]] = copy.deepcopy(seed.TYPES)
    for t in types:
        seed._inject_hierarchy_level_into_type(t)
        seed._inject_english_translations_type(t)
        add(card_type_slots(t))
        roles: list[dict[str, Any]]
        if "stakeholder_roles" in t:
            roles = t["stakeholder_roles"]
        elif t["key"] == "Application":
            roles = seed._APP_ROLES
        else:
            roles = seed._DEFAULT_ROLES
        for role in roles:
            add(role_slots({**role, "card_type_key": t["key"]}))
    for r in copy.deepcopy(seed.RELATIONS):
        seed._inject_english_translations_relation(r)
        add(relation_slots(r))
    for reg in seed.BUILTIN_REGULATIONS:
        add(regulation_slots(reg))
    for res in seed.BUILTIN_RESOURCE_TYPES:
        add(resource_slots(res))
    for c in seed.CARD_TYPE_CATEGORIES:
        add(category_slots(c))
    for d in seed.DASHBOARD_NAMES:
        add(dashboard_slots({"key": d["key"], "name": d["label"]}))
    for entry in seed.LIFECYCLE_PHASE_HELP:
        text = _text(entry.get("label"))
        if entry.get("key") in PHASE_CHRONOLOGICAL and text:
            out.setdefault(make_key("lifecycle", entry["key"]), text)
    return out


# ---------------------------------------------------------------------------
# Lifecycle phase help in the bootstrap payload
# ---------------------------------------------------------------------------


def overlay_phase_help(
    phase_help: Mapping[str, Mapping[str, str]], per_locale: Mapping[str, Mapping[str, Any]]
) -> dict[str, dict[str, str]]:
    """``phase_help`` (``read_phase_help``) with each custom locale's phase
    texts laid over it — ``per_locale`` is ``{code: metamodel pack strings}``.
    Only a phase that still has English help gets one: a phase saved empty
    serves no help in any language."""
    out = {phase: dict(texts) for phase, texts in phase_help.items()}
    for code, strings in per_locale.items():
        for phase, texts in out.items():
            if not _text(texts.get("en")):
                continue
            value = strings.get(make_key("lifecycle", phase))
            if isinstance(value, str) and value.strip():
                texts[code] = value
    return out
