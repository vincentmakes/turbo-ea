import { describe, it, expect } from "vitest";
import {
  buildRowBands,
  buildChannel,
  buildRoundedOrthPath,
  type ChannelInput,
  type RowBand,
} from "./ldvChannels";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function card(x: number, y: number) {
  return { x1: x - 100, y1: y - 36, x2: x + 100, y2: y + 36 };
}

/** A downward channel over the given middle bands, sides available. */
function input(overrides: Partial<ChannelInput> & Pick<ChannelInput, "bands" | "betweenIdxs">): ChannelInput {
  return {
    sx: 0,
    sy: 36,
    tx: 0,
    ty: 764,
    srcRowIdx: -1,
    tgtRowIdx: -1,
    srcCard: { x1: -100, x2: 100, cy: 0 },
    tgtCard: { x1: -100, x2: 100, cy: 800 },
    sides: { exitLeft: true, exitRight: true, entryLeft: true, entryRight: true },
    reservations: new Map(),
    ...overrides,
  };
}

const MIDDLE: RowBand[] = [{ y1: 364, y2: 436, intervals: [{ x1: -100, x2: 100 }] }];

describe("buildRowBands", () => {
  it("buckets cards into rows and merges overlapping intervals", () => {
    const bands = buildRowBands([card(0, 400), card(150, 400), card(500, 400), card(0, 800)]);
    expect(bands).toHaveLength(2);
    expect(bands[0].y1).toBe(364);
    // First two cards overlap (−100..100 and 50..250) → one merged interval.
    expect(bands[0].intervals).toEqual([
      { x1: -100, x2: 250 },
      { x1: 400, x2: 600 },
    ]);
    expect(bands[1].intervals).toEqual([{ x1: -100, x2: 100 }]);
  });

  it("returns bands sorted by y", () => {
    const bands = buildRowBands([card(0, 800), card(0, 400)]);
    expect(bands[0].y1).toBeLessThan(bands[1].y1);
  });
});

