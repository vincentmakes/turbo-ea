"""Language packs for custom UI languages: the English catalogue, the validator,
the source-hash diff, the served bundle and the AI prompt.

Pure by design — no database, no FastAPI — so the same rules can later run in a
community repository's CI that checks contributed packs. Everything that
touches a stored locale lives in ``custom_locale_store.py``.

Terms:

* **Namespace** — one of the i18next resource files (``common``, ``admin`` …).
* **Flat key** — a string's JSON path in the English file joined with ``"."``.
  Some English files are flat with dotted keys, some nested; both flatten to
  the same shape, and the bundle is rebuilt in the English file's own shape.
* **Source hash** — the first 12 hex characters of the SHA-256 of the English
  text a translation was made from. A stored translation whose hash differs
  from the current English one is *stale* (English changed since).

Every translated value from outside — an imported file, an AI answer, an MCP
client — is untrusted and goes through :func:`validate_value`, the one gate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

PACK_FORMAT = "turbo-ea-language-pack"
PACK_FORMAT_VERSION = 1

#: Origins a stored translation can carry (``meta[key]["o"]``).
ORIGINS = ("manual", "ai", "import", "mcp")

#: The CLDR plural categories. English only has ``one`` / ``other``; a
#: language with more categories adds ``<base>_few`` and so on beside the
#: ``<base>_other`` key English has.
PLURAL_CATEGORIES = ("zero", "one", "two", "few", "many", "other")
_PLURAL_KEY = re.compile(r"^(?P<base>.+)_(?P<cat>zero|one|two|few|many|other)$")

STATUS_MISSING = "missing"
STATUS_STALE = "stale"
STATUS_TRANSLATED = "translated"
STATUS_OBSOLETE = "obsolete"

# Rejection reason codes (the API returns them verbatim).
UNKNOWN_KEY = "unknown_key"
EMPTY = "empty"
TOO_LONG = "too_long"
PLACEHOLDER_MISMATCH = "placeholder_mismatch"
NESTING_MISMATCH = "nesting_mismatch"
MARKUP_NOT_IN_SOURCE = "markup_not_in_source"
URL_NOT_IN_SOURCE = "url_not_in_source"
CONTROL_CHARS = "control_chars"
NOT_A_STRING = "not_a_string"

_CODE = re.compile(r"[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?")
MAX_CODE_LENGTH = 10
#: Base codes usually written right to left (a hint for the add dialog only).
RTL_HINT_CODES = ("he", "ar", "fa", "ur", "yi", "ps", "sd", "ug", "dv")
_ENGLISH_NAME = re.compile(r"^[A-Za-z][A-Za-z ()\-]{1,59}$")
_HASH = re.compile(r"^[0-9a-f]{12}$")

_PLACEHOLDER = re.compile(r"\{\{([^{}]*)\}\}")
_NESTING = re.compile(r"\$t\(([^()]*)\)")
_TAG = re.compile(r"<[^<>]*>")
_URL = re.compile(r"(?:https?://|www\.)[^\s<>\"'()\[\]]*", re.IGNORECASE)
_URL_TRAILING = ".,;:!?"
#: The two bidi override characters: they can make text read differently from
#: its storage order. Marks (LRM/RLM) and isolates (U+2066–2069) are allowed.
_BIDI_OVERRIDES = frozenset({"\u202d", "\u202e"})
_ALLOWED_CONTROLS = frozenset({"\n", "\t"})
_WHITESPACE = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# Hashing, codes, names
# ---------------------------------------------------------------------------


def source_hash(text: str) -> str:
    """The first 12 hex characters of the SHA-256 of ``text`` (UTF-8)."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def is_source_hash(value: Any) -> bool:
    """Whether ``value`` has the shape of a :func:`source_hash`."""
    return isinstance(value, str) and bool(_HASH.match(value))


