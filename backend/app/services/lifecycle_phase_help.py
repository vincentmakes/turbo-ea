"""Lifecycle phase help — one admin-written explanation per phase.

The five lifecycle phases are fixed keys (``PHASE_CHRONOLOGICAL``), so what an
organisation means by *Phase out* is not metamodel data: it is a small app
setting, stored under ``general_settings["lifecyclePhaseHelp"]`` as
``{phase: {locale: text}}`` and served by ``/settings/bootstrap``.

Until an admin saves the setting — the key is absent from the blob — every
phase is explained by its built-in default, ``LIFECYCLE_PHASE_HELP`` in
``services/seed.py`` (translated there like the other seed labels). Once the
key is present, whatever was saved wins, an empty map included: that is how an
admin clears the help.

Plain functions so the route stays thin and the rules are unit-tested.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from app.services.lifecycle import PHASE_CHRONOLOGICAL

SETTING_KEY = "lifecyclePhaseHelp"
MAX_LEN = 2000


def default_phase_help() -> dict[str, dict[str, str]]:
    """The built-in explanation of each phase, ``{phase: {locale: text}}``.

    Built from ``seed.LIFECYCLE_PHASE_HELP``: ``label`` is the English text,
    each non-empty ``translations`` entry another locale. An entry naming an
    unknown phase is skipped.
    """
    # Imported here, as ``seed_dashboards`` imports ``DASHBOARD_NAMES``: seed.py
    # pulls in half the services layer, which must not load it at import time.
    from app.services.seed import LIFECYCLE_PHASE_HELP

    out: dict[str, dict[str, str]] = {}
    for entry in LIFECYCLE_PHASE_HELP:
        phase = entry.get("key")
        if phase not in PHASE_CHRONOLOGICAL:
            continue
        texts: dict[str, str] = {}
        label = entry.get("label")
        if isinstance(label, str) and label:
            texts["en"] = label
        for locale, text in (entry.get("translations") or {}).items():
            if isinstance(text, str) and text:
                texts[str(locale)] = text
        if texts:
            out[phase] = texts
    return out


def read_phase_help(general: Mapping[str, Any] | None) -> dict[str, dict[str, str]]:
    """The phase help to serve, keeping only known phases and non-empty strings.

    The built-in defaults (``default_phase_help``) when the setting key is
    absent; once present, the stored value, so a saved ``{}`` serves no help at
    all. Whatever else the blob holds (an older shape, a phase that no longer
    exists) is ignored rather than served to every client.
    """
    general = general or {}
    if SETTING_KEY not in general:
        return default_phase_help()
    stored = general.get(SETTING_KEY)
    if not isinstance(stored, Mapping):
        return {}
    out: dict[str, dict[str, str]] = {}
    for phase in PHASE_CHRONOLOGICAL:
        texts = stored.get(phase)
        if not isinstance(texts, Mapping):
            continue
        clean = {
            str(locale): text for locale, text in texts.items() if isinstance(text, str) and text
        }
        if clean:
            out[phase] = clean
    return out


def normalize_phase_help(
    raw: Mapping[str, Mapping[str, Any]], allowed_locales: Iterable[str]
) -> dict[str, dict[str, str]]:
    """Validate and tidy an admin's phase help before it is stored.

    An unknown phase raises ``ValueError`` (the route answers 400): it is a
    client bug, not something to drop silently. A locale outside
    ``allowed_locales`` is dropped, like ``/settings/enabled-locales`` drops one.
    Texts are stripped, empty ones removed (that is how a text is cleared) and
    capped at ``MAX_LEN`` characters. A phase left with no text is omitted.
    """
    locales = set(allowed_locales)
    unknown = sorted(set(raw) - set(PHASE_CHRONOLOGICAL))
    if unknown:
        raise ValueError(f"Unknown lifecycle phase: {', '.join(unknown)}")
    out: dict[str, dict[str, str]] = {}
    for phase in PHASE_CHRONOLOGICAL:
        texts = raw.get(phase) or {}
        clean: dict[str, str] = {}
        for locale, text in texts.items():
            if locale not in locales or not isinstance(text, str):
                continue
            stripped = text.strip()[:MAX_LEN]
            if stripped:
                clean[locale] = stripped
        if clean:
            out[phase] = clean
    return out


def audit_view(help_map: Mapping[str, Mapping[str, str]]) -> dict[str, str]:
    """The phase help flattened to ``{"<phase>_<locale>": text}``.

    A Security & admin log value must be a scalar, so the audit row names the
    one phase text that moved (``phase_out_de``) instead of nesting the map.
    """
    return {
        f"{phase}_{locale}": text
        for phase, texts in help_map.items()
        for locale, text in texts.items()
    }
