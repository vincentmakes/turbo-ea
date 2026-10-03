import { describe, it, expect } from "vitest";
import type { XY } from "./ldvEdgeRouting";
import {
  ANCHOR_TOLERANCE,
  effectiveCenterY,
  effectiveOffset,
  liveWaypointPolyline,
  longestSegmentMidpoint,
  type EdgeAnchors,
} from "./ldvEdgeGeometry";

/* ------------------------------------------------------------------ */
/*  liveWaypointPolyline                                               */
/* ------------------------------------------------------------------ */

describe("liveWaypointPolyline", () => {
  // Layout-time anchors: the edge leaves (0,0) and arrives at (100,200).
  const anchors: EdgeAnchors = { sx: 0, sy: 0, tx: 100, ty: 200 };
  const source: XY = { x: 0, y: 0 };
  const target: XY = { x: 100, y: 200 };
  // Down, across, down.
  const waypoints: XY[] = [
    { x: 0, y: 50 },
    { x: 100, y: 50 },
  ];

  it("is null without waypoints or without anchors", () => {
    expect(liveWaypointPolyline(undefined, anchors, source, target)).toBeNull();
    expect(liveWaypointPolyline([], anchors, source, target)).toBeNull();
    expect(liveWaypointPolyline(waypoints, undefined, source, target)).toBeNull();
  });

  it("drops stale bends once any live handle has drifted by the tolerance", () => {
    expect(ANCHOR_TOLERANCE).toBe(4);
    const drift = ANCHOR_TOLERANCE;
    expect(liveWaypointPolyline(waypoints, anchors, { x: drift, y: 0 }, target)).toBeNull();
    expect(liveWaypointPolyline(waypoints, anchors, { x: 0, y: -drift }, target)).toBeNull();
    expect(liveWaypointPolyline(waypoints, anchors, source, { x: 100 + drift, y: 200 })).toBeNull();
    expect(liveWaypointPolyline(waypoints, anchors, source, { x: 100, y: 200 - drift })).toBeNull();
  });

  it("keeps the bends while every handle is within the tolerance", () => {
    const under = ANCHOR_TOLERANCE - 0.1;
    const poly = liveWaypointPolyline(
      waypoints,
      anchors,
      { x: under, y: -under },
      { x: 100 - under, y: 200 + under },
    );
    expect(poly).not.toBeNull();
    expect(poly).toHaveLength(4);
  });

  it("returns live source, snapped bends, live target", () => {
    const liveSource = { x: 2, y: 1 };
    const liveTarget = { x: 101, y: 203 };
    const poly = liveWaypointPolyline(waypoints, anchors, liveSource, liveTarget);
    // The first segment is vertical (bend shares x with the source anchor):
    // the bend takes the live source's x. Likewise the last bend and target.
    expect(poly).toEqual([
      { x: 2, y: 1 },
      { x: 2, y: 50 },
      { x: 101, y: 50 },
      { x: 101, y: 203 },
    ]);
    expect(poly![0]).toBe(liveSource);
    expect(poly![3]).toBe(liveTarget);
  });

  it("snaps along y when the end segments run horizontally", () => {
    // Across, down, across.
    const wps: XY[] = [
      { x: 50, y: 0 },
      { x: 50, y: 200 },
    ];
    const poly = liveWaypointPolyline(wps, anchors, { x: 1, y: 2 }, { x: 99, y: 203 });
    expect(poly).toEqual([
      { x: 1, y: 2 },
      { x: 50, y: 2 },
      { x: 50, y: 203 },
      { x: 99, y: 203 },
    ]);
  });

  it("leaves a bend alone when it shares neither axis with its anchor", () => {
    const wps: XY[] = [
      { x: 30, y: 30 },
      { x: 70, y: 170 },
    ];
    const poly = liveWaypointPolyline(wps, anchors, { x: 2, y: 1 }, { x: 101, y: 203 });
    expect(poly).toEqual([
      { x: 2, y: 1 },
      { x: 30, y: 30 },
      { x: 70, y: 170 },
      { x: 101, y: 203 },
    ]);
  });

  it("snaps a single bend to the source on one axis and the target on the other", () => {
    // An L: down from the source, then across to the target.
    const poly = liveWaypointPolyline([{ x: 0, y: 200 }], anchors, { x: 2, y: 1 }, { x: 101, y: 203 });
    expect(poly).toEqual([
      { x: 2, y: 1 },
      { x: 2, y: 203 },
      { x: 101, y: 203 },
    ]);
  });

  it("never mutates the stored waypoints", () => {
    const stored: XY[] = [
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ];
    const snapshot = stored.map((p) => ({ ...p }));
    liveWaypointPolyline(stored, anchors, { x: 2, y: 1 }, { x: 101, y: 203 });
    expect(stored).toEqual(snapshot);
  });
});

