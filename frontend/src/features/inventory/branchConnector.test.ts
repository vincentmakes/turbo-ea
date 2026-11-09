import { describe, expect, it } from "vitest";
import {
  branchLineOffset,
  CONNECTOR_GUTTER,
  CONNECTOR_STUB,
  connectorSegments,
  MIN_LINE_WIDTH,
  routeIsClear,
  type ConnectorSegment,
} from "./branchConnector";

describe("branchLineOffset", () => {
  it("starts the line at the marker while the strip leaves it room", () => {
    expect(MIN_LINE_WIDTH).toBe(240);
    expect(branchLineOffset(100, 800)).toBe(100);
    expect(branchLineOffset(560, 800)).toBe(560);
  });

  it("pulls the line back so MIN_LINE_WIDTH stays free, never before the strip's start", () => {
    expect(branchLineOffset(561, 800)).toBe(560);
    expect(branchLineOffset(300, 400)).toBe(160);
    expect(branchLineOffset(50, 200)).toBe(0);
    expect(branchLineOffset(0, 800)).toBe(0);
  });
});

describe("routeIsClear", () => {
  const box = (start: number, end: number, top: number, bottom: number) => ({ start, end, top, bottom });
  // A corner: down at x=100 from 40 to 100, then along y=100 to x=112.
  const corner: ConnectorSegment[] = [
    { start: 100, top: 40, width: 12, height: 60, side: "start", bottom: true },
  ];
  // The same box drawn by its far edge: down at x=112.
  const farSide: ConnectorSegment[] = [{ ...corner[0], side: "end", bottom: false }];

  it("is clear of nothing, of boxes beside the drop, and of boxes it only touches", () => {
    expect(routeIsClear(corner, [])).toBe(true);
    expect(
      routeIsClear(corner, [
        box(101, 111, 50, 90), // between the drop and the badge, above the run along
        box(60, 99, 50, 90), // before the drop
        box(80, 120, 20, 40), // the marker's own arrow, ending where the drop starts
        box(112, 140, 90, 110), // the badge, starting where the run along ends
        box(60, 99, 95, 105), // before the run along
        box(80, 120, 101, 120), // below the run along
      ]),
    ).toBe(true);
  });

  it("is blocked by a box the drop or the run along passes through", () => {
    expect(routeIsClear(corner, [box(100, 120, 50, 74)])).toBe(false);
    expect(routeIsClear(corner, [box(60, 100, 50, 74)])).toBe(false);
    expect(routeIsClear(corner, [box(90, 110, 39, 41)])).toBe(false);
    expect(routeIsClear(corner, [box(90, 110, 99, 101)])).toBe(false);
    // Along: a box over the run, its edges on it.
    expect(routeIsClear(corner, [box(105, 108, 100, 110)])).toBe(false);
    expect(routeIsClear(corner, [box(105, 108, 90, 100)])).toBe(false);
    expect(routeIsClear(corner, [box(111, 130, 95, 105)])).toBe(false);
    expect(routeIsClear(corner, [box(90, 101, 95, 105)])).toBe(false);
  });

  it("checks the edge a segment draws: its far side, and no run along without a bottom", () => {
    expect(routeIsClear(farSide, [box(110, 112, 50, 60)])).toBe(false);
    expect(routeIsClear(farSide, [box(100, 101, 50, 60)])).toBe(true);
    expect(routeIsClear(farSide, [box(105, 108, 95, 105)])).toBe(true);
  });

  it("checks every segment of a route", () => {
    const two: ConnectorSegment[] = [corner[0], { ...corner[0], start: 300 }];
    expect(routeIsClear(two, [box(300, 310, 50, 60)])).toBe(false);
  });
});

