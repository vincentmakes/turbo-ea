import { describe, it, expect } from "vitest";
import {
  routeLdvEdges,
  countEdgeCrossings,
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
    // Three attachments on one side → symmetric slots [2, 3, 4], ordered by
    // the direction toward the target regardless of edge declaration order.
    expect(routes[1].sourceHandle).toBe("b-2"); // → left
    expect(routes[0].sourceHandle).toBe("b-3"); // → mid
    expect(routes[2].sourceHandle).toBe("b-4"); // → right
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
    expect(routes[0].targetHandle).toBe("t-2");
    expect(routes[1].targetHandle).toBe("t-3");
    expect(routes[2].targetHandle).toBe("t-4");
  });

  it("uses symmetric inner slots for a pair of edges", () => {
    const { routes } = route(
      [edge("s", "l"), edge("s", "r")],
      { s: { x: 0, y: 0 }, l: { x: -300, y: 400 }, r: { x: 300, y: 400 } },
      { s: "A", l: "B", r: "B" },
    );
    expect(routes[0].sourceHandle).toBe("b-2");
    expect(routes[1].sourceHandle).toBe("b-4");
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
    expect(routes[0].targetHandle).toBe("t-2"); // from above-left
    expect(routes[1].sourceHandle).toBe("ts-4"); // toward above-right
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
    // Handle ys: 36 (source bottom) and 364 (target top) — the run must sit
    // between them, at the midpoint when nothing conflicts.
    expect(routes[0].centerY).toBeGreaterThan(36);
    expect(routes[0].centerY).toBeLessThan(364);
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

  it("moves a run off a card body its span would cross", () => {
    // A wide edge whose midpoint line would slice through the card "o"
    // sitting between its endpoints (but off the direct corridor, so the
    // edge is not classified as obstructed).
    const { routes } = route(
      [edge("s", "t")],
      {
        s: { x: 0, y: 0 },
        o: { x: 400, y: 200 },
        t: { x: 800, y: 400 },
      },
      { s: "A", o: "A", t: "B" },
    );
    const y = routes[0].centerY!;
    // Card "o" spans y 164..236 — the run must clear it (with margin).
    expect(y < 158 || y > 242).toBe(true);
  });

  it("leaves obstructed edges on the legacy shape (no centerY)", () => {
    const { routes } = route(
      [edge("s", "t")],
      {
        s: { x: 0, y: 0 },
        o: { x: 0, y: 400 },
        t: { x: 0, y: 800 },
      },
      { s: "A", o: "B", t: "C" },
    );
    expect(routes[0].minOffset).toBeGreaterThan(0);
    expect(routes[0].centerY).toBeUndefined();
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
