"""Pure helpers for migration 178 (the ``licensing`` extension's data -> core licenses).

No database and no app models here, so the migration, ``seed.py`` and the tests can all
import it. The extension stored four ``ext.licensing.multivalue`` fields per card, each a list
of ``{"category": str, "value": number}``; core keeps ``{metric: {license_type_key:
{"licensed", "actual"}}}`` per fiscal year.
"""

from __future__ import annotations

import copy
import math
import re
from collections.abc import Iterable

EXT_KEY = "licensing"
MODEL_KEY = "licensingModel"
# Where migration 179 put the field, alone, on both types (frozen for migrations 178/179).
LICENSING_SECTION = "Licensing"
# Where the field sat before migration 179 (still read by 178's and 179's tests).
GENERAL_SECTION = {
    "Application": "Application Information",
    "ITComponent": "Component Information",
}
LICENSING_TYPES = frozenset(GENERAL_SECTION)
MAX_COUNT = 1_000_000_000

# THE one definition of the field (migration 178 and the fresh-install seed both use it).
LICENSING_MODEL_FIELD: dict = {
    "key": MODEL_KEY,
    "label": "Licensing Model",
    "type": "multiple_select",
    "weight": 0,
    "options": [
        {
            "key": "users",
            "label": "Users",
            "translations": {
                "de": "Benutzer",
                "fr": "Utilisateurs",
                "es": "Usuarios",
                "it": "Utenti",
                "pt": "Utilizadores",
                "zh": "用户",
                "ru": "Пользователи",
                "da": "Brugere",
                "ar": "المستخدمون",
            },
        },
        {
            "key": "installations",
            "label": "Installations",
            "translations": {
                "de": "Installationen",
                "fr": "Installations",
                "es": "Instalaciones",
                "it": "Installazioni",
                "pt": "Instalações",
                "zh": "安装",
                "ru": "Установки",
                "da": "Installationer",
                "ar": "التثبيتات",
            },
        },
    ],
    "translations": {
        "de": "Lizenzmodell",
        "fr": "Modèle de licence",
        "es": "Modelo de licencia",
        "it": "Modello di licenza",
        "pt": "Modelo de licenciamento",
        "zh": "许可模式",
        "ru": "Модель лицензирования",
        "da": "Licensmodel",
        "ar": "نموذج الترخيص",
    },
}

LICENSING_SECTION_TRANSLATIONS: dict[str, str] = {
    "de": "Lizenzierung",
    "fr": "Licences",
    "es": "Licencias",
    "it": "Licenze",
    "pt": "Licenciamento",
    "zh": "许可",
    "ru": "Лицензирование",
    "da": "Licenser",
    "ar": "التراخيص",
}


def licensing_section() -> dict:
    """A fresh dedicated section holding the model field (the fresh-install seed uses it)."""
    return {
        "section": LICENSING_SECTION,
        "translations": dict(LICENSING_SECTION_TRANSLATIONS),
        "fields": [copy.deepcopy(LICENSING_MODEL_FIELD)],
    }


# old field key -> (metric, "licensed" | "actual")
OLD_FIELDS: dict[str, tuple[str, str]] = {
    "licensedUsers": ("users", "licensed"),
    "licensedInstallations": ("installations", "licensed"),
    "actualUsers": ("users", "actual"),
    "actualInstallations": ("installations", "actual"),
}
OLD_KEYS = tuple(OLD_FIELDS)


def slug(name: str) -> str | None:
    """Lower-case, runs outside ``[a-z0-9]`` become ``_``, max 64; None when it is empty or
    does not start with a letter."""
    out = re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_")[:64].rstrip("_")
    return out if out and out[0].isalpha() else None


def _norm(name: object) -> str:
    return str(name).strip().casefold()


