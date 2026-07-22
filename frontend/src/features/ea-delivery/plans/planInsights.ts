/**
 * Pure insight helpers for Transition Planning — the "consequences" engine.
 * All functions are side-effect free and computed from the merged before/after
 * graph (`buildPlanGraph`) so they can be unit-tested and shared by the editor,
 * the preview, and (mirrored in Python) the committed ADR.
 *
 * Node changeState semantics (from planGraph):
 *  - undefined  → retained (untouched baseline card)
 *  - "removed"  → decommissioned (was in the baseline)
 *  - "added"    → new card (not in the baseline)
 *  - "changed"  → a replacement's successor (new, not in the baseline)
 *
 * BEFORE set  = retained + removed.   AFTER set = retained + added + changed.
 */

import type { GNode } from "@/features/reports/layeredDependencyLayout";
import type { CardType, PlanChangeOp } from "@/types";
import type { PlanGraph } from "./planGraph";

/* ---- Gap analysis (TOGAF Added / Removed / Changed / Retained) ---- */

export interface GapBuckets {
  added: GNode[];
  removed: GNode[];
  changed: GNode[];
  retained: GNode[];
  addedEdges: number;
  removedEdges: number;
  changedEdges: number;
}

export function computeGapBuckets(graph: PlanGraph): GapBuckets {
  const added: GNode[] = [];
  const removed: GNode[] = [];
  const changed: GNode[] = [];
  const retained: GNode[] = [];
  for (const n of graph.nodes) {
    switch (n.changeState) {
      case "added":
        added.push(n);
        break;
      case "removed":
        removed.push(n);
        break;
      case "changed":
        changed.push(n);
        break;
      default:
        retained.push(n);
    }
  }
  let addedEdges = 0;
  let removedEdges = 0;
  let changedEdges = 0;
  for (const e of graph.edges) {
    if (e.changeState === "added") addedEdges++;
    else if (e.changeState === "removed") removedEdges++;
    else if (e.changeState === "changed") changedEdges++;
  }
  return { added, removed, changed, retained, addedEdges, removedEdges, changedEdges };
}

/* ---- Cost delta ---- */

/** Map card-type key → its cost-field keys (fields declared `type: "cost"`). */
export function costFieldKeysByType(types: CardType[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of types) {
    const keys: string[] = [];
    for (const section of t.fields_schema ?? []) {
      for (const f of section.fields ?? []) {
        if (f.type === "cost") keys.push(f.key);
      }
    }
    map.set(t.key, keys);
  }
  return map;
}

export interface CostDelta {
  before: number;
  after: number;
  delta: number;
  /** True when some card's cost could not be determined (an added existing card
   *  with no attributes, or a proposed card with no estimate) — the totals are
   *  then a lower bound, shown as "estimated". */
  approximate: boolean;
}

function estimatedByTempId(changes: PlanChangeOp[]): Map<string, number | undefined> {
  const map = new Map<string, number | undefined>();
  for (const c of changes) {
    const ref = c.op === "add_card" ? c.card : c.op === "replace_card" ? c.successor : null;
    if (ref && "proposed" in ref) map.set(ref.proposed.tempId, ref.proposed.estimatedCost);
  }
  return map;
}

function nodeCost(
  node: GNode,
  costKeys: Map<string, string[]>,
  estimates: Map<string, number | undefined>,
): { cost: number; known: boolean } {
  if (node.id.startsWith("tmp:")) {
    const est = estimates.get(node.id);
    return { cost: est ?? 0, known: est !== undefined };
  }
  const keys = costKeys.get(node.type) ?? [];
  if (keys.length === 0) return { cost: 0, known: true }; // type has no cost field
  const attrs = (node.attributes ?? {}) as Record<string, unknown>;
  if (!node.attributes) return { cost: 0, known: false }; // real card, attributes absent
  let sum = 0;
  for (const k of keys) {
    const v = attrs[k];
    if (typeof v === "number") sum += v;
  }
  return { cost: sum, known: true };
}

