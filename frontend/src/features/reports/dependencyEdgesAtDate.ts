/**
 * Which relations the Dependencies report draws at the travelled date.
 *
 * A relation is on the graph as of a date when both of its cards are (the
 * caller's `cardIds`, already filtered by the cards' own lifecycles) AND its
 * own dates say so: in effect there, it is drawn plainly; not started yet, it
 * follows the "preview planned" toggle; ended, the "keep retired" one — the
 * same two switches, read through the same rule, that keep a card the date has
 * not reached or has left behind (`relationAtDate`). A relation drawn although
 * it is not in effect carries its `relationState`, which the Layered Dependency
 * View draws as a dimmed line of its own.
 *
 * A relation without dates is always in effect and passes through as the same
 * object, so an undated landscape reads exactly as it did before relations had
 * dates.
 *
 * This decides the LINES only. Which CARDS a relation not in effect leaves in
 * the centred view — and in which state — is `dependencyViewpoint.ts`: a card
 * reached only through such relations is a planned / retired card from there,
 * hidden unless the same toggles keep it.
 */
import { parseDate } from "@/lib/lifecycleAtDate";
import type { GEdge } from "./layeredDependencyLayout";
import { relationAtDate, type TimelineVisibility } from "./timelineRange";

/** The legend entries the drawn relations call for: one per relation state
 *  (planned / ended) at least one line is drawn in. */
export function relationStateLegendKeys(
  edges: readonly { relationState?: string }[],
): ("plannedRelation" | "endedRelation")[] {
  const keys: ("plannedRelation" | "endedRelation")[] = [];
  if (edges.some((e) => e.relationState === "planned")) keys.push("plannedRelation");
  if (edges.some((e) => e.relationState === "ended")) keys.push("endedRelation");
  return keys;
}

export function edgesAtDate(
  edges: GEdge[],
  /** The cards on the graph at the date. */
  cardIds: ReadonlySet<string>,
  /** The date the graph is drawn as of (epoch ms). */
  dateMs: number,
  visibility: TimelineVisibility,
  /** The transition mark the slider stands on, when it stands on one. A
   *  relation ending inside it stays drawn — dimmed — for as long as the slider
   *  is there, as a card retiring at the mark does, so the change the mark
   *  announces is visible even with "keep retired" off. */
  span: { from: number; to: number } | null = null,
): GEdge[] {
  const out: GEdge[] = [];
  for (const e of edges) {
    if (!cardIds.has(e.source) || !cardIds.has(e.target)) continue;
    if (!e.lifecycle) {
      out.push(e);
      continue;
    }
    const { visible, state } = relationAtDate(e.lifecycle, dateMs, visibility);
    const eol = parseDate(e.lifecycle.endOfLife);
    // "ended" means the end date has arrived, so it is a date.
    const endsAtMark =
      span != null && state === "ended" && eol! >= span.from && eol! <= span.to;
    if (!visible && !endsAtMark) continue;
    out.push(state ? { ...e, relationState: state } : e);
  }
  return out;
}
