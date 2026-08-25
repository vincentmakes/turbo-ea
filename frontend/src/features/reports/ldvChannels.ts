/**
 * Channel routing for the Layered Dependency View — the piece of DrawIO's
 * hierarchical layout that keeps long edges out of the way of nodes in
 * intermediate ranks.
 *
 * An edge whose endpoints have whole rows of cards between them picks ONE
 * corridor — an x that is free through every row it must cross (free space
 * is unbounded on both sides, so the route around a lane's content always
 * exists) — and connects each end to that corridor as cheaply as possible:
 * straight when the corridor lines up with the handle, through the card's
 * SIDE (one bend) when the corridor runs directly beside the card, or with
 * a jog in the adjacent gap (two bends) otherwise. A single corridor is what
 * prevents the staircase paths a per-row greedy dodge produces.
 *
 * Pure module: no React, no React Flow — unit-testable geometry only.
 */

export interface ChannelXY {
  x: number;
  y: number;
}

/** One horizontal row of cards: its y-extent and merged card x-intervals. */
export interface RowBand {
  y1: number;
  y2: number;
  intervals: { x1: number; x2: number }[];
}

/** Cards must be cleared by this much when a corridor passes beside them —
 *  deliberately larger than SIDE_STUB so a corridor placed at a card's
 *  clearance boundary still qualifies for a side connection. */
const CARD_CLEARANCE = 12;
/** Two corridors in the same band keep at least this separation. */
const CORRIDOR_SEP = 12;
/** Breathing room between a jog and the row bands above/below it. */
const BAND_INSET = 8;
/** Minimum stub out of a top/bottom handle before the first jog. */
const CHANNEL_STUB = 12;
/** Minimum horizontal stub out of a side handle. */
const SIDE_STUB = 10;

function mergeIntervals(intervals: { x1: number; x2: number }[]): { x1: number; x2: number }[] {
  const sorted = [...intervals].sort((a, b) => a.x1 - b.x1 || a.x2 - b.x2);
  const merged: { x1: number; x2: number }[] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.x1 <= last.x2) last.x2 = Math.max(last.x2, iv.x2);
    else merged.push({ ...iv });
  }
  return merged;
}

/**
 * Bucket card bounds into row bands per lane, returned as one flat list
 * sorted by y (lanes are stacked, so bands never interleave across lanes).
 */
export function buildRowBands(
  cardBounds: { x1: number; y1: number; x2: number; y2: number }[],
): RowBand[] {
  const byRow = new Map<number, { y1: number; y2: number; intervals: { x1: number; x2: number }[] }>();
  for (const b of cardBounds) {
    const key = Math.round(b.y1);
    let row = byRow.get(key);
    if (!row) {
      row = { y1: b.y1, y2: b.y2, intervals: [] };
      byRow.set(key, row);
    }
    row.y1 = Math.min(row.y1, b.y1);
    row.y2 = Math.max(row.y2, b.y2);
    row.intervals.push({ x1: b.x1, x2: b.x2 });
  }
  return [...byRow.values()]
    .map((r) => ({ y1: r.y1, y2: r.y2, intervals: mergeIntervals(r.intervals) }))
    .sort((a, b) => a.y1 - b.y1);
}

/** Blocked x-intervals of a band: cards inflated by clearance, plus the
 *  corridors already reserved in the SAME band inflated by their separation. */
export function blockedIntervals(
  bands: RowBand[],
  bandIdx: number,
  reservations: Map<number, number[]>,
): { x1: number; x2: number }[] {
  const blocked = bands[bandIdx].intervals.map((iv) => ({
    x1: iv.x1 - CARD_CLEARANCE,
    x2: iv.x2 + CARD_CLEARANCE,
  }));
  for (const r of reservations.get(bandIdx) ?? []) {
    blocked.push({ x1: r - CORRIDOR_SEP, x2: r + CORRIDOR_SEP });
  }
  return mergeIntervals(blocked);
}

function isBlockedX(blocked: { x1: number; x2: number }[], x: number): boolean {
  return blocked.some((iv) => x > iv.x1 && x < iv.x2);
}

/** Free x nearest `ideal` in the complement of `blocked` (unbounded on both
 *  sides, so a solution always exists). Ties resolve to the smaller x. */
function nearestFreeInBlocked(blocked: { x1: number; x2: number }[], ideal: number): number {
  if (!isBlockedX(blocked, ideal)) return ideal;
  let best = ideal;
  let bestDist = Infinity;
  for (const iv of blocked) {
    for (const cand of [iv.x1, iv.x2]) {
      if (isBlockedX(blocked, cand)) continue;
      const dist = Math.abs(cand - ideal);
      if (dist < bestDist || (dist === bestDist && cand < best)) {
        bestDist = dist;
        best = cand;
      }
    }
  }
  return best;
}

