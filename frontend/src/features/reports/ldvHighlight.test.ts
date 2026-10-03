import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import {
  clusterMembersOf,
  hoveredNeighborsOf,
  hoverDimStyle,
  pulseSpotlightStyle,
} from "./ldvHighlight";
import { STATUS_COLORS, TIMELINE_COLORS } from "@/theme/tokens";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function node(id: string, type: string, data: Record<string, unknown> = {}): Node {
  return { id, type, position: { x: 0, y: 0 }, data };
}

function edge(source: string, target: string, data?: Record<string, unknown>): Edge {
  return { id: `${source}->${target}`, source, target, ...(data ? { data } : {}) };
}

// jsdom ships no `CSS.escape`; the two style builders need it for ids that
// carry selector syntax. A minimal stand-in for the one case that matters here
// (colons), installed only when the environment has none and removed after.
type CssGlobal = { CSS?: { escape?: (ident: string) => string } };
const g = globalThis as unknown as CssGlobal;
let previousCss: CssGlobal["CSS"];
let polyfilled = false;

beforeAll(() => {
  if (typeof g.CSS?.escape === "function") return;
  previousCss = g.CSS;
  polyfilled = true;
  g.CSS = { ...(g.CSS ?? {}), escape: (ident: string) => ident.replace(/:/g, "\\:") };
});

afterAll(() => {
  if (!polyfilled) return;
  if (previousCss === undefined) delete g.CSS;
  else g.CSS = previousCss;
});

/* ------------------------------------------------------------------ */
/*  clusterMembersOf                                                   */
/* ------------------------------------------------------------------ */

