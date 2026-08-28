import { describe, it, expect } from "vitest";
import {
  routeLdvEdges,
  countEdgeCrossings,
  exportRoute,
  type OrientedEdge,
  type NodeBounds,
  type XY,
} from "./ldvEdgeRouting";
import { handleOffset, LDV_NODE_W, LDV_NODE_H } from "./ldvHandles";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function edge(source: string, target: string, flipped = false): OrientedEdge {
  return { source, target, relLabel: "uses", flipped };
}

function boundsFrom(absPos: Map<string, XY>): NodeBounds[] {
  return [...absPos.entries()].map(([id, p]) => ({
    id,
    x1: p.x - LDV_NODE_W / 2,
    y1: p.y - LDV_NODE_H / 2,
    x2: p.x + LDV_NODE_W / 2,
    y2: p.y + LDV_NODE_H / 2,
  }));
}

function route(
  oriented: OrientedEdge[],
  positions: Record<string, XY>,
  lanes: Record<string, string>,
) {
  const absPos = new Map(Object.entries(positions));
  return routeLdvEdges(oriented, absPos, boundsFrom(absPos), [], new Map(Object.entries(lanes)));
}

/* ------------------------------------------------------------------ */
/*  Port assignment                                                    */
/* ------------------------------------------------------------------ */