def assign_keys(names: Iterable[str]) -> dict[str, tuple[str, str]]:
    """``casefolded name -> (key, first-seen label)``; ``type_<n>`` when there is no usable
    slug; a slug already taken gets ``_2``, ``_3`` ..."""
    out: dict[str, tuple[str, str]] = {}
    used: set[str] = set()
    fallback = 0
    for name in names:
        norm = _norm(name)
        if not norm or norm in out:
            continue
        base = slug(name)
        if base is None:
            while True:
                fallback += 1
                if (base := f"type_{fallback}") not in used:
                    break
        key, n = base, 1
        while key in used:
            n += 1
            suffix = f"_{n}"
            key = base[: 64 - len(suffix)] + suffix
        used.add(key)
        out[norm] = (key, str(name).strip()[:100])
    return out


def _count(value: object) -> tuple[int | None, str | None]:
    """``(count, reason)``: a usable integer (with ``rounded`` when it was rounded) or
    ``(None, reason)``."""
    if isinstance(value, bool):
        return None, "not_numeric"
    try:
        num = float(value.strip()) if isinstance(value, str) else float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None, "not_numeric"
    if not math.isfinite(num):
        return None, "not_numeric"
    if num < 0:
        return None, "negative"
    if num > MAX_COUNT:
        return None, "too_large"
    whole = int(math.floor(num + 0.5))
    return whole, None if whole == num else "rounded"


def build_items(attrs: dict, keys: dict) -> tuple[dict, list[dict]]:
    """Core items from one card's attributes, and the values that were skipped or rounded.

    Duplicate categories of one card are summed; a cell with an actual and no licensed gets
    ``licensed`` 0; a cell with a licensed and no actual keeps ``actual`` null.
    """
    cells: dict[str, dict[str, dict]] = {}
    problems: list[dict] = []
    for field, (metric, kind) in OLD_FIELDS.items():
        entries = attrs.get(field)
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict) or entry.get("value") in (None, ""):
                continue
            category, value = entry.get("category"), entry["value"]

            def problem(reason: str) -> None:
                problems.append(
                    {
                        "field": field,
                        "category": str(category),
                        "value": str(value)[:50],
                        "reason": reason,
                    }
                )

            hit = keys.get(_norm(category)) if category is not None else None
            if hit is None:
                problem("no_category")
                continue
            key = hit[0]
            count, reason = _count(value)
            if reason:
                problem(reason)
            if count is None:
                continue
            cell = cells.setdefault(metric, {}).setdefault(key, {"licensed": 0, "actual": None})
            cell[kind] = (cell[kind] or 0) + count
    return cells, problems


def _model_fields(schema: list) -> list[tuple[dict, dict]]:
    """``(section, field)`` for every non-extension ``licensingModel`` field of a schema."""
    return [
        (section, field)
        for section in schema or []
        if isinstance(section, dict)
        for field in section.get("fields", [])
        if isinstance(field, dict) and field.get("key") == MODEL_KEY and not field.get("ext")
    ]


def move_model_field(type_key: str, schema: list) -> list | None:
    """The schema with ``licensingModel`` alone in its ``Licensing`` section, or None when the
    type is not a licensing type, it is already there, or the key is taken by a field of
    another type (an admin's own; left alone). The field keeps its stored definition when it
    exists, and is restored from ``LICENSING_MODEL_FIELD`` when it does not."""
    if type_key not in LICENSING_TYPES:
        return None
    found = _model_fields(schema)
    if any(field.get("type") != "multiple_select" for _, field in found):
        return None
    out = copy.deepcopy(schema or [])
    field = copy.deepcopy(found[0][1]) if found else copy.deepcopy(LICENSING_MODEL_FIELD)
    target = None
    for section in out:
        if not isinstance(section, dict):
            continue
        if section.get("section") == LICENSING_SECTION and not section.get("ext"):
            target = section
        else:
            # An extension section is cleaned too: a copy left there would be a duplicate key.
            section["fields"] = [
                f
                for f in section.get("fields", [])
                if not (isinstance(f, dict) and f.get("key") == MODEL_KEY and not f.get("ext"))
            ]
    if target is None:
        target = licensing_section()
        target["fields"] = []
        out.append(target)
    present = [
        f for f in target.get("fields", []) if isinstance(f, dict) and f.get("key") == MODEL_KEY
    ]
    if not present:
        target.setdefault("fields", []).append(field)
        present = [field]
    # Required options come back; the admin's label, translations and extra options stay.
    options = present[0].setdefault("options", [])
    have = {o.get("key") for o in options if isinstance(o, dict)}
    options.extend(
        copy.deepcopy(o) for o in LICENSING_MODEL_FIELD["options"] if o["key"] not in have
    )
    return None if out == schema else out


