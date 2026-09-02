import type { RelatedCardRef, Relation, RelationType } from "@/types";

/**
 * Build a lookup: for each relation type, map cardId → array of related cards.
 *
 * Indexed per ROW and per END: every end of a relation whose card is of the
 * selected type maps to the other end. For a cross-type relation type that is
 * exactly one end, as before. For a self-referencing type it is BOTH — reading
 * "which end am I" off the *type* was true for every row, so a relation was
 * filed under its source only and the target card's cell stayed empty. Pass
 * `side` to keep one direction (the filter sidebar's per-verb facets).
 *
 * The far end's **id** is kept, not just its name: the cell text needs the
 * name, but the context menu's Preview action needs to open the card, and
 * resolving a name back to an id is ambiguous the moment two cards share one.
 */
export function buildRelationIndex(
  relations: Relation[],
  relationType: RelationType,
  selectedType: string,
  side?: "out" | "in"
): Map<string, RelatedCardRef[]> {
  const index = new Map<string, RelatedCardRef[]>();
  const add = (myId: string, other: Relation["source"]) => {
    if (!other?.name || !other.id) return;
    const ref: RelatedCardRef = { id: other.id, name: other.name, type: other.type };
    const existing = index.get(myId);
    if (existing) existing.push(ref);
    else index.set(myId, [ref]);
  };

  for (const rel of relations) {
    if (side !== "in" && relationType.source_type_key === selectedType) {
      add(rel.source_id, rel.target);
    }
    if (side !== "out" && relationType.target_type_key === selectedType) {
      add(rel.target_id, rel.source);
    }
  }
  return index;
}
