"""Translate instance-local ids stored *inside* imported blobs (#1246).

Cards, relations and tags are matched or created on import, so they land on
the target under new primary keys. Their foreign-key *columns* were always
remapped (the entity engine resolves a card FK by reference), but an id held
inside a blob was copied verbatim and kept pointing at the source instance:

* a DrawIO diagram's ``cardId`` / ``relationId`` cell attributes, which is
  what made every card on an imported diagram read as deleted;
* BPMN ``calledElement`` / ``turboea:processRef``, a step's ``called_element``
  and a draft flow's ``draft_element_links``;
* saved-report scopes and filters, survey targets, portal and bookmark tag
  filters, a todo's in-app link, and a compliance finding's ``finding_key``
  (a hash over the card id).

The exporter now writes each card, relation and tag's own id in a
``source_id`` column, the appliers record ``source id → target id`` in an
:class:`IdMap`, and the per-section rewriters below translate a row's blobs
through it just before the row is inserted. Only an id found in the map is
ever replaced — a foreign BPMN process id, a pending diagram cell or a module
row's preserved primary key is left exactly as it was.

A bundle written before ``source_id`` existed carries no ids at all. For those
only diagrams are relinked, by card type and name (:func:`infer_legacy_card_ids`)
and by each edge's two endpoints (:func:`infer_legacy_relation_ids`).

Everything here is a plain function over plain data — no database access — so
the rules are unit-tested directly and reachable by mutation testing.
"""

from __future__ import annotations

import html
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

import defusedxml.ElementTree as ET  # noqa: N817

from app.services.drawio_refs import extract_card_refs

CARDS = "cards"
RELATIONS = "relations"
TAGS = "tags"
KINDS = (CARDS, RELATIONS, TAGS)

# Counter keys on :class:`RewriteTally` — stable identifiers the import
# preview translates (``workspaceTransfer.report.ref.<key>``).
REMAPPED = "remapped"
UNRESOLVED = "unresolved"
RELINKED_BY_NAME = "relinked_by_name"
AMBIGUOUS = "ambiguous"
UNPARSEABLE = "unparseable"
COMPRESSED = "compressed"

_UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
_UUID_FULL_RE = re.compile(_UUID)
_UUID_TOKEN_RE = re.compile(r"(?<![0-9a-fA-F-])" + _UUID + r"(?![0-9a-fA-F-])")

# Messages on one tally are capped: a diagram with hundreds of unmatched cells
# says so once per cell up to here, then only in the counters.
MAX_MESSAGES = 20


def canonical_uuid(value: Any) -> str | None:
    """The lower-case canonical form of a UUID string, or None for anything else.

    Strict on purpose: only the 36-character dashed form is an id. ``None``,
    ``""``, a sentinel such as ``__empty__`` or a BPMN process id like
    ``Process_1`` all answer None, which is how the rewriters know to leave a
    value alone.
    """
    if value is None:
        return None
    text = str(value).strip()
    if _UUID_FULL_RE.fullmatch(text) is None:
        return None
    return text.lower()


@dataclass
class IdMap:
    """Source-instance id → target-instance id, per kind of row."""

    cards: dict[str, str] = field(default_factory=dict)
    relations: dict[str, str] = field(default_factory=dict)
    tags: dict[str, str] = field(default_factory=dict)

    def table(self, kind: str) -> dict[str, str]:
        if kind == CARDS:
            return self.cards
        if kind == RELATIONS:
            return self.relations
        if kind == TAGS:
            return self.tags
        raise ValueError(f"Unknown id kind {kind!r}")

    def record(self, kind: str, source: Any, target: Any) -> None:
        """Remember that ``source`` landed as ``target``. The first mapping for
        a source id wins; an invalid id on either side is ignored."""
        src = canonical_uuid(source)
        tgt = canonical_uuid(target)
        if src is None or tgt is None:
            return
        self.table(kind).setdefault(src, tgt)

    def lookup(self, kind: str, value: Any) -> str | None:
        key = canonical_uuid(value)
        if key is None:
            return None
        return self.table(kind).get(key)


