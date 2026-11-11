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

Spans outside that grammar (:func:`normalise`). A browser reads
``<SPAN DATA-TYPE='mention' data-kind=card …>`` as a mention chip just as
well, so a span the grammar does not read must never be stored or returned
as it came. :func:`normalise` tokenises the text with the standard library's
``html.parser`` and rewrites every ``span`` whose ``data-type`` is
``mention`` (any case, any quoting, any attribute order) to the canonical
nameless span when it names a valid kind and id, else to the escaped text of
its content; then does the same to every span :data:`MENTION_SPAN_RE` still
matches (one the parser saw as text, e.g. inside ``<sp<span …>``); and runs
until the text stops changing, so normalising twice gives the same text and
no later regular-expression pass can splice a new span together.
:func:`iter_mentions` (and the mention service's rendering) read through it
whenever the text holds a ``data-type`` the grammar did not match as a
mention, so a writer's check and a reader's rendering always see the same
mentions.

Every pattern here runs in linear time on hostile input: an opening tag is
never scanned across a ``<`` or ``>``, a label stops at the next ``<span`` or
``</span``, and attribute lists are read one pair at a time from a fixed
position (never searched for).

Pure and standard-library only (``re``, ``html``): used by the workspace
transfer rewriter (``workspace_io/remap.py``) and the mention service alike.
"""

from __future__ import annotations

import html as html_lib
import re
import uuid
from collections.abc import Callable, Iterable
from html.parser import HTMLParser

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
#: its leading whitespace), group 2 the span's text. Linear on any input: the
#: opening tag cannot cross a ``<`` or ``>``, and the text stops at the next
#: ``<span`` or ``</span`` (a span nested in a label is left to
#: :func:`normalise`).
MENTION_SPAN_RE = re.compile(
    r'<span\b(?=[^<>]*\bdata-type="mention")([^<>]*+)>((?:[^<]++|<(?!/?span\b))*+)</span>'
)

# One ``name="value"`` pair, with the whitespace before it (matched at a
# given position, never searched for).
_ATTRIBUTE_RE = re.compile(r'\s++([A-Za-z_:][-A-Za-z0-9_:.]*+)="([^"<>]*+)"')
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
    while (match := _ATTRIBUTE_RE.match(attrs, pos)) is not None:
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
    (repeats kept). Malformed spans are skipped. Text holding a span the
    grammar does not read is read through :func:`normalise` first."""
    if not has_hint(html):
        return []
    found = []
    for match in MENTION_SPAN_RE.finditer(for_reading(html)):
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


# --- spans outside the grammar ------------------------------------------------------

#: What every mention-like span carries, in any case: its absence is the fast path.
_HINT_RE = re.compile("data-type", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^<>]*+>")
#: How often :func:`normalise` re-reads its own output before giving up on
#: markup built to keep assembling new spans (it then keeps the text only).
MAX_PASSES = 8


def has_hint(html: object) -> bool:
    """Whether ``html`` is a string that could hold a mention span (cheap)."""
    return isinstance(html, str) and _HINT_RE.search(html) is not None


def text_of(inner_html: str) -> str:
    """The text of some markup, escaped: tags dropped, entities read."""
    return html_lib.escape(html_lib.unescape(_TAG_RE.sub("", inner_html)), quote=False)


def grammar_clean(html: str) -> bool:
    """Whether every ``data-type`` in ``html`` sits in a span the grammar
    matched and reads as a mention: the text then holds nothing
    :func:`normalise` would read differently, and the regular expressions can
    be used as they are."""
    matches = 0
    for match in MENTION_SPAN_RE.finditer(html):
        if mention_of(match.group(1)) is None:
            return False
        matches += 1
    return matches == len(_HINT_RE.findall(html))


def for_reading(html: str) -> str:
    """``html`` itself when :func:`grammar_clean`, else run through
    :func:`normalise` with every kind allowed."""
    return html if grammar_clean(html) else normalise(html)


def mention_of_parsed(
    attrs: list[tuple[str, str | None]], allowed: Iterable[str]
) -> tuple[str, str] | None:
    """``(kind, id)`` for a span's parsed attributes (``html.parser``'s list:
    names lower-cased, values unescaped, ``None`` for a valueless one), else
    ``None``: every attribute known, given once and with a value, the kind one
    of ``allowed``, the id a UUID."""
    seen: dict[str, str] = {}
    for name, value in attrs:
        if name in seen or value is None or name not in KNOWN_ATTRIBUTES:
            return None
        seen[name] = value
    if seen.get("data-type", "").lower() != "mention":
        return None
    kind = seen.get("data-kind", "").lower()
    if kind not in MENTION_KINDS or kind not in allowed:
        return None
    mention_id = _canonical_uuid(seen.get("data-id", ""))
    if mention_id is None:
        return None
    return kind, mention_id


def _says_mention(attrs: list[tuple[str, str | None]]) -> bool:
    return any(name == "data-type" and (value or "").lower() == "mention" for name, value in attrs)


class _MentionScanner(HTMLParser):
    """Finds the outermost mention-like spans of one text, as offsets.

    Script, style and the other raw-text elements are tokenised like any other
    content (a span hidden in them is found too), and a self-closed
    ``<span …/>`` stays open, as a browser reads it.
    """

    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=False)
        self.source = source
        self.line_starts = [0] + [m.end() for m in re.finditer("\n", source)]
        #: ``(start, end of opening tag, start of closing tag, end, attrs)``
        self.spans: list[tuple[int, int, int, int, list[tuple[str, str | None]]]] = []
        #: ``(start, end of opening tag, attrs)`` of a span still open.
        self.open: tuple[int, int, list[tuple[str, str | None]]] | None = None
        self.depth = 0

    def set_cdata_mode(self, *args: object, **kwargs: object) -> None:
        """Never enter raw-text mode: ``<script>`` content is markup here."""

    def _position(self) -> int:
        line, column = self.getpos()
        return self.line_starts[line - 1] + column

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "span":
            return
        if self.open is not None:
            self.depth += 1
        elif _says_mention(attrs):
            start = self._position()
            self.open = (start, start + len(self.get_starttag_text() or ""), attrs)
            self.depth = 0

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag: str) -> None:
        if tag != "span" or self.open is None:
            return
        if self.depth:
            self.depth -= 1
            return
        start = self._position()
        end = self.source.find(">", start) + 1 or len(self.source)
        opened, inner, attrs = self.open
        self.spans.append((opened, inner, start, end, attrs))
        self.open = None


