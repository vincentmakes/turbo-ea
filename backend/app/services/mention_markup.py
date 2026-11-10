"""The mention span format: one grammar for every reader and writer of it.

A mention in the rich text of a decision, a SoAW section or a comment is
stored as an empty span the server writes::

    <span data-type="mention" data-kind="card" data-id="<lowercase uuid>"></span>

``data-kind`` is one of :data:`MENTION_KINDS`; no name is stored, so a rename
never reads as an edit. The attribute order above is the canonical one (the
order the editor's ``renderHTML`` emits, so a load/save round trip is
byte-stable); a reader accepts the attributes in any order.

What counts as a mention here (``iter_mentions``, ``map_ids``):

* a ``<span …>…</span>`` whose attributes include ``data-type="mention"``;
* every attribute is written ``name="value"`` with DOUBLE quotes. A single
  quoted, unquoted or valueless attribute makes the span malformed: canonical
  markup is double-quoted, and a span this module did not write is not
  trusted to name anything;
* every attribute name is one of :data:`KNOWN_ATTRIBUTES` (the canonical
  three plus the reader-state attributes a rendered span carries); an unknown
  attribute makes the span malformed, as does an attribute given twice;
* ``data-kind`` is a known kind and ``data-id`` a UUID (any case; reported
  lower-cased). A restricted span carries a token instead of an id and names
  nothing here.

The span's text (a label such as ``@CRM``, possibly with inline markup) is
ignored. Only the span grammar lives here; what a mention means for a reader
— labels, restricted chips, tokens — is the mention service's.

Pure and standard-library only (``re``, ``html``): used by the workspace
transfer rewriter (``workspace_io/remap.py``) and the mention service alike.
"""

from __future__ import annotations

import html as html_lib
import re
import uuid
from collections.abc import Callable

MENTION_KINDS: tuple[str, ...] = ("card", "decision", "user")

#: Attributes a mention span may carry: the three stored ones, then what a
#: rendered span adds for a reader (restricted token, missing, archived).
KNOWN_ATTRIBUTES: frozenset[str] = frozenset(
    {
        "data-type",
        "data-kind",
        "data-id",
        "data-token",
        "data-restricted",
        "data-missing",
        "data-archived",
    }
)

#: A span that says it is a mention. Group 1 is the attribute string (with
#: its leading whitespace), group 2 the span's text.
MENTION_SPAN_RE = re.compile(r'<span\b([^>]*\bdata-type="mention"[^>]*)>(.*?)</span>', re.S)

# One ``name="value"`` pair, with the whitespace before it.
_ATTRIBUTE_RE = re.compile(r'\s+([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"<>]*)"')
_DATA_ID_RE = re.compile(r'(\sdata-id=")([^"]*)(")', re.IGNORECASE)
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def parse_attributes(attrs: str) -> dict[str, str] | None:
    """The attributes of a span as ``{name: value}``, or ``None`` when malformed.

    ``attrs`` is the text between ``<span`` and ``>``. Malformed: anything that
    is not a sequence of whitespace-led, double-quoted ``name="value"`` pairs
    (trailing whitespace allowed), or a name given twice. Names are compared
    lower-cased; values are HTML-unescaped.
    """
    out: dict[str, str] = {}
    pos = 0
    for match in _ATTRIBUTE_RE.finditer(attrs):
        if match.start() != pos:
            return None
        name = match.group(1).lower()
        if name in out:
            return None
        out[name] = html_lib.unescape(match.group(2))
        pos = match.end()
    if attrs[pos:].strip():
        return None
    return out


def _canonical_uuid(value: str) -> str | None:
    """The lower-case dashed form of a UUID string, else ``None`` (no braces,
    no URN, no surrounding space)."""
    if _UUID_RE.fullmatch(value) is None:
        return None
    return value.lower()


def mention_of(attrs: str) -> tuple[str, str] | None:
    """``(kind, lower-case id)`` when ``attrs`` make a mention, else ``None``."""
    parsed = parse_attributes(attrs)
    if parsed is None or parsed.get("data-type") != "mention":
        return None
    if not parsed.keys() <= KNOWN_ATTRIBUTES:
        return None
    kind = parsed.get("data-kind")
    if kind not in MENTION_KINDS:
        return None
    mention_id = _canonical_uuid(parsed.get("data-id", ""))
    if mention_id is None:
        return None
    return kind, mention_id


def canonical_span(kind: str, mention_id: str | uuid.UUID) -> str:
    """The stored span for a mention (no label). ``ValueError`` on a bad kind or id."""
    if kind not in MENTION_KINDS:
        raise ValueError(f"Unknown mention kind {kind!r}")
    canonical = _canonical_uuid(str(mention_id))
    if canonical is None:
        raise ValueError(f"Not a UUID: {mention_id!r}")
    return f'<span data-type="mention" data-kind="{kind}" data-id="{canonical}"></span>'


def iter_mentions(html: str) -> list[tuple[str, str]]:
    """Every mention in ``html`` as ``(kind, lower-case id)``, in document order
    (repeats kept). Malformed spans are skipped."""
    if not isinstance(html, str) or 'data-type="mention"' not in html:
        return []
    found = []
    for match in MENTION_SPAN_RE.finditer(html):
        mention = mention_of(match.group(1))
        if mention is not None:
            found.append(mention)
    return found


def map_ids(html: str, mapping: Callable[[str, str], str | None]) -> tuple[str, int, int]:
    """Rewrite the ``data-id`` of every mention through ``mapping``.

    ``mapping(kind, id)`` answers the new id, or ``None`` when it knows none
    (counted unresolved, span kept). Returns ``(html, remapped, unresolved)``;
    ``remapped`` counts spans whose id changed. Only the ``data-id`` value of a
    mention span changes — attribute order, the label and every byte around it
    stay. When nothing changes the very same string object comes back.
    """
    if not isinstance(html, str) or 'data-type="mention"' not in html:
        return html, 0, 0
    remapped = 0
    unresolved = 0

    def _sub(match: re.Match[str]) -> str:
        nonlocal remapped, unresolved
        mention = mention_of(match.group(1))
        if mention is None:
            return match.group(0)
        kind, mention_id = mention
        target = mapping(kind, mention_id)
        if target is None:
            unresolved += 1
            return match.group(0)
        if target == mention_id:
            return match.group(0)
        remapped += 1
        attrs = _DATA_ID_RE.sub(lambda m: f"{m.group(1)}{target}{m.group(3)}", match.group(1), 1)
        return f"<span{attrs}>{match.group(2)}</span>"

    rewritten = MENTION_SPAN_RE.sub(_sub, html)
    if remapped == 0:
        return html, 0, unresolved
    return rewritten, remapped, unresolved
