/**
 * Pure helpers behind the inventory's query builder (the path strip in edit
 * mode). The builder edits a single chain — one hop per node, any conditions
 * on each — so every operation reads the query as its chain of nodes
 * (`chainNodes`), changes one node, and writes the chain back
 * (`rebuildChain`). Hops beside the chain (a branch an MCP assistant wrote)
 * ride along untouched on the node they hang from.
 */
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import { expandSides, sideKey } from "@/lib/relationSort";
import type { CardQuery, CardQueryHop, CardQueryWhere, RelationType, TagGroup } from "@/types";
import type { CardNameEntry } from "./useCardNames";

/** The most hops a chain may hold below its start card (the backend's MAX_DEPTH). */
export const MAX_CHAIN_DEPTH = 3;

/** The query grammar's "no lifecycle" value; the facet controls say `EMPTY_FILTER_KEY`. */
const LIFECYCLE_NONE = "none";

/** One node of the chain: the start card (no `relation`) or a hop. */
export interface ChainNode {
  type: string;
  where?: CardQueryWhere;
  /** The hop's relation key; absent on the start node. */
  relation?: string;
  negate?: boolean;
  /** Hops at this node beside the chain's own (a branch), kept as they are. */
  extra?: CardQueryHop[];
}

/** What a condition chip filters on. */
export type ConditionKind =
  | "lifecycle_phase"
  | "subtype"
  | "approval_status"
  | "data_quality_band"
  | "eol_status"
  | "tags"
  | "cards"
  | { attribute: string };

/** Why a draft cannot be saved (or sent), or null when it can. */
export type DraftProblem = "empty_type" | "empty_values";

function nodeOf(
  base: { type: string; where?: CardQueryWhere; related?: CardQueryHop[] },
  hop?: Pick<CardQueryHop, "relation" | "negate">,
): ChainNode {
  const node: ChainNode = { type: base.type };
  if (base.where) node.where = base.where;
  if (hop) {
    node.relation = hop.relation;
    if (hop.negate) node.negate = true;
  }
  const extra = (base.related ?? []).slice(1);
  if (extra.length > 0) node.extra = extra;
  return node;
}

/** The query read as its chain: the start node, then the first hop of each level. */
export function chainNodes(query: CardQuery): ChainNode[] {
  const nodes = [nodeOf(query)];
  let hops = query.related ?? [];
  while (hops.length > 0) {
    const hop = hops[0];
    nodes.push(nodeOf(hop, hop));
    hops = hop.related ?? [];
  }
  return nodes;
}

/** The inverse of `chainNodes`. Empty `where` / `related` are left out. */
export function rebuildChain(nodes: ChainNode[]): CardQuery {
  let below: CardQueryHop | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const related = [...(below ? [below] : []), ...(node.extra ?? [])];
    if (i === 0) {
      const query: CardQuery = { type: node.type };
      if (node.where) query.where = node.where;
      if (related.length > 0) query.related = related;
      return query;
    }
    const hop: CardQueryHop = { relation: node.relation ?? "", type: node.type };
    if (node.where) hop.where = node.where;
    if (node.negate) hop.negate = true;
    if (related.length > 0) hop.related = related;
    below = hop;
  }
  return { type: "" };
}

function mapNode(query: CardQuery, index: number, fn: (node: ChainNode) => ChainNode): CardQuery {
  const nodes = chainNodes(query);
  if (index < 0 || index >= nodes.length) return query;
  return rebuildChain(nodes.map((n, i) => (i === index ? fn(n) : n)));
}

/** A new start type: the chain and its conditions belonged to the old one. */
export function setStartType(query: CardQuery, type: string): CardQuery {
  if (query.type === type) return query;
  return { type };
}

/** Appends a hop after the chain's last node, up to `MAX_CHAIN_DEPTH` hops. */
export function appendHop(query: CardQuery, relation: string, type: string): CardQuery {
  const nodes = chainNodes(query);
  if (nodes.length > MAX_CHAIN_DEPTH) return query;
  return rebuildChain([...nodes, { relation, type }]);
}