def code_error(code: str, built_in: Iterable[str]) -> str | None:
    """Why ``code`` cannot be a new custom locale's code, or ``None``.

    ``invalid_code`` unless it is a two- or three-letter lower-case language
    code with an optional script and an optional upper-case region (``nl``,
    ``pt-BR``, ``zh-Hant``, ``zh-Hant-TW``), at most 10 characters;
    ``built_in_code`` when the app already ships it.
    """
    if not isinstance(code, str) or len(code) > MAX_CODE_LENGTH or not _CODE.fullmatch(code):
        return "invalid_code"
    if code in set(built_in):
        return "built_in_code"
    return None


def is_valid_english_name(name: str) -> bool:
    """Whether ``name`` may stand in an LLM prompt as a language name."""
    return isinstance(name, str) and bool(_ENGLISH_NAME.match(name))


# ---------------------------------------------------------------------------
# The English catalogue
# ---------------------------------------------------------------------------


def flatten(tree: Mapping[str, Any], prefix: tuple[str, ...] = ()) -> Iterator[tuple[str, ...]]:
    """Yield the JSON path of every string leaf of ``tree``, in file order.

    A leaf that is not a string (there are none today) is skipped: it cannot
    be translated."""
    for key, value in tree.items():
        path = (*prefix, key)
        if isinstance(value, Mapping):
            yield from flatten(value, path)
        elif isinstance(value, str):
            yield path


def flat_key(path: tuple[str, ...]) -> str:
    return ".".join(path)


@dataclass(frozen=True)
class Namespace:
    """One English resource file: its strings by flat key (in file order),
    each key's JSON path, and each string's source hash."""

    name: str
    strings: dict[str, str]
    paths: dict[str, tuple[str, ...]]
    hashes: dict[str, str]

    @classmethod
    def from_tree(cls, name: str, tree: Mapping[str, Any]) -> Namespace:
        strings: dict[str, str] = {}
        paths: dict[str, tuple[str, ...]] = {}
        for path in flatten(tree):
            key = flat_key(path)
            value = tree
            for part in path:
                value = value[part]
            strings[key] = value  # type: ignore[assignment]
            paths[key] = path
        hashes = {key: source_hash(text) for key, text in strings.items()}
        return cls(name=name, strings=strings, paths=paths, hashes=hashes)

    def source_key(self, key: str) -> str | None:
        """The English key ``key`` is translated from, or ``None`` when the
        key does not belong to this namespace.

        A key English has is its own source. A plural-category key English
        does not have (``items_few``) is accepted when its ``items_other``
        sibling exists — a language with more plural categories than English
        needs it — and is translated (and validated) from that sibling."""
        if key in self.strings:
            return key
        match = _PLURAL_KEY.match(key)
        if match:
            other = f"{match.group('base')}_other"
            if other in self.strings:
                return other
        return None

    def source_text(self, key: str) -> str | None:
        source = self.source_key(key)
        return None if source is None else self.strings[source]

    def current_hash(self, key: str) -> str | None:
        source = self.source_key(key)
        return None if source is None else self.hashes[source]

    def path_for(self, key: str) -> tuple[str, ...] | None:
        """Where ``key`` sits in the bundle: its English path, or for an extra
        plural key its ``_other`` sibling's path with the last segment renamed."""
        if key in self.paths:
            return self.paths[key]
        source = self.source_key(key)
        if source is None:
            return None
        other_path = self.paths[source]
        suffix = key[len(source) - len("_other") :]
        # ``source`` ends in "_other"; swap that for the key's own category on
        # the last path segment (the segment, not the dotted flat key, ends in
        # "_other").
        return (*other_path[:-1], other_path[-1][: -len("_other")] + suffix)


@dataclass(frozen=True)
class Catalog:
    namespaces: dict[str, Namespace]
    fingerprint: str

    def namespace(self, name: str) -> Namespace | None:
        return self.namespaces.get(name)

    @property
    def names(self) -> list[str]:
        return list(self.namespaces)


