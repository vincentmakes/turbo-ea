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