def _parsed_pass(html: str, allowed: frozenset[str]) -> str:
    """Every mention-like span ``html.parser`` finds, rewritten."""
    scanner = _MentionScanner(html)
    scanner.feed(html)
    scanner.close()
    out: list[str] = []
    pos = 0
    for start, inner, closing, end, attrs in scanner.spans:
        out.append(html[pos:start])
        mention = mention_of_parsed(attrs, allowed)
        out.append(canonical_span(*mention) if mention else text_of(html[inner:closing]))
        pos = end
    if scanner.open is not None:
        # Never closed: not a mention; what follows keeps its text only.
        start, inner, _ = scanner.open
        out.append(html[pos:start])
        out.append(text_of(html[inner:]))
    else:
        out.append(html[pos:])
    return "".join(out)


def _grammar_pass(html: str, allowed: frozenset[str]) -> str:
    """Every span :data:`MENTION_SPAN_RE` matches, rewritten the same way.

    The parser does not see a span inside an attribute value, a comment or a
    tag such as ``<sp<span …>``, but the expression does: rewriting those too
    means no later reading can splice text around a collapsed span into a new
    one."""

    def _sub(match: re.Match[str]) -> str:
        mention = mention_of(match.group(1))
        if mention is None or mention[0] not in allowed:
            return text_of(match.group(2))
        return canonical_span(*mention)

    return MENTION_SPAN_RE.sub(_sub, html)


def normalise(html: str, allowed: Iterable[str] = MENTION_KINDS) -> str:
    """``html`` with every mention-like span rewritten (see the module doc):
    the canonical span of a valid mention of an ``allowed`` kind, else the
    escaped text of its content. Text without a ``data-type`` comes back as
    it is. Repeated until nothing changes, so the result is a fixed point."""
    if not has_hint(html):
        return html
    kinds = frozenset(allowed)
    for _ in range(MAX_PASSES):
        again = _grammar_pass(_parsed_pass(html, kinds), kinds)
        if again == html:
            return html
        html = again
    # Markup built to keep assembling spans: keep its text only.
    return text_of(html)