describe("routeLdvEdges port assignment", () => {
  it("routes a single downward edge through the center handles", () => {
    const { routes } = route(
      [edge("s", "t")],
      { s: { x: 0, y: 0 }, t: { x: 0, y: 400 } },
      { s: "A", t: "B" },
    );
    expect(routes[0].sourceHandle).toBe("b-3");
    expect(routes[0].targetHandle).toBe("t-3");
  });

  it("uses the mirror handles for a flipped (upward) edge", () => {
    const { routes } = route(
      [edge("s", "t", true)],
      { s: { x: 0, y: 400 }, t: { x: 0, y: 0 } },
      { s: "B", t: "A" },
    );
    expect(routes[0].sourceHandle).toBe("ts-3");
    expect(routes[0].targetHandle).toBe("bt-3");
  });

  it("assigns fan-out slots strictly left-to-right by target direction", () => {
    const { routes } = route(
      [edge("s", "mid"), edge("s", "left"), edge("s", "right")],
      {
        s: { x: 0, y: 0 },
        left: { x: -500, y: 400 },
        mid: { x: 0, y: 400 },
        right: { x: 500, y: 400 },
      },
      { s: "A", left: "B", mid: "B", right: "B" },
    );
    // Slots follow each edge's direction (straightness-seeking assignment),
    // ordered left-to-right regardless of edge declaration order.
    expect(routes[1].sourceHandle).toBe("b-1"); // → left
    expect(routes[0].sourceHandle).toBe("b-3"); // → mid
    expect(routes[2].sourceHandle).toBe("b-5"); // → right
  });

  it("orders fan-in slots on the target the same way", () => {
    const { routes } = route(
      [edge("a", "t"), edge("b", "t"), edge("c", "t")],
      {
        a: { x: -500, y: 0 },
        b: { x: 0, y: 0 },
        c: { x: 500, y: 0 },
        t: { x: 0, y: 400 },
      },
      { a: "A", b: "A", c: "A", t: "B" },
    );
    expect(routes[0].targetHandle).toBe("t-1");
    expect(routes[1].targetHandle).toBe("t-3");
    expect(routes[2].targetHandle).toBe("t-5");
  });

  it("spreads a pair of edges toward their targets", () => {
    const { routes } = route(
      [edge("s", "l"), edge("s", "r")],
      { s: { x: 0, y: 0 }, l: { x: -300, y: 400 }, r: { x: 300, y: 400 } },
      { s: "A", l: "B", r: "B" },
    );
    expect(routes[0].sourceHandle).toBe("b-1");
    expect(routes[1].sourceHandle).toBe("b-5");
  });

  it("gives an aligned partner the straight slot even with a sibling edge", () => {
    // "below" sits exactly in s's column; "off" pulls to the right. The
    // aligned edge must keep the center slot (dead-straight vertical), the
    // other spreads — instead of both being pushed to symmetric slots.
    const { routes } = route(
      [edge("s", "below"), edge("s", "off")],
      { s: { x: 0, y: 0 }, below: { x: 0, y: 400 }, off: { x: 400, y: 400 } },
      { s: "A", below: "B", off: "B" },
    );
    expect(routes[0].sourceHandle).toBe("b-3");
    expect(routes[0].targetHandle).toBe("t-3");
    expect(routes[1].sourceHandle).toBe("b-5");
  });

  it("orders upward and downward attachments on one border together", () => {
    // "hub" is target of a downward edge from above-left and source of an
    // upward (flipped) edge to above-right: both attach to hub's TOP border
    // (t-N and ts-N share physical slots) and must not collide or cross.
    const { routes } = route(
      [edge("above", "hub"), edge("hub", "up", true)],
      {
        above: { x: -300, y: 0 },
        up: { x: 300, y: 0 },
        hub: { x: 0, y: 400 },
      },
      { above: "A", up: "A", hub: "B" },
    );
    expect(routes[0].targetHandle).toBe("t-1"); // from above-left
    expect(routes[1].sourceHandle).toBe("ts-5"); // toward above-right
  });

  it("shares slots in declaration-stable order when a side has more than five edges", () => {
    const targets = Array.from({ length: 7 }, (_, i) => `t${i}`);
    const positions: Record<string, XY> = { s: { x: 0, y: 0 } };
    const lanes: Record<string, string> = { s: "A" };
    targets.forEach((t, i) => {
      positions[t] = { x: (i - 3) * 300, y: 400 };
      lanes[t] = "B";
    });
    const { routes } = route(
      targets.map((t) => edge("s", t)),
      positions,
      lanes,
    );
    const slots = routes.map((r) => Number(r.sourceHandle.split("-")[1]));
    // Slots may repeat (7 edges, 5 slots) but must be non-decreasing
    // left-to-right — order is never violated.
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i]).toBeGreaterThanOrEqual(slots[i - 1]);
    }
    expect(slots[0]).toBe(1);
    expect(slots[slots.length - 1]).toBe(5);
  });

  it("uses facing side handles for a near-horizontal edge within one lane", () => {
    const { routes } = route(
      [edge("a", "b"), edge("c", "d")],
      {
        a: { x: 0, y: 0 },
        b: { x: 600, y: 0 },
        c: { x: 600, y: 300 },
        d: { x: 0, y: 300 },
      },
      { a: "A", b: "A", c: "A", d: "A" },
    );
    expect(routes[0].sourceHandle).toBe("right");
    expect(routes[0].targetHandle).toBe("left");
    expect(routes[1].sourceHandle).toBe("left-src");
    expect(routes[1].targetHandle).toBe("right-tgt");
  });

  it("keeps vertical handles for a cross-lane edge even when it is wide", () => {
    const { routes } = route(
      [edge("s", "t")],
      { s: { x: 0, y: 0 }, t: { x: 900, y: 300 } },
      { s: "A", t: "B" },
    );
    expect(routes[0].sourceHandle).toMatch(/^b-/);
    expect(routes[0].targetHandle).toMatch(/^t-/);
  });

  it("routes a lane-skipping edge out the source's side into a straight drop", () => {
    // Column at the source x is blocked in the middle lane; the target
    // column is clear — one bend: out the source's side, straight down into
    // the target's top.
    const { routes } = route(
      [edge("s", "t")],
      {
        s: { x: 0, y: 0 },
        m: { x: 0, y: 400 },
        t: { x: 600, y: 800 },
      },
      { s: "A", m: "B", t: "C" },
    );
    expect(routes[0].sourceHandle).toBe("right");
    const wps = routes[0].waypoints!;
    expect(wps).toHaveLength(1);
    // Bend at the target-handle column, level with the source's center.
    expect(wps[0].x).toBeCloseTo(600 + handleOffset(routes[0].targetHandle).dx, 5);
    expect(wps[0].y).toBe(0);
  });

  it("staggers a channel jog against a normal edge sharing its gap", () => {
    const { routes } = route(
      [edge("s", "t"), edge("a", "b")],
      {
        s: { x: 0, y: 0 },
        m: { x: 0, y: 400 },
        t: { x: 600, y: 800 },
        a: { x: 300, y: 0 },
        b: { x: 300, y: 400 },
      },
      { s: "A", m: "B", t: "C", a: "A", b: "B" },
    );
    const jogY = routes[0].waypoints![0].y;
    const normalY = routes[1].centerY!;
    // The straight a→b edge's horizontal run is zero-length at x=300, inside
    // the jog's 0..600 extent — they must not share a line.
    expect(Math.abs(jogY - normalY)).toBeGreaterThanOrEqual(8);
  });

  it("mirrors channel routing for an upward skip edge", () => {
    const { routes } = route(
      [edge("s", "t", true)],
      {
        s: { x: 0, y: 800 },
        m: { x: 0, y: 400 },
        t: { x: 0, y: 0 },
      },
      { s: "C", m: "B", t: "A" },
    );
    const wps = routes[0].waypoints!;
    expect(wps.length).toBeGreaterThanOrEqual(4);
    expect(routes[0].sourceHandle).toMatch(/^ts-/);
    expect(routes[0].targetHandle).toMatch(/^bt-/);
    // y decreases along the polyline (the edge runs upward).
    for (let i = 1; i < wps.length; i++) {
      expect(wps[i].y).toBeLessThanOrEqual(wps[i - 1].y);
    }
    // The corridor clears the middle card.
    const corridorX = wps[1].x;
    expect(corridorX < -100 || corridorX > 100).toBe(true);
  });

  it("keeps two channel corridors in one band separated", () => {
    const { routes } = route(
      [edge("s1", "t1"), edge("s2", "t2")],
      {
        s1: { x: 0, y: 0 },
        s2: { x: 240, y: 0 },
        m1: { x: 0, y: 400 },
        m2: { x: 240, y: 400 },
        t1: { x: 0, y: 800 },
        t2: { x: 240, y: 800 },
      },
      { s1: "A", s2: "A", m1: "B", m2: "B", t1: "C", t2: "C" },
    );
    const c1 = routes[0].waypoints![1].x;
    const c2 = routes[1].waypoints![1].x;
    expect(Math.abs(c1 - c2)).toBeGreaterThanOrEqual(14);
  });

  it("never staircases: one corridor even across several populated rows", () => {
    // Screenshot regression: a Platform above three fully populated business
    // rows, connected to an Application below them, surrounded by sibling
    // edges whose corridors already occupy the handy gaps. The old per-row
    // greedy walk zigzagged across the whole lane; the single-corridor route
    // must use at most 2 jogs (4 bends) and clear every card.
    const positions: Record<string, XY> = {
      platform: { x: 350, y: 0 },
      ea: { x: 350, y: 340 },
      schem: { x: 575, y: 340 },
      comp: { x: 800, y: 340 },
      engdiv: { x: 350, y: 435 },
      epcb: { x: 575, y: 435 },
      emea: { x: 800, y: 435 },
      ecm: { x: 350, y: 530 },
      pcb: { x: 575, y: 530 },
      altium: { x: 465, y: 840 },
    };
    const lanes: Record<string, string> = {
      platform: "S", altium: "A",
      ea: "B", schem: "B", comp: "B", engdiv: "B", epcb: "B", emea: "B", ecm: "B", pcb: "B",
    };
    const oriented = [
      edge("altium", "ecm", true),
      edge("altium", "pcb", true),
      edge("altium", "epcb", true),
      edge("altium", "schem", true),
      edge("engdiv", "altium"),
      edge("ea", "altium"),
      edge("emea", "altium"),
      edge("platform", "altium"),
    ];
    const { routes } = route(oriented, positions, lanes);
    // Derived, never written out: a hard-coded half-height silently shrinks
    // the clearance box — and so weakens every assertion below — the day the
    // card changes size.
    const bounds = Object.entries(positions).map(([id, p]) => ({
      id,
      x1: p.x - LDV_NODE_W / 2,
      y1: p.y - LDV_NODE_H / 2,
      x2: p.x + LDV_NODE_W / 2,
      y2: p.y + LDV_NODE_H / 2,
    }));
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (!r.waypoints) continue;
      expect(r.waypoints.length).toBeLessThanOrEqual(4);
      // Every segment of the polyline stays clear of every card body.
      const a = r.anchors!;
      const pts = [{ x: a.sx, y: a.sy }, ...r.waypoints, { x: a.tx, y: a.ty }];
      for (let k = 0; k + 1 < pts.length; k++) {
        const x1 = Math.min(pts[k].x, pts[k + 1].x);
        const x2 = Math.max(pts[k].x, pts[k + 1].x);
        const y1 = Math.min(pts[k].y, pts[k + 1].y);
        const y2 = Math.max(pts[k].y, pts[k + 1].y);
        for (const b of bounds) {
          if (b.id === oriented[i].source || b.id === oriented[i].target) continue;
          const overlaps = x2 > b.x1 + 2 && x1 < b.x2 - 2 && y2 > b.y1 + 2 && y1 < b.y2 - 2;
          expect(overlaps, `edge ${i} segment ${k} crosses ${b.id}`).toBe(false);
        }
      }
    }
    // The Platform edge specifically must not zigzag: at most one corridor,
    // i.e. at most 3 distinct x values across its whole polyline.
    const plat = routes[7];
    expect(plat.waypoints).toBeDefined();
    const xs = new Set(
      [plat.anchors!.sx, ...plat.waypoints!.map((p) => p.x), plat.anchors!.tx].map((x) =>
        Math.round(x),
      ),
    );
    expect(xs.size).toBeLessThanOrEqual(3);
  });

  it("is deterministic with channels in play", () => {
    const oriented = [edge("s1", "t1"), edge("s2", "t2"), edge("a", "b")];
    const positions = {
      s1: { x: 0, y: 0 },
      s2: { x: 240, y: 0 },
      m1: { x: 0, y: 400 },
      m2: { x: 240, y: 400 },
      t1: { x: 0, y: 800 },
      t2: { x: 240, y: 800 },
      a: { x: 600, y: 0 },
      b: { x: 600, y: 400 },
    };
    const lanes = { s1: "A", s2: "A", m1: "B", m2: "B", t1: "C", t2: "C", a: "A", b: "B" };
    const first = route(oriented, positions, lanes);
    const second = route(oriented, positions, lanes);
    expect(second.routes).toEqual(first.routes);
  });

  it("reports every chosen handle in usedHandles", () => {
    const { routes, usedHandles } = route(
      [edge("s", "t")],
      { s: { x: 0, y: 0 }, t: { x: 0, y: 400 } },
      { s: "A", t: "B" },
    );
    expect(usedHandles.get("s")).toContain(routes[0].sourceHandle);
    expect(usedHandles.get("t")).toContain(routes[0].targetHandle);
  });

  it("is deterministic", () => {
    const oriented = [edge("s", "mid"), edge("s", "left"), edge("s", "right"), edge("mid", "s", true)];
    const positions = {
      s: { x: 40, y: 0 },
      left: { x: -500, y: 400 },
      mid: { x: 10, y: 400 },
      right: { x: 500, y: 400 },
    };
    const lanes = { s: "A", left: "B", mid: "B", right: "B" };
    const a = route(oriented, positions, lanes);
    const b = route(oriented, positions, lanes);
    expect(a.routes).toEqual(b.routes);
    expect([...a.usedHandles.entries()]).toEqual([...b.usedHandles.entries()]);
  });
});

