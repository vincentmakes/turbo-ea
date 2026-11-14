"""The picture format in decision and SoAW text: one grammar, one serialiser.

A picture in the rich text of a decision (``adr``) or a SoAW section
(``soaw``) is stored as::

    <img src="/api/v1/document-images/<kind>/<lowercase uuid>" alt="…" title="…"
         width="320" height="200" data-align="center">

(on one line). The picture's bytes live in ``document_images``
(:mod:`app.services.document_image_service`); the text holds only this
reference. The rules (:func:`canonical_attributes`):

* ``src`` must be exactly this document kind's route (:data:`ROUTE_PREFIX`,
  then the kind, then a UUID — any case on the way in, lower case on the way
  out). Anything else — an external URL, ``data:``, ``blob:``, a relative
  path, another kind's route — drops the whole ``<img>``;
* the kept attributes are :data:`ATTRIBUTE_ORDER`, in that order, an absent
  one omitted; every other attribute (event handlers, ``style``, ``srcset``,
  ``loading`` …) is stripped. ``width`` / ``height`` are integers from 1 to
  :data:`MAX_DIMENSION` (anything else is dropped), ``data-align`` is one of
  :data:`ALIGNMENTS` (absent means left; anything else is dropped), ``alt`` /
  ``title`` are kept as text, escaped. When an attribute is given twice the
  first one counts, as in a browser;
* the serialisation is the editor's own (:func:`serialise`): double quotes,
  no self-closing slash. It must stay byte-identical to what TipTap's
  ``getHTML()`` emits, or every load of a document would count as an edit —
  the order and the escaping are defined once, here.

A browser also reads ``<image …>`` as ``<img …>``, so both tag names are
pictures here. Everything that is not a picture passes through byte for
byte.

How (:func:`normalise_images`), after :mod:`app.services.mention_markup`:
a fast path when the text holds no ``<img`` / ``<image`` at all; a scanner
on the standard library's ``html.parser`` that never enters raw-text mode
(a picture hidden in ``<script>`` is found too) rewrites every picture tag
it sees to its canonical form or removes it; then a possessive regular
expression pass (:data:`IMG_TAG_RE`) rewrites every picture tag the parser
saw as text — inside an attribute value, a comment, a tag such as
``<im<img …>g …>``, or an unterminated tag at the end — keeping only one
that is already canonical. Removing a tag can splice its neighbours into a
new one, so both run until the text stops changing (at most
:data:`MAX_PASSES` times; markup built to keep assembling pictures then has
every remaining picture opener escaped). The result is a fixed point:
normalising it again changes nothing.

Removing a picture can also splice a mention span together, and removing a
mention can splice a picture: the caller (``document_collab.before_save``)
alternates this pass with the mention pass until both are stable.

Every pattern runs in linear time on hostile input: a tag is never scanned
across a ``<`` or ``>``.

Pure and standard-library only (``re``, ``html``).
"""

from __future__ import annotations

import html as html_lib
import re
from collections.abc import Callable, Mapping
from html.parser import HTMLParser

KINDS: tuple[str, ...] = ("adr", "soaw")

#: Where a picture of document kind ``k`` is served: ``ROUTE_PREFIX + k + "/" + id``.
ROUTE_PREFIX = "/api/v1/document-images/"

#: The attributes a stored picture keeps, in the editor's output order.
ATTRIBUTE_ORDER: tuple[str, ...] = ("src", "alt", "title", "width", "height", "data-align")

#: The alignments a picture may carry; no ``data-align`` means left.
ALIGNMENTS: frozenset[str] = frozenset({"center", "right"})

#: The largest ``width`` / ``height`` kept, in CSS pixels.
MAX_DIMENSION = 4000

#: How often :func:`normalise_images` re-reads its own output before giving up
#: on markup built to keep assembling pictures (the same bound as mentions).
MAX_PASSES = 8

_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_SRC_RE = re.compile(re.escape(ROUTE_PREFIX) + r"(adr|soaw)/(" + _UUID + r")")
_DIMENSION_RE = re.compile(r"[0-9]{1,4}")

#: Anything that could open a picture tag, in any case: its absence is the fast path.
_HINT_RE = re.compile(r"<im(?:g|age)", re.IGNORECASE)

