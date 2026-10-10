/**
 * What the Layered Dependency View decides, apart from how it draws it.
 *
 * `LayeredDependencyView.tsx` mounts React Flow, which jsdom cannot run, so
 * whatever lived inline in its node, edge and canvas components could only be
 * reached through a full render — and much of it never was. The rules are
 * here, each testable on its own; the component keeps the rendering.
 */

import type { CSSProperties } from "react";
import { STATUS_COLORS, TIMELINE_COLORS } from "@/theme/tokens";
import type { ObstacleBounds } from "./ldvObstacles";
import type { LdvBackgroundStyle } from "./ldvDisplaySettings";
import type { TimelineChange } from "./timelineRange";

/* ------------------------------------------------------------------ */
/*  Card (node)                                                        */
/* ------------------------------------------------------------------ */

/** The grey a card falls back to when its type colour is not `#rrggbb`. */
export const FALLBACK_TYPE_COLOR = "#9e9e9e";

/** A type colour the tint maths can use: `#rrggbb`, else neutral grey. */
export function safeTypeColor(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : FALLBACK_TYPE_COLOR;
}

/**
 * The card's wash over its opaque paper: 12 % of the type colour in light
 * mode, 22 % in dark, and a faint 6 % on a proposed (not yet real) card.
 */
export function cardTint(color: string, isDark: boolean, proposed: boolean): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  const alpha = proposed ? 0.06 : isDark ? 0.22 : 0.12;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Lifecycle-phase → dot colour (hex, theme-independent). Mirrors LifecycleBadge. */
export const PHASE_DOT: Record<string, string> = {
  plan: "#9e9e9e",
  phaseIn: "#1976d2",
  active: "#2e7d32",
  phaseOut: "#ed6c02",
  endOfLife: "#d32f2f",
};

/** The lifecycle dot's colour, or null when the card shows no phase. */
export function phaseDotColor(phase: string | null): string | null {
  return phase ? (PHASE_DOT[phase] ?? FALLBACK_TYPE_COLOR) : null;
}

/** Time travel: the future accent for a card arriving or planned, red for one retired. */
export function changeAccent(changeState: TimelineChange | undefined): string | null {
  if (changeState === "arriving" || changeState === "planned") return TIMELINE_COLORS.future;
  if (changeState === "retired") return STATUS_COLORS.error;
  return null;
}

/**
 * The card's border. A changing card wears its change colour, solid when it
 * is in the viewed date's landscape and dashed when it is not; a proposed card
 * is dashed in its own accent; anything else is a thin solid accent line.
 */
export function cardBorder(
  changeColor: string | null,
  present: boolean,
  proposed: boolean,
  accent: string,
): string {
  if (changeColor) return `2px ${present ? "solid" : "dashed"} ${changeColor}`;
  if (proposed) return `2px dashed ${accent}`;
  return `1.5px solid ${accent}`;
}

/**
 * The time-travel badge on a card drawn despite not being in the viewed
 * date's landscape: planned cards take the top edge (unless a NEW badge holds
 * it), retired ones the bottom-right. An arriving card is simply there.
 */
export function changeBadge(
  changeState: TimelineChange | undefined,
  present: boolean,
  proposed: boolean,
): { onTop: boolean; labelKey: string } | null {
  if (present || !changeAccent(changeState)) return null;
  return {
    onTop: changeState === "planned" && !proposed,
    labelKey:
      changeState === "planned" ? "dependency.plannedBadge" : "dependency.retiredBadge",
  };
}

/** The lifecycle dot's inset from the card's top-right corner. */
export const DOT_INSET = 6;
/** The dot's box: 9 px plus its 1.5 px border on each side. */
export const DOT_BOX = 9 + 1.5 * 2;
/**
 * The type icon's right offset when it sits on the top edge immediately left
 * of the dot, clearing it by 3 px. Computed rather than written as a literal
 * so the two can never drift apart.
 */
export const TYPE_ICON_RIGHT_BESIDE_DOT = DOT_INSET + DOT_BOX + 3;

/**
 * Where the type icon goes: top-left on a card with no logo; when a logo takes
 * that corner, top-right — beside the lifecycle dot only when one is drawn,
 * since reserving room for a missing dot would leave the icon floating.
 */
export function typeIconPlacement(
  hasLogo: boolean,
  hasDot: boolean,
): { left: number } | { right: number } {
  if (!hasLogo) return { left: 6 };
  return { right: hasDot ? TYPE_ICON_RIGHT_BESIDE_DOT : DOT_INSET };
}

/** Lines the card's name may wrap to: two, or one when two extra fields are shown. */
export function nameLineClamp(extraLineCount: number): number {
  return extraLineCount > 1 ? 1 : 2;
}

