import { describe, it, expect } from "vitest";
import {
  buildRowBands,
  nearestFreeX,
  buildChannel,
  buildRoundedOrthPath,
  type RowBand,
} from "./ldvChannels";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function card(x: number, y: number) {
  return { x1: x - 100, y1: y - 36, x2: x + 100, y2: y + 36 };
}

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

describe("nearestFreeX", () => {
  const bands: RowBand[] = [
    { y1: 364, y2: 436, intervals: [{ x1: -100, x2: 100 }] },
  ];

  it("returns the ideal x when it is free", () => {
    expect(nearestFreeX(bands, 0, 300, new Map())).toBe(300);
  });

  it("dodges a card to the nearest free x, ties to the smaller x", () => {
    // Ideal 0 is dead center of the card — both sides equidistant.
    expect(nearestFreeX(bands, 0, 0, new Map())).toBe(-107);
    // Ideal 50 is nearer the right edge.
    expect(nearestFreeX(bands, 0, 50, new Map())).toBe(107);
  });

  it("keeps corridors separated from reservations in the band and its neighbours", () => {
    const reservations = new Map<number, number[]>([[0, [107]]]);
    const x = nearestFreeX(bands, 0, 107, reservations);
    expect(Math.abs(x - 107)).toBeGreaterThanOrEqual(14);
    expect(x > -100 && x < 100).toBe(false); // still clear of the card
  });
});

describe("buildChannel", () => {
  const bands: RowBand[] = [
    { y1: 364, y2: 436, intervals: [{ x1: -100, x2: 100 }] },
  ];

  it("walks straight through when the column is free (no forced jogs)", () => {
    const res = buildChannel(300, 36, 300, 764, bands, [0], new Map());
    expect(res.forcedJogs).toBe(0);
    expect(res.waypoints).toHaveLength(0);
  });

  it("jogs directly to the target x when a band blocks the column", () => {
    // Column at x=0 is blocked; the target column (600) is clear, so the
    // walk jogs once, straight to the target-handle x.
    const res = buildChannel(0, 36, 600, 764, bands, [0], new Map());
    expect(res.forcedJogs).toBe(1);
    expect(res.waypoints).toHaveLength(2);
    expect(res.waypoints[0].x).toBe(0);
    expect(res.waypoints[1].x).toBe(600);
    // The jog sits in the free gap ABOVE the blocking band.
    expect(res.waypoints[0].y).toBeGreaterThan(36);
    expect(res.waypoints[0].y).toBeLessThan(364);
    expect(res.jogs).toHaveLength(1);
  });

  it("adds a final approach jog when the corridor cannot be the target x", () => {
    // Target column itself is blocked by the band → corridor beside the
    // card, then a second jog back to the target x below the band.
    const res = buildChannel(0, 36, 0, 764, bands, [0], new Map());
    expect(res.forcedJogs).toBe(1);
    expect(res.waypoints).toHaveLength(4);
    const corridorX = res.waypoints[1].x;
    expect(corridorX < -100 || corridorX > 100).toBe(true);
    expect(res.waypoints[3].x).toBe(0);
    // Second jog lives below the band, above the target handle.
    expect(res.waypoints[2].y).toBeGreaterThan(436);
    expect(res.waypoints[2].y).toBeLessThan(764);
  });

  it("mirrors for an upward edge", () => {
    const res = buildChannel(0, 764, 0, 36, bands, [0], new Map());
    expect(res.forcedJogs).toBe(1);
    expect(res.waypoints).toHaveLength(4);
    // Walking upward: first jog below the band, final approach above it.
    expect(res.waypoints[0].y).toBeGreaterThan(436);
    expect(res.waypoints[3].y).toBeLessThan(364);
    // y strictly decreases along the polyline corners.
    for (let i = 1; i < res.waypoints.length; i++) {
      expect(res.waypoints[i].y).toBeLessThanOrEqual(res.waypoints[i - 1].y);
    }
  });

  it("reserves its corridors so a second channel keeps its distance", () => {
    const reservations = new Map<number, number[]>();
    const first = buildChannel(0, 36, 0, 764, bands, [0], reservations);
    const second = buildChannel(0, 36, 0, 764, bands, [0], reservations);
    const c1 = first.waypoints[1].x;
    const c2 = second.waypoints[1].x;
    expect(Math.abs(c1 - c2)).toBeGreaterThanOrEqual(14);
  });

  it("is deterministic", () => {
    const a = buildChannel(0, 36, 0, 764, bands, [0], new Map());
    const b = buildChannel(0, 36, 0, 764, bands, [0], new Map());
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