/** Removes the hop at node `index` (≥ 1) and everything after it. */
export function removeHopAt(query: CardQuery, index: number): CardQuery {
  const nodes = chainNodes(query);
  if (index < 1 || index >= nodes.length) return query;
  return rebuildChain(nodes.slice(0, index));
}

/** Flips the hop at node `index` between "has" and "has no". */
export function toggleNegate(query: CardQuery, index: number): CardQuery {
  if (index < 1) return query;
  return mapNode(query, index, (n) => {
    const { negate, ...rest } = n;
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

function setWhere(node: ChainNode, where: CardQueryWhere | undefined): ChainNode {
  const next: ChainNode = { ...node };
  if (where) next.where = where;
  else delete next.where;
  return next;
}

/**
 * Sets a condition on node `index`. An empty list is kept: it is a condition
 * still being filled in, which `draftProblem` reports until it has a value
 * (the strip drops it when its editor closes empty).
 */
export function setCondition(
  query: CardQuery,
  index: number,
  kind: ConditionKind,
  values: string[],
): CardQuery {
  return mapNode(query, index, (n) => setWhere(n, withCondition(n.where, kind, [...values])));
}

/** Removes a condition from node `index`; an emptied `where` is dropped. */
export function removeCondition(query: CardQuery, index: number, kind: ConditionKind): CardQuery {
  return mapNode(query, index, (n) => setWhere(n, withCondition(n.where, kind, null)));
}

/**
 * Turns "Include sub-cards" on or off for node `index`. A no-op on a node
 * without picked cards: the flag means nothing (and is refused) without them.
 */
export function setIncludeDescendants(query: CardQuery, index: number, on: boolean): CardQuery {
  const node = chainNodes(query)[index];
  if (!node?.where?.cards) return query;
  return mapNode(query, index, (n) => {
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
    where.eol_status,
    where.tags,
    where.cards,
    ...Object.values(where.attributes ?? {}),
  ];
  return lists.some((l) => l !== undefined && l.length === 0);
}

function hopsHaveEmptyList(hops: CardQueryHop[] | undefined): boolean {
  return (hops ?? []).some(
    (h) => !h.type || whereHasEmptyList(h.where) || hopsHaveEmptyList(h.related),
  );
}

/** Why the draft cannot be saved or sent: no start type, or a condition without values. */
export function draftProblem(query: CardQuery): DraftProblem | null {
  if (!query.type) return "empty_type";
  if (whereHasEmptyList(query.where) || hopsHaveEmptyList(query.related)) return "empty_values";
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
    "eol_status",
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

function sendableHop(hop: CardQueryHop): CardQueryHop {
  const next: CardQueryHop = { relation: hop.relation, type: hop.type };
  const where = sendableWhere(hop.where);
  if (where) next.where = where;
  if (hop.negate !== undefined) next.negate = hop.negate;
  if (hop.related) next.related = hop.related.map(sendableHop);
  return next;
}

/**
 * The part of a draft the grid can preview while it is being edited: a copy
 * with every condition still waiting for values left out (and "Include
 * sub-cards" with an emptied cards condition), on every node. Null while the
 * draft has no start type. An empty condition is the one being filled in, so
 * it narrows nothing yet — it must not widen the preview to the whole type.
 */
export function sendableQuery(query: CardQuery): CardQuery | null {
  if (!query.type) return null;
  const next: CardQuery = { type: query.type };
  const where = sendableWhere(query.where);
  if (where) next.where = where;
  if (query.related) next.related = query.related.map(sendableHop);
  return next;
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
 * Every card id the query picks, on every node — branch hops beside the chain
 * included — deduped in the order they first appear (start node first, then
 * each node's hops depth-first).
 */
export function pickedCardIds(query: CardQuery): string[] {
  const seen = new Set<string>();
  const visit = (where: CardQueryWhere | undefined, hops: CardQueryHop[] | undefined) => {
    for (const id of where?.cards ?? []) seen.add(id);
    for (const hop of hops ?? []) visit(hop.where, hop.related);
  };
  visit(query.where, query.related);
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
