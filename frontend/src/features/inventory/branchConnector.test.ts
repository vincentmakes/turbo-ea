import { describe, expect, it } from "vitest";
import {
  branchLineOffset,
  CONNECTOR_GUTTER,
  branchRoute,
  CONNECTOR_STUB,
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

describe("branchRoute", () => {
  /** The arrow after card "o": its centre `x`, 36px tall down to its marker's `bottom`. */
  const at = (x: number, bottom: number) => ({ key: "o", x, top: bottom - 36, bottom });
  const box = (start: number, end: number, top: number, bottom: number) => ({ start, end, top, bottom });
  /** A badge between 90px and 110px down: its middle at 100px. */
  const BADGE = { top: 90, bottom: 110 };

  it("starts the line under the arrow and drops into its badge, one corner", () => {
    expect(CONNECTOR_STUB).toBe(12);
    expect(branchRoute(at(100, 40), BADGE, [], 800)).toEqual({
      start: 100,
      segments: [{ start: 100, top: 40, width: 12, height: 60, side: "start", bottom: true }],
    });
    // The badge's middle rounds to a whole pixel.
    expect(branchRoute(at(100, 40), { top: 90, bottom: 109 }, [], 800).segments[0].height).toBe(60);
    // Boxes beside the drop change nothing.
    expect(branchRoute(at(100, 40), BADGE, [box(120, 200, 50, 74)], 800).start).toBe(100);
  });

  it("turns in the gap above a pulled-back line, entering the badge from the top", () => {
    // 300px leaves the line 60px in; its badge at 72px.
    expect(branchRoute(at(200, 38), { top: 60, bottom: 80 }, [], 300)).toEqual({
      start: 60,
      segments: [
        { start: 84, top: 38, width: 116, height: 11, side: "end", bottom: true },
        { start: 84, top: 49, width: 0, height: 11, side: "start", bottom: false },
      ],
    });
    // A badge right at the arrow: the turn rounds, and the way in stays under it.
    expect(branchRoute(at(100, 40), { top: 61, bottom: 81 }, [], 328)).toEqual({
      start: 88,
      segments: [
        { start: 100, top: 40, width: 0, height: 11, side: "end", bottom: true },
        { start: 100, top: 51, width: 0, height: 10, side: "start", bottom: false },
      ],
    });
  });

  it("jogs to the nearest clear spot after the arrow when chips sit under it", () => {
    // The arrow's line wraps: a chip from 50px to 150px sits under it.
    const wrapped = [box(50, 150, 50, 74)];
    expect(branchRoute(at(100, 40), BADGE, wrapped, 800)).toEqual({
      start: 157,
      segments: [
        { start: 100, top: 40, width: 57, height: 3, side: "start", bottom: true },
        { start: 157, top: 43, width: 12, height: 57, side: "start", bottom: true },
      ],
    });
    // Two chips side by side, the second within clearance of the first: past both.
    expect(branchRoute(at(100, 40), BADGE, [...wrapped, box(160, 220, 80, 88)], 800).start).toBe(227);
    // Exactly the room the line needs is enough.
    expect(branchRoute(at(100, 40), BADGE, wrapped, 157 + MIN_LINE_WIDTH).start).toBe(157);
  });

  it("jogs back before the arrow when the spot after it leaves the line too little room", () => {
    const wrapped = [box(50, 150, 50, 74)];
    expect(branchRoute(at(100, 40), BADGE, wrapped, 156 + MIN_LINE_WIDTH)).toEqual({
      start: 43,
      segments: [
        { start: 43, top: 40, width: 57, height: 3, side: "end", bottom: true },
        { start: 43, top: 43, width: 12, height: 57, side: "start", bottom: true },
      ],
    });
    // A clear spot right at the strip's start will do.
    expect(branchRoute(at(100, 40), BADGE, [box(7, 150, 50, 74)], 380).start).toBe(0);
  });

  it("skips a jog whose run along the gap would cut a chip", () => {
    // A chip ending right on the gap, after the arrow: the run right cuts it,
    // the run left does not.
    const cut = [box(50, 150, 50, 74), box(120, 130, 41, 43)];
    expect(branchRoute(at(100, 40), BADGE, cut, 800).start).toBe(43);
  });

  it("goes round by the gutter when neither way is clear", () => {
    expect(CONNECTOR_GUTTER).toBe(-6);
    // Under the arrow from the strip's start on, with no room after it.
    expect(branchRoute(at(100, 40), BADGE, [box(0, 150, 50, 74)], 380)).toEqual({
      start: 100,
      segments: [
        { start: -6, top: 40, width: 106, height: 3, side: "end", bottom: true },
        { start: -6, top: 43, width: 118, height: 57, side: "start", bottom: true },
      ],
    });
    // A pulled-back line whose turn would cut a chip, with no clear spot either way.
    const onTheTurn = [box(120, 160, 40, 60), box(0, 300, 45, 55)];
    expect(branchRoute(at(200, 38), { top: 60, bottom: 81 }, onTheTurn, 300)).toEqual({
      start: 60,
      segments: [
        { start: -6, top: 38, width: 206, height: 3, side: "end", bottom: true },
        { start: -6, top: 41, width: 78, height: 30, side: "start", bottom: true },
      ],
    });
  });

  it("never takes the box holding its own arrow for an obstacle", () => {
    // The arrow with a verb wrapped to two lines beside it: the box reaches
    // below the marker, across the drop.
    const own = { start: 90, end: 260, top: 4, bottom: 52, origin: "o" };
    expect(branchRoute(at(100, 40), BADGE, [own], 800)).toEqual({
      start: 100,
      segments: [{ start: 100, top: 40, width: 12, height: 60, side: "start", bottom: true }],
    });
    // Another branch's arrow box, or one naming no origin, is in the way all
    // round: the connector goes by the gutter.
    for (const other of [{ ...own, origin: "p" }, { ...own, origin: undefined }]) {
      expect(branchRoute(at(100, 40), BADGE, [other], 800).segments.map((g) => g.start)).toEqual([
        -6, -6,
      ]);
    }
  });

  it("runs along the gap below the tallest chip of the arrow's row", () => {
    const wrapped = box(50, 150, 60, 84);
    // A two-line verb earlier on the row reaches 50px down, below the marker.
    expect(branchRoute(at(100, 40), BADGE, [wrapped, box(10, 40, 4, 50)], 800).segments).toEqual([
      { start: 100, top: 40, width: 57, height: 13, side: "start", bottom: true },
      { start: 157, top: 53, width: 12, height: 47, side: "start", bottom: true },
    ]);
    // Boxes off the row count for nothing: one ending where the arrow starts,
    // one (past the jog) starting where the marker ends.
    const above = box(10, 60, -40, 4);
    const below = box(300, 340, 40, 58);
    expect(branchRoute(at(100, 40), BADGE, [wrapped, above, below], 800).segments[0].height).toBe(3);
    // A row box that only reaches the marker's bottom leaves the run where it was.
    expect(
      branchRoute(at(100, 40), BADGE, [wrapped, box(10, 40, 5, 40)], 800).segments[0].height,
    ).toBe(3);
  });
});