/** A mirrored handle (`ts-N`, `bt-N`) shares its visibility with its base (`t-N`, `b-N`). */
export function handleBaseId(id: string): string {
  if (id.startsWith("ts-")) return "t-" + id.slice(3);
  if (id.startsWith("bt-")) return "b-" + id.slice(3);
  return id;
}

/** A handle's dot shows, in the card's colour, only where a line attaches. */
export function handleStyle(
  id: string,
  used: ReadonlySet<string>,
  color: string,
  extra?: CSSProperties,
): CSSProperties {
  const isUsed = used.has(id) || used.has(handleBaseId(id));
  return {
    background: isUsed ? color : "transparent",
    width: 5,
    height: 5,
    border: "none",
    opacity: isUsed ? 1 : 0,
    ...extra,
  };
}

/** Where a top/bottom handle sits along its edge; side handles keep their default. */
export function handleOffset(spec: {
  side: "top" | "bottom" | "left" | "right";
  frac: number;
}): { left: string } | undefined {
  return spec.side === "top" || spec.side === "bottom"
    ? { left: `${spec.frac * 100}%` }
    : undefined;
}

/** Pixels a pointer may travel between down and up and still count as a click. */
export const CLICK_SLOP = 5;

/** Whether a pointer moved far enough to be a drag rather than a click. */
export function movedBeyondClick(
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  return Math.abs(to.x - from.x) > CLICK_SLOP || Math.abs(to.y - from.y) > CLICK_SLOP;
}

/* ------------------------------------------------------------------ */
/*  Line (edge)                                                        */
/* ------------------------------------------------------------------ */

/**
 * Whether a line is lit: in highlight mode only by its hovered card; otherwise
 * also when the line itself is hovered.
 */
export function edgeIsActive(data: {
  highlightMode?: boolean;
  isHovered?: boolean;
  connectedToHovered?: boolean;
}): boolean {
  const connected = data.connectedToHovered ?? false;
  return data.highlightMode ? connected : data.isHovered === true || connected;
}

/**
 * A line's colours. A severed line (one end retired at the viewed date) keeps
 * the error colour even when lit, so a dependency going away never reads as a
 * healthy blue link.
 */
export function edgeColors(
  active: boolean,
  severed: boolean,
  isDark: boolean,
): { stroke: string; label: string; labelBorder: string; labelBackground: string } {
  const lit = isDark ? "#4fc3f7" : "#1976d2";
  const base = severed ? STATUS_COLORS.error : isDark ? "#aaa" : "#777";
  const hover = severed ? STATUS_COLORS.error : lit;
  return {
    stroke: active ? hover : base,
    label: active ? lit : isDark ? "#aaa" : "#666",
    labelBorder: active ? lit : isDark ? "#444" : "#ccc",
    labelBackground: isDark ? "#121212" : "#ffffff",
  };
}

/** The longest verb a line label shows before it is cut with an ellipsis. */
export const MAX_EDGE_LABEL_CHARS = 24;

export function truncateEdgeLabel(label: string): string {
  return label.length > MAX_EDGE_LABEL_CHARS
    ? label.slice(0, MAX_EDGE_LABEL_CHARS - 1) + "…"
    : label;
}

/** The label box's estimated width: the verb, the flow arrow, and the count pill. */
export function edgeLabelWidth(displayLabel: string, hasFlow: boolean, countText: string): number {
  return (
    displayLabel.length * 6.5 +
    16 +
    (hasFlow ? 17 : 0) +
    (countText ? countText.length * 7 + 14 : 0)
  );
}

/**
 * The stroke of an aggregate connector standing for `count` relations: one
 * heavy line growing with the count (log2, capped), never the dotted idle style.
 */
export function connectorWidth(count: number): number {
  return 1.6 + Math.min(2.8, Math.log2(Math.max(1, count)));
}

/** A line's stroke width: a connector's own, an ordinary line's 1.2 — each 0.8 heavier when lit. */
export function edgeStrokeWidth(count: number | undefined, active: boolean): number {
  if (count !== undefined) return connectorWidth(count) + (active ? 0.8 : 0);
  return active ? 2 : 1.2;
}

/** Whether a label box centred at (x, y) overlaps any obstacle, with `margin` of air. */
export function labelHitsObstacle(
  x: number,
  y: number,
  size: { width: number; height: number; margin: number },
  obstacles: readonly ObstacleBounds[],
): boolean {
  const x1 = x - size.width / 2 - size.margin;
  const x2 = x + size.width / 2 + size.margin;
  const y1 = y - size.height / 2 - size.margin;
  const y2 = y + size.height / 2 + size.margin;
  return obstacles.some((b) => x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1);
}

