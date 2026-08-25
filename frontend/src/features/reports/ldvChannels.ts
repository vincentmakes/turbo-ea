/**
 * Channel routing for lane-skipping edges in the Layered Dependency View —
 * the piece of DrawIO's hierarchical layout that keeps long edges out of the
 * way of nodes in intermediate ranks.
 *
 * A vertical edge that must cross rows of cards between its endpoints walks
 * those "row bands" carrying its current x: while the column is free it goes
 * straight; when a band blocks it, it jogs — in the card-free gap before the
 * band — to the free x nearest the target handle, and reserves that corridor
 * so other channel edges keep their distance. The result is an orthogonal
 * polyline whose verticals never cut through a card, with a jog only where a
 * dodge was actually forced.
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

/** Cards must be cleared by this much when a corridor passes beside them. */
const CARD_CLEARANCE = 7;
/** Two corridors in the same band keep at least this separation. */
const CORRIDOR_SEP = 14;
/** Breathing room between a jog and the row bands above/below it. */
const BAND_INSET = 8;
/** Minimum stub out of a handle before the first jog may happen. */
const CHANNEL_STUB = 12;

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

/** Blocked x-intervals of a band: cards inflated by clearance, reserved
 *  corridors (this band and its neighbours) inflated by corridor separation. */
function blockedIntervals(
  bands: RowBand[],
  bandIdx: number,
  reservations: Map<number, number[]>,
): { x1: number; x2: number }[] {
  const blocked = bands[bandIdx].intervals.map((iv) => ({
    x1: iv.x1 - CARD_CLEARANCE,
    x2: iv.x2 + CARD_CLEARANCE,
  }));
  for (const nb of [bandIdx - 1, bandIdx, bandIdx + 1]) {
    for (const r of reservations.get(nb) ?? []) {
      blocked.push({ x1: r - CORRIDOR_SEP, x2: r + CORRIDOR_SEP });
    }
  }
  return mergeIntervals(blocked);
}

function isBlockedX(blocked: { x1: number; x2: number }[], x: number): boolean {
  return blocked.some((iv) => x > iv.x1 && x < iv.x2);
}

/**
 * The free x nearest `ideal` in a band (free space is the complement of the
 * blocked intervals and is unbounded on both sides, so a corridor always
 * exists — worst case it runs just outside the lane's content). Deterministic:
 * ties resolve to the smaller x.
 */
export function nearestFreeX(
  bands: RowBand[],
  bandIdx: number,
  ideal: number,
  reservations: Map<number, number[]>,
): number {
  const blocked = blockedIntervals(bands, bandIdx, reservations);
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
  /** Index into the returned waypoint list of the jog's first corner (the
   *  second corner is wpIndex + 1). */
  wpIndex: number;
  /** Feasible y range for the jog's horizontal run. */
  lo: number;
  hi: number;
}

export interface ChannelResult {
  waypoints: ChannelXY[];
  jogs: ChannelJog[];
  /** Jogs forced by a blocked band (the final approach to the target-handle
   *  x is not counted). Zero means the straight column was clear and the
   *  edge should keep its ordinary smoothstep rendering. */
  forcedJogs: number;
}

/**
 * Walk the row bands between the two handle points, dodging blocked bands.
 * `bandIdxs` are indexes into `bands` for the rows strictly between the
 * handles, ordered along the walk direction (top→bottom for a downward edge,
 * bottom→top for an upward one). Reserves every corridor it uses.
 */
export function buildChannel(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  bands: RowBand[],
  bandIdxs: number[],
  reservations: Map<number, number[]>,
): ChannelResult {
  const down = ty > sy;
  const waypoints: ChannelXY[] = [];
  const jogs: ChannelJog[] = [];
  let forcedJogs = 0;
  let x = sx;

  const reserve = (bandIdx: number, atX: number) => {
    let list = reservations.get(bandIdx);
    if (!list) {
      list = [];
      reservations.set(bandIdx, list);
    }
    list.push(atX);
  };

  // Free y-gap crossed just before band k of the walk (between the previous
  // band — or the source handle — and this band), as [lo, hi] with lo < hi.
  const gapBefore = (k: number): { lo: number; hi: number } => {
    const band = bands[bandIdxs[k]];
    const prev = k > 0 ? bands[bandIdxs[k - 1]] : null;
    if (down) {
      return {
        lo: prev ? prev.y2 + BAND_INSET : sy + CHANNEL_STUB,
        hi: band.y1 - BAND_INSET,
      };
    }
    return {
      lo: band.y2 + BAND_INSET,
      hi: prev ? prev.y1 - BAND_INSET : sy - CHANNEL_STUB,
    };
  };

  const pushJog = (toX: number, lo: number, hi: number) => {
    const y = (lo + hi) / 2;
    jogs.push({ wpIndex: waypoints.length, lo, hi });
    waypoints.push({ x, y }, { x: toX, y });
    x = toX;
  };

  for (let k = 0; k < bandIdxs.length; k++) {
    const bandIdx = bandIdxs[k];
    const blocked = blockedIntervals(bands, bandIdx, reservations);
    if (isBlockedX(blocked, x)) {
      const nx = nearestFreeX(bands, bandIdx, tx, reservations);
      const { lo, hi } = gapBefore(k);
      pushJog(nx, Math.min(lo, hi), Math.max(lo, hi));
      forcedJogs++;
    }
    reserve(bandIdx, x);
  }

  if (Math.abs(x - tx) > 0.5) {
    // Final approach: jog to the target-handle x in the gap after the last
    // crossed band (or the whole span when nothing was crossed).
    const last = bandIdxs.length ? bands[bandIdxs[bandIdxs.length - 1]] : null;
    const lo = down ? (last ? last.y2 + BAND_INSET : sy + CHANNEL_STUB) : ty + CHANNEL_STUB;
    const hi = down ? ty - CHANNEL_STUB : last ? last.y1 - BAND_INSET : sy - CHANNEL_STUB;
    pushJog(tx, Math.min(lo, hi), Math.max(lo, hi));
  }

  return { waypoints, jogs, forcedJogs };
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