#: A picture tag as a regular expression sees it: ``<img`` or ``<image`` ended
#: by whitespace, ``/`` or ``>``, then everything up to the closing ``>`` — or
#: to the end of the text, for a tag left unterminated. Group 1 is the text
#: between the tag name and the ``>``. Never crosses a ``<`` or ``>``.
IMG_TAG_RE = re.compile(r"<im(?:g|age)(?=[\s/>]|\Z)([^<>]*+)(>|\Z)", re.IGNORECASE)

# One ``name="value"`` pair, with the whitespace before it (matched at a given
# position, never searched for).
_ATTRIBUTE_RE = re.compile(r'\s++([A-Za-z_:][-A-Za-z0-9_:.]*+)="([^"<>]*+)"')

#: The canonical ``src`` of a stored picture, as :func:`image_ids_of` reads it.
_CANONICAL_SRC_RE = re.compile(
    r'<img src="' + re.escape(ROUTE_PREFIX) + r"(?:adr|soaw)/([0-9a-f]{8}-[0-9a-f]{4}-"
    r'[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"'
)

# What the editor's serialiser escapes in an attribute value (the HTML
# fragment serialisation algorithm, with ``<`` / ``>`` as current browsers do).
_ATTRIBUTE_ESCAPES: tuple[tuple[str, str], ...] = (
    ("&", "&amp;"),
    ("\u00a0", "&nbsp;"),
    ('"', "&quot;"),
    ("<", "&lt;"),
    (">", "&gt;"),
)


# --- the canonical form -------------------------------------------------------------


def src_for(kind: str, image_id: str) -> str:
    """The route of a picture: ``/api/v1/document-images/<kind>/<id>``."""
    return f"{ROUTE_PREFIX}{kind}/{image_id}"


def image_id_of_src(src: str | None, kind: str) -> str | None:
    """The lower-case id ``src`` names when it is exactly ``kind``'s route, else ``None``."""
    if src is None:
        return None
    match = _SRC_RE.fullmatch(src)
    if match is None or match.group(1) != kind:
        return None
    return match.group(2).lower()


def _dimension(value: str | None) -> str | None:
    if value is None or _DIMENSION_RE.fullmatch(value) is None:
        return None
    number = int(value)
    return str(number) if 1 <= number <= MAX_DIMENSION else None


def escape_attribute(value: str) -> str:
    """An attribute value escaped as the editor's serialiser does."""
    for raw, escaped in _ATTRIBUTE_ESCAPES:
        value = value.replace(raw, escaped)
    return value


def serialise(attributes: Mapping[str, str]) -> str:
    """The ``<img>`` tag for already-validated ``attributes``: the names of
    :data:`ATTRIBUTE_ORDER` in that order, double-quoted and escaped, no
    self-closing slash. The one place the stored form is spelled."""
    parts = "".join(
        f' {name}="{escape_attribute(attributes[name])}"'
        for name in ATTRIBUTE_ORDER
        if name in attributes
    )
    return f"<img{parts}>"


def canonical_attributes(attrs: list[tuple[str, str | None]], kind: str) -> dict[str, str] | None:
    """The kept attributes of a picture (``html.parser``'s list: names lower
    case, values unescaped, ``None`` for a valueless one), or ``None`` when
    the picture must be dropped (its ``src`` is not ``kind``'s route)."""
    first: dict[str, str | None] = {}
    for name, value in attrs:
        first.setdefault(name, value)
    image_id = image_id_of_src(first.get("src"), kind)
    if image_id is None:
        return None
    out = {"src": src_for(kind, image_id)}
    for name in ("alt", "title"):
        if name in first:
            out[name] = first[name] or ""
    for name in ("width", "height"):
        dimension = _dimension(first.get(name))
        if dimension is not None:
            out[name] = dimension
    align = first.get("data-align")
    if align in ALIGNMENTS:
        out["data-align"] = align
    return out


def canonical_img(attrs: list[tuple[str, str | None]], kind: str) -> str | None:
    """The stored tag for a picture's parsed attributes, or ``None`` to drop it."""
    kept = canonical_attributes(attrs, kind)
    return None if kept is None else serialise(kept)


def image_ids_of(html: object) -> set[str]:
    """The ids of every stored (canonical) picture in ``html``, lower case.
    Meant for normalised text; anything that is not a string holds none."""
    if not isinstance(html, str) or "<img" not in html:
        return set()
    return set(_CANONICAL_SRC_RE.findall(html))


