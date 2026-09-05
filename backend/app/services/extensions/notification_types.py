"""Extension-declared notification types (SDK 1.11).

Core owns the preference matrix: which notification types exist, what each
defaults to and which may never leave the bell are decided against
``NOTIFICATION_TYPE_SPECS``. Until 1.11 that left an extension exactly one
type — the generic ``extension_notice`` — so everything it sent shared one
switch with everything every other extension sent. An extension holding the
``core.notifications.send`` grant may now declare up to five types of its own
under ``notifications.types`` in its manifest (label + translations, in-app
and email defaults), and each becomes a row in every person's preferences.

The registry still belongs to core: a type is namespaced ``ext.{key}.``, is
validated at install (``bundle.py``) and by ``teax lint``, is only *live*
while the extension is enabled and licensed (re-checked per call, like the
channel registry), and is never ``in_app_only`` / ``email_locked`` — those
are core's own levers. When an extension lapses its rows leave the dialog
and its type resolves like any unknown type (bell on, nothing else); what
the person stored stays put for when it comes back.

Registration is manifest-driven — no code hook — so a backend-only bundle
gets a labelled row without a UI plugin, and the label reaches the dialog
from ``GET /users/me/notification-preferences`` resolved for the viewer's
locale rather than from an i18n key core cannot carry for it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from app.models.user import NotificationTypeSpec
from app.services.extensions.bundle import (
    NOTIFICATION_TYPE_GRANT,
    notification_types_error,
)
from app.services.extensions.loader import LoadReport
from app.services.extensions.registry import extension_registry

logger = logging.getLogger(__name__)

#: The single grant that unlocks declaring a type (and sending under it).
GRANT = NOTIFICATION_TYPE_GRANT


@dataclass(frozen=True)
class ExtensionNotificationType:
    key: str
    ext_key: str
    label: str
    translations: dict[str, str]
    spec: NotificationTypeSpec


#: type key -> registration. Empty on a stock install.
_types: dict[str, ExtensionNotificationType] = {}


def reset_types() -> None:
    """Drop every registration. Test helper — mirrors ``reset_channels``."""
    _types.clear()


def register_manifest_types(ext_key: str, manifest: dict) -> list[str]:
    """Register the types ``manifest`` declares for ``ext_key``; return their keys.

    Re-validates the block defensively (the bundle verifier already did, but
    a manifest on disk is re-read every boot) and skips it whole on any
    problem — a half-registered block would give the dialog rows the bridge
    then refuses. On a key another extension already holds, the first wins.
    """
    block = manifest.get("notifications")
    if not block:
        return []
    grants = [str(g) for g in (manifest.get("grants") or [])]
    problem = notification_types_error(block, ext_key, grants)
    if problem:
        logger.warning(
            "Extension %s declares notification types but %s — types skipped", ext_key, problem
        )
        return []
    registered: list[str] = []
    for entry in block["types"]:
        key = str(entry["key"])
        if key in _types and _types[key].ext_key != ext_key:
            logger.warning(
                "Notification type %r already registered by extension %s — %s's type skipped",
                key,
                _types[key].ext_key,
                ext_key,
            )
            continue
        _types[key] = ExtensionNotificationType(
            key=key,
            ext_key=ext_key,
            label=str(entry["label"]).strip(),
            translations={
                str(loc): str(text).strip()
                for loc, text in (entry.get("translations") or {}).items()
            },
            spec=NotificationTypeSpec(
                key,
                in_app_default=bool(entry.get("in_app_default", True)),
                email_default=bool(entry.get("email_default", False)),
            ),
        )
        registered.append(key)
    if registered:
        logger.info("Registered notification type(s) %s for extension %s", registered, ext_key)
    return registered


def start_notification_types(report: LoadReport) -> None:
    """Register every loaded extension's declared types at startup."""
    for ext in report.loaded:
        info = extension_registry.get(ext.key)
        if info is None or not info.manifest.get("notifications"):
            continue
        register_manifest_types(ext.key, info.manifest)


def _live(key: str) -> ExtensionNotificationType | None:
    """The registration, but only while its extension may actually notify."""
    reg = _types.get(key)
    if reg is None:
        return None
    if GRANT not in extension_registry.grants_for(reg.ext_key):
        return None
    return reg


def type_spec(key: str) -> NotificationTypeSpec | None:
    """The spec for a live extension type — the resolver's fallback after core's own."""
    reg = _live(key)
    return reg.spec if reg is not None else None


def registered_type_keys() -> list[str]:
    """Type keys currently live, sorted for a stable UI order."""
    return sorted(key for key in _types if _live(key) is not None)


def types_for_extension(ext_key: str) -> set[str]:
    """The live type keys ``ext_key`` may send under."""
    return {key for key in registered_type_keys() if _types[key].ext_key == ext_key}


def type_label(key: str, locale: str | None) -> str:
    """The label for ``key`` in ``locale`` — exact, then language, then the manifest label."""
    reg = _types.get(key)
    if reg is None:
        return key
    if locale:
        for candidate in (locale, locale.split("-", 1)[0].split("_", 1)[0]):
            text = reg.translations.get(candidate)
            if text:
                return text
    return reg.label


def type_descriptors(locale: str | None) -> list[dict]:
    """What the preferences dialog needs to render one row per live extension type."""
    return [
        {
            "key": key,
            "in_app_default": _types[key].spec.in_app_default,
            "email_default": _types[key].spec.email_default,
            "in_app_only": False,
            "email_locked": False,
            "label": type_label(key, locale),
            "extension_key": _types[key].ext_key,
        }
        for key in registered_type_keys()
    ]
