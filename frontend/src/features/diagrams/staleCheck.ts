import { api } from "@/api/client";
import type { Card, CardListResponse, Relation } from "@/types";
import type {
  RelationFlowDirection,
  ScannedSyncedEdge,
  ScannedSyncedFS,
} from "./drawio-shapes";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface StaleCardGone {
  cellId: string;
  cardId: string;
  name: string;
  typeColor: string;
}

/** One inventory change detected against the canvas. Every kind needs a
 *  manual action from the user — nothing is auto-applied. */
export type StaleItem =
  | {
      kind: "renamed";
      /** Card cell id (unique per canvas cell). */
      cellId: string;
      cardId: string;
      diagramName: string;
      inventoryName: string;
      typeColor: string;
    }
  | ({ kind: "cardDeleted" } & StaleCardGone)
  | ({ kind: "cardArchived" } & StaleCardGone)
  | {
      kind: "relationDeleted";
      /** Edge cell id. */
      cellId: string;
      relationId: string;
      relationLabel: string;
      sourceName: string;
      targetName: string;
    }
  | {
      kind: "relationFlowChanged";
      /** Edge cell id. */
      cellId: string;
      relationId: string;
      relationLabel: string;
      sourceName: string;
      targetName: string;
      /** The flow the inventory now carries (source → target axis of the
       *  relation), or undefined when the attribute was cleared. */
      newFlow?: RelationFlowDirection;
      /** True when the edge was drawn against the relation's direction
       *  (derived from the inventory relation's endpoints — the drawn edge's
       *  source is the relation's target). Needed to restyle the arrowhead. */
      incoming: boolean;
    };

export interface InventoryState {
  cardById: Map<string, Card>;
  relationById: Map<string, Relation>;
}

/* ------------------------------------------------------------------ */
/*  Fetch                                                              */
/* ------------------------------------------------------------------ */

/** Keep ids-per-request comfortably below URL-length limits; the
 *  relations endpoint caps card_ids at 500 server-side. */
const CHUNK_SIZE = 200;

/**
 * Fetch the current inventory state for the given canvas card ids in
 * batched calls. `GET /cards?ids=` deliberately returns archived cards
 * (so they can be flagged) and simply omits hard-deleted ones;
 * `GET /relations?card_ids=` returns every live relation touching any of
 * the ids — but excludes relations whose source or target is archived,
 * which is why the diff below skips edges with a flagged endpoint.
 */
export async function fetchInventoryState(
  cardIds: string[],
  signal?: AbortSignal,
): Promise<InventoryState> {
  const cardById = new Map<string, Card>();
  const relationById = new Map<string, Relation>();

  const unique = Array.from(new Set(cardIds.filter(Boolean)));
  for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
    const chunk = unique.slice(i, i + CHUNK_SIZE);
    const idsParam = encodeURIComponent(chunk.join(","));
    const [cardsRes, relations] = await Promise.all([
      api.get<CardListResponse>(`/cards?ids=${idsParam}`, { signal }),
      api.get<Relation[]>(`/relations?card_ids=${idsParam}`, { signal }),
    ]);
    for (const card of cardsRes.items) cardById.set(card.id, card);
    // A relation between two on-canvas cards comes back from the chunk of
    // each endpoint — the Map dedupes.
    for (const rel of relations) relationById.set(rel.id, rel);
  }

  return { cardById, relationById };
}

/* ------------------------------------------------------------------ */
/*  Diff                                                               */
/* ------------------------------------------------------------------ */

/**
 * Pure diff between what the canvas shows and what the inventory holds.
 *
 * Cards (top-level and expanded-group children alike): missing from the
 * inventory → deleted; `status === "ARCHIVED"` → archived; otherwise a
 * name mismatch → renamed. Synced relation edges: skipped when either
 * endpoint card is itself flagged (removing the card cell cascades the
 * edge, and the relations endpoint hides relations with archived
 * endpoints, which would otherwise read as false "deleted" positives);
 * a relation id absent from the inventory → deleted; a live relation
 * whose resolved `flowDirection` no longer matches the value stamped on
 * the edge → flow changed (the drawn arrowhead is stale).
 *
 * `resolveFlow` is the same gate Card Detail uses (`flowDirectionBadge`):
 * it returns a value only when the relation type declares the attribute
 * AND the relation carries one, so the canvas and the card can never
 * disagree about whether the attribute applies.
 */
export function diffStaleItems(
  cards: ScannedSyncedFS[],
  edges: ScannedSyncedEdge[],
  inventory: InventoryState,
  resolveColor: (typeKey: string) => string,
  resolveRelationLabel: (edge: ScannedSyncedEdge) => string,
  resolveFlow: (
    relationTypeKey: string,
    attributes: Record<string, unknown> | undefined,
  ) => RelationFlowDirection | undefined,
): StaleItem[] {
  const items: StaleItem[] = [];
  const flaggedCardIds = new Set<string>();
  const seenCellIds = new Set<string>();

  for (const cell of cards) {
    // The same cell can't legally appear twice, but guard anyway — the
    // panel keys rows by cellId.
    if (seenCellIds.has(cell.cellId)) continue;
    seenCellIds.add(cell.cellId);

    const card = inventory.cardById.get(cell.cardId);
    if (!card) {
      flaggedCardIds.add(cell.cardId);
      items.push({
        kind: "cardDeleted",
        cellId: cell.cellId,
        cardId: cell.cardId,
        name: cell.name,
        typeColor: resolveColor(cell.type),
      });
    } else if (card.status === "ARCHIVED") {
      flaggedCardIds.add(cell.cardId);
      items.push({
        kind: "cardArchived",
        cellId: cell.cellId,
        cardId: cell.cardId,
        name: cell.name,
        typeColor: resolveColor(cell.type),
      });
    } else if (card.name !== cell.name) {
      items.push({
        kind: "renamed",
        cellId: cell.cellId,
        cardId: cell.cardId,
        diagramName: cell.name,
        inventoryName: card.name,
        typeColor: resolveColor(cell.type),
      });
    }
  }

  for (const edge of edges) {
    if (!edge.sourceCardId || !edge.targetCardId) continue;
    if (
      flaggedCardIds.has(edge.sourceCardId) ||
      flaggedCardIds.has(edge.targetCardId)
    ) {
      continue;
    }
    const relation = inventory.relationById.get(edge.relationId);
    if (!relation) {
      items.push({
        kind: "relationDeleted",
        cellId: edge.edgeCellId,
        relationId: edge.relationId,
        relationLabel: resolveRelationLabel(edge),
        sourceName: edge.sourceName,
        targetName: edge.targetName,
      });
      continue;
    }
    const newFlow = resolveFlow(relation.type, relation.attributes);
    if (newFlow !== edge.flowDirection) {
      // The stamped flow rides the relation's source → target axis, so the
      // comparison is direct — but the restyle needs to know whether the
      // edge was DRAWN against the relation's direction. The relation's own
      // endpoints are the authority (expansion edges never stamp
      // `reversed`).
      items.push({
        kind: "relationFlowChanged",
        cellId: edge.edgeCellId,
        relationId: edge.relationId,
        relationLabel: resolveRelationLabel(edge),
        sourceName: edge.sourceName,
        targetName: edge.targetName,
        newFlow,
        incoming:
          edge.sourceCardId === relation.target_id &&
          edge.targetCardId === relation.source_id,
      });
    }
  }

  return items;
}