/**
 * Where a line's label goes: at `labelT` along the path when that spot is
 * clear; else the clear sample nearest to it among 19 between the ends,
 * skipping the first and last 8 % (which sit on the cards); else at `labelT`
 * anyway. `pointAt` maps a fraction of the path's length to a point.
 */
export function placeEdgeLabel(
  pointAt: (t: number) => { x: number; y: number },
  labelT: number,
  size: { width: number; height: number; margin: number },
  obstacles: readonly ObstacleBounds[],
): { x: number; y: number } {
  const preferred = pointAt(labelT);
  if (!labelHitsObstacle(preferred.x, preferred.y, size, obstacles)) return preferred;
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  const steps = 20;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (t < 0.08 || t > 0.92) continue;
    const pt = pointAt(t);
    if (labelHitsObstacle(pt.x, pt.y, size, obstacles)) continue;
    const dist = Math.abs(t - labelT);
    if (dist < bestDist) {
      bestDist = dist;
      best = pt;
    }
  }
  return best ?? preferred;
}

/* ------------------------------------------------------------------ */
/*  Canvas                                                             */
/* ------------------------------------------------------------------ */

/** How many cards of each type are on the view (before the type filter). */
export function countByType(nodes: readonly { type: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  return counts;
}

/** Whether the type filter is what emptied the view: a hidden type has cards on it. */
export function hidesCardsOnView(
  hiddenTypes: Iterable<string>,
  typeCounts: ReadonlyMap<string, number>,
): boolean {
  for (const key of hiddenTypes) if (typeCounts.has(key)) return true;
  return false;
}

const BACKGROUND_CYCLE: LdvBackgroundStyle[] = ["dots", "lines", "none"];

/** The background the toolbar button switches to next: dots → lines → none → dots. */
export function nextBackground(current: LdvBackgroundStyle): LdvBackgroundStyle {
  return BACKGROUND_CYCLE[(BACKGROUND_CYCLE.indexOf(current) + 1) % BACKGROUND_CYCLE.length];
}

/** An image export's file name: the centre card's name made file-safe, or "dependency". */
export function exportFileName(centerName: string | undefined, format: "png" | "svg"): string {
  return `${(centerName || "dependency").replace(/[^\w.-]+/g, "_")}.${format}`;
}

export type InteractionMode = "normal" | "highlight" | "expand" | "parents" | "children";

export type CardClickAction =
  | { kind: "toggleHighlight" }
  | { kind: "expand" }
  | { kind: "reveal"; direction: "parents" | "children" }
  | { kind: "recentre" }
  | { kind: "open" };

/**
 * What clicking a card does in the current mode. A mode whose handler the
 * host did not provide falls through to the plain click, as does a shift-click
 * without a re-centre handler.
 */
export function cardClickAction(
  mode: InteractionMode,
  shiftKey: boolean,
  handlers: { expand: boolean; reveal: boolean; recentre: boolean },
): CardClickAction {
  if (mode === "highlight") return { kind: "toggleHighlight" };
  if (mode === "expand" && handlers.expand) return { kind: "expand" };
  if ((mode === "parents" || mode === "children") && handlers.reveal) {
    return { kind: "reveal", direction: mode };
  }
  if (shiftKey && handlers.recentre) return { kind: "recentre" };
  return { kind: "open" };
}

/**
 * Whether a line touches the hovered card: at either end, or — on an
 * aggregate connector — through one of the relations it merged.
 */
export function touchesHovered(
  edge: { source: string; target: string; data?: { members?: { source: string; target: string }[] } },
  hoveredNode: string | null,
): boolean {
  if (!hoveredNode) return false;
  if (edge.source === hoveredNode || edge.target === hoveredNode) return true;
  return (edge.data?.members ?? []).some(
    (m) => m.source === hoveredNode || m.target === hoveredNode,
  );
}

/**
 * Lines in paint order: the hovered line last (on top); else, while a card is
 * hovered, its lines after all the others. Order is otherwise kept.
 */
export function paintOrder<E extends { id: string; data: { connectedToHovered?: boolean } }>(
  edges: E[],
  hoveredEdge: string | null,
  hoveredNode: string | null,
): E[] {
  if (hoveredEdge) {
    const hovered = edges.find((e) => e.id === hoveredEdge);
    return hovered ? [...edges.filter((e) => e.id !== hoveredEdge), hovered] : edges;
  }
  if (hoveredNode) {
    return [
      ...edges.filter((e) => !e.data.connectedToHovered),
      ...edges.filter((e) => e.data.connectedToHovered),
    ];
  }
  return edges;
}
