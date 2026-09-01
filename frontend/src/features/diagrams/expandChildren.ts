/**
 * Folding a card's relations into expandable children.
 *
 * Expanding a card inserts one CELL per related card. That is not the same as
 * one cell per relation: any number of relation types may connect a pair of
 * card types, so the same neighbour can be reached several times over. A second
 * vertex carrying the same `cardId` would trip the canvas dedup and unlink one
 * of them, so the extra relations become extra EDGES on the one vertex instead
 * — each keeping its own verb and relation id.
 */

import type { Relation } from "@/types";
import type { ExpandChildData, ExpandChildRelation } from "./drawio-shapes";

export interface RelationGroup {
  /** The card at the other end. */
  other: NonNullable<Relation["target"]>;
  /** The relation that supplies the child's own edge. */
  primary: Relation;
  /** Further relations to the same card, in encounter order. */
  extras: Relation[];
}

/**
 * Group a card's relations by the card at the other end, preserving order.
 *
 * `rels` is expected to be the raw `GET /relations?card_id=` payload; relations
 * whose other end is missing are skipped, as are any whose other card
 * `shouldSkip` rejects (used to leave neighbours already on the canvas alone).
 */
export function groupRelationsByOtherCard(
  rels: Relation[],
  cardId: string,
  shouldSkip?: (otherId: string) => boolean,
): RelationGroup[] {
  const byCard = new Map<string, RelationGroup>();
  const groups: RelationGroup[] = [];
  const skipped = new Set<string>();

  for (const r of rels) {
    const other = r.source_id === cardId ? r.target : r.source;
    if (!other) continue;
    if (skipped.has(other.id)) continue;

    const existing = byCard.get(other.id);
    if (existing) {
      existing.extras.push(r);
      continue;
    }
    if (shouldSkip?.(other.id)) {
      skipped.add(other.id);
      continue;
    }
    const group: RelationGroup = { other, primary: r, extras: [] };
    byCard.set(other.id, group);
    groups.push(group);
  }
  return groups;
}

/**
 * Drop relations the user deleted from the canvas while the group was expanded.
 *
 * Collapse removes the child cells, so what survives is remembered by id and
 * re-applied on the next expand. Tracking that per CARD was right only while a
 * card had exactly one edge: with several relation types reaching the same
 * neighbour, deleting one edge leaves the card still connected, nothing is
 * recorded, and re-expanding redraws the deleted relation — with a `relationId`
 * the server no longer has.
 *
 * A child whose relations were all deleted is dropped; otherwise the first
 * surviving relation becomes the primary and the rest stay as extras.
 */
export function pruneDeletedRelations(
  children: ExpandChildData[],
  deletedRelationIds: ReadonlySet<string>,
): ExpandChildData[] {
  if (deletedRelationIds.size === 0) return children;
  const out: ExpandChildData[] = [];

  for (const child of children) {
    const rels: ExpandChildRelation[] = [
      {
        relationType: child.relationType,
        relationId: child.relationId,
        relationLabel: child.relationLabel,
        incoming: child.incoming,
        flow: child.flow,
      },
      ...(child.extraRelations ?? []),
    ];
    // A relation with no id was never persisted, so it cannot have been deleted.
    const kept = rels.filter((r) => !r.relationId || !deletedRelationIds.has(r.relationId));
    if (kept.length === 0) continue;

    const [primary, ...extras] = kept;
    out.push({
      ...child,
      relationType: primary.relationType,
      relationId: primary.relationId,
      relationLabel: primary.relationLabel,
      incoming: primary.incoming,
      flow: primary.flow,
      ...(extras.length > 0 ? { extraRelations: extras } : { extraRelations: undefined }),
    });
  }
  return out;
}
