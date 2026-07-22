/**
 * Pure merge engine for Transition Planning: replays a plan's ordered
 * change-operation list against the snapshotted baseline subgraph and returns
 * the merged before/after graph for the Layered Dependency View.
 *
 * Diff semantics (rendered by the LDV `changeState` decorations):
 *  - `remove_card`     → node + its edges marked `removed` (red ✕, dashed)
 *  - `add_card`        → node marked `added` (green NEW/+)
 *  - `replace_card`    → predecessor `removed`; successor `changed` (blue swap);
 *                        every surviving baseline edge of the predecessor is
 *                        duplicated onto the successor as a `changed` edge while
 *                        the original stays visible as `removed` — the swap is
 *                        readable from the diagram alone.
 *  - `add_relation`    → edge `added` (metamodel direction enforced)
 *  - `remove_relation` → matching edge marked `removed`
 *
 * Pure and side-effect free so it can be unit-tested and shared by the editor,
 * the read-only preview, and the commit dialog.
 */

import type { GEdge, GNode } from "@/features/reports/layeredDependencyLayout";
import type { PlanBaseline, PlanCardRef, PlanChangeOp, RelationType } from "@/types";

export interface PlanGraph {
  nodes: GNode[];
  edges: GEdge[];
}

export interface PlanOpError {
  /** Index of the offending op in the changes array. */
  index: number;
  code: "missingCard" | "missingEdge" | "duplicateCard";
  /** The id/ref the op points at, for display. */
  ref?: string;
}

function refIds(ref: PlanCardRef): { id: string; proposed: boolean } {
  if ("proposed" in ref) return { id: ref.proposed.tempId, proposed: true };
  return { id: ref.existingCardId, proposed: false };
}

/**
 * Replay `changes` over `baseline` and return the merged before/after graph.
 *
 * `cardLookup` supplies name/type for `existingCardId` refs that are not part
 * of the baseline snapshot (cards picked from the wider inventory).
 */
export function buildPlanGraph(
  baseline: PlanBaseline,
  changes: PlanChangeOp[],
  relationTypes: RelationType[],
  cardLookup: Map<string, { name: string; type: string }>,
): PlanGraph {
  const nodes: GNode[] = baseline.nodes.map((n) => ({ ...n }) as GNode);
  const edges: GEdge[] = baseline.edges.map((e) => ({ ...e }) as GEdge);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Exclusions are order-independent (same rule as the backend commit):
  // a remove_relation op anywhere in the list suppresses the matching
  // derived/inherited edge of a replace op.
  const removeRelOps = changes.filter(
    (c): c is Extract<PlanChangeOp, { op: "remove_relation" }> => c.op === "remove_relation",
  );
  const isRelationRemoved = (source: string, target: string, type: string) =>
    removeRelOps.some(
      (rr) => rr.relationType === type && rr.sourceId === source && rr.targetId === target,
    );

  const relTypeByKey = new Map(relationTypes.map((rt) => [rt.key, rt]));

  const addNode = (ref: PlanCardRef, changeState: "added" | "changed"): GNode | null => {
    const { id, proposed } = refIds(ref);
    const existing = nodeMap.get(id);
    if (existing) {
      // Re-adding a card already on the diagram just decorates it.
      existing.changeState = changeState;
      return existing;
    }
    let name: string;
    let type: string;
    if ("proposed" in ref) {
      name = ref.proposed.name;
      type = ref.proposed.cardTypeKey;
    } else {
      const known = cardLookup.get(id);
      if (!known) return null;
      name = known.name;
      type = known.type;
    }
    const node: GNode = { id, name, type, proposed, changeState };
    nodeMap.set(id, node);
    nodes.push(node);
    return node;
  };

  const markCardRemoved = (cardId: string) => {
    const node = nodeMap.get(cardId);
    if (!node) return;
    node.changeState = "removed";
    for (const e of edges) {
      if (e.source === cardId || e.target === cardId) e.changeState = "removed";
    }
  };

  for (const change of changes) {
    switch (change.op) {
      case "add_card": {
        addNode(change.card, "added");
        break;
      }

      case "remove_card": {
        markCardRemoved(change.cardId);
        break;
      }

      case "replace_card": {
        const successor = addNode(change.successor, "changed");
        // Derive inherited edges from the ORIGINAL baseline edge set before
        // the predecessor's edges get flagged removed.
        if (successor) {
          for (const be of baseline.edges) {
            if (be.source !== change.predecessorId && be.target !== change.predecessorId) {
              continue;
            }
            const newSource = be.source === change.predecessorId ? successor.id : be.source;
            const newTarget = be.target === change.predecessorId ? successor.id : be.target;
            if (
              isRelationRemoved(be.source, be.target, be.type) ||
              isRelationRemoved(newSource, newTarget, be.type)
            ) {
              continue;
            }
            // Skip inheritance onto a counterpart that is itself removed.
            const otherId = be.source === change.predecessorId ? be.target : be.source;
            if (nodeMap.get(otherId)?.changeState === "removed") continue;
            edges.push({
              ...be,
              source: newSource,
              target: newTarget,
              changeState: "changed",
            } as GEdge);
          }
        }
        markCardRemoved(change.predecessorId);
        break;
      }

      case "add_relation": {
        let sid = change.sourceId;
        let tid = change.targetId;
        if (!nodeMap.has(sid) || !nodeMap.has(tid)) break;
        const rt = relTypeByKey.get(change.relationType);
        if (rt) {
          // Enforce metamodel source→target direction (same rule as
          // AssessmentViewer.buildMergedGraph).
          const sType = nodeMap.get(sid)?.type;
          const tType = nodeMap.get(tid)?.type;
          if (sType === rt.target_type_key && tType === rt.source_type_key) {
            [sid, tid] = [tid, sid];
          }
        }
        edges.push({
          source: sid,
          target: tid,
          type: change.relationType,
          label: rt?.label || change.relationType,
          reverse_label: rt?.reverse_label,
          changeState: "added",
        } as GEdge);
        break;
      }

      case "remove_relation": {
        for (const e of edges) {
          if (
            e.type === change.relationType &&
            e.source === change.sourceId &&
            e.target === change.targetId
          ) {
            e.changeState = "removed";
          }
        }
        break;
      }
    }
  }

  return { nodes, edges };
}

