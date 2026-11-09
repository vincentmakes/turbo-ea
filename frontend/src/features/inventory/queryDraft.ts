/**
 * Pure helpers behind the inventory's query builder (the path strip in edit
 * mode). The query is a tree: every node (the start card or a hop) holds AND
 * hops in `related` and, optionally, an OR group in `related_any`. A node is
 * addressed by its `NodePath` from the start card; every operation changes
 * the one node a path names and copies the nodes above it.
 *
 * The strip draws the tree as lines (`rows`): each row is a chain that
 * follows a node's continuation hop (`related_any[0]` when the node has an OR
 * group, else `related[0]`), and every other hop of a node opens a row of its
 * own below, starting under that node and joined to it by a connector.
 */
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import { expandSides, sideKey } from "@/lib/relationSort";
import type { CardQuery, CardQueryHop, CardQueryWhere, RelationType, TagGroup } from "@/types";
import type { CardNameEntry } from "./useCardNames";

/** The most hops a chain may hold below its start card (the backend's MAX_DEPTH). */
export const MAX_CHAIN_DEPTH = 3;
/** The most hops in one `related` or one `related_any` list (the backend's MAX_HOPS). */
export const MAX_HOPS_PER_LIST = 10;
/** The most hops in the whole tree, both lists counted (the backend's MAX_TOTAL_HOPS). */
export const MAX_HOPS_TOTAL = 12;

/** The query grammar's "no lifecycle" value; the facet controls say `EMPTY_FILTER_KEY`. */
const LIFECYCLE_NONE = "none";

/** The two hop lists of a node: AND (`related`) and OR (`related_any`). */
export type HopList = "related" | "related_any";

/** One step down the tree: the hop at `index` of a node's `list`. */
export interface PathStep {
  list: HopList;
  index: number;
}

/** A node of the query, as the steps from the start card to it (empty = the start card). */
export type NodePath = PathStep[];

/** How a branch joins the node it hangs from: beside its hops, or as an alternative. */
export type Connective = "and" | "or";

/** A node of the query tree: the start card or a hop. */
type QueryNode = CardQuery | CardQueryHop;

/** One node of a row: its path, and its hop (null for the start card). */
export interface QueryRowNode {
  path: NodePath;
  hop: CardQueryHop | null;
}

/** One line of the strip: a chain of nodes, the first row or a branch below a node. */
export interface QueryRow {
  /** The node the row branches from; null for the first row. */
  parentPath: NodePath | null;
  /** How the row's first hop joins its parent; null for the first row. */
  connective: Connective | null;
  nodes: QueryRowNode[];
}

/** What a condition chip filters on. */
export type ConditionKind =
  | "lifecycle_phase"
  | "subtype"
  | "approval_status"
  | "data_quality_band"
  | "tags"
  | "cards"
  | { attribute: string };

/** Why a draft cannot be saved (or sent), or null when it can. */
export type DraftProblem = "empty_type" | "empty_values";

/** The node at `path`, or undefined when the query has no such node. */
export function nodeAt(query: CardQuery, path: NodePath): QueryNode | undefined {
  let node: QueryNode = query;
  for (const step of path) {
    const next: CardQueryHop | undefined = node[step.list]?.[step.index];
    if (!next) return undefined;
    node = next;
  }
  return node;
}

function replaceAt<N extends QueryNode>(
  node: N,
  path: NodePath,
  fn: (node: QueryNode) => QueryNode,
): N | null {
  if (path.length === 0) return fn(node) as N;
  const [step, ...rest] = path;
  const list = node[step.list];
  const child = list?.[step.index];
  if (!list || !child) return null;
  const next = replaceAt(child, rest, fn);
  if (!next) return null;
  return { ...node, [step.list]: list.map((h, i) => (i === step.index ? next : h)) };
}

/** `fn` applied to the node at `path`; the query itself when there is no such node. */
function mapNode(query: CardQuery, path: NodePath, fn: (node: QueryNode) => QueryNode): CardQuery {
  return replaceAt(query, path, fn) ?? query;
}

/** The hop a node's row continues with: the first of its OR group, else its first hop. */
function continuationStep(node: QueryNode): PathStep | null {
  if (node.related_any && node.related_any.length > 0) return { list: "related_any", index: 0 };
  if (node.related && node.related.length > 0) return { list: "related", index: 0 };
  return null;
}