export interface ChannelJog {
  /** Index into the waypoint list of the jog's first corner (second corner
   *  is wpIndex + 1). */
  wpIndex: number;
  /** Feasible y range for the jog's horizontal run. */
  lo: number;
  hi: number;
}

export interface ChannelCard {
  x1: number;
  x2: number;
  /** Vertical center of the card — where a side connection attaches. */
  cy: number;
}

export type ChannelEnd = "straight" | "side-left" | "side-right" | "jog";

export interface ChannelPlan {
  /** "none": the straight column is clear and identical at both ends — the
   *  edge needs no waypoints at all. */
  kind: "none" | "route";
  corridor: number;
  exit: ChannelEnd;
  entry: ChannelEnd;
  waypoints: ChannelXY[];
  jogs: ChannelJog[];
}

export interface ChannelInput {
  /** Handle points as currently assigned (top/bottom slots). */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  bands: RowBand[];
  /** Bands strictly between the handles, ordered along the walk direction. */
  betweenIdxs: number[];
  /** Band index of the source's / target's own row (-1 when not found). */
  srcRowIdx: number;
  tgtRowIdx: number;
  srcCard: ChannelCard;
  tgtCard: ChannelCard;
  /** Whether each card side is still available for a side connection
   *  (at most one per card side, claimed by the caller). */
  sides: { exitLeft: boolean; exitRight: boolean; entryLeft: boolean; entryRight: boolean };
  reservations: Map<number, number[]>;
}

interface EndPlan {
  bends: number;
  kind: ChannelEnd;
}

/**
 * Whether `x` sits in the free region DIRECTLY adjacent to the card in its
 * row band — nothing (card, clearance, reservation) between the card's edge
 * and `x`. That is the condition for a clean side connection: the horizontal
 * from the card edge to the corridor crosses nothing.
 */
function adjacentClear(
  bands: RowBand[],
  rowIdx: number,
  reservations: Map<number, number[]>,
  card: ChannelCard,
  x: number,
  side: "left" | "right",
): boolean {
  if (rowIdx < 0) return true; // no known row → no siblings to hit
  const blocked = blockedIntervals(bands, rowIdx, reservations);
  const own = blocked.find((iv) => iv.x1 <= card.x1 && iv.x2 >= card.x2);
  if (!own) return !isBlockedX(blocked, x);
  if (side === "left") {
    const prev = blocked.filter((iv) => iv.x2 <= own.x1).pop();
    return x < own.x1 && (!prev || x > prev.x2);
  }
  const next = blocked.find((iv) => iv.x1 >= own.x2);
  return x > own.x2 && (!next || x < next.x1);
}

/**
 * Plan the route for one channel edge. Deterministic; reserves the chosen
 * corridor in every band it crosses (including the source/target rows when
 * a side connection is used).
 */