def citing_calculations(rows: Iterable[tuple[str, str, str]]) -> list[dict]:
    """``(id, name, formula)`` rows whose formula names one of the four old keys, as
    ``[{"id", "name", "keys"}]``. Listed in the migration report, never rewritten."""
    out: list[dict] = []
    for calc_id, name, formula in rows:
        cited = [
            k for k in dict.fromkeys(re.findall(r"data\.(\w+)", formula or "")) if k in OLD_FIELDS
        ]
        if cited:
            out.append({"id": calc_id, "name": name, "keys": cited})
    return out


# The two metrics that existed before the catalogue, in the order migration 192 seeds them.
# Frozen with the migration: the app reads ``license_types.DEFAULT_METRICS``.
DEFAULT_METRICS = (("users", "Users"), ("installations", "Installations"))


def derive_type_metrics(
    types: Iterable[tuple[str, bool]],
    used: dict[str, set[str]],
    known: Iterable[str] = (),
) -> list[tuple[str, str]]:
    """``(type_key, metric_key)`` rows for migration 192, from ``(key, archived)`` types and
    ``used[type_key]`` (the metrics holding data for that type). A type with data under one
    metric belongs to it, under both it is listed under both, with none it goes under both
    default metrics (the admin archives what they do not need). Only the defaults and the
    ``known`` metrics (a bundle's own) count; data under any other metric is ignored.
    ``archived`` is carried by the caller's templates, not decided here."""
    order = [key for key, _ in DEFAULT_METRICS]
    counted = order + [m for m in known if m not in order]
    plan: list[tuple[str, str]] = []
    for type_key, _archived in types:
        metrics = [m for m in counted if m in (used.get(type_key) or ())] or order
        plan.extend((type_key, m) for m in metrics)
    return plan


def without_model_field(type_key: str, schema: list) -> list:
    """The schema without ``licensingModel`` (Application / IT Component only, the same scope
    as ``_model_fields``: the non-extension multiple-select) and without the ``Licensing``
    section once it is left empty (an admin may have added fields to it). A custom type's own
    field of that name, and every other type, is left alone."""
    out = copy.deepcopy(schema or [])
    if type_key not in LICENSING_TYPES:
        return out
    for section in out:
        if isinstance(section, dict):
            section["fields"] = [
                f
                for f in section.get("fields", [])
                if not (
                    isinstance(f, dict)
                    and f.get("key") == MODEL_KEY
                    and not f.get("ext")
                    and f.get("type") == "multiple_select"
                )
            ]
    return [
        s
        for s in out
        if not (
            isinstance(s, dict)
            and s.get("section") == LICENSING_SECTION
            and not s.get("ext")
            and not s.get("fields")
        )
    ]


def citing_model_calculations(rows: Iterable[tuple[str, str, str]]) -> list[dict]:
    """``(id, name, formula)`` rows whose formula reads ``data.licensingModel``, as
    ``[{"id", "name"}]``. Listed in migration 192's report, never rewritten."""
    return [
        {"id": calc_id, "name": name}
        for calc_id, name, formula in rows
        if re.search(rf"data\.{MODEL_KEY}\b", formula or "")
    ]