/* ------------------------------------------------------------------ */
/*  longestSegmentMidpoint                                             */
/* ------------------------------------------------------------------ */

describe("longestSegmentMidpoint", () => {
  it("picks the midpoint of the longest segment", () => {
    const pts: XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 20 },
    ];
    expect(longestSegmentMidpoint(pts)).toEqual({ x: 50, y: 10 });
  });

  it("measures segments by Manhattan length", () => {
    // A diagonal 30 across + 40 down (70) beats a straight 60.
    const pts: XY[] = [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 40 },
    ];
    expect(longestSegmentMidpoint(pts)).toEqual({ x: 75, y: 20 });
  });

  it("breaks a tie towards the first segment", () => {
    const pts: XY[] = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(longestSegmentMidpoint(pts)).toEqual({ x: 0, y: 5 });
  });

  it("handles a straight two-point line", () => {
    expect(longestSegmentMidpoint([{ x: 0, y: 0 }, { x: 4, y: 2 }])).toEqual({ x: 2, y: 1 });
  });
});

/* ------------------------------------------------------------------ */
/*  effectiveCenterY                                                   */
/* ------------------------------------------------------------------ */

describe("effectiveCenterY", () => {
  it("passes an absent value through", () => {
    expect(effectiveCenterY(undefined, 0, 100)).toBeUndefined();
  });

  it("keeps a centerY that lies well inside the handle span", () => {
    expect(effectiveCenterY(50, 0, 100)).toBe(50);
    expect(effectiveCenterY(9, 0, 100)).toBe(9);
    expect(effectiveCenterY(91, 0, 100)).toBe(91);
  });

  it("drops a centerY at or inside the 8 px margins", () => {
    expect(effectiveCenterY(8, 0, 100)).toBeUndefined();
    expect(effectiveCenterY(92, 0, 100)).toBeUndefined();
  });

  it("drops a centerY outside the span, which would double the path back", () => {
    expect(effectiveCenterY(-10, 0, 100)).toBeUndefined();
    expect(effectiveCenterY(200, 0, 100)).toBeUndefined();
  });

  it("works when the source sits below the target", () => {
    expect(effectiveCenterY(50, 100, 0)).toBe(50);
    expect(effectiveCenterY(95, 100, 0)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/*  effectiveOffset                                                    */
/* ------------------------------------------------------------------ */

describe("effectiveOffset", () => {
  it("enforces the minimum offset needed to clear an obstruction", () => {
    expect(effectiveOffset(20, 30, undefined, 0, 100)).toBe(30);
    expect(effectiveOffset(40, 30, undefined, 0, 100)).toBe(40);
    // A pinned centerY does not override the clearance.
    expect(effectiveOffset(20, 30, 50, 0, 100)).toBe(30);
  });

  it("keeps the offset short of both handles when a centerY is pinned", () => {
    // 6 px clear of each handle's distance to the run.
    expect(effectiveOffset(60, 0, 50, 0, 100)).toBe(44);
    // The raw offset wins when it is already shorter.
    expect(effectiveOffset(10, 0, 50, 0, 100)).toBe(10);
    // Limited by the nearer handle, whichever end it is.
    expect(effectiveOffset(60, 0, 50, 0, 60)).toBe(4);
  });

  it("never goes below 4 with a pinned centerY", () => {
    // 8 − 6 = 2 would be the room left; the floor keeps a visible bend.
    expect(effectiveOffset(60, 0, 8, 0, 100)).toBe(4);
    expect(effectiveOffset(60, 0, 95, 0, 100)).toBe(4);
  });

  it("caps the offset at 48% of the vertical gap without a centerY", () => {
    expect(effectiveOffset(60, 0, undefined, 0, 100)).toBe(48);
    expect(effectiveOffset(60, 0, undefined, 100, 0)).toBe(48);
    // The raw offset wins when it is already under the cap.
    expect(effectiveOffset(5, 0, undefined, 0, 100)).toBe(5);
  });

  it("floors the cap at 10 for a very short gap", () => {
    expect(effectiveOffset(60, 0, undefined, 0, 10)).toBe(10);
    expect(effectiveOffset(60, 0, undefined, 0, 0)).toBe(10);
  });
});
