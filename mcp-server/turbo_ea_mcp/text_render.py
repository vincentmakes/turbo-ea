"""Rich text as plain text, for agents reading a discussion.

The backend returns comment bodies (and decision / SoAW sections) as small
HTML documents: paragraphs, line breaks, inline marks, lists, block quotes,
links, and mention spans it rendered for the reader::

    <span data-type="mention" data-kind="card" data-id="…">@CRM</span>
    <span data-type="mention" data-kind="card" data-restricted="true" data-token="…"></span>
    <span data-type="mention" data-kind="card" data-id="…" data-missing="true"></span>

:func:`html_to_text` turns that into readable text: a paragraph per block,
``- `` / ``1. `` list items, ``> `` quotes, a link's target after its text,
and each mention as ``@Label`` (``[restricted]`` for one the reader may not
see, ``[deleted]`` for one whose target no longer exists).

Standard library only (``html.parser``). The input is untrusted: the output
is plain text and never markup, scripts and styles are dropped with their
content, and nesting is capped so a hostile body cannot inflate the output.
"""

from __future__ import annotations

import html as html_lib
import re
from html.parser import HTMLParser

#: Mention states, as the agent reads them.
RESTRICTED = "[restricted]"
DELETED = "[deleted]"
#: A mention span with no state and no label (never written by the backend
#: for a reader; stored, unrendered markup would read this way).
UNLABELLED = "[mention]"

#: Deeper lists and quotes are rendered at this depth.
MAX_DEPTH = 8

_BLOCKS = frozenset(
    {
        "p",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "pre",
        "table",
        "tr",
        "section",
        "article",
        "header",
        "footer",
        "hr",
    }
)
_DROPPED = frozenset({"script", "style", "template"})
_SPACE_RE = re.compile(r"\s+")
_BLANK_LINES_RE = re.compile(r"\n{3,}")
_TAG_RE = re.compile(r"<[^>]*>?")
_SAFE_HREF_RE = re.compile(r"(?:https?://|mailto:)", re.IGNORECASE)


def mention_text(attrs: dict[str, str], label: str) -> str:
    """How one mention span reads: ``@Label``, or its state when it has no
    label for this reader."""
    if attrs.get("data-restricted") == "true":
        return RESTRICTED
    if attrs.get("data-missing") == "true":
        return DELETED
    label = _SPACE_RE.sub(" ", label).strip()
    if not label:
        return UNLABELLED
    if not label.startswith("@"):
        label = f"@{label}"
    if attrs.get("data-archived") == "true":
        label = f"{label} (archived)"
    return label