/** The hops of a node that open rows of their own: OR alternatives first, then AND hops. */
function branchSteps(node: QueryNode): { step: PathStep; connective: Connective }[] {
  const cont = continuationStep(node);
  const out: { step: PathStep; connective: Connective }[] = [];
  const related = node.related ?? [];
  if (cont?.list === "related_any") {
    node.related_any!.forEach((_, index) => {
      if (index > 0) out.push({ step: { list: "related_any", index }, connective: "or" });
    });
    related.forEach((_, index) => out.push({ step: { list: "related", index }, connective: "and" }));
  } else {
    related.forEach((_, index) => {
      if (index > 0) out.push({ step: { list: "related", index }, connective: "and" });
    });
  }
  return out;
}

/**
 * The query as the strip's lines. Row 0 is the start card and its chain of
 * continuation hops. Every other hop of a node opens a row of its own,
 * holding the hop and its own chain, drawn below and starting under that
 * node. Rows are listed depth-first: each row is followed by the rows that
 * branch from its nodes, the last node's first, so a branch row sits right
 * below the row it hangs from. The builder offers its pluses on the last row
 * only, so a query it made grows as a stack downward; every line of one an
 * assistant wrote is listed the same way.
 */
export function rows(query: CardQuery): QueryRow[] {
  const out: QueryRow[] = [];
  const walk = (
    path: NodePath,
    hop: CardQueryHop | null,
    parentPath: NodePath | null,
    connective: Connective | null,
  ) => {
    const row: QueryRow = { parentPath, connective, nodes: [] };
    out.push(row);
    let p = path;
    let h = hop;
    for (;;) {
      row.nodes.push({ path: p, hop: h });
      const node: QueryNode = h ?? query;
      const step = continuationStep(node);
      if (!step) break;
      h = node[step.list]![step.index];
      p = [...p, step];
    }
    for (const rn of [...row.nodes].reverse()) {
      const node: QueryNode = rn.hop ?? query;
      for (const { step, connective: c } of branchSteps(node)) {
        walk([...rn.path, step], node[step.list]![step.index], rn.path, c);
      }
    }
  };
  walk([], null, null, null);
  return out;
}

/** Every hop of a node, both lists: its `related`, then its `related_any`. */
function hopsOf(node: QueryNode): CardQueryHop[] {
  return [...(node.related ?? []), ...(node.related_any ?? [])];
}

function countHops(node: QueryNode): number {
  return hopsOf(node).reduce((n, hop) => n + 1 + countHops(hop), 0);
}

/** How many hops hang directly from a node, both lists counted. */
export function hopCount(node: QueryNode | undefined): number {
  return node ? hopsOf(node).length : 0;
}

/** The node at `path` when a hop may hang from it at all: typed, above `MAX_CHAIN_DEPTH`, tree not full. */
function growableNode(query: CardQuery, path: NodePath): QueryNode | null {
  const node = nodeAt(query, path);
  if (!node?.type || path.length >= MAX_CHAIN_DEPTH) return null;
  return countHops(query) < MAX_HOPS_TOTAL ? node : null;
}

/** Can the `+ relation` chip add a hop to the node at `path` (its `related` not full)? */
export function canAppend(query: CardQuery, path: NodePath): boolean {
  const node = growableNode(query, path);
  return !!node && (node.related?.length ?? 0) < MAX_HOPS_PER_LIST;
}

/**
 * Can a branch be added under the node at `path`, joined by `connective`
 * (either one when left out)? Only beside a hop the node already has — a
 * node with none has nothing to combine a branch with, and its first hop is
 * the `+ relation` chip's. Not without a type, at `MAX_CHAIN_DEPTH`, with
 * `MAX_HOPS_TOTAL` hops in the tree, or with the list it would join full.
 */
export function canBranch(query: CardQuery, path: NodePath, connective?: Connective): boolean {
  const node = growableNode(query, path);
  if (!node || hopCount(node) === 0) return false;
  const andOk = (node.related?.length ?? 0) < MAX_HOPS_PER_LIST;
  const orOk = (node.related_any?.length ?? 0) < MAX_HOPS_PER_LIST;
  if (connective === "and") return andOk;
  if (connective === "or") return orOk;
  return andOk || orOk;
}

/** A new start type: the chain and its conditions belonged to the old one. */
export function setStartType(query: CardQuery, type: string): CardQuery {
  if (query.type === type) return query;
  return { type };
}

/**
 * Appends a hop to the `related` list of the node at `path` — the `+
 * relation` chip at the end of a row, where it is the node's first hop.
 */
export function appendHopAt(
  query: CardQuery,
  path: NodePath,
  relation: string,
  type: string,
): CardQuery {
  if (!canAppend(query, path)) return query;
  return mapNode(query, path, (n) => ({ ...n, related: [...(n.related ?? []), { relation, type }] }));
}

