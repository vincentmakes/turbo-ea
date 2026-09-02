import type { Relation, RelationRef } from "@/types";

/**
 * The card at the *other* end of a relation, from `fsId`'s point of view.
 *
 * Always compare per row (`r.source_id === fsId`) rather than off the relation
 * type's static "am I the source type" flag: for a self-referencing relation
 * type (source type === target type) that flag is true for every row, so
 * incoming relations resolve to the wrong end.
 */
export function otherEnd(r: Relation, fsId: string): RelationRef | undefined {
  return r.source_id === fsId ? r.target : r.source;
}

/**
 * Sort relations alphabetically by the other card's name (discussion #918).
 *
 * Returns a new array; the input is left alone. Pass the app locale
 * (`i18n.language`) — `localeCompare(…, undefined)` collates with the
 * *browser* locale, which is not necessarily the language the UI is in.
 *
 * Lives here rather than in `cardDetailUtils` so the inventory grid can reuse
 * it without pulling that module's MUI + extension-host import graph into its
 * bundle.
 */
export function sortRelationsByName(
  rels: Relation[],
  fsId: string,
  locale?: string,
): Relation[] {
  return [...rels].sort((a, b) =>
    (otherEnd(a, fsId)?.name ?? "").localeCompare(otherEnd(b, fsId)?.name ?? "", locale, {
      sensitivity: "base",
    }),
  );
}

/**
 * Relation types ordered so every type pointing at the same card type sits
 * together.
 *
 * Several relation types may share an ordered card-type pair — an Organization
 * that *owns* an Application and one that *uses* it — and `sort_order` is a
 * flat sequence with no notion of that, so the two groups for one pair could
 * land at opposite ends of the Relations section and a card linked by both
 * could not be read as one story.
 *
 * A stable group-by anchored on each other-type's FIRST appearance: the
 * metamodel's own order is preserved inside a run and no run jumps ahead of an
 * unrelated one, so the change is contiguity only — not a re-sort. A
 * self-referencing type buckets under `cardTypeKey` and needs no special case.
 */
export function orderRelationTypesByOtherEnd<
  T extends { source_type_key: string; target_type_key: string },
>(rts: T[], cardTypeKey: string): T[] {
  const runs = new Map<string, T[]>();
  for (const rt of rts) {
    const other = rt.source_type_key === cardTypeKey ? rt.target_type_key : rt.source_type_key;
    const run = runs.get(other);
    if (run) run.push(rt);
    else runs.set(other, [rt]);
  }
  // `Map` iterates in insertion order, which is exactly first-appearance
  // anchoring — no explicit sort needed.
  return [...runs.values()].flat();
}

/** One relation type as seen from ONE of its ends. */
export interface RelationSide<T> {
  rt: T;
  /** True when the card under view sits at the relation's SOURCE end. */
  isSource: boolean;
}

/**
 * Every side of every relation type a card type takes part in.
 *
 * "Am I the source?" must never be derived from the relation *type*: for a
 * self-referencing type (source type === target type) that test is true at
 * BOTH ends, so both directions collapsed into one group under the forward
 * verb and nothing could ever create the incoming one. A cross-type rt has
 * exactly one side, as before; a self-referencing rt has two, emitted
 * together so they stay adjacent wherever the list is rendered. A type that
 * touches neither end is dropped rather than guessed at.
 */
export function expandSides<T extends { source_type_key: string; target_type_key: string }>(
  rts: T[],
  cardTypeKey: string,
): RelationSide<T>[] {
  const out: RelationSide<T>[] = [];
  for (const rt of rts) {
    if (rt.source_type_key === cardTypeKey) out.push({ rt, isSource: true });
    if (rt.target_type_key === cardTypeKey) out.push({ rt, isSource: false });
  }
  return out;
}

/**
 * The key one side is filed under. A cross-type rt keeps its bare key, so
 * persisted filters, bookmarks and `rel_<key>` deep links keep resolving; a
 * self-referencing rt takes the `__out` / `__in` suffix the inventory's mass
 * edit already uses for exactly this split.
 */
export function sideKey<T extends { key: string; source_type_key: string; target_type_key: string }>(
  rt: T,
  isSource: boolean,
): string {
  if (rt.source_type_key !== rt.target_type_key) return rt.key;
  return `${rt.key}__${isSource ? "out" : "in"}`;
}

/**
 * Does relation `r` belong on this side of `rtKey`, seen from `myId`?
 *
 * Per row, never per type — see `otherEnd`. A degenerate self-loop
 * (`source_id === target_id === myId`) lands on the outgoing side, once.
 */
export function onSide(
  r: { type: string; source_id: string; target_id: string },
  rtKey: string,
  myId: string,
  isSource: boolean,
): boolean {
  return r.type === rtKey && (r.source_id === myId) === isSource;
}

/**
 * Inverse of `sideKey`: the bare relation-type key plus, when the key names
 * one side of a self-referencing type, which side. A bare key means "either
 * side" — the union every saved report and bookmark has always meant.
 */
export function parseSideKey(key: string): { key: string; isSource?: boolean } {
  if (key.endsWith("__out")) return { key: key.slice(0, -5), isSource: true };
  if (key.endsWith("__in")) return { key: key.slice(0, -4), isSource: false };
  return { key };
}