@dataclass
class RewriteTally:
    """What a rewrite did, summed per section into the import preview."""

    counts: dict[str, int] = field(default_factory=dict)
    messages: list[str] = field(default_factory=list)

    def bump(self, key: str, n: int = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + n

    def note(self, message: str) -> None:
        if len(self.messages) < MAX_MESSAGES:
            self.messages.append(message)

    def merge(self, other: RewriteTally) -> None:
        for key, n in other.counts.items():
            self.bump(key, n)
        for message in other.messages:
            self.note(message)

    def changed(self) -> bool:
        return bool(self.counts.get(REMAPPED) or self.counts.get(RELINKED_BY_NAME))


@dataclass
class RemapContext:
    """Everything a row rewriter may consult.

    ``legacy`` marks a bundle with no ``source_id`` column. The three indexes
    below it are only filled for such a bundle, and only for the diagram name
    fallback: cards by ``(type, lower-cased name)``, the ids of every card the
    target holds, relations by ``(type, source, target)`` and, per diagram, the
    cards its ``DiagramCards`` rows resolved to.
    """

    ids: IdMap = field(default_factory=IdMap)
    legacy: bool = False
    cards_by_type_name: dict[tuple[str, str], list[str]] = field(default_factory=dict)
    live_card_ids: set[str] = field(default_factory=set)
    relations_by_ends: dict[tuple[str, str, str], str] = field(default_factory=dict)
    diagram_card_hints: dict[str, set[str]] = field(default_factory=dict)


RowRewriter = Callable[[dict[str, Any], RemapContext], RewriteTally]


# ---------------------------------------------------------------------------
# Building the map
# ---------------------------------------------------------------------------


def bundle_carries_source_ids(rows: list[dict[str, Any]], column: str = "source_id") -> bool:
    """True when a sheet was written with the ``source_id`` column.

    Read off the header (every row carries every column, empty or not), so a
    bundle with no rows at all is not mistaken for a legacy one: with nothing
    to map there is nothing to fall back for either.
    """
    if not rows:
        return True
    return column in rows[0]


def backfill(
    rows: Iterable[dict[str, Any]],
    ids: IdMap,
    kind: str,
    resolve: Callable[[dict[str, Any]], Any],
    column: str = "source_id",
) -> None:
    """Map every bundle row whose ``source_id`` is not mapped yet, by resolving
    the row's own natural key on the target.

    The appliers record what they created or matched. This covers a sheet the
    run did not apply — a selective ``apply_selected`` over module sheets only,
    or a row a section skipped before reaching its record — so the blobs still
    translate as long as the row's card, relation or tag exists on the target.
    """
    table = ids.table(kind)
    for row in rows:
        source = canonical_uuid(row.get(column))
        if source is None or source in table:
            continue
        target = resolve(row)
        if target is not None:
            ids.record(kind, source, target)


def harvest_legacy_process_refs(
    rows: Iterable[dict[str, Any]],
    ids: IdMap,
    resolve: Callable[[str, str], Any],
) -> None:
    """Recover old → new card ids for called processes from a legacy bundle.

    A step's ``called_element`` is the called process's card id on the source,
    and the same row names that process by reference in
    ``business_process_id__ref`` — so the pair maps the old id without any
    ``source_id`` column. That is what keeps a legacy bundle's call activities
    pointing at the right process.
    """
    for row in rows:
        old = canonical_uuid(row.get("called_element"))
        ref = row.get("business_process_id__ref")
        ctype = row.get("business_process_id__type")
        if old is None or not ref or not ctype or old in ids.cards:
            continue
        target = resolve(str(ctype), str(ref))
        if target is not None:
            ids.record(CARDS, old, target)


# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------


def map_id(value: Any, table: dict[str, str], tally: RewriteTally) -> Any:
    """Translate one id. Anything that is not a UUID comes back untouched; a
    UUID with no mapping is counted as unresolved and kept as it was."""
    key = canonical_uuid(value)
    if key is None:
        return value
    target = table.get(key)
    if target is None:
        tally.bump(UNRESOLVED)
        return value
    if target != key:
        tally.bump(REMAPPED)
    return target


def map_id_list(values: Any, table: dict[str, str], tally: RewriteTally) -> Any:
    """Translate a list of ids, keeping its order. Not a list → untouched, so a
    malformed filter is carried over rather than dropped."""
    if not isinstance(values, list):
        return values
    return [map_id(v, table, tally) for v in values]


def map_dict_values(values: Any, table: dict[str, str], tally: RewriteTally) -> Any:
    """Translate the id lists under every key of a ``{key: [ids]}`` filter."""
    if not isinstance(values, dict):
        return values
    return {k: map_id_list(v, table, tally) for k, v in values.items()}


def replace_mapped_ids(value: Any, tables: tuple[dict[str, str], ...], tally: RewriteTally) -> Any:
    """Replace, anywhere inside a JSON value, an id one of ``tables`` maps.

    Shape-agnostic, so a key a report adds tomorrow is covered without being
    listed. It cannot misfire: only an id the map knows is ever touched, and
    those are random UUIDs. It also cannot report: a UUID it does not know may
    be anything, so the named keys stay what counts ``unresolved`` and the walk
    runs over the keys nobody named. Dict keys are left alone — a tag-group id
    keying a filter is matched by name on import and has no map.
    """
    if isinstance(value, dict):
        return {k: replace_mapped_ids(v, tables, tally) for k, v in value.items()}
    if isinstance(value, list):
        return [replace_mapped_ids(v, tables, tally) for v in value]
    key = canonical_uuid(value) if isinstance(value, str) else None
    if key is None:
        return value
    for table in tables:
        target = table.get(key)
        if target is not None:
            if target != key:
                tally.bump(REMAPPED)
            return target
    return value


# ---------------------------------------------------------------------------
# DrawIO
# ---------------------------------------------------------------------------

# The two Turbo EA attributes on a diagram cell that name an inventory row. The
# look-behind keeps a longer attribute ending in the same name out of it.
_DRAWIO_ID_ATTR_RE = re.compile(r'(?<![\w:-])(cardId|relationId)="(' + _UUID + r')"')
# DrawIO's compressed page format: base64 deflate text inside <diagram>, which
# no attribute regex can see into.
_COMPRESSED_DIAGRAM_RE = re.compile(r"<diagram\b[^>]*>\s*[^<\s]")
_TAG_RE = re.compile(r"<[^>]+>")
_LINE_BREAK_RE = re.compile(r"<br\s*/?>|</div>|</p>", re.IGNORECASE)


def rewrite_drawio_xml(
    xml: str,
    cards: dict[str, str],
    relations: dict[str, str],
    tally: RewriteTally,
) -> str:
    """Replace every mapped ``cardId`` / ``relationId`` value in a DrawIO XML.

    A regex, not a parse-and-serialise: the XML comes back byte-identical
    except for the ids, so nothing DrawIO wrote is reformatted on the way.
    """

    def _sub(match: re.Match[str]) -> str:
        attr, value = match.group(1), match.group(2)
        table = cards if attr == "cardId" else relations
        return f'{attr}="{map_id(value, table, tally)}"'

    return _DRAWIO_ID_ATTR_RE.sub(_sub, xml)


def count_mapped_drawio_ids(xml: str, cards: dict[str, str], relations: dict[str, str]) -> int:
    """How many ``cardId`` / ``relationId`` occurrences ``cards`` / ``relations``
    would move — what a legacy diagram reports as ``remapped`` for the ids the
    map alone knew, apart from the cells its name fallback placed."""
    moved = 0
    for match in _DRAWIO_ID_ATTR_RE.finditer(xml):
        attr, value = match.group(1), match.group(2).lower()
        target = (cards if attr == "cardId" else relations).get(value)
        if target is not None and target != value:
            moved += 1
    return moved


def is_compressed_drawio(xml: str) -> bool:
    return _COMPRESSED_DIAGRAM_RE.search(xml) is not None


@dataclass(frozen=True)
class DrawioCardCell:
    cell_ids: tuple[str, ...]
    card_id: str
    card_type: str
    name: str


@dataclass(frozen=True)
class DrawioEdge:
    relation_id: str
    relation_type: str
    source: str | None
    target: str | None


@dataclass
class DrawioScan:
    cards: list[DrawioCardCell] = field(default_factory=list)
    edges: list[DrawioEdge] = field(default_factory=list)


def cell_display_name(card_name: str | None, label: str | None) -> str:
    """The card name a cell shows: ``cardName`` when stamped, else its label.

    A label with detail rows is composed HTML, so it is reduced to its first
    line of text — the card's name — before it is used to match anything.
    """
    if card_name and card_name.strip():
        return card_name.strip()
    text = _LINE_BREAK_RE.sub("\n", label or "")
    text = html.unescape(_TAG_RE.sub("", text))
    for line in text.splitlines():
        if line.strip():
            return line.strip()
    return ""


def _inner_cell(el: Any) -> Any:
    for child in el:
        if child.tag == "mxCell":
            return child
    return None


def scan_drawio_cells(xml: str) -> DrawioScan | None:
    """Read the card cells and relation edges of a DrawIO XML, or None when it
    does not parse.

    A cell's id may sit on the ``<object>`` itself or on its inner ``<mxCell>``
    (older seed data), so both are registered for the edge lookup.
    """
    try:
        root = ET.fromstring(xml)
    except Exception:  # noqa: BLE001 — any malformed XML is simply not scanned
        return None
    scan = DrawioScan()
    for el in root.iter():
        inner = _inner_cell(el)
        card_id = canonical_uuid(el.get("cardId"))
        if card_id is not None:
            cell_ids = tuple(
                i for i in (el.get("id"), inner.get("id") if inner is not None else None) if i
            )
            scan.cards.append(
                DrawioCardCell(
                    cell_ids=cell_ids,
                    card_id=card_id,
                    card_type=el.get("cardType") or "",
                    name=cell_display_name(el.get("cardName"), el.get("label")),
                )
            )
        relation_id = canonical_uuid(el.get("relationId"))
        if relation_id is not None:
            ends = inner if inner is not None else el
            scan.edges.append(
                DrawioEdge(
                    relation_id=relation_id,
                    relation_type=el.get("relationType") or "",
                    source=ends.get("source"),
                    target=ends.get("target"),
                )
            )
    return scan


def infer_legacy_card_ids(
    scan: DrawioScan,
    ctx: RemapContext,
    hints: set[str],
    tally: RewriteTally,
) -> dict[str, str]:
    """Old card id → new card id for a legacy bundle's diagram, by type + name.

    One candidate links. Several are narrowed to the cards this diagram's
    ``DiagramCards`` rows resolved to and link only if exactly one is left.
    Otherwise the cell is reported and left alone. A cell whose id already
    names a card on the target (a re-import into the same instance) is not
    touched at all.
    """
    found: dict[str, str] = {}
    seen: set[str] = set()
    for cell in scan.cards:
        if (
            cell.card_id in seen
            or cell.card_id in ctx.live_card_ids
            or cell.card_id in ctx.ids.cards
        ):
            continue
        seen.add(cell.card_id)
        candidates = ctx.cards_by_type_name.get((cell.card_type, cell.name.lower()), [])
        if len(candidates) > 1:
            narrowed = [c for c in candidates if c in hints]
            if len(narrowed) == 1:
                candidates = narrowed
        if len(candidates) == 1:
            found[cell.card_id] = candidates[0]
            tally.bump(RELINKED_BY_NAME)
        elif candidates:
            tally.bump(AMBIGUOUS)
            tally.note(f"diagram card {cell.name!r} ({cell.card_type}) matches several cards")
        else:
            tally.bump(UNRESOLVED)
            tally.note(f"diagram card {cell.name!r} ({cell.card_type}) not found")
    return found


def infer_legacy_relation_ids(
    scan: DrawioScan,
    cards: dict[str, str],
    ctx: RemapContext,
    tally: RewriteTally,
) -> dict[str, str]:
    """Old relation id → new relation id, from each edge's two card endpoints.

    The edge may be drawn against the relation's direction, so both
    orientations are tried; the relation's own direction is preferred.
    """
    cell_card: dict[str, str] = {}
    for cell in scan.cards:
        for cell_id in cell.cell_ids:
            cell_card[cell_id] = cell.card_id
    # An edge whose id already names a relation here (a re-import into the
    # same instance) is left alone and not counted.
    live_relations = set(ctx.relations_by_ends.values())
    found: dict[str, str] = {}
    for edge in scan.edges:
        if edge.relation_id in found or edge.relation_id in live_relations:
            continue
        src = cards.get(cell_card.get(edge.source or "", ""))
        tgt = cards.get(cell_card.get(edge.target or "", ""))
        rel = None
        if src and tgt:
            rel = ctx.relations_by_ends.get((edge.relation_type, src, tgt))
            if rel is None:
                rel = ctx.relations_by_ends.get((edge.relation_type, tgt, src))
        if rel is not None:
            found[edge.relation_id] = rel
            tally.bump(RELINKED_BY_NAME)
        else:
            tally.bump(UNRESOLVED)
    return found


def rewrite_diagram_data(
    data: Any,
    diagram_id: str | None,
    ctx: RemapContext,
) -> RewriteTally:
    """Translate the ids inside a diagram's ``data`` dict, in place."""
    tally = RewriteTally()
    if not isinstance(data, dict):
        return tally
    xml = data.get("xml")
    if not isinstance(xml, str) or not xml:
        return tally
    if is_compressed_drawio(xml):
        tally.bump(COMPRESSED)
    cards = ctx.ids.cards
    relations = ctx.ids.relations
    if ctx.legacy:
        scan = scan_drawio_cells(xml)
        if scan is None:
            tally.bump(UNPARSEABLE)
        else:
            hints = ctx.diagram_card_hints.get(diagram_id or "", set())
            cards = {**cards, **infer_legacy_card_ids(scan, ctx, hints, tally)}
            resolved = {**{c: c for c in ctx.live_card_ids}, **cards}
            relations = {**relations, **infer_legacy_relation_ids(scan, resolved, ctx, tally)}
        # The fallback has counted its own cells, placed or not; what the map
        # alone moved is counted here, so the heal path can tell the row
        # changed. The rewrite itself therefore counts nothing.
        moved = count_mapped_drawio_ids(xml, ctx.ids.cards, ctx.ids.relations)
        if moved:
            tally.bump(REMAPPED, moved)
        data["xml"] = rewrite_drawio_xml(xml, cards, relations, RewriteTally())
    else:
        data["xml"] = rewrite_drawio_xml(xml, cards, relations, tally)
    if "card_refs" in data:
        data["card_refs"] = extract_card_refs(data)
    return tally


def rewrite_diagram_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    diagram_id = kwargs.get("id")
    return rewrite_diagram_data(
        kwargs.get("data"), str(diagram_id) if diagram_id is not None else None, ctx
    )


# ---------------------------------------------------------------------------
# BPM
# ---------------------------------------------------------------------------

# ``calledElement`` (BPMN's own call-activity reference) and any namespaced
# ``processRef`` — Turbo EA writes ``turboea:processRef``. A bare
# ``processRef`` (a participant's reference to a <process>) has no prefix and
# never matches, and the value must be a UUID to be touched at all.
_BPMN_REF_ATTR_RE = re.compile(
    r'(\s)(calledElement|[A-Za-z_][\w.-]*:processRef)="(' + _UUID + r')"'
)

# Card links on one step in a draft flow (``draft_element_links``).
DRAFT_LINK_CARD_KEYS = (
    "application_id",
    "data_object_id",
    "it_component_id",
    "business_process_id",
)


def rewrite_bpmn_xml(xml: Any, ids: IdMap, tally: RewriteTally) -> Any:
    if not isinstance(xml, str) or not xml:
        return xml

    def _sub(match: re.Match[str]) -> str:
        lead, attr, value = match.group(1), match.group(2), match.group(3)
        return f'{lead}{attr}="{map_id(value, ids.cards, tally)}"'

    return _BPMN_REF_ATTR_RE.sub(_sub, xml)


def rewrite_draft_element_links(links: Any, ids: IdMap, tally: RewriteTally) -> Any:
    """Translate the card ids a draft holds per step.

    An explicit clear — ``None`` for a link, ``[]`` for organisations — is the
    user's own statement and survives untouched; so do the step's custom fields.
    """
    if not isinstance(links, dict):
        return links
    out: dict[str, Any] = {}
    for element_id, link in links.items():
        if not isinstance(link, dict):
            out[element_id] = link
            continue
        new_link = dict(link)
        for key in DRAFT_LINK_CARD_KEYS:
            if key in new_link:
                new_link[key] = map_id(new_link[key], ids.cards, tally)
        if "organization_ids" in new_link:
            new_link["organization_ids"] = map_id_list(
                new_link["organization_ids"], ids.cards, tally
            )
        out[element_id] = new_link
    return out


def rewrite_process_diagram_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    tally = RewriteTally()
    kwargs["bpmn_xml"] = rewrite_bpmn_xml(kwargs.get("bpmn_xml"), ctx.ids, tally)
    return tally


def rewrite_flow_version_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    tally = RewriteTally()
    kwargs["bpmn_xml"] = rewrite_bpmn_xml(kwargs.get("bpmn_xml"), ctx.ids, tally)
    if "draft_element_links" in kwargs:
        kwargs["draft_element_links"] = rewrite_draft_element_links(
            kwargs["draft_element_links"], ctx.ids, tally
        )
    return tally


def rewrite_process_element_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    """``called_element`` copies the called process's card id out of the XML;
    a foreign, non-UUID process id is left as the hint it is."""
    tally = RewriteTally()
    kwargs["called_element"] = map_id(kwargs.get("called_element"), ctx.ids.cards, tally)
    return tally


# ---------------------------------------------------------------------------
# Saved reports, surveys, portals, bookmarks
# ---------------------------------------------------------------------------

# Saved-report config keys that hold one card id, a list of card ids, a
# {key: [card ids]} map, or tag ids. Every other key is a type key, a field
# key, a display option or a date, and is carried over as it is.
REPORT_CARD_ID_KEYS = ("center",)
REPORT_CARD_ID_LIST_KEYS = ("scopeIds", "rowScopeIds", "colScopeIds", "filterOrgs", "filterCtxs")
REPORT_CARD_ID_MAP_KEYS = ("relationFilters",)
REPORT_TAG_ID_LIST_KEYS = ("tagFilterIds",)
REPORT_TAG_ID_MAP_KEYS = ("tagFilters",)
REPORT_KNOWN_KEYS = frozenset(
    (
        *REPORT_CARD_ID_KEYS,
        *REPORT_CARD_ID_LIST_KEYS,
        *REPORT_CARD_ID_MAP_KEYS,
        *REPORT_TAG_ID_LIST_KEYS,
        *REPORT_TAG_ID_MAP_KEYS,
        "drillStack",
    )
)


def _walk_unknown_keys(
    out: dict[str, Any], known: frozenset[str] | set[str], ids: IdMap, tally: RewriteTally
) -> dict[str, Any]:
    tables = (ids.cards, ids.tags)
    return {k: (v if k in known else replace_mapped_ids(v, tables, tally)) for k, v in out.items()}


def rewrite_saved_report_config(config: Any, ids: IdMap, tally: RewriteTally) -> Any:
    if not isinstance(config, dict):
        return config
    out = dict(config)
    for key in REPORT_CARD_ID_KEYS:
        if key in out:
            out[key] = map_id(out[key], ids.cards, tally)
    for key in REPORT_CARD_ID_LIST_KEYS:
        if key in out:
            out[key] = map_id_list(out[key], ids.cards, tally)
    for key in REPORT_CARD_ID_MAP_KEYS:
        if key in out:
            out[key] = map_dict_values(out[key], ids.cards, tally)
    for key in REPORT_TAG_ID_LIST_KEYS:
        if key in out:
            out[key] = map_id_list(out[key], ids.tags, tally)
    for key in REPORT_TAG_ID_MAP_KEYS:
        if key in out:
            out[key] = map_dict_values(out[key], ids.tags, tally)
    # The cost report's drill-down path: one card per frame.
    stack = out.get("drillStack")
    if isinstance(stack, list):
        new_stack = []
        for frame in stack:
            if isinstance(frame, dict) and "cardId" in frame:
                frame = {**frame, "cardId": map_id(frame["cardId"], ids.cards, tally)}
            new_stack.append(frame)
        out["drillStack"] = new_stack
    return _walk_unknown_keys(out, REPORT_KNOWN_KEYS, ids, tally)


def rewrite_saved_report_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    tally = RewriteTally()
    if "config" in kwargs:
        kwargs["config"] = rewrite_saved_report_config(kwargs["config"], ctx.ids, tally)
    return tally


def _rewrite_filter_keys(
    filters: Any,
    card_keys: tuple[str, ...],
    tag_keys: tuple[str, ...],
    ids: IdMap,
    tally: RewriteTally,
) -> Any:
    if not isinstance(filters, dict):
        return filters
    out = dict(filters)
    for key in card_keys:
        if key in out:
            out[key] = map_id_list(out[key], ids.cards, tally)
    for key in tag_keys:
        if key in out:
            out[key] = map_id_list(out[key], ids.tags, tally)
    return _walk_unknown_keys(out, {*card_keys, *tag_keys}, ids, tally)


def rewrite_survey_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    tally = RewriteTally()
    if "target_filters" in kwargs:
        kwargs["target_filters"] = _rewrite_filter_keys(
            kwargs["target_filters"], ("card_ids", "related_ids"), ("tag_ids",), ctx.ids, tally
        )
    return tally


def rewrite_portal_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    tally = RewriteTally()
    if "filters" in kwargs:
        kwargs["filters"] = _rewrite_filter_keys(
            kwargs["filters"], (), ("tag_ids",), ctx.ids, tally
        )
    return tally


def rewrite_bookmark_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    """A bookmark's relation filters hold card *names*, which travel as they
    are; only its tag filter holds ids."""
    tally = RewriteTally()
    if "filters" in kwargs:
        kwargs["filters"] = _rewrite_filter_keys(kwargs["filters"], (), ("tagIds",), ctx.ids, tally)
    return tally


def _rewrite_relation_answer(value: Any, ids: IdMap, tally: RewriteTally) -> Any:
    """A relation answer is a list of ``{id, name}`` card refs (or bare ids).
    An attribute answer is anything else and comes back as it is — its list
    items are option keys, never ids."""
    if not isinstance(value, list):
        return value
    out = []
    for item in value:
        if isinstance(item, dict) and "id" in item:
            item = {**item, "id": map_id(item["id"], ids.cards, tally)}
        elif canonical_uuid(item) is not None:
            item = map_id(item, ids.cards, tally)
        out.append(item)
    return out


def rewrite_survey_response_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    """A response to a relation field holds the related cards' ids — both the
    value shown to the respondent and the one they proposed, which an admin
    later applies."""
    tally = RewriteTally()
    responses = kwargs.get("responses")
    if not isinstance(responses, dict):
        return tally
    out: dict[str, Any] = {}
    for key, answer in responses.items():
        if isinstance(answer, dict):
            answer = {
                **answer,
                **{
                    k: _rewrite_relation_answer(answer[k], ctx.ids, tally)
                    for k in ("current_value", "new_value")
                    if k in answer
                },
            }
        out[key] = answer
    kwargs["responses"] = out
    return tally


# ---------------------------------------------------------------------------
# Todos, compliance findings
# ---------------------------------------------------------------------------

# In-app paths whose segment after the prefix is a card id.
_CARD_LINK_PREFIXES = ("/cards/", "/ppm/")


def rewrite_link(link: Any, ids: IdMap, tally: RewriteTally) -> Any:
    """Translate the card ids in an in-app link (``/cards/{id}``,
    ``/ppm/{id}?tab=…``, ``/surveys/{survey}/respond/{card}``).

    Only a mapped id is replaced, so a module row's id in the same path — a
    survey's, a risk's — is left alone. A card-shaped segment that does not map
    is counted; any other UUID that does not map is simply not a card.
    """
    if not isinstance(link, str) or not link:
        return link
    card_positions = {
        len(prefix) + idx
        for prefix in _CARD_LINK_PREFIXES
        for idx in [link.find(prefix)]
        if idx >= 0
    }

    def _sub(match: re.Match[str]) -> str:
        value = match.group(0)
        if ids.lookup(CARDS, value) is not None or match.start() in card_positions:
            return str(map_id(value, ids.cards, tally))
        return value

    return _UUID_TOKEN_RE.sub(_sub, link)


def rewrite_todo_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    tally = RewriteTally()
    if "link" in kwargs:
        kwargs["link"] = rewrite_link(kwargs["link"], ctx.ids, tally)
    return tally


def refresh_finding_key_row(kwargs: dict[str, Any], ctx: RemapContext) -> RewriteTally:
    """Recompute a compliance finding's ``finding_key`` from the card it now
    belongs to.

    The key hashes the card id, so a copied key would stop matching the very
    next scan on the target: the scan would mint a duplicate of every finding
    and orphan the review decision recorded on the original.
    """
    from app.services.compliance_scanner import compute_finding_key

    tally = RewriteTally()
    if "finding_key" not in kwargs:
        return tally
    new_key = compute_finding_key(
        kwargs.get("scope_type"),
        kwargs.get("card_id"),
        kwargs.get("regulation"),
        kwargs.get("regulation_article"),
    )
    if new_key != kwargs["finding_key"]:
        kwargs["finding_key"] = new_key
        tally.bump(REMAPPED)
    return tally