/**
 * Adds a branch under the node at `path`. "and" appends the hop to the
 * node's `related`. The first "or" moves the node's continuation hop
 * (`related[0]`) into `related_any` beside the new one — "either the row
 * above or this branch"; a later "or" joins `related_any`. A node with no hop
 * yet takes no branch (`canBranch`): its first hop is the `+ relation` chip's.
 */
export function addBranch(
  query: CardQuery,
  path: NodePath,
  connective: Connective,
  relation: string,
  type: string,
): CardQuery {
  if (!canBranch(query, path, connective)) return query;
  if (connective === "and") return appendHopAt(query, path, relation, type);
  const hop: CardQueryHop = { relation, type };
  return mapNode(query, path, (n) => {
    if (n.related_any && n.related_any.length > 0) {
      return { ...n, related_any: [...n.related_any, hop] };
    }
    const [first, ...rest] = n.related ?? [];
    const next: QueryNode = { ...n, related_any: [first, hop] };
    if (rest.length > 0) next.related = rest;
    else delete next.related;
    return next;
  });
}

/** The two hop lists of a node, as `normalizeHops` reads and writes them. */
type HopLists = Pick<CardQuery, "related" | "related_any">;

/**
 * `node` with an OR group of one folded into `related`, in front: an OR of
 * one is that hop, and it stays the continuation the row above reads
 * (`related[0]`). The one fold rule — `removeHopAt`, `sendableQuery` and the
 * backend's workspace-import remap (`_rewrite_query_node`) all apply it.
 */
export function normalizeHops<N extends HopLists>(node: N): N {
  if (node.related_any?.length !== 1) return node;
  const { related_any: [survivor], ...rest } = node;
  return { ...rest, related: [survivor, ...(node.related ?? [])] } as N;
}

/**
 * Removes the hop at `path` and everything below it. An OR group left with
 * one hop folds into `related` (`normalizeHops`).
 */
export function removeHopAt(query: CardQuery, path: NodePath): CardQuery {
  if (path.length === 0 || !nodeAt(query, path)) return query;
  const step = path[path.length - 1];
  return mapNode(query, path.slice(0, -1), (n) => {
    const next: QueryNode = { ...n };
    const left = (n[step.list] ?? []).filter((_, i) => i !== step.index);
    if (left.length > 0) next[step.list] = left;
    else delete next[step.list];
    return normalizeHops(next);
  });
}

/** Flips the hop at `path` between "has" and "has no". */
export function toggleNegate(query: CardQuery, path: NodePath): CardQuery {
  if (path.length === 0) return query;
  return mapNode(query, path, (n) => {
    const { negate, ...rest } = n as CardQueryHop;
    return negate ? rest : { ...rest, negate: true };
  });
}

/** The values a condition holds on `where`, or undefined when it is not set. */
export function conditionValues(
  where: CardQueryWhere | undefined,
  kind: ConditionKind,
): string[] | undefined {
  if (!where) return undefined;
  if (typeof kind === "object") return where.attributes?.[kind.attribute];
  return where[kind];
}

