"""Lifecycle phase help — one admin-written explanation per phase.

The five lifecycle phases are fixed keys (``PHASE_CHRONOLOGICAL``), so what an
organisation means by *Phase out* is not metamodel data: it is a small app
setting, stored under ``general_settings["lifecyclePhaseHelp"]`` as
``{phase: {locale: text}}`` and served by ``/settings/bootstrap``.

Plain functions so the route stays thin and the rules are unit-tested.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from app.services.lifecycle import PHASE_CHRONOLOGICAL

SETTING_KEY = "lifecyclePhaseHelp"
MAX_LEN = 2000


def read_phase_help(general: Mapping[str, Any] | None) -> dict[str, dict[str, str]]:
    """The stored phase help, keeping only known phases and non-empty strings.

    ``{}`` when the setting was never written. Whatever else the blob holds
    (an older shape, a phase that no longer exists) is ignored rather than
    served to every client.
    """
    stored = (general or {}).get(SETTING_KEY)
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