/* ------------------------------------------------------------------ */
/*  Crossing metric + reduction                                        */
/* ------------------------------------------------------------------ */

describe("countEdgeCrossings", () => {
  it("counts a proper X crossing", () => {
    expect(
      countEdgeCrossings([
        { sx: 0, sy: 0, tx: 100, ty: 100 },
        { sx: 100, sy: 0, tx: 0, ty: 100 },
      ]),
    ).toBe(1);
  });

  it("ignores parallel segments and shared endpoints", () => {
    expect(
      countEdgeCrossings([
        { sx: 0, sy: 0, tx: 0, ty: 100 },
        { sx: 50, sy: 0, tx: 50, ty: 100 },
      ]),
    ).toBe(0);
    expect(
      countEdgeCrossings([
        { sx: 0, sy: 0, tx: 100, ty: 100 },
        { sx: 0, sy: 0, tx: -100, ty: 100 },
      ]),
    ).toBe(0);
  });

  it("ordered port assignment produces a crossing-free fan", () => {
    const positions: Record<string, XY> = {
      s: { x: 0, y: 0 },
      l: { x: -500, y: 400 },
      m: { x: 0, y: 400 },
      r: { x: 500, y: 400 },
    };
    const oriented = [edge("s", "r"), edge("s", "l"), edge("s", "m")];
    const { routes } = route(oriented, positions, { s: "A", l: "B", m: "B", r: "B" });
    const segments = oriented.map((e, i) => {
      const sOff = handleOffset(routes[i].sourceHandle);
      const tOff = handleOffset(routes[i].targetHandle);
      return {
        sx: positions[e.source].x + sOff.dx,
        sy: positions[e.source].y + sOff.dy,
        tx: positions[e.target].x + tOff.dx,
        ty: positions[e.target].y + tOff.dy,
      };
    });
    expect(countEdgeCrossings(segments)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Offset staggering                                                  */
/* ------------------------------------------------------------------ */

describe("routeLdvEdges horizontal-run placement (centerY)", () => {
  it("pins the horizontal run strictly between the two handles", () => {
    const { routes } = route(
      [edge("s", "t")],
      { s: { x: 0, y: 0 }, t: { x: 300, y: 400 } },
      { s: "A", t: "B" },
    );
    // The run must sit between the two handle ys — half a card below the
    // source centre and half a card above the target's — at the midpoint when
    // nothing conflicts.
    expect(routes[0].centerY).toBeGreaterThan(LDV_NODE_H / 2);
    expect(routes[0].centerY).toBeLessThan(400 - LDV_NODE_H / 2);
    expect(routes[0].centerY).toBe(200);
  });

  it("keeps horizontally separated runs on one shared line", () => {
    const { routes } = route(
      [edge("a", "b"), edge("c", "d")],
      {
        a: { x: 0, y: 0 },
        b: { x: 0, y: 400 },
        c: { x: 1000, y: 0 },
        d: { x: 1000, y: 400 },
      },
      { a: "A", b: "B", c: "A", d: "B" },
    );
    expect(routes[0].centerY).toBe(routes[1].centerY);
  });

  it("staggers runs that overlap horizontally onto distinct lines", () => {
    // Two diagonals spanning the same x range: at the default midpoint their
    // horizontal segments would be exactly collinear.
    const { routes } = route(
      [edge("a", "b"), edge("c", "d")],
      {
        a: { x: 0, y: 0 },
        c: { x: 500, y: 0 },
        b: { x: 500, y: 400 },
        d: { x: 0, y: 400 },
      },
      { a: "A", c: "A", b: "B", d: "B" },
    );
    expect(routes[0].centerY).toBeDefined();
    expect(routes[1].centerY).toBeDefined();
    expect(Math.abs(routes[0].centerY! - routes[1].centerY!)).toBeGreaterThanOrEqual(10);
  });

  it("routes around a card between the endpoints instead of crossing it", () => {
    // The card "o" forms a row between the endpoints — the edge becomes a
    // channel route whose segments all clear it (o spans x 300..500,
    // y 164..236).
    const { routes } = route(
      [edge("s", "t")],
      {
        s: { x: 0, y: 0 },
        o: { x: 400, y: 200 },
        t: { x: 800, y: 400 },
      },
      { s: "A", o: "A", t: "B" },
    );
    expect(routes[0].centerY).toBeUndefined();
    const a = routes[0].anchors!;
    const pts = [{ x: a.sx, y: a.sy }, ...routes[0].waypoints!, { x: a.tx, y: a.ty }];
    for (let k = 0; k + 1 < pts.length; k++) {
      const x1 = Math.min(pts[k].x, pts[k + 1].x);
      const x2 = Math.max(pts[k].x, pts[k + 1].x);
      const y1 = Math.min(pts[k].y, pts[k + 1].y);
      const y2 = Math.max(pts[k].y, pts[k + 1].y);
      const overlaps = x2 > 300 && x1 < 500 && y2 > 164 && y1 < 236;
      expect(overlaps).toBe(false);
    }
  });

  it("channel-routes an edge whose straight column is blocked by a card", () => {
    // The card "o" sits exactly on the straight line between the endpoints.
    // The edge used to fall back to the offset-driven wrap-around; it now
    // dodges through a corridor beside the card, as an explicit polyline.
    const { routes } = route(
      [edge("s", "t")],
      {
        s: { x: 0, y: 0 },
        o: { x: 0, y: 400 },
        t: { x: 0, y: 800 },
      },
      { s: "A", o: "B", t: "C" },
    );
    const wps = routes[0].waypoints!;
    expect(wps.length).toBeGreaterThanOrEqual(4); // dodge out + dodge back
    expect(routes[0].minOffset).toBe(0);
    expect(routes[0].centerY).toBeUndefined();
    expect(routes[0].anchors).toBeDefined();
    // Every vertical of the polyline clears the card "o" (x -100..100,
    // y 364..436) — the corridor runs beside it, never through it.
    const pts = [
      { x: routes[0].anchors!.sx, y: routes[0].anchors!.sy },
      ...wps,
      { x: routes[0].anchors!.tx, y: routes[0].anchors!.ty },
    ];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      if (Math.abs(a.x - b.x) < 0.01) {
        const overlap = Math.min(Math.max(a.y, b.y), 436) - Math.max(Math.min(a.y, b.y), 364);
        if (overlap > 2) {
          expect(a.x < -100 || a.x > 100).toBe(true);
        }
      }
    }
  });
});

describe("routeLdvEdges vertical de-overlap", () => {
  /** Collect every vertical run (x, y1, y2) of the routed edges. */
  function verticalSegs(
    oriented: OrientedEdge[],
    positions: Record<string, XY>,
    routes: { sourceHandle: string; targetHandle: string; centerY?: number }[],
  ) {
    const segs: { x: number; y1: number; y2: number }[] = [];
    oriented.forEach((e, i) => {
      const y = routes[i].centerY;
      if (y === undefined) return;
      const sOff = handleOffset(routes[i].sourceHandle);
      const tOff = handleOffset(routes[i].targetHandle);
      const sx = positions[e.source].x + sOff.dx;
      const sy = positions[e.source].y + sOff.dy;
      const tx = positions[e.target].x + tOff.dx;
      const ty = positions[e.target].y + tOff.dy;
      if (Math.abs(sx - tx) < 1) {
        segs.push({ x: sx, y1: Math.min(sy, ty), y2: Math.max(sy, ty) });
      } else {
        segs.push({ x: sx, y1: Math.min(sy, y), y2: Math.max(sy, y) });
        segs.push({ x: tx, y1: Math.min(y, ty), y2: Math.max(y, ty) });
      }
    });
    return segs;
  }

  it("shifts a handle so collinear vertical runs separate", () => {
    // P's source column and S's target column both sit at x = 0, and the
    // staggered run ys make their y-ranges overlap — without the nudge the
    // two edges would share a piece of wire.
    const oriented = [edge("p", "q"), edge("r", "s")];
    const positions: Record<string, XY> = {
      p: { x: 0, y: 0 },
      q: { x: 300, y: 400 },
      r: { x: -300, y: 0 },
      s: { x: 0, y: 400 },
    };
    const { routes } = route(oriented, positions, { p: "A", q: "B", r: "A", s: "B" });
    const segs = verticalSegs(oriented, positions, routes);
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const overlap =
          Math.min(segs[i].y2, segs[j].y2) - Math.max(segs[i].y1, segs[j].y1);
        if (Math.abs(segs[i].x - segs[j].x) < 6) {
          expect(overlap).toBeLessThanOrEqual(12);
        }
      }
    }
  });

  it("shifts a normal edge away from a channel corridor it would overlap", () => {
    // The skip edge s→t dodges card "o" and its corridor is fixed; if a
    // plain edge's vertical lands on the corridor, the plain edge moves.
    const oriented = [edge("s", "t"), edge("a", "b")];
    const positions: Record<string, XY> = {
      s: { x: 0, y: 0 },
      o: { x: 0, y: 400 },
      t: { x: 0, y: 800 },
      a: { x: -107, y: 400 },
      b: { x: -107, y: 800 },
    };
    const { routes } = route(oriented, positions, { s: "A", o: "B", t: "C", a: "B", b: "C" });
    // Determinism of the fixture: the corridor picked beside "o".
    expect(routes[0].waypoints).toBeDefined();
    // The normal edge a→b must not share a column with the corridor for a
    // meaningful stretch — either its handles shifted or the corridor is
    // far enough away.
    const corridorX = routes[0].waypoints![1].x;
    const aOff = handleOffset(routes[1].sourceHandle);
    expect(Math.abs(positions.a.x + aOff.dx - corridorX)).toBeGreaterThanOrEqual(6);
  });

  it("never breaks the left-to-right slot order when nudging", () => {
    // A fully occupied side cannot shift — the order guarantee wins over the
    // overlap fix, and the call must not throw or reorder slots.
    const targets = ["t1", "t2", "t3", "t4", "t5"];
    const positions: Record<string, XY> = { s: { x: 0, y: 0 } };
    const lanes: Record<string, string> = { s: "A" };
    targets.forEach((t, i) => {
      positions[t] = { x: (i - 2) * 300, y: 400 };
      lanes[t] = "B";
    });
    const { routes } = route(
      targets.map((t) => edge("s", t)),
      positions,
      lanes,
    );
    const slots = routes.map((r) => Number(r.sourceHandle.split("-")[1]));
    expect(slots).toEqual([1, 2, 3, 4, 5]);
  });
});

/* ------------------------------------------------------------------ */
/*  Export routing                                                     */
/* ------------------------------------------------------------------ */

describe("exportRoute", () => {
  const sourceCentre = { x: 0, y: 0 };
  const targetCentre = { x: 0, y: 400 };
  // b-3 / t-3 are the centre slots, so the handle points sit half a card below
  // and above the two centres. Derived from LDV_NODE_H rather than written out:
  // a hard-coded 36 silently made every anchor look stale the day the card grew
  // to hold a logo, and the whole suite reported dropped waypoints instead.
  const halfCard = LDV_NODE_H / 2;
  const base = {
    sourceHandle: "b-3",
    targetHandle: "t-3",
    sourceCentre,
    targetCentre,
    anchors: {
      sx: 0,
      sy: sourceCentre.y + halfCard,
      tx: 0,
      ty: targetCentre.y - halfCard,
    },
  };

  it("translates handles into fractional anchors on the cards", () => {
    const route = exportRoute(base);
    expect(route.exit).toEqual({ x: 0.5, y: 1 });
    expect(route.entry).toEqual({ x: 0.5, y: 0 });
  });

  it("carries a channel route's own bend points", () => {
    const waypoints = [
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ];
    expect(exportRoute({ ...base, waypoints }).waypoints).toEqual(waypoints);
  });

  it("re-derives the two bends of an ordinary staggered edge", () => {
    // A plain edge has no waypoints, but its horizontal run is pinned — those
    // corners are the path, so naming them keeps the exported edge identical.
    const route = exportRoute({ ...base, centerY: 200 });
    expect(route.waypoints).toEqual([
      { x: 0, y: 200 },
      { x: 0, y: 200 },
    ]);
  });

  it("contributes anchors only when the edge has no stored route", () => {
    const route = exportRoute(base);
    expect(route.waypoints).toBeUndefined();
    expect(route.exit).toBeDefined();
  });

  it("drops stale bends after a card was dragged", () => {
    // Positions are live, the route is from layout time. Exporting bends that
    // no longer meet the card would draw a broken path.
    const route = exportRoute({
      ...base,
      targetCentre: { x: 500, y: 400 },
      waypoints: [{ x: 300, y: 100 }],
    });
    expect(route.waypoints).toBeUndefined();
    expect(route.entry).toEqual({ x: 0.5, y: 0 });
  });

  it("keeps bends when positions moved within the tolerance", () => {
    const route = exportRoute({
      ...base,
      targetCentre: { x: 2, y: 400 },
      waypoints: [{ x: 300, y: 100 }],
    });
    expect(route.waypoints).toHaveLength(1);
  });

  it("copies the bend points rather than sharing them", () => {
    const waypoints = [{ x: 300, y: 100 }];
    const route = exportRoute({ ...base, waypoints });
    route.waypoints![0].x = 999;
    expect(waypoints[0].x).toBe(300);
  });
});