describe("connectorSegments", () => {
  /** The arrow after card "o": its centre `x`, 36px tall down to its marker's `bottom`. */
  const at = (x: number, bottom: number) => ({ key: "o", x, top: bottom - 36, bottom });

  it("draws one corner when the badge lies ahead of the marker", () => {
    expect(CONNECTOR_STUB).toBe(12);
    expect(connectorSegments(at(100, 40), { start: 112, top: 90, bottom: 110 })).toEqual([
      { start: 100, top: 40, width: 12, height: 60, side: "start", bottom: true },
    ]);
    // The badge's middle rounds to a whole pixel.
    expect(connectorSegments(at(100, 40), { start: 101, top: 90, bottom: 109 })).toEqual([
      { start: 100, top: 40, width: 1, height: 60, side: "start", bottom: true },
    ]);
  });

  it("turns in the gap above a pulled-back line, entering the badge from the top", () => {
    expect(connectorSegments(at(200, 38), { start: 72, top: 60, bottom: 80 })).toEqual([
      { start: 84, top: 38, width: 116, height: 11, side: "end", bottom: true },
      { start: 84, top: 49, width: 0, height: 11, side: "start", bottom: false },
    ]);
    // A badge at the marker itself: the turn rounds, and the way in stays under the marker.
    expect(connectorSegments(at(100, 40), { start: 100, top: 61, bottom: 81 })).toEqual([
      { start: 100, top: 40, width: 0, height: 11, side: "end", bottom: true },
      { start: 100, top: 51, width: 0, height: 10, side: "start", bottom: false },
    ]);
  });

  it("goes round by the gutter when the way down or the turn crosses a box", () => {
    expect(CONNECTOR_GUTTER).toBe(-6);
    const wrapped = [{ start: 80, end: 120, top: 50, bottom: 74 }];
    expect(connectorSegments(at(100, 40), { start: 112, top: 90, bottom: 110 }, wrapped)).toEqual([
      { start: -6, top: 40, width: 106, height: 3, side: "end", bottom: true },
      { start: -6, top: 43, width: 118, height: 57, side: "start", bottom: true },
    ]);
    // A pulled-back line whose turn would cut through a chip.
    const onTheTurn = [{ start: 120, end: 160, top: 40, bottom: 60 }];
    expect(connectorSegments(at(200, 38), { start: 72, top: 60, bottom: 81 }, onTheTurn)).toEqual([
      { start: -6, top: 38, width: 206, height: 3, side: "end", bottom: true },
      { start: -6, top: 41, width: 78, height: 30, side: "start", bottom: true },
    ]);
    // Boxes off both ways keep the direct shapes.
    const aside = [{ start: 300, end: 340, top: 40, bottom: 60 }];
    expect(connectorSegments(at(100, 40), { start: 112, top: 90, bottom: 110 }, aside)).toHaveLength(1);
    expect(connectorSegments(at(200, 38), { start: 72, top: 60, bottom: 80 }, aside)).toEqual(
      connectorSegments(at(200, 38), { start: 72, top: 60, bottom: 80 }),
    );
  });

  it("never takes the box holding its own arrow for an obstacle", () => {
    // The arrow with a verb wrapped to two lines beside it: the box reaches
    // below the marker, across the drop.
    const own = { start: 90, end: 260, top: 4, bottom: 52, origin: "o" };
    expect(connectorSegments(at(100, 40), { start: 112, top: 90, bottom: 110 }, [own])).toEqual([
      { start: 100, top: 40, width: 12, height: 60, side: "start", bottom: true },
    ]);
    // Another branch's arrow box, or one naming no origin, is in the way.
    for (const other of [{ ...own, origin: "p" }, { ...own, origin: undefined }]) {
      expect(
        connectorSegments(at(100, 40), { start: 112, top: 90, bottom: 110 }, [other])[0].start,
      ).toBe(-6);
    }
  });

  it("turns toward the gutter below the tallest chip of the origin's row", () => {
    const badge = { start: 112, top: 90, bottom: 110 };
    const blocker = { start: 80, end: 120, top: 60, bottom: 84 };
    const route = (row: { start: number; end: number; top: number; bottom: number }[]) =>
      connectorSegments(at(100, 40), badge, [blocker, ...row]);
    // A two-line verb earlier on the row reaches 50px down, below the marker.
    expect(route([{ start: 10, end: 60, top: 4, bottom: 50 }])).toEqual([
      { start: -6, top: 40, width: 106, height: 13, side: "end", bottom: true },
      { start: -6, top: 53, width: 118, height: 47, side: "start", bottom: true },
    ]);
    // Boxes off the row count for nothing: one ending where the arrow starts,
    // one (past the drop) starting where the marker ends.
    const above = { start: 10, end: 60, top: -40, bottom: 4 };
    const below = { start: 150, end: 200, top: 40, bottom: 58 };
    expect(route([above, below])[0]).toEqual({
      start: -6,
      top: 40,
      width: 106,
      height: 3,
      side: "end",
      bottom: true,
    });
    // A row box that only reaches the marker's bottom leaves the turn where it was.
    expect(route([{ start: 10, end: 60, top: 5, bottom: 40 }])[0].height).toBe(3);
  });
});