def catalog_from_trees(trees: Mapping[str, Mapping[str, Any]]) -> Catalog:
    """Build a :class:`Catalog` from ``{namespace: parsed English JSON}``.

    The fingerprint hashes every namespace's content, so anything derived from
    the English text (bundle hashes, statuses) changes when English does."""
    namespaces = {name: Namespace.from_tree(name, trees[name]) for name in sorted(trees)}
    digest = hashlib.sha256()
    for name, ns in namespaces.items():
        digest.update(name.encode("utf-8"))
        digest.update(json.dumps(ns.strings, ensure_ascii=False, sort_keys=True).encode("utf-8"))
    return Catalog(namespaces=namespaces, fingerprint=digest.hexdigest()[:16])


def english_dir_candidates(override: str | None, here: Path | None = None) -> list[Path]:
    """Where the English locale files may be, in order: the override (env
    ``I18N_EN_DIR``), ``/app/i18n/en`` in the backend image (next to the
    ``app`` package), and the frontend sources in a repository checkout."""
    base = (here or Path(__file__).resolve()).parent  # app/services
    app_root = base.parent.parent  # /app in the image, backend/ in a checkout
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override))
    candidates.append(app_root / "i18n" / "en")
    candidates.append(app_root.parent / "frontend" / "src" / "i18n" / "locales" / "en")
    return candidates


def find_english_dir(override: str | None, here: Path | None = None) -> Path | None:
    """The first candidate directory that holds at least one ``.json`` file."""
    for candidate in english_dir_candidates(override, here):
        if candidate.is_dir() and any(candidate.glob("*.json")):
            return candidate
    return None


def read_catalog(directory: Path) -> Catalog:
    """Parse every ``<namespace>.json`` in ``directory``."""
    trees = {
        path.stem: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(directory.glob("*.json"))
    }
    return catalog_from_trees(trees)


@lru_cache(maxsize=4)
def _cached_catalog(directory: str) -> Catalog:
    return read_catalog(Path(directory))


def load_catalog(override: str | None = None) -> Catalog | None:
    """The English catalogue, cached in-process; ``None`` when no English
    directory can be found (the image was built without it)."""
    directory = find_english_dir(override)
    if directory is None:
        return None
    return _cached_catalog(str(directory))


# ---------------------------------------------------------------------------
# The validator — the one gate for every untrusted value
# ---------------------------------------------------------------------------


def has_forbidden_chars(text: str) -> bool:
    """Whether ``text`` holds a control character (Unicode category ``Cc``)
    other than newline and tab, or a bidi override (U+202D / U+202E).

    Everything else is accepted — combining marks (Hebrew points, Thai tone
    marks, Devanagari vowel signs), ZWJ / ZWNJ, LRM / RLM and the bidi
    isolates — because real scripts need them."""
    return any(
        ch in _BIDI_OVERRIDES or (ch not in _ALLOWED_CONTROLS and unicodedata.category(ch) == "Cc")
        for ch in text
    )


def _placeholders(text: str) -> Counter[str]:
    return Counter(_WHITESPACE.sub("", m) for m in _PLACEHOLDER.findall(text))


def _nestings(text: str) -> Counter[str]:
    return Counter(_WHITESPACE.sub("", m) for m in _NESTING.findall(text))


def _urls(text: str) -> set[str]:
    return {m.rstrip(_URL_TRAILING).lower() for m in _URL.findall(text)}


def max_length(english: str) -> int:
    return 4 * len(english) + 200


def validate_value(english: str, value: Any) -> str | None:
    """Why ``value`` is not an acceptable translation of ``english``, or
    ``None`` when it is.

    The checks, in order: a string, not blank, no control character other
    than newline and tab and no bidi override (:func:`has_forbidden_chars`),
    at most ``4 × len(english) + 200`` characters (code points), the
    same ``{{placeholders}}`` (as a multiset, inner whitespace ignored) and
    ``$t(...)`` references as English, every tag-like token (``<b>``,
    ``</b>``, ``<br/>``, ``<1>``) one that English also has — so a translation
    can never introduce markup — and every URL one English also has.
    """
    if not isinstance(value, str):
        return NOT_A_STRING
    if not value.strip():
        return EMPTY
    if has_forbidden_chars(value):
        return CONTROL_CHARS
    if len(value) > max_length(english):
        return TOO_LONG
    if _placeholders(value) != _placeholders(english):
        return PLACEHOLDER_MISMATCH
    if _nestings(value) != _nestings(english):
        return NESTING_MISMATCH
    if not set(_TAG.findall(value)) <= set(_TAG.findall(english)):
        return MARKUP_NOT_IN_SOURCE
    if not _urls(value) <= _urls(english):
        return URL_NOT_IN_SOURCE
    return None