# --- normalising --------------------------------------------------------------------


def has_hint(html: object) -> bool:
    """Whether ``html`` is a string that could hold a picture tag (cheap)."""
    return isinstance(html, str) and _HINT_RE.search(html) is not None


class _ImageScanner(HTMLParser):
    """Finds every picture start tag of one text, as offsets.

    Script, style and the other raw-text elements are tokenised like any other
    content, so a picture hidden in them is found too.
    """

    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=False)
        self.line_starts = [0] + [m.end() for m in re.finditer("\n", source)]
        #: ``(start, end, attrs)`` of each picture tag.
        self.tags: list[tuple[int, int, list[tuple[str, str | None]]]] = []

    def set_cdata_mode(self, *args: object, **kwargs: object) -> None:
        """Never enter raw-text mode: ``<script>`` content is markup here."""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in ("img", "image"):
            return
        line, column = self.getpos()
        start = self.line_starts[line - 1] + column
        self.tags.append((start, start + len(self.get_starttag_text() or ""), attrs))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)


def _keep_tag(tag: str | None, keep: Callable[[str], bool] | None) -> str:
    """``tag`` (a canonical picture, or ``None``) unless ``keep`` refuses its id."""
    if tag is None:
        return ""
    if keep is not None:
        ids = image_ids_of(tag)
        if not all(keep(image_id) for image_id in ids):
            return ""
    return tag


def _parsed_pass(html: str, kind: str, keep: Callable[[str], bool] | None) -> str:
    """Every picture tag ``html.parser`` finds, rewritten or removed."""
    scanner = _ImageScanner(html)
    scanner.feed(html)
    scanner.close()
    out: list[str] = []
    pos = 0
    for start, end, attrs in scanner.tags:
        out.append(html[pos:start])
        out.append(_keep_tag(canonical_img(attrs, kind), keep))
        pos = end
    out.append(html[pos:])
    return "".join(out)


def _strict_attributes(text: str) -> list[tuple[str, str | None]] | None:
    """The ``name="value"`` pairs of a tag's attribute text, or ``None`` when
    it is anything else (only canonical markup survives the regex pass)."""
    found: list[tuple[str, str | None]] = []
    pos = 0
    while (match := _ATTRIBUTE_RE.match(text, pos)) is not None:
        found.append((match.group(1).lower(), html_lib.unescape(match.group(2))))
        pos = match.end()
    return found if pos == len(text) else None


def _grammar_pass(html: str, kind: str, keep: Callable[[str], bool] | None) -> str:
    """Every picture tag :data:`IMG_TAG_RE` matches: kept when it is already
    canonical, removed otherwise. The parser does not see a tag inside an
    attribute value, a comment, a tag such as ``<im<img …>``, or one left
    unterminated at the end; the expression does."""

    def _sub(match: re.Match[str]) -> str:
        whole = match.group(0)
        if match.group(2) != ">":
            return ""
        attrs = _strict_attributes(match.group(1))
        if attrs is None:
            return ""
        tag = canonical_img(attrs, kind)
        if tag != whole:
            return ""
        return _keep_tag(tag, keep)

    return IMG_TAG_RE.sub(_sub, html)


def _escape_openers(html: str) -> str:
    """Every remaining picture opener turned into text: the last resort for
    markup built to keep assembling pictures."""
    return _HINT_RE.sub(lambda m: "&lt;" + m.group(0)[1:], html)


def normalise_images(html: str, kind: str, keep: Callable[[str], bool] | None = None) -> str:
    """``html`` with every picture in its stored form for a ``kind`` document
    (see the module doc), or removed. ``keep(id)``, when given, also removes
    a picture whose id it refuses (an unknown picture). Anything that is not
    a string, or holds no picture opener, comes back as it is. Repeated
    until nothing changes, so the result is a fixed point."""
    if kind not in KINDS:
        raise ValueError(f"Unknown document kind {kind!r}")
    if not has_hint(html):
        return html
    text = html
    for _ in range(MAX_PASSES):
        again = _grammar_pass(_parsed_pass(text, kind, keep), kind, keep)
        if again == text:
            return text
        text = again
    # Markup built to keep assembling pictures: no picture survives.
    return _escape_openers(text)