describe("buildChannel", () => {
  it("needs no waypoints when the straight column is clear", () => {
    const plan = buildChannel(input({ bands: MIDDLE, betweenIdxs: [0], sx: 300, tx: 300 }));
    expect(plan.kind).toBe("none");
    expect(plan.waypoints).toHaveLength(0);
  });

  it("prefers a straight rise into the target when its column is clear", () => {
    // Source column (0) blocked by the middle card; target column (600)
    // clear. With sides available, one bend: out the source's side, then a
    // straight drop into the target's top.
    const plan = buildChannel(input({ bands: MIDDLE, betweenIdxs: [0], tx: 600 }));
    expect(plan.kind).toBe("route");
    expect(plan.corridor).toBe(600);
    expect(plan.exit).toBe("side-right");
    expect(plan.entry).toBe("straight");
    expect(plan.waypoints).toEqual([{ x: 600, y: 0 }]);
  });

  it("jogs in the gap when the side is unavailable", () => {
    const plan = buildChannel(
      input({
        bands: MIDDLE,
        betweenIdxs: [0],
        tx: 600,
        sides: { exitLeft: false, exitRight: false, entryLeft: false, entryRight: false },
      }),
    );
    expect(plan.exit).toBe("jog");
    expect(plan.entry).toBe("straight");
    expect(plan.waypoints).toHaveLength(2);
    expect(plan.waypoints[0].x).toBe(0);
    expect(plan.waypoints[1].x).toBe(600);
    // The jog sits in the free gap between source row and the blocking band.
    expect(plan.waypoints[0].y).toBeGreaterThan(36);
    expect(plan.waypoints[0].y).toBeLessThan(364);
    expect(plan.jogs).toHaveLength(1);
  });

  it("routes side-to-side around a card blocking both columns", () => {
    // Both handle columns sit on the blocked card column → corridor beside
    // it, entering and leaving through the card sides: two bends total.
    const plan = buildChannel(input({ bands: MIDDLE, betweenIdxs: [0] }));
    expect(plan.kind).toBe("route");
    expect(plan.corridor < -100 || plan.corridor > 100).toBe(true);
    expect(plan.exit).toMatch(/^side-/);
    expect(plan.entry).toMatch(/^side-/);
    expect(plan.waypoints).toEqual([
      { x: plan.corridor, y: 0 },
      { x: plan.corridor, y: 800 },
    ]);
  });

  it("uses ONE corridor even when several rows block different columns", () => {
    // Three rows, each blocking a different x — the per-row greedy walk this
    // replaces would have staircased. The single corridor is free in ALL
    // rows (around the side here), so at most one x-change happens.
    const bands: RowBand[] = [
      { y1: 200, y2: 272, intervals: [{ x1: -100, x2: 100 }] },
      { y1: 350, y2: 422, intervals: [{ x1: -50, x2: 150 }] },
      { y1: 500, y2: 572, intervals: [{ x1: -150, x2: 50 }] },
    ];
    const plan = buildChannel(input({ bands, betweenIdxs: [0, 1, 2] }));
    expect(plan.kind).toBe("route");
    const xs = new Set(plan.waypoints.map((p) => p.x));
    // Every bend shares the single corridor x.
    expect(xs.size).toBe(1);
    expect(xs.has(plan.corridor)).toBe(true);
    for (const band of bands) {
      for (const iv of band.intervals) {
        expect(plan.corridor <= iv.x1 - 7 || plan.corridor >= iv.x2 + 7).toBe(true);
      }
    }
  });

  it("mirrors for an upward edge", () => {
    const plan = buildChannel(
      input({
        bands: MIDDLE,
        betweenIdxs: [0],
        sy: 764,
        ty: 36,
        srcCard: { x1: -100, x2: 100, cy: 800 },
        tgtCard: { x1: -100, x2: 100, cy: 0 },
        sides: { exitLeft: false, exitRight: false, entryLeft: false, entryRight: false },
      }),
    );
    expect(plan.exit).toBe("jog");
    expect(plan.entry).toBe("jog");
    // y strictly decreases along the polyline corners (edge runs upward).
    for (let i = 1; i < plan.waypoints.length; i++) {
      expect(plan.waypoints[i].y).toBeLessThanOrEqual(plan.waypoints[i - 1].y);
    }
    // First jog below the band, final jog above it.
    expect(plan.waypoints[0].y).toBeGreaterThan(436);
    expect(plan.waypoints[3].y).toBeLessThan(364);
  });

  it("keeps a second channel's corridor separated from the first", () => {
    const reservations = new Map<number, number[]>();
    const a = buildChannel(input({ bands: MIDDLE, betweenIdxs: [0], reservations }));
    const b = buildChannel(input({ bands: MIDDLE, betweenIdxs: [0], reservations }));
    expect(Math.abs(a.corridor - b.corridor)).toBeGreaterThanOrEqual(12);
  });

  it("is deterministic", () => {
    const a = buildChannel(input({ bands: MIDDLE, betweenIdxs: [0] }));
    const b = buildChannel(input({ bands: MIDDLE, betweenIdxs: [0] }));
    expect(a).toEqual(b);
  });
});

describe("buildRoundedOrthPath", () => {
  it("renders a straight line with no corners", () => {
    const d = buildRoundedOrthPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      8,
    );
    expect(d).toBe("M 0 0 L 0 100");
  });

  it("collapses collinear and duplicate points", () => {
    const d = buildRoundedOrthPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 0, y: 50 },
        { x: 0, y: 100 },
      ],
      8,
    );
    expect(d).toBe("M 0 0 L 0 100");
  });

  it("emits one rounded corner per bend and no NaN", () => {
    const d = buildRoundedOrthPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
      ],
      8,
    );
    expect((d.match(/Q /g) ?? []).length).toBe(2);
    expect(d).not.toContain("NaN");
    expect(d.startsWith("M 0 0")).toBe(true);
    expect(d.endsWith("L 200 200")).toBe(true);
  });

  it("clamps the corner radius on short segments", () => {
    const d = buildRoundedOrthPath(
      [
        { x: 0, y: 0 },
        { x: 0, y: 6 },
        { x: 100, y: 6 },
      ],
      8,
    );
    // Radius clamps to half the 6px segment → corner points at y = 3.
    expect(d).toContain("L 0 3 Q 0 6 3 6");
  });
});