def validate_entry(ns: Namespace, key: str, value: Any) -> str | None:
    """:func:`validate_value` against the key's English source, or
    ``unknown_key`` when the namespace has no such key."""
    english = ns.source_text(key)
    if english is None:
        return UNKNOWN_KEY
    return validate_value(english, value)


# ---------------------------------------------------------------------------
# Status, stats, listings
# ---------------------------------------------------------------------------


def key_status(ns: Namespace, key: str, strings: Mapping[str, Any], meta: Mapping[str, Any]) -> str:
    """``obsolete`` (English no longer has it), ``missing`` (no value),
    ``stale`` (made from an English text that has changed since) or
    ``translated``."""
    current = ns.current_hash(key)
    if current is None:
        return STATUS_OBSOLETE
    value = strings.get(key)
    if not isinstance(value, str) or not value:
        return STATUS_MISSING
    entry = meta.get(key)
    stored = entry.get("h") if isinstance(entry, Mapping) else None
    return STATUS_TRANSLATED if stored == current else STATUS_STALE


def extra_keys(ns: Namespace, strings: Mapping[str, Any]) -> list[str]:
    """Stored plural-category keys English does not have but accepts."""
    return [k for k in strings if k not in ns.strings and ns.source_key(k) is not None]


def namespace_stats(
    ns: Namespace, strings: Mapping[str, Any], meta: Mapping[str, Any]
) -> dict[str, int]:
    """``{total, translated, missing, stale}`` over the English keys (an extra
    plural-category key is not counted: English has no such string)."""
    counts = {STATUS_TRANSLATED: 0, STATUS_MISSING: 0, STATUS_STALE: 0}
    for key in ns.strings:
        counts[key_status(ns, key, strings, meta)] += 1
    return {"total": len(ns.strings), **counts}


def sum_stats(stats: Iterable[Mapping[str, int]]) -> dict[str, int]:
    total = {"total": 0, STATUS_TRANSLATED: 0, STATUS_MISSING: 0, STATUS_STALE: 0}
    for s in stats:
        for k in total:
            total[k] += s[k]
    return total


#: Status filters of the review listing; ``untranslated`` is missing + stale.
LIST_FILTERS = {
    "all": (STATUS_MISSING, STATUS_STALE, STATUS_TRANSLATED),
    "missing": (STATUS_MISSING,),
    "stale": (STATUS_STALE,),
    "translated": (STATUS_TRANSLATED,),
    "untranslated": (STATUS_MISSING, STATUS_STALE),
}


def list_entries(
    ns: Namespace,
    strings: Mapping[str, Any],
    meta: Mapping[str, Any],
    *,
    status: str = "all",
    search: str = "",
) -> list[dict[str, Any]]:
    """The review rows of one namespace, English file order first and the
    extra plural keys after: ``{namespace, key, source, value, status,
    origin}``. ``search`` matches the key, the English text or the
    translation, case-insensitively."""
    wanted = LIST_FILTERS[status]
    needle = search.strip().casefold()
    rows: list[dict[str, Any]] = []
    for key in [*ns.strings, *extra_keys(ns, strings)]:
        state = key_status(ns, key, strings, meta)
        if state not in wanted:
            continue
        source = ns.source_text(key) or ""
        value = strings.get(key)
        if needle and not any(
            needle in str(text).casefold() for text in (key, source, value or "")
        ):
            continue
        entry = meta.get(key)
        rows.append(
            {
                "namespace": ns.name,
                "key": key,
                "source": source,
                "value": value if isinstance(value, str) else None,
                "status": state,
                "origin": entry.get("o") if isinstance(entry, Mapping) else None,
            }
        )
    return rows


