/**
 * What an expanded card group remembers between one expansion and the next.
 *
 * Collapsing a group removes its children from the canvas, so anything the user
 * did to them while they were drawn is gone unless it is written down first:
 *
 *  - the cards and relations they removed — re-expanding must not put them back;
 *  - where they moved each child and how they styled it — re-expanding puts each
 *    one back the way they left it instead of re-running the auto-layout.
 *
 * The memory lives in a React ref, keyed by the expanded card's cell id, so it
 * does not survive a reload. Layouts are keyed by CARD id rather than stored on
 * the children themselves: the expand menu draws a different per-relation-type
 * subset each time, so a child drawn now may not be in the next expansion, and
 * one that was arranged two expansions ago may come back.
 */

import type { ChildLayout, ExpandChildData } from "./drawio-shapes";
import { pruneDeletedRelations } from "./expandChildren";

export interface GroupMemory {
  /** The children the most recent expansion drew. */
  drawn: ExpandChildData[];
  /** Cards the user removed from the group while it was expanded. */
  deletedCardIds: Set<string>;
  /** Relations the user removed while the group was expanded — tracked by
   *  relation id, since a child can carry several edges and keep some. */
  deletedRelationIds: Set<string>;
  /** Each child's last arrangement, by card id. */
  layouts: Map<string, ChildLayout>;
}

/** What is still on the canvas when the group is collapsed. */
export interface LiveGroup {
  /** Children still connected to the expanded card. */
  cardIds: Set<string>;
  /** Relation ids still drawn between the expanded card and its children. */
  relationIds: Set<string>;
  /** Each surviving child's arrangement, by card id. */
  layouts: Map<string, ChildLayout>;
}

/** Record what an expansion drew, keeping what earlier collapses learned. */
export function recordExpansion(
  prev: GroupMemory | undefined,
  drawn: ExpandChildData[],
): GroupMemory {
  return {
    drawn,
    deletedCardIds: new Set(prev?.deletedCardIds),
    deletedRelationIds: new Set(prev?.deletedRelationIds),
    layouts: new Map(prev?.layouts),
  };
}

/**
 * Diff what the last expansion drew against what is still on the canvas, just
 * before the group is collapsed. A drawn card that is no longer connected was
 * removed; so was a drawn relation (primary or extra) whose edge is gone. The
 * live arrangement replaces any earlier one for the same card.
 *
 * With nothing drawn — a group restored expanded from a saved diagram, whose
 * children this session never drew — it records the layouts and nothing else.
 */
export function recordCollapse(prev: GroupMemory | undefined, live: LiveGroup): GroupMemory {
  const drawn = prev?.drawn ?? [];
  const deletedCardIds = new Set(prev?.deletedCardIds);
  const deletedRelationIds = new Set(prev?.deletedRelationIds);

  for (const child of drawn) {
    if (!live.cardIds.has(child.id)) deletedCardIds.add(child.id);
    for (const rel of [{ relationId: child.relationId }, ...(child.extraRelations ?? [])]) {
      if (rel.relationId && !live.relationIds.has(rel.relationId)) {
        deletedRelationIds.add(rel.relationId);
      }
    }
  }

  return {
    drawn,
    deletedCardIds,
    deletedRelationIds,
    layouts: new Map([...(prev?.layouts ?? []), ...live.layouts]),
  };
}

/**
 * The children an expansion should actually draw: without the cards and
 * relations the user removed, and with each one's remembered arrangement.
 * Order is preserved; without a memory the input comes back as is.
 */
export function applyMemory(
  children: ExpandChildData[],
  memory: GroupMemory | undefined,
): ExpandChildData[] {
  if (!memory) return children;
  const kept = children.filter((c) => !memory.deletedCardIds.has(c.id));
  return pruneDeletedRelations(kept, memory.deletedRelationIds).map((c) => {
    const layout = memory.layouts.get(c.id);
    return layout ? { ...c, layout } : c;
  });
}

/** Has the user removed anything from this group that an expansion now hides? */
export function hasDeletions(memory: GroupMemory | undefined): boolean {
  return !!memory && (memory.deletedCardIds.size > 0 || memory.deletedRelationIds.size > 0);
}