export function buildChannel(input: ChannelInput): ChannelPlan {
  const { sx, sy, tx, ty, bands, betweenIdxs, srcRowIdx, tgtRowIdx, srcCard, tgtCard, sides, reservations } = input;
  const down = ty > sy;

  // Union of blocked space over every crossed band — a corridor must be
  // free in all of them (plus the end rows when a side connection is used).
  const blockedUnion = mergeIntervals(
    betweenIdxs.flatMap((b) => blockedIntervals(bands, b, reservations)),
  );
  const freeAll = (x: number) => !isBlockedX(blockedUnion, x);

  const exitPlanFor = (c: number): EndPlan => {
    if (Math.abs(c - sx) < 0.5) return { bends: 0, kind: "straight" };
    const side: "left" | "right" | null =
      c <= srcCard.x1 - SIDE_STUB ? "left" : c >= srcCard.x2 + SIDE_STUB ? "right" : null;
    if (
      side &&
      (side === "left" ? sides.exitLeft : sides.exitRight) &&
      adjacentClear(bands, srcRowIdx, reservations, srcCard, c, side)
    ) {
      return { bends: 1, kind: side === "left" ? "side-left" : "side-right" };
    }
    return { bends: 2, kind: "jog" };
  };
  const entryPlanFor = (c: number): EndPlan => {
    if (Math.abs(c - tx) < 0.5) return { bends: 0, kind: "straight" };
    const side: "left" | "right" | null =
      c <= tgtCard.x1 - SIDE_STUB ? "left" : c >= tgtCard.x2 + SIDE_STUB ? "right" : null;
    if (
      side &&
      (side === "left" ? sides.entryLeft : sides.entryRight) &&
      adjacentClear(bands, tgtRowIdx, reservations, tgtCard, c, side)
    ) {
      return { bends: 1, kind: side === "left" ? "side-left" : "side-right" };
    }
    return { bends: 2, kind: "jog" };
  };

  // Candidate corridors in preference order: straight into the target,
  // straight out of the source, then the nearest x free through every band.
  const candidates: number[] = [];
  if (freeAll(tx)) candidates.push(tx);
  if (freeAll(sx)) candidates.push(sx);
  candidates.push(nearestFreeInBlocked(blockedUnion, tx));

  let best: { c: number; exit: EndPlan; entry: EndPlan; score: [number, number] } | null = null;
  for (const c of candidates) {
    const exit = exitPlanFor(c);
    const entry = entryPlanFor(c);
    const score: [number, number] = [exit.bends + entry.bends, Math.abs(c - sx) + Math.abs(c - tx)];
    if (
      !best ||
      score[0] < best.score[0] ||
      (score[0] === best.score[0] && score[1] < best.score[1])
    ) {
      best = { c, exit, entry, score };
    }
  }
  const { c, exit, entry } = best!;

  if (exit.kind === "straight" && entry.kind === "straight") {
    // Fully straight column — no waypoints needed at all.
    for (const b of betweenIdxs) reserve(reservations, b, c);
    return { kind: "none", corridor: c, exit: "straight", entry: "straight", waypoints: [], jogs: [] };
  }

  // Free gaps adjacent to the first / last crossed band, along the walk.
  const first = bands[betweenIdxs[0]];
  const last = bands[betweenIdxs[betweenIdxs.length - 1]];
  const firstGap = down
    ? { lo: sy + CHANNEL_STUB, hi: first.y1 - BAND_INSET }
    : { lo: first.y2 + BAND_INSET, hi: sy - CHANNEL_STUB };
  const lastGap = down
    ? { lo: last.y2 + BAND_INSET, hi: ty - CHANNEL_STUB }
    : { lo: ty + CHANNEL_STUB, hi: last.y1 - BAND_INSET };
  const norm = (g: { lo: number; hi: number }) => ({
    lo: Math.min(g.lo, g.hi),
    hi: Math.max(g.lo, g.hi),
  });

  const waypoints: ChannelXY[] = [];
  const jogs: ChannelJog[] = [];

  if (exit.kind === "jog") {
    const g = norm(firstGap);
    jogs.push({ wpIndex: waypoints.length, lo: g.lo, hi: g.hi });
    const y = (g.lo + g.hi) / 2;
    waypoints.push({ x: sx, y }, { x: c, y });
  } else if (exit.kind !== "straight") {
    // Side exit: the horizontal leaves the card edge at its center y.
    waypoints.push({ x: c, y: srcCard.cy });
  }

  if (entry.kind === "jog") {
    const g = norm(lastGap);
    jogs.push({ wpIndex: waypoints.length, lo: g.lo, hi: g.hi });
    const y = (g.lo + g.hi) / 2;
    waypoints.push({ x: c, y }, { x: tx, y });
  } else if (entry.kind !== "straight") {
    waypoints.push({ x: c, y: tgtCard.cy });
  }

  for (const b of betweenIdxs) reserve(reservations, b, c);
  if (exit.kind === "side-left" || exit.kind === "side-right") {
    if (srcRowIdx >= 0) reserve(reservations, srcRowIdx, c);
  }
  if (entry.kind === "side-left" || entry.kind === "side-right") {
    if (tgtRowIdx >= 0) reserve(reservations, tgtRowIdx, c);
  }

  return { kind: "route", corridor: c, exit: exit.kind, entry: entry.kind, waypoints, jogs };
}

function reserve(reservations: Map<number, number[]>, bandIdx: number, x: number): void {
  let list = reservations.get(bandIdx);
  if (!list) {
    list = [];
    reservations.set(bandIdx, list);
  }
  list.push(x);
}

/**
 * Orthogonal polyline → SVG path with rounded corners (quarter-turn
 * quadratic beziers). Consecutive duplicates and collinear middles collapse;
 * the corner radius clamps to half of each adjacent segment.
 */
export function buildRoundedOrthPath(points: ChannelXY[], radius: number): string {
  const pts: ChannelXY[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    pts.push(p);
    while (pts.length >= 3) {
      const a = pts[pts.length - 3];
      const b = pts[pts.length - 2];
      const c = pts[pts.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
        (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
      if (collinear) pts.splice(pts.length - 2, 1);
      else break;
    }
  }
  if (pts.length < 2) return "";
  const seg = (a: ChannelXY, b: ChannelXY) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const r = Math.min(radius, seg(a, b) / 2, seg(b, c) / 2);
    const inX = Math.sign(b.x - a.x);
    const inY = Math.sign(b.y - a.y);
    const outX = Math.sign(c.x - b.x);
    const outY = Math.sign(c.y - b.y);
    const p1 = { x: b.x - inX * r, y: b.y - inY * r };
    const p2 = { x: b.x + outX * r, y: b.y + outY * r };
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const end = pts[pts.length - 1];
  d += ` L ${end.x} ${end.y}`;
  return d;
}