# ---------------------------------------------------------------------------
# Merging a batch of translations into one namespace
# ---------------------------------------------------------------------------


@dataclass
class MergeResult:
    strings: dict[str, str]
    meta: dict[str, dict[str, str]]
    applied: int = 0
    unchanged: int = 0
    cleared: int = 0
    unknown: int = 0
    rejected: list[dict[str, str]] | None = None

    def report(self) -> dict[str, Any]:
        return {
            "applied": self.applied,
            "unchanged": self.unchanged,
            "cleared": self.cleared,
            "rejected": list(self.rejected or []),
            "unknown": self.unknown,
        }


def merge_strings(
    ns: Namespace,
    strings: Mapping[str, Any],
    meta: Mapping[str, Any],
    incoming: Mapping[str, Any],
    *,
    origin: str,
    source_hashes: Mapping[str, Any] | None = None,
    expected: Mapping[str, Any] | None = None,
) -> MergeResult:
    """Merge ``incoming`` (``{key: value | None}``) into one namespace's stored
    ``strings`` / ``meta`` and return the new dicts with the counts.

    * ``None`` clears a key (``cleared``; ``unchanged`` when it had no value).
    * A key English does not have counts as ``unknown`` and is not stored.
    * A value the validator refuses is listed in ``rejected`` with its reason;
      it never blocks the other keys.
    * A stored value is kept with the hash ``source_hashes`` gives for its key
      (a pack made on an older version stays stale where English changed
      since), else the current English hash. Re-sending the same value with
      the same hash is ``unchanged``; the same value with a new hash confirms
      a stale translation and is ``applied``.
    * ``expected`` (``{key: value-when-read}``) makes the write conditional,
      for a writer that read the namespace earlier (the AI job): a key whose
      stored value changed since is left alone and counted ``unchanged``.
    * Stored keys English no longer has are pruned.
    """
    out_strings = {k: v for k, v in strings.items() if ns.source_key(k) is not None}
    out_meta = {k: dict(v) for k, v in meta.items() if k in out_strings and isinstance(v, Mapping)}
    result = MergeResult(strings=out_strings, meta=out_meta, rejected=[])
    hashes = source_hashes or {}
    for key, value in incoming.items():
        if expected is not None and out_strings.get(key) != expected.get(key):
            result.unchanged += 1
            continue
        if value is None:
            if key in out_strings:
                del out_strings[key]
                out_meta.pop(key, None)
                result.cleared += 1
            else:
                result.unchanged += 1
            continue
        reason = validate_entry(ns, key, value)
        if reason == UNKNOWN_KEY:
            result.unknown += 1
            continue
        if reason is not None:
            result.rejected.append({"namespace": ns.name, "key": key, "reason": reason})  # type: ignore[union-attr]
            continue
        given = hashes.get(key)
        digest = given if is_source_hash(given) else ns.current_hash(key)
        current_meta = out_meta.get(key) or {}
        if out_strings.get(key) == value and current_meta.get("h") == digest:
            result.unchanged += 1
            continue
        out_strings[key] = value
        out_meta[key] = {"h": digest, "o": origin}  # type: ignore[dict-item]
        result.applied += 1
    return result


# ---------------------------------------------------------------------------
# The bundle the browser loads
# ---------------------------------------------------------------------------


def _set_path(tree: dict[str, Any], path: tuple[str, ...], value: str) -> None:
    node = tree
    for part in path[:-1]:
        child = node.get(part)
        if not isinstance(child, dict):
            child = {}
            node[part] = child
        node = child
    node[path[-1]] = value