export function computeCostDelta(
  graph: PlanGraph,
  types: CardType[],
  changes: PlanChangeOp[],
): CostDelta {
  const costKeys = costFieldKeysByType(types);
  const estimates = estimatedByTempId(changes);
  let before = 0;
  let after = 0;
  let approximate = false;
  for (const n of graph.nodes) {
    const { cost, known } = nodeCost(n, costKeys, estimates);
    if (!known) approximate = true;
    const inBefore = n.changeState === undefined || n.changeState === "removed";
    const inAfter = n.changeState === undefined || n.changeState === "added" || n.changeState === "changed";
    if (inBefore) before += cost;
    if (inAfter) after += cost;
  }
  return { before, after, delta: after - before, approximate };
}

/* ---- Capability coverage ---- */

export interface CoverageGap {
  capabilityId: string;
  capabilityName: string;
  /** How many applications supported it in the baseline. */
  baselineApps: number;
}

/**
 * Flag every BusinessCapability that had supporting applications in the baseline
 * but loses them all in the target state — a genuine architecture gap the change
 * would open. Considers Application↔BusinessCapability edges (typically
 * `relAppToBC`).
 */
export function computeCapabilityCoverage(graph: PlanGraph): CoverageGap[] {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const gaps: CoverageGap[] = [];

  for (const cap of graph.nodes) {
    if (cap.type !== "BusinessCapability") continue;
    const baselineApps = new Set<string>();
    const targetApps = new Set<string>();
    for (const e of graph.edges) {
      let appId: string | null = null;
      if (e.source === cap.id) appId = e.target;
      else if (e.target === cap.id) appId = e.source;
      if (!appId) continue;
      const app = nodeById.get(appId);
      if (!app || app.type !== "Application") continue;
      // Baseline = apps that existed before (not freshly added).
      if (app.changeState !== "added" && e.changeState !== "added") baselineApps.add(appId);
      // Target = surviving support (neither the app nor the edge removed).
      if (app.changeState !== "removed" && e.changeState !== "removed") targetApps.add(appId);
    }
    if (baselineApps.size > 0 && targetApps.size === 0) {
      gaps.push({ capabilityId: cap.id, capabilityName: cap.name, baselineApps: baselineApps.size });
    }
  }
  return gaps;
}

/* ---- Risk (pure summariser; the fetch lives in planRisk.ts) ---- */

export interface RiskSummary {
  total: number;
  high: number; // residual (or initial) level high/critical
}

/** Dedupe risks by id across per-card lists and count high/critical by residual
 *  level (falling back to initial level when residual is unset). */
export function summarizeRisks(
  riskLists: { id: string; residual_level: string | null; initial_level: string }[][],
): RiskSummary {
  const byId = new Map<string, { residual_level: string | null; initial_level: string }>();
  for (const list of riskLists) {
    for (const r of list) byId.set(r.id, r);
  }
  let high = 0;
  for (const r of byId.values()) {
    const level = r.residual_level ?? r.initial_level;
    if (level === "high" || level === "critical") high++;
  }
  return { total: byId.size, high };
}

/** Real (non-proposed) card ids touched by the plan — the set worth checking for
 *  risk. Covers removed/replaced cards and the endpoints of relation ops. */
export function affectedRealCardIds(changes: PlanChangeOp[]): string[] {
  const ids = new Set<string>();
  const addReal = (id: string) => {
    if (id && !id.startsWith("tmp:")) ids.add(id);
  };
  for (const c of changes) {
    switch (c.op) {
      case "remove_card":
        addReal(c.cardId);
        break;
      case "replace_card":
        addReal(c.predecessorId);
        if ("existingCardId" in c.successor) addReal(c.successor.existingCardId);
        break;
      case "add_card":
        if ("existingCardId" in c.card) addReal(c.card.existingCardId);
        break;
      case "add_relation":
      case "remove_relation":
        addReal(c.sourceId);
        addReal(c.targetId);
        break;
    }
  }
  return [...ids];
}