function withCondition(
  where: CardQueryWhere | undefined,
  kind: ConditionKind,
  values: string[] | null,
): CardQueryWhere | undefined {
  const next: CardQueryWhere = { ...(where ?? {}) };
  if (typeof kind === "object") {
    const attributes = { ...(next.attributes ?? {}) };
    if (values) attributes[kind.attribute] = values;
    else delete attributes[kind.attribute];
    if (Object.keys(attributes).length > 0) next.attributes = attributes;
    else delete next.attributes;
  } else if (values) {
    next[kind] = values;
  } else {
    delete next[kind];
    // "Include sub-cards" qualifies the picked cards; it goes with them.
    if (kind === "cards") delete next.include_descendants;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function setWhere(node: QueryNode, where: CardQueryWhere | undefined): QueryNode {
  const next: QueryNode = { ...node };
  if (where) next.where = where;
  else delete next.where;
  return next;
}

/**
 * Sets a condition on the node at `path`. An empty list is kept: it is a condition
 * still being filled in, which `draftProblem` reports until it has a value
 * (the strip drops it when its editor closes empty).
 */
export function setCondition(
  query: CardQuery,
  path: NodePath,
  kind: ConditionKind,
  values: string[],
): CardQuery {
  return mapNode(query, path, (n) => setWhere(n, withCondition(n.where, kind, [...values])));
}

/** Removes a condition from the node at `path`; an emptied `where` is dropped. */
export function removeCondition(
  query: CardQuery,
  path: NodePath,
  kind: ConditionKind,
): CardQuery {
  return mapNode(query, path, (n) => setWhere(n, withCondition(n.where, kind, null)));
}

/**
 * Turns "Include sub-cards" on or off for the node at `path`. A no-op on a
 * node without picked cards: the flag means nothing (and is refused) without them.
 */
export function setIncludeDescendants(query: CardQuery, path: NodePath, on: boolean): CardQuery {
  if (!nodeAt(query, path)?.where?.cards) return query;
  return mapNode(query, path, (n) => {
    const where: CardQueryWhere = { ...n.where };
    if (on) where.include_descendants = true;
    else delete where.include_descendants;
    return setWhere(n, where);
  });
}

/** Lifecycle values as the facet control holds them (`none` → the empty key). */
export function lifecycleToFacet(values: string[]): string[] {
  return values.map((v) => (v === LIFECYCLE_NONE ? EMPTY_FILTER_KEY : v));
}

/** The facet control's lifecycle values as the grammar holds them. */
export function facetToLifecycle(values: string[]): string[] {
  return values.map((v) => (v === EMPTY_FILTER_KEY ? LIFECYCLE_NONE : v));
}

function whereHasEmptyList(where: CardQueryWhere | undefined): boolean {
  if (!where) return false;
  const lists = [
    where.lifecycle_phase,
    where.subtype,
    where.approval_status,
    where.data_quality_band,
    where.tags,
    where.cards,
    ...Object.values(where.attributes ?? {}),
  ];
  return lists.some((l) => l !== undefined && l.length === 0);
}

function treeHas(node: QueryNode, test: (node: QueryNode) => boolean): boolean {
  return test(node) || hopsOf(node).some((hop) => treeHas(hop, test));
}

/**
 * Why the draft cannot be saved or sent: a node without a type (the start
 * card or any hop, in either list), else a condition without values.
 */
export function draftProblem(query: CardQuery): DraftProblem | null {
  if (treeHas(query, (n) => !n.type)) return "empty_type";
  if (treeHas(query, (n) => whereHasEmptyList(n.where))) return "empty_values";
  return null;
}

/** A copy of `where` without its empty condition lists, or undefined when nothing is left. */
function sendableWhere(where: CardQueryWhere | undefined): CardQueryWhere | undefined {
  if (!where) return undefined;
  const next: CardQueryWhere = {};
  const kinds = [
    "lifecycle_phase",
    "subtype",
    "approval_status",
    "data_quality_band",
    "tags",
    "cards",
  ] as const;
  for (const kind of kinds) {
    const values = where[kind];
    if (values && values.length > 0) next[kind] = [...values];
  }
  const attributes: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(where.attributes ?? {})) {
    if (values.length > 0) attributes[key] = [...values];
  }
  if (Object.keys(attributes).length > 0) next.attributes = attributes;
  // "Include sub-cards" qualifies the picked cards; it goes with them.
  if (next.cards && where.include_descendants !== undefined) {
    next.include_descendants = where.include_descendants;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * The hop lists of `node` as sent: hops without a type left out in both
 * lists, and an OR group left with one hop folded (`normalizeHops`) — the UI
 * never sends a one-hop OR group.
 */
function sendableHops(node: QueryNode): HopLists {
  const lists: HopLists = {};
  if (node.related) lists.related = node.related.filter((h) => h.type).map(sendableHop);
  const any = (node.related_any ?? []).filter((h) => h.type).map(sendableHop);
  if (any.length > 0) lists.related_any = any;
  return normalizeHops(lists);
}

function sendableHop(hop: CardQueryHop): CardQueryHop {
  const next: CardQueryHop = { relation: hop.relation, type: hop.type };
  const where = sendableWhere(hop.where);
  if (where) next.where = where;
  if (hop.negate !== undefined) next.negate = hop.negate;
  return { ...next, ...sendableHops(hop) };
}

/**
 * The part of a draft the grid can preview while it is being edited: a copy
 * with every condition still waiting for values left out (and "Include
 * sub-cards" with an emptied cards condition), on every node; a hop without a
 * type left out; a one-hop OR group sent as a plain hop. Null while the draft
 * has no start type. An empty condition is the one being filled in, so it
 * narrows nothing yet — it must not widen the preview to the whole type.
 */
export function sendableQuery(query: CardQuery): CardQuery | null {
  if (!query.type) return null;
  const next: CardQuery = { type: query.type };
  const where = sendableWhere(query.where);
  if (where) next.where = where;
  return { ...next, ...sendableHops(query) };
}

/** One relation a hop can follow from a node of `type`. */
export interface RelationChoice {
  /** The hop's `relation`: the bare key, or `__out` / `__in` on a self-referencing type. */
  key: string;
  rt: RelationType;
  /** True when the node sits at the relation's source end. */
  isSource: boolean;
  /** The card type at the other end. */
  otherType: string;
}

/** Every side of every relation type a node of `type` can follow — both sides of a self-reference. */
export function relationChoices(type: string, relationTypes: RelationType[]): RelationChoice[] {
  return expandSides(relationTypes, type).map(({ rt, isSource }) => ({
    key: sideKey(rt, isSource),
    rt,
    isSource,
    otherType: isSource ? rt.target_type_key : rt.source_type_key,
  }));
}

/** One chip of a tags condition: a tag group and its chosen tags. */
export interface TagChip {
  key: string;
  label: string;
  ids: string[];
}

/**
 * A tags condition as one chip per tag group, `"<Group>: <tag>, <tag>"`, in
 * the order the ids first name each group. Ids no group holds (a deleted tag)
 * share one chip labelled `unknownLabel`.
 */
export function tagChipsByGroup(
  tagIds: string[],
  tagGroups: TagGroup[],
  unknownLabel: string,
): TagChip[] {
  const byGroup = new Map<string, { name: string; names: string[]; ids: string[] }>();
  const unknown: string[] = [];
  for (const id of tagIds) {
    const group = tagGroups.find((g) => g.tags.some((tag) => tag.id === id));
    const tag = group?.tags.find((x) => x.id === id);
    if (!group || !tag) {
      unknown.push(id);
      continue;
    }
    const entry = byGroup.get(group.id) ?? { name: group.name, names: [], ids: [] };
    entry.names.push(tag.name);
    entry.ids.push(id);
    byGroup.set(group.id, entry);
  }
  const chips: TagChip[] = [...byGroup.entries()].map(([groupId, g]) => ({
    key: groupId,
    label: `${g.name}: ${g.names.join(", ")}`,
    ids: g.ids,
  }));
  if (unknown.length > 0) chips.push({ key: "__unknown__", label: unknownLabel, ids: unknown });
  return chips;
}

/**
 * Every card id the query picks, on every node — `related` and `related_any`
 * alike — deduped in the order they first appear (start node first, then each
 * node's hops depth-first, its `related` before its `related_any`).
 */
export function pickedCardIds(query: CardQuery): string[] {
  const seen = new Set<string>();
  const visit = (node: QueryNode) => {
    for (const id of node.where?.cards ?? []) seen.add(id);
    hopsOf(node).forEach(visit);
  };
  visit(query);
  return [...seen];
}

/** The translated words `cardsChipLabel` puts together. */
export interface CardsChipLabels {
  /** The condition's name, "Cards". */
  cardsLabel: string;
  hiddenCard: string;
  unknownCard: string;
  /** The suffix naming "Include sub-cards", "sub-cards". */
  subCards: string;
}

/**
 * What one picked card is called wherever the query names it (the strip's
 * chip, the cards editor's chips, the picker's basket): its id while it is
 * still loading, the "(hidden card)" / "(unknown card)" label when it is
 * withheld from the reader or gone, else its name.
 */
export function cardNameLabel(
  entry: CardNameEntry | undefined,
  id: string,
  labels: Pick<CardsChipLabels, "hiddenCard" | "unknownCard">,
): string {
  if (!entry) return id;
  if (entry.kind === "card") return entry.name;
  return entry.kind === "hidden" ? labels.hiddenCard : labels.unknownCard;
}

/**
 * A cards condition as one chip label: `"Cards: A, B, C +N"`, plus
 * `" · sub-cards"` when the picks cover their descendants. A card still
 * loading shows its id; one withheld from the reader, or gone, says so.
 */
export function cardsChipLabel(
  ids: string[],
  names: Map<string, CardNameEntry>,
  includeDescendants: boolean,
  labels: CardsChipLabels,
  max = 3,
): string {
  let label = labels.cardsLabel;
  if (ids.length > 0) {
    const shown = ids.slice(0, max).map((id) => cardNameLabel(names.get(id), id, labels));
    label += `: ${shown.join(", ")}`;
    if (ids.length > max) label += ` +${ids.length - max}`;
  }
  if (includeDescendants) label += ` · ${labels.subCards}`;
  return label;
}