/**
 * Validate every op against the baseline (and against cards introduced by
 * earlier ops). Used by the editor after a baseline refresh to surface ops
 * whose targets no longer exist.
 */
export function validatePlanOps(baseline: PlanBaseline, changes: PlanChangeOp[]): PlanOpError[] {
  const errors: PlanOpError[] = [];
  const knownIds = new Set(baseline.nodes.map((n) => n.id));
  const edgeKeys = new Set(baseline.edges.map((e) => `${e.type}|${e.source}|${e.target}`));

  changes.forEach((change, index) => {
    switch (change.op) {
      case "add_card": {
        const { id } = refIds(change.card);
        knownIds.add(id);
        break;
      }
      case "remove_card": {
        if (!knownIds.has(change.cardId)) {
          errors.push({ index, code: "missingCard", ref: change.cardId });
        }
        break;
      }
      case "replace_card": {
        if (!knownIds.has(change.predecessorId)) {
          errors.push({ index, code: "missingCard", ref: change.predecessorId });
        }
        const { id } = refIds(change.successor);
        knownIds.add(id);
        // Derived edges become addressable by remove_relation ops.
        for (const be of baseline.edges) {
          if (be.source === change.predecessorId) {
            edgeKeys.add(`${be.type}|${id}|${be.target}`);
          } else if (be.target === change.predecessorId) {
            edgeKeys.add(`${be.type}|${be.source}|${id}`);
          }
        }
        break;
      }
      case "add_relation": {
        if (!knownIds.has(change.sourceId)) {
          errors.push({ index, code: "missingCard", ref: change.sourceId });
        } else if (!knownIds.has(change.targetId)) {
          errors.push({ index, code: "missingCard", ref: change.targetId });
        } else {
          // Added relations become addressable by later remove_relation ops
          // (both directions — the merge may flip to metamodel direction).
          edgeKeys.add(`${change.relationType}|${change.sourceId}|${change.targetId}`);
          edgeKeys.add(`${change.relationType}|${change.targetId}|${change.sourceId}`);
        }
        break;
      }
      case "remove_relation": {
        const key = `${change.relationType}|${change.sourceId}|${change.targetId}`;
        if (!edgeKeys.has(key)) {
          errors.push({ index, code: "missingEdge", ref: key });
        }
        break;
      }
    }
  });

  return errors;
}