def build_namespace_bundle(ns: Namespace, strings: Mapping[str, Any]) -> dict[str, Any]:
    """The i18next resource for one namespace, in the English file's shape.

    Walks the English keys in file order and emits each one that has a value —
    a stale value included (an old translation beats English) — then the extra
    plural-category keys beside their ``_other`` sibling, then every plural
    category still empty filled from its ``_other`` (:func:`plural_fill`). A
    key with no value is left out, so i18next falls back to English for it; an
    obsolete key is never served."""
    tree: dict[str, Any] = {}
    for key in ns.strings:
        value = strings.get(key)
        if isinstance(value, str) and value:
            _set_path(tree, ns.paths[key], value)
    for key in extra_keys(ns, strings):
        value = strings[key]
        path = ns.path_for(key)
        if path is not None and isinstance(value, str) and value:
            _set_path(tree, path, value)
    for key, value in plural_fill(ns, strings).items():
        _set_path(tree, ns.path_for(key), value)  # type: ignore[arg-type]
    return tree


def plural_fill(ns: Namespace, strings: Mapping[str, Any]) -> dict[str, str]:
    """``{key: text}`` for every plural category a translated ``<base>_other``
    has no translation for, filled from the ``_other`` value.

    A language's plural rules ask i18next for categories the pack may not
    carry (``_few`` in Russian, ``_one`` when only ``_other`` was translated);
    without a value there it would fall through to English for that count. The
    general form reads better than English. Only bases whose ``_other`` is
    translated are filled."""
    fill: dict[str, str] = {}
    for key in ns.strings:
        if not key.endswith("_other"):
            continue
        other = strings.get(key)
        if not isinstance(other, str) or not other:
            continue
        base = key[: -len("_other")]
        for category in PLURAL_CATEGORIES:
            if category == "other":
                continue
            sibling = f"{base}_{category}"
            current = strings.get(sibling)
            if not (isinstance(current, str) and current):
                fill[sibling] = other
    return fill