class _Renderer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._lists: list[list] = []  # [tag, items so far]
        self._quote = 0
        self._pre = 0
        self._dropped = 0
        self._fresh_item = False
        self._links: list[tuple[str | None, int]] = []
        self._mention: dict[str, str] | None = None
        self._mention_depth = 0
        self._mention_label: list[str] = []

    # -- output helpers ---------------------------------------------------------

    def _trailing_newlines(self) -> int:
        count = 0
        for piece in reversed(self.out):
            stripped = piece.rstrip("\n")
            count += len(piece) - len(stripped)
            if stripped:
                return count
        return count if self.out else -1

    def _break(self, lines: int) -> None:
        """End the current line and leave ``lines - 1`` blank lines (never
        at the very start)."""
        have = self._trailing_newlines()
        if have < 0:
            return
        if have < lines:
            self.out.append("\n" * (lines - have))
        self._fresh_item = False

    def _at_line_start(self) -> bool:
        return self._trailing_newlines() != 0

    def _prefix(self) -> str:
        depth = min(len(self._lists), MAX_DEPTH)
        return "> " * min(self._quote, MAX_DEPTH) + "  " * depth

    def _write(self, text: str) -> None:
        if not self._pre:
            text = _SPACE_RE.sub(" ", text)
            if self._at_line_start() or self._fresh_item:
                text = text.lstrip(" ")
        if not text:
            return
        if self._at_line_start():
            self.out.append(self._prefix())
        self.out.append(text)
        self._fresh_item = False

    def _paragraph_gap(self) -> int:
        return 1 if self._lists else 2

    # -- parser callbacks -------------------------------------------------------

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._dropped or tag in _DROPPED:
            if tag in _DROPPED:
                self._dropped += 1
            return
        if self._mention is not None:
            if tag == "span":
                self._mention_depth += 1
            return
        values = {name: value or "" for name, value in attrs}
        if tag == "span" and values.get("data-type") == "mention":
            self._mention = values
            self._mention_depth = 1
            self._mention_label = []
        elif tag == "br":
            self._write_break()
        elif tag in ("ul", "ol"):
            self._break(1 if self._lists else 2)
            self._lists.append([tag, 0])
        elif tag == "li":
            self._start_item()
        elif tag == "blockquote":
            self._break(self._paragraph_gap())
            self._quote += 1
        elif tag in _BLOCKS:
            if not self._fresh_item:
                self._break(self._paragraph_gap())
            if tag == "pre":
                self._pre += 1
        elif tag == "a":
            href = values.get("href", "").strip()
            self._links.append((href or None, len(self.out)))
        elif tag in ("td", "th"):
            self._write(" ")

    def handle_endtag(self, tag: str) -> None:
        if self._dropped:
            if tag in _DROPPED:
                self._dropped -= 1
            return
        if self._mention is not None:
            if tag == "span":
                self._mention_depth -= 1
                if self._mention_depth == 0:
                    self._end_mention()
            return
        if tag in ("ul", "ol"):
            if self._lists:
                self._lists.pop()
            self._break(1 if self._lists else 2)
        elif tag == "li":
            self._break(1)
        elif tag == "blockquote":
            if self._quote:
                self._quote -= 1
            self._break(self._paragraph_gap())
        elif tag in _BLOCKS:
            if tag == "pre" and self._pre:
                self._pre -= 1
            self._break(self._paragraph_gap())
        elif tag == "a" and self._links:
            self._end_link(*self._links.pop())

    def handle_data(self, data: str) -> None:
        if self._dropped:
            return
        if self._mention is not None:
            self._mention_label.append(data)
            return
        self._write(data)

    # -- pieces -----------------------------------------------------------------

    def _write_break(self) -> None:
        self.out.append("\n")
        self._fresh_item = False

    def _start_item(self) -> None:
        self._break(1)
        if not self._lists:
            self._lists.append(["ul", 0])
        current = self._lists[-1]
        current[1] += 1
        marker = f"{current[1]}. " if current[0] == "ol" else "- "
        depth = min(len(self._lists), MAX_DEPTH)
        self.out.append("> " * min(self._quote, MAX_DEPTH) + "  " * (depth - 1) + marker)
        self._fresh_item = True

    def _end_link(self, href: str | None, start: int) -> None:
        if href is None or not _SAFE_HREF_RE.match(href):
            return
        text = "".join(self.out[start:]).strip()
        shown = href[len("mailto:") :] if href.lower().startswith("mailto:") else href
        if text in (href, shown):
            return
        if text:
            self.out.append(f" ({href})")
        else:
            self._write(href)

    def _end_mention(self) -> None:
        attrs = self._mention or {}
        label = "".join(self._mention_label)
        self._mention = None
        self._mention_label = []
        self._write(mention_text(attrs, label))

    def finish(self) -> str:
        self.close()
        if self._mention is not None:
            self._end_mention()
        text = "".join(self.out)
        text = "\n".join(line.rstrip() for line in text.split("\n"))
        return _BLANK_LINES_RE.sub("\n\n", text).strip()


def _fallback(html: str) -> str:
    """Tags stripped and entities read: for input the parser gives up on."""
    text = html_lib.unescape(_TAG_RE.sub(" ", html))
    return _SPACE_RE.sub(" ", text).strip()


def html_to_text(html: object) -> str:
    """``html`` as readable plain text (``""`` for anything but a string)."""
    if not isinstance(html, str) or not html:
        return ""
    parser = _Renderer()
    try:
        parser.feed(html)
        return parser.finish()
    except Exception:  # noqa: BLE001 — malformed markup never fails a read
        return _fallback(html)
