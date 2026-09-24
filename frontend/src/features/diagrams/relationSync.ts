/**
 * The `POST /relations` body for a relation drawn on the canvas.
 *
 * Both ways of pushing a drawn edge to the inventory — syncing that one edge
 * and **Sync all** — build it here, so they cannot drift. They did: Sync all
 * sent the type and the ends but not the attributes chosen in the relation
 * picker, so a link drawn as Provider showed its arrow on the canvas while the
 * saved relation had no flow direction at all (#1140).
 */
import type { ScannedPendingRel } from "./drawio-shapes";

export function relationCreatePayload(
  rel: Pick<ScannedPendingRel, "relationType" | "sourceCardId" | "targetCardId" | "reversed">,
  attributes?: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: rel.relationType,
    // A relation picked in its reverse direction runs target -> source even
    // though the edge points the other way.
    source_id: rel.reversed ? rel.targetCardId : rel.sourceCardId,
    target_id: rel.reversed ? rel.sourceCardId : rel.targetCardId,
  };
  if (attributes && Object.keys(attributes).length > 0) {
    payload.attributes = attributes;
  }
  return payload;
}