describe("clusterMembersOf", () => {
  it("maps every cluster to its members and nothing else", () => {
    const m = clusterMembersOf([
      node("card", "ldvNode", { memberIds: ["ignored"] }),
      node("lane", "ldvGroup"),
      node("box", "ldvCluster", { memberIds: ["a", "b"] }),
    ]);
    expect([...m.keys()]).toEqual(["box"]);
    expect(m.get("box")).toEqual(["a", "b"]);
  });

  it("gives a cluster with no member list an empty one", () => {
    expect(clusterMembersOf([node("box", "ldvCluster")]).get("box")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  hoveredNeighborsOf                                                 */
/* ------------------------------------------------------------------ */

describe("hoveredNeighborsOf", () => {
  const noClusters = new Map<string, string[]>();

  it("is null when nothing is hovered", () => {
    expect(hoveredNeighborsOf(null, [edge("a", "b")], noClusters, undefined)).toBeNull();
  });

  it("always keeps the hovered node itself lit", () => {
    expect(hoveredNeighborsOf("h", [], noClusters, undefined)).toEqual(new Set(["h"]));
  });

  it("lights a hovered box's own members", () => {
    const clusters = new Map([["box", ["a", "b"]]]);
    expect(hoveredNeighborsOf("box", [], clusters, undefined)).toEqual(
      new Set(["box", "a", "b"]),
    );
  });

  it("lights the other endpoint and every member pair of a line touching the hovered node", () => {
    // The box itself is hovered: everything it connects to lights up, down to
    // the cards behind the connector on both sides.
    const edges = [
      edge("h", "boxB", {
        members: [
          { source: "h", target: "c1" },
          { source: "m", target: "c2" },
        ],
      }),
    ];
    expect(hoveredNeighborsOf("h", edges, noClusters, undefined)).toEqual(
      new Set(["h", "boxB", "c1", "m", "c2"]),
    );
  });

  it("lights the source of a line whose target is the hovered node", () => {
    // Data without `members` (an ordinary line) falls back to its endpoints.
    const edges = [edge("boxA", "h", { relLabel: "uses" })];
    expect(hoveredNeighborsOf("h", edges, noClusters, undefined)).toEqual(new Set(["h", "boxA"]));
  });

  it("reads an aggregate connector's members, not its endpoints, for a card inside a box", () => {
    // Hovering one card inside a box must light the cards it is actually
    // related to — never every card in the box at the other end.
    const edges = [
      edge("boxA", "boxB", {
        members: [
          { source: "h", target: "c1" },
          { source: "x", target: "h" },
          { source: "y", target: "z" },
        ],
      }),
    ];
    expect(hoveredNeighborsOf("h", edges, noClusters, undefined)).toEqual(
      new Set(["h", "c1", "x"]),
    );
  });

  it("falls back to the endpoints of a line with no data", () => {
    // Neither endpoint is the hovered node, so an unrelated line adds nothing.
    const edges = [edge("x", "y"), edge("h", "n")];
    expect(hoveredNeighborsOf("h", edges, noClusters, undefined)).toEqual(new Set(["h", "n"]));
  });

  it("keeps a lit card's box lit", () => {
    const edges = [
      edge("boxH", "boxB", {
        members: [
          { source: "h", target: "c1" },
          { source: "z", target: "c2" },
        ],
      }),
    ];
    const memberOf = new Map([
      ["h", "boxH"],
      ["c1", "boxB"],
      ["z", "boxH"],
      ["c2", "boxB"],
    ]);
    expect(hoveredNeighborsOf("h", edges, noClusters, memberOf)).toEqual(
      new Set(["h", "c1", "boxH", "boxB"]),
    );
  });

  it("tolerates a lit card with no box", () => {
    // The centred card of the aggregate view sits in no box at all.
    const memberOf = new Map([["elsewhere", "boxZ"]]);
    expect(hoveredNeighborsOf("h", [edge("h", "n")], noClusters, memberOf)).toEqual(
      new Set(["h", "n"]),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  hoverDimStyle                                                      */
/* ------------------------------------------------------------------ */

describe("hoverDimStyle", () => {
  it("is empty when nothing is hovered", () => {
    expect(hoverDimStyle(null)).toBe("");
  });

  it("dims every card and box, then keeps the neighbours at full opacity", () => {
    const css = hoverDimStyle(new Set(["card-a", "card-b"]));
    const [dim, keep, ...rest] = css.split("\n");
    expect(rest).toEqual([]);
    expect(dim).toBe(
      `.ldv-hover-active .react-flow__node-ldvNode, .ldv-hover-active .react-flow__node-ldvCluster { opacity: 0.35; transition: opacity 0.15s; }`,
    );
    expect(keep).toBe(
      `.react-flow__node[data-id="card-a"],.react-flow__node[data-id="card-b"] { opacity: 1 !important; }`,
    );
  });

  it("escapes the colons of a cluster id in the keep selector", () => {
    // `cluster:type:Application` is selector syntax as written.
    const css = hoverDimStyle(new Set(["cluster:type:Application"]));
    expect(css).toContain(`.react-flow__node[data-id="cluster\\:type\\:Application"]`);
    expect(css).not.toContain(`[data-id="cluster:type:Application"]`);
  });
});

/* ------------------------------------------------------------------ */
/*  pulseSpotlightStyle                                                */
/* ------------------------------------------------------------------ */

describe("pulseSpotlightStyle", () => {
  it("is empty when there is nothing to pulse", () => {
    expect(pulseSpotlightStyle(undefined)).toBe("");
    expect(pulseSpotlightStyle({})).toBe("");
  });

  it("fades the canvas and declares one keyframe per kind of change", () => {
    const css = pulseSpotlightStyle({ a: "live" });
    const rules = css.split("\n");
    expect(rules[0]).toBe(
      `.ldv-pulse-active .react-flow__node-ldvNode { opacity: 0.3; transition: opacity 0.2s; }`,
    );
    expect(rules[1]).toBe(
      `@keyframes ldv-pulse-live { 0%,100% { box-shadow: 0 0 0 0 ${TIMELINE_COLORS.goLive}00 } 50% { box-shadow: 0 0 0 8px ${TIMELINE_COLORS.goLive}66 } }`,
    );
    expect(rules[2]).toBe(
      `@keyframes ldv-pulse-retire { 0%,100% { box-shadow: 0 0 0 0 ${STATUS_COLORS.error}00 } 50% { box-shadow: 0 0 0 8px ${STATUS_COLORS.error}66 } }`,
    );
  });

  it("spotlights each card with an opacity rule and an animation in the colour of its change", () => {
    const css = pulseSpotlightStyle({ a: "live", b: "retire" });
    const rules = css.split("\n");
    // 3 shared rules + 2 per card.
    expect(rules).toHaveLength(7);
    expect(rules[3]).toBe(
      `.react-flow__node[data-id="a"] { opacity: 1 !important; z-index: 10 !important; }`,
    );
    expect(rules[4]).toBe(
      `.react-flow__node[data-id="a"] > * { animation: ldv-pulse-live 0.65s ease-in-out 2; border-radius: 8px; }`,
    );
    expect(rules[5]).toBe(
      `.react-flow__node[data-id="b"] { opacity: 1 !important; z-index: 10 !important; }`,
    );
    expect(rules[6]).toBe(
      `.react-flow__node[data-id="b"] > * { animation: ldv-pulse-retire 0.65s ease-in-out 2; border-radius: 8px; }`,
    );
  });

  it("escapes the card id in its selectors", () => {
    const css = pulseSpotlightStyle({ "odd:id": "retire" });
    expect(css).toContain(`.react-flow__node[data-id="odd\\:id"] {`);
    expect(css).toContain(`.react-flow__node[data-id="odd\\:id"] > * {`);
  });
});