def bundle_hash(fingerprint: str, code: str, name: str, rtl: bool, rows: Iterable[tuple]) -> str:
    """The version tag of a locale's bundle (its ``ETag``): the English
    catalogue fingerprint, the locale's own name / direction and a digest per
    stored namespace (``rows`` = ``(namespace, digest)`` pairs)."""
    payload = json.dumps(
        [fingerprint, code, name, bool(rtl), sorted([str(n), str(d)] for n, d in rows)],
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Export file
# ---------------------------------------------------------------------------

EXPORT_MODES = ("missing", "all", "current")


def pack_instructions(language: str) -> str:
    return (
        f'Translate every value under "strings" from English into {language}. '
        "Keep the keys, the {{placeholders}}, any <tags> and $t(...) references exactly "
        "as they are, and do not add markup or links the English text does not have. "
        "Keep product terms consistent (card, inventory, stakeholder, metamodel, relation, "
        "lifecycle). A language with more plural forms than English may add keys ending "
        "in _zero, _two, _few or _many next to a key ending in _other. Leave "
        '"source_hashes" unchanged and import the file back in Settings.'
    )


def export_namespace(
    ns: Namespace, strings: Mapping[str, Any], meta: Mapping[str, Any], mode: str
) -> tuple[dict[str, str], dict[str, str]]:
    """``(strings, source_hashes)`` of one namespace for an export file.

    ``missing``: the English text of every missing or stale key (an extra
    plural key that went stale included); ``all``: the English text of every
    English key; ``current``: the stored translations, each with the hash of
    the English it was made from."""
    out: dict[str, str] = {}
    hashes: dict[str, str] = {}
    if mode == "current":
        for key in [*ns.strings, *extra_keys(ns, strings)]:
            value = strings.get(key)
            if not isinstance(value, str) or not value:
                continue
            entry = meta.get(key)
            stored = entry.get("h") if isinstance(entry, Mapping) else None
            out[key] = value
            hashes[key] = stored if is_source_hash(stored) else ns.current_hash(key)  # type: ignore[assignment]
        return out, hashes
    keys = list(ns.strings)
    if mode == "missing":
        keys = [
            k
            for k in [*ns.strings, *extra_keys(ns, strings)]
            if key_status(ns, k, strings, meta) in (STATUS_MISSING, STATUS_STALE)
        ]
    for key in keys:
        out[key] = ns.source_text(key)  # type: ignore[assignment]
        hashes[key] = ns.current_hash(key)  # type: ignore[assignment]
    return out, hashes


def build_pack(
    *,
    locale: Mapping[str, Any],
    mode: str,
    app_version: str,
    namespaces: Mapping[str, tuple[dict[str, str], dict[str, str]]],
) -> dict[str, Any]:
    """The language-pack file: ``namespaces`` maps a namespace to the
    ``(strings, source_hashes)`` :func:`export_namespace` gave; empty
    namespaces are left out."""
    kept = {name: pair for name, pair in namespaces.items() if pair[0]}
    return {
        "format": PACK_FORMAT,
        "format_version": PACK_FORMAT_VERSION,
        "app_version": app_version,
        "locale": {
            "code": locale["code"],
            "name": locale["name"],
            "english_name": locale["english_name"],
            "rtl": bool(locale["rtl"]),
        },
        "mode": mode,
        "instructions": pack_instructions(locale["english_name"]),
        "strings": {name: pair[0] for name, pair in kept.items()},
        "source_hashes": {name: pair[1] for name, pair in kept.items()},
    }


# ---------------------------------------------------------------------------
# AI translation: chunks and prompt
# ---------------------------------------------------------------------------

CHUNK_MAX_ITEMS = 40
CHUNK_MAX_CHARS = 6000
MAX_REFERENCE_PAIRS = 30
_REFERENCE_MAX_CHARS = 120

GLOSSARY = (
    "card (an item in the architecture inventory, e.g. an application)",
    "inventory (the list of all cards)",
    "stakeholder (a person with a role on a card)",
    "metamodel (the configurable card types, fields and relations)",
    "relation (a typed link between two cards)",
    "lifecycle (the plan / phase-in / active / phase-out / end-of-life dates)",
    "card type, subtype, field, tag, survey, diagram, report, dashboard",
)


def chunk(
    items: list[Any],
    size_of: Any,
    *,
    max_items: int = CHUNK_MAX_ITEMS,
    max_chars: int = CHUNK_MAX_CHARS,
) -> list[list[Any]]:
    """Split ``items`` into chunks of at most ``max_items`` items and at most
    ``max_chars`` characters (``size_of(item)``); an item larger than
    ``max_chars`` on its own makes a chunk of one."""
    chunks: list[list[Any]] = []
    current: list[Any] = []
    chars = 0
    for item in items:
        size = size_of(item)
        if current and (len(current) >= max_items or chars + size > max_chars):
            chunks.append(current)
            current, chars = [], 0
        current.append(item)
        chars += size
    if current:
        chunks.append(current)
    return chunks


def reference_pairs(
    ns: Namespace,
    strings: Mapping[str, Any],
    meta: Mapping[str, Any],
    exclude: Iterable[str] = (),
    limit: int = MAX_REFERENCE_PAIRS,
) -> list[tuple[str, str]]:
    """Up to ``limit`` ``(english, translation)`` pairs of up-to-date short
    translations in this namespace, as a terminology reference for the model."""
    skip = set(exclude)
    pairs: list[tuple[str, str]] = []
    for key, english in ns.strings.items():
        if len(pairs) >= limit:
            break
        if key in skip or len(english) > _REFERENCE_MAX_CHARS:
            continue
        if key_status(ns, key, strings, meta) != STATUS_TRANSLATED:
            continue
        pairs.append((english, strings[key]))
    return pairs


def translation_system_prompt(language: str, references: list[tuple[str, str]]) -> str:
    lines = [
        "You are a professional software localisation translator. You translate the user "
        "interface of Turbo EA, an enterprise architecture management application, from "
        f"English into {language}.",
        "The user message is a JSON object mapping numeric ids to English UI strings. Answer "
        "with a JSON object that maps every id to its translation, and nothing else.",
        "Rules: keep every {{placeholder}}, every <tag> and every $t(...) reference exactly as "
        "it is; do not add markup or links; keep the same tone and brevity as the English; use "
        "the established software terminology of the target language and translate product "
        "terms consistently.",
        "Glossary: " + "; ".join(GLOSSARY) + ".",
    ]
    if references:
        lines.append(
            "Existing translations to stay consistent with (English → translation): "
            + json.dumps(dict(references), ensure_ascii=False)
        )
    return "\n".join(lines)


def translation_messages(
    language: str, sources: Mapping[str, str], references: list[tuple[str, str]]
) -> list[dict[str, str]]:
    """The chat messages for one chunk: ``sources`` is ``{id: english}``."""
    return [
        {"role": "system", "content": translation_system_prompt(language, references)},
        {"role": "user", "content": json.dumps(dict(sources), ensure_ascii=False)},
    ]


def answer_map(answer: Any, ids: Iterable[str]) -> dict[str, Any]:
    """The ``{id: translation}`` map of an LLM answer. A model that wraps the
    object in one outer key (``{"translations": {...}}``) is unwrapped."""
    if not isinstance(answer, Mapping):
        return {}
    wanted = set(ids)
    if not wanted & set(answer) and len(answer) == 1:
        (inner,) = answer.values()
        if isinstance(inner, Mapping):
            return dict(inner)
    return dict(answer)


# ---------------------------------------------------------------------------
# Command line: validate a pack file offline (a community repository's CI)
# ---------------------------------------------------------------------------

#: The namespace of database-held labels (``metamodel_strings.py``). Its
#: English text lives in the database, so offline it is checked structurally.
METAMODEL_NAMESPACE = "metamodel"
METAMODEL_MAX_LENGTH = 500


def validate_structural(value: Any) -> str | None:
    """The checks a ``metamodel`` value gets without an English source: a
    non-blank string of at most 500 characters with no placeholder, no
    tag-like token, no URL and no forbidden character."""
    if not isinstance(value, str):
        return NOT_A_STRING
    if not value.strip():
        return EMPTY
    if has_forbidden_chars(value):
        return CONTROL_CHARS
    if len(value) > METAMODEL_MAX_LENGTH:
        return TOO_LONG
    if "{{" in value:
        return PLACEHOLDER_MISMATCH
    if _TAG.search(value):
        return MARKUP_NOT_IN_SOURCE
    if _URL.search(value):
        return URL_NOT_IN_SOURCE
    return None


def validate_pack(pack: Any, cat: Catalog) -> list[dict[str, str]]:
    """Every problem of a language-pack file: ``[{namespace, key, reason}]``
    (``key`` is empty for a problem with the file or a whole namespace)."""
    if not isinstance(pack, Mapping) or pack.get("format") != PACK_FORMAT:
        return [{"namespace": "", "key": "", "reason": "not_a_language_pack"}]
    strings = pack.get("strings")
    if not isinstance(strings, Mapping):
        return [{"namespace": "", "key": "", "reason": "no_strings"}]
    problems: list[dict[str, str]] = []
    for name, entries in strings.items():
        if not isinstance(entries, Mapping):
            problems.append({"namespace": str(name), "key": "", "reason": "not_an_object"})
            continue
        ns = cat.namespace(name)
        if ns is None and name != METAMODEL_NAMESPACE:
            problems.append({"namespace": str(name), "key": "", "reason": "unknown_namespace"})
            continue
        for key, value in entries.items():
            reason = validate_structural(value) if ns is None else validate_entry(ns, key, value)
            if reason is not None:
                problems.append({"namespace": str(name), "key": str(key), "reason": reason})
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="language_pack.py", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("validate", help="check a language-pack file against English")
    check.add_argument("pack", type=Path)
    check.add_argument("--english", type=Path, required=True, help="the English locale directory")
    args = parser.parse_args(argv)
    try:
        pack = json.loads(args.pack.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"cannot read {args.pack}: {exc}")
        return 1
    problems = validate_pack(pack, read_catalog(args.english))
    for problem in problems:
        print(f"{problem['namespace']}\t{problem['key']}\t{problem['reason']}")
    strings = pack.get("strings") if isinstance(pack, Mapping) else None
    total = (
        sum(len(v) for v in strings.values() if isinstance(v, Mapping))
        if isinstance(strings, Mapping)
        else 0
    )
    print(f"{total} strings checked, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
