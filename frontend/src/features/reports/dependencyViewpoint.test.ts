import { describe, expect, it } from "vitest";
import {
  IN_EFFECT,
  bestReach,
  combineChangeState,
  hopReach,
  isReachShown,
  pairReaches,
  relationReach,
  treeChildReach,
  viewHopsFor,
  viewMovesBetween,
  viewScopeFor,
  viewTransitions,
  viewpointReach,
  type Reach,
  type TreePaths,
  type ViewEdge,
} from "./dependencyViewpoint";
import { computeTimelineMilestones } from "./timelineRange";

const ms = (iso: string) => new Date(iso).getTime();
const DAY = 86_400_000;
const PLANNED: Reach = { state: "planned", atMark: false };
const ENDED: Reach = { state: "ended", atMark: false };
const ENDED_AT_MARK: Reach = { state: "ended", atMark: true };
const SHOW_NONE = { persistRetired: false, previewPlanned: false };
const SHOW_ALL = { persistRetired: true, previewPlanned: true };
const KEEP_RETIRED = { persistRetired: true, previewPlanned: false };
const PREVIEW = { persistRetired: false, previewPlanned: true };

/** Reach states as a plain `{id: state}` map, `!` marking "leaves at the mark". */
function states(r: Map<string, Reach>): Record<string, string> {
  return Object.fromEntries([...r].map(([k, v]) => [k, v.state + (v.atMark ? "!" : "")]));
}

describe("relationReach", () => {
  it("reads an undated relation as in effect, the shared object", () => {
    expect(relationReach(undefined, ms("2026-01-01"))).toBe(IN_EFFECT);
    expect(relationReach({}, ms("2026-01-01"))).toBe(IN_EFFECT);
  });

  it("reads a relation before, on and after its start", () => {
    const lc = { active: "2027-01-01" };
    expect(relationReach(lc, ms("2027-01-01") - DAY)).toEqual(PLANNED);
    expect(relationReach(lc, ms("2027-01-01"))).toBe(IN_EFFECT);
    expect(relationReach(lc, ms("2030-01-01"))).toBe(IN_EFFECT);
  });

  it("reads end of life as inclusive: the day before in effect, on and after ended", () => {
    const lc = { active: "2020-01-01", endOfLife: "2027-01-01" };
    expect(relationReach(lc, ms("2026-12-31"))).toBe(IN_EFFECT);
    expect(relationReach(lc, ms("2027-01-01"))).toEqual(ENDED);
    expect(relationReach(lc, ms("2027-01-02"))).toEqual(ENDED);
  });

  it("reads a relation with Plan / Phase In and no Active date as never started", () => {
    for (const lc of [{ plan: "2025-01-01" }, { phaseIn: "2025-06-01" }]) {
      expect(relationReach(lc, ms("2024-01-01"))).toEqual(PLANNED);
      expect(relationReach(lc, ms("2026-08-22"))).toEqual(PLANNED);
      expect(relationReach(lc, ms("2099-01-01"))).toEqual(PLANNED);
    }
  });

  it("flags an end inside the mark's span, inclusive at both ends, and nowhere else", () => {
    const lc = { endOfLife: "2027-01-01" };
    const at = ms("2027-01-01");
    expect(relationReach(lc, at, { from: at, to: at })).toEqual(ENDED_AT_MARK);
    expect(relationReach(lc, at + DAY, { from: at - DAY, to: at })).toEqual(ENDED_AT_MARK);
    expect(relationReach(lc, at + DAY, { from: at + DAY, to: at + 2 * DAY })).toEqual(ENDED);
    expect(relationReach(lc, at, { from: at - 2 * DAY, to: at - DAY })).toEqual(ENDED);
    expect(relationReach(lc, at, null)).toEqual(ENDED);
  });
});

describe("relationReach for a planned relation", () => {
  it("never leaves at a mark, even when its end falls inside it", () => {
    const lc = { active: "2030-01-01", endOfLife: "2031-01-01" };
    expect(relationReach(lc, ms("2026-01-01"), { from: 0, to: ms("2032-01-01") })).toEqual(PLANNED);
  });
});

describe("bestReach / hopReach", () => {
  it("bestReach orders in effect > planned > ended, either way round", () => {
    expect(bestReach(PLANNED, IN_EFFECT)).toBe(IN_EFFECT);
    expect(bestReach(IN_EFFECT, PLANNED)).toBe(IN_EFFECT);
    expect(bestReach(ENDED, PLANNED)).toBe(PLANNED);
    expect(bestReach(PLANNED, ENDED)).toBe(PLANNED);
    expect(bestReach(undefined, ENDED)).toBe(ENDED);
  });

  it("bestReach keeps the first object when nothing improves, and leaves at the mark if either path does", () => {
    const a: Reach = { state: "ended", atMark: false };
    expect(bestReach(a, ENDED)).toBe(a);
    expect(bestReach(ENDED_AT_MARK, ENDED)).toBe(ENDED_AT_MARK);
    expect(bestReach(ENDED, ENDED_AT_MARK)).toEqual(ENDED_AT_MARK);
  });

  it("hopReach gives a neighbour no better state than the card it is reached from", () => {
    expect(hopReach(PLANNED, IN_EFFECT)).toBe(PLANNED);
    expect(hopReach(IN_EFFECT, PLANNED)).toBe(PLANNED);
    expect(hopReach(ENDED, PLANNED)).toBe(ENDED);
    expect(hopReach(PLANNED, ENDED)).toBe(ENDED);
    expect(hopReach(IN_EFFECT, IN_EFFECT)).toBe(IN_EFFECT);
  });

  it("hopReach keeps the card it came from when the hop is no worse", () => {
    const from: Reach = { state: "ended", atMark: false };
    expect(hopReach(from, ENDED)).toBe(from);
    expect(hopReach(from, ENDED_AT_MARK)).toBe(from);
  });

  it("hopReach leaves at the mark only when both sides of an ended hop do", () => {
    expect(hopReach(ENDED_AT_MARK, ENDED)).toBe(ENDED);
    expect(hopReach(ENDED, ENDED_AT_MARK)).toBe(ENDED);
    expect(hopReach(ENDED_AT_MARK, ENDED_AT_MARK)).toBe(ENDED_AT_MARK);
    expect(hopReach(IN_EFFECT, ENDED_AT_MARK)).toBe(ENDED_AT_MARK);
  });
});

describe("isReachShown", () => {
  it("draws in effect always, planned with preview, ended with keep-retired or at its mark", () => {
    expect(isReachShown(IN_EFFECT, SHOW_NONE)).toBe(true);
    expect(isReachShown(PLANNED, SHOW_NONE)).toBe(false);
    expect(isReachShown(PLANNED, KEEP_RETIRED)).toBe(false);
    expect(isReachShown(PLANNED, PREVIEW)).toBe(true);
    expect(isReachShown(ENDED, SHOW_NONE)).toBe(false);
    expect(isReachShown(ENDED, PREVIEW)).toBe(false);
    expect(isReachShown(ENDED, KEEP_RETIRED)).toBe(true);
    expect(isReachShown(ENDED_AT_MARK, SHOW_NONE)).toBe(true);
  });
});

describe("pairReaches", () => {
  it("keeps the best relation per unordered pair", () => {
    const at = pairReaches(
      [
        { source: "a", target: "b", lifecycle: { endOfLife: "2020-01-01" } },
        { source: "b", target: "a", lifecycle: { active: "2030-01-01" } },
        { source: "a", target: "c", lifecycle: { endOfLife: "2020-01-01" } },
      ],
      ms("2026-01-01"),
    );
    expect(at("a", "b")).toEqual(PLANNED);
    expect(at("b", "a")).toEqual(PLANNED);
    expect(at("c", "a")).toEqual(ENDED);
    expect(at("a", "z")).toBeUndefined();
  });

  it("flags an end at the mark through the span", () => {
    const d = ms("2027-01-01");
    const at = pairReaches([{ source: "a", target: "b", lifecycle: { endOfLife: "2027-01-01" } }], d, {
      from: d,
      to: d,
    });
    expect(at("a", "b")).toEqual(ENDED_AT_MARK);
  });
});

describe("viewpointReach", () => {
  const AT = ms("2026-08-22");

  it("reads an undated landscape as all in effect, the centre's neighbours only", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "a" },
      { source: "a", target: "b" },
    ];
    const r = viewpointReach(edges, { center: "c" }, AT);
    expect(states(r)).toEqual({ c: "inEffect", a: "inEffect" });
    expect(r.get("a")).toBe(IN_EFFECT);
    expect(states(viewpointReach(edges, { center: "c", expanded: ["a"] }, AT))).toEqual({
      c: "inEffect",
      a: "inEffect",
      b: "inEffect",
    });
  });

  it("an undated relation keeps its card in effect at every date, with every toggle", () => {
    const edges: ViewEdge[] = [{ source: "c", target: "a" }];
    for (const d of [ms("1990-01-01"), AT, ms("2099-01-01")])
      for (const visibility of [SHOW_NONE, SHOW_ALL, KEEP_RETIRED, PREVIEW]) {
        const r = viewpointReach(edges, { center: "c" }, d, { visibility });
        expect(r.get("a")).toBe(IN_EFFECT);
        expect(isReachShown(r.get("a")!, visibility)).toBe(true);
      }
  });

  it("reads each relation state: in effect, planned, ended", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "now", lifecycle: { active: "2020-01-01" } },
      { source: "c", target: "later", lifecycle: { active: "2027-01-01" } },
      { source: "past", target: "c", lifecycle: { endOfLife: "2025-01-01" } },
    ];
    expect(states(viewpointReach(edges, { center: "c" }, AT))).toEqual({
      c: "inEffect",
      now: "inEffect",
      later: "planned",
      past: "ended",
    });
  });

  it("a relation with Plan / Phase In and no Active never brings its card in, at any date", () => {
    const edges: ViewEdge[] = [{ source: "c", target: "a", lifecycle: { plan: "2025-01-01", phaseIn: "2026-01-01" } }];
    for (const d of [AT, ms("2099-01-01")]) {
      const r = viewpointReach(edges, { center: "c" }, d);
      expect(r.get("a")).toEqual(PLANNED);
      expect(isReachShown(r.get("a")!, SHOW_NONE)).toBe(false);
      expect(isReachShown(r.get("a")!, KEEP_RETIRED)).toBe(false);
      expect(isReachShown(r.get("a")!, PREVIEW)).toBe(true);
    }
  });

  it("an ended relation: shown the day before its end, gone on it and after", () => {
    const edges: ViewEdge[] = [{ source: "c", target: "a", lifecycle: { endOfLife: "2027-01-01" } }];
    const at = (d: number) => viewpointReach(edges, { center: "c" }, d).get("a")!;
    expect(at(ms("2026-12-31"))).toBe(IN_EFFECT);
    expect(at(ms("2027-01-01"))).toEqual(ENDED);
    expect(at(ms("2028-01-01"))).toEqual(ENDED);
    expect(isReachShown(at(ms("2027-01-01")), SHOW_NONE)).toBe(false);
    expect(isReachShown(at(ms("2028-01-01")), SHOW_NONE)).toBe(false);
    // (a) "keep retired" keeps it, as a retired card.
    expect(isReachShown(at(ms("2028-01-01")), KEEP_RETIRED)).toBe(true);
    // (b) standing on the mark where it ends keeps it — only there.
    const eol = ms("2027-01-01");
    const onMark = viewpointReach(edges, { center: "c" }, eol, { span: { from: eol, to: eol } });
    expect(onMark.get("a")).toEqual(ENDED_AT_MARK);
    expect(isReachShown(onMark.get("a")!, SHOW_NONE)).toBe(true);
  });

  it("lets the best of several relation types between two cards decide", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "a", lifecycle: { endOfLife: "2020-01-01" } },
      { source: "a", target: "c", lifecycle: { active: "2030-01-01" } },
      { source: "c", target: "b", lifecycle: { endOfLife: "2020-01-01" } },
      { source: "c", target: "b" },
    ];
    expect(states(viewpointReach(edges, { center: "c" }, AT))).toEqual({
      c: "inEffect",
      a: "planned",
      b: "inEffect",
    });
  });

  it("a card reached from an upcoming card inherits no better state", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "up", lifecycle: { active: "2030-01-01" } },
      { source: "up", target: "x" },
      { source: "up", target: "y", lifecycle: { endOfLife: "2020-01-01" } },
    ];
    expect(
      states(viewpointReach(edges, { center: "c", expanded: ["up"] }, AT, { visibility: SHOW_ALL })),
    ).toEqual({ c: "inEffect", up: "planned", x: "planned", y: "ended" });
  });

  it("does not expand through a card its visibility does not draw", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "up", lifecycle: { active: "2030-01-01" } },
      { source: "up", target: "x" },
    ];
    const hops = { center: "c", expanded: ["up"] };
    expect(states(viewpointReach(edges, hops, AT, { visibility: SHOW_NONE }))).toEqual({
      c: "inEffect",
      up: "planned",
    });
    expect(states(viewpointReach(edges, hops, AT, { visibility: PREVIEW }))).toEqual({
      c: "inEffect",
      up: "planned",
      x: "planned",
    });
  });

  it("takes the best path, even when found by a later expansion", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "a" },
      { source: "c", target: "b", lifecycle: { active: "2030-01-01" } },
      { source: "b", target: "x" },
      { source: "a", target: "b" },
    ];
    // b is planned from the centre, in effect through a: a later expansion of a
    // lifts b, and the x reached earlier through b with it.
    expect(
      states(viewpointReach(edges, { center: "c", expanded: ["b", "a"] }, AT, { visibility: SHOW_ALL })),
    ).toEqual({ c: "inEffect", a: "inEffect", b: "inEffect", x: "inEffect" });
  });

  it("expands in order, only through cards already in the view at their turn", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "a" },
      { source: "a", target: "b" },
      { source: "b", target: "x" },
    ];
    expect(Object.keys(states(viewpointReach(edges, { center: "c", expanded: ["b", "a"] }, AT)))).toEqual(
      ["c", "a", "b"],
    );
    expect(Object.keys(states(viewpointReach(edges, { center: "c", expanded: ["a", "b", "a"] }, AT))).sort()).toEqual(
      ["a", "b", "c", "x"],
    );
  });

  it("reaches only the centre when nothing connects to it", () => {
    expect(states(viewpointReach([], { center: "c" }, AT))).toEqual({ c: "inEffect" });
  });

  it("settles over as many passes as a lift takes to travel", () => {
    // b lifts a (reached ended) to in effect; a then lifts e on the next pass,
    // and e lifts f on the one after.
    const ended = { endOfLife: "2020-01-01" };
    const edges: ViewEdge[] = [
      { source: "c", target: "a", lifecycle: ended },
      { source: "c", target: "b" },
      { source: "b", target: "a" },
      { source: "a", target: "e" },
      { source: "e", target: "f" },
      { source: "c", target: "e", lifecycle: ended },
    ];
    expect(states(viewpointReach(edges, { center: "c", expanded: ["e", "a", "b"] }, AT))).toEqual({
      c: "inEffect",
      a: "inEffect",
      b: "inEffect",
      e: "inEffect",
      f: "inEffect",
    });
  });

  it("never changes the centre's state and ignores self-loops", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "c", lifecycle: { endOfLife: "2020-01-01" } },
      { source: "c", target: "a", lifecycle: { endOfLife: "2020-01-01" } },
    ];
    const r = viewpointReach(edges, { center: "c", expanded: ["a"] }, AT, { visibility: SHOW_ALL });
    expect(r.get("c")).toBe(IN_EFFECT);
    expect(states(r)).toEqual({ c: "inEffect", a: "ended" });
  });

  it("hops only onto eligible cards; the centre is always eligible", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "a" },
      { source: "c", target: "hidden" },
      { source: "elsewhere", target: "c" },
    ];
    expect(states(viewpointReach(edges, { center: "c" }, AT, { eligible: new Set(["a"]) }))).toEqual({
      c: "inEffect",
      a: "inEffect",
    });
  });

  it("places hierarchy reveals in effect, without expanding through them", () => {
    const edges: ViewEdge[] = [
      { source: "c", target: "p", lifecycle: { endOfLife: "2020-01-01" } },
      { source: "p", target: "x" },
    ];
    const r = viewpointReach(edges, { center: "c", placed: ["p", "gone"] }, AT, {
      eligible: new Set(["p", "x"]),
    });
    expect(states(r)).toEqual({ c: "inEffect", p: "inEffect" });
  });
});

describe("combineChangeState", () => {
  const TODAY = ms("2026-08-22");
  const LATER = ms("2028-01-01");

  it("keeps the card's own state when the path is in effect", () => {
    expect(combineChangeState(undefined, IN_EFFECT, null, TODAY, TODAY)).toBeUndefined();
    expect(combineChangeState("retired", IN_EFFECT, null, TODAY, TODAY)).toBe("retired");
    expect(combineChangeState("planned", IN_EFFECT, null, TODAY, TODAY)).toBe("planned");
    expect(combineChangeState("arriving", IN_EFFECT, IN_EFFECT, LATER, TODAY)).toBe("arriving");
  });

  it("makes a present card planned or retired by its path", () => {
    expect(combineChangeState(undefined, PLANNED, null, TODAY, TODAY)).toBe("planned");
    expect(combineChangeState(undefined, ENDED, null, TODAY, TODAY)).toBe("retired");
    expect(combineChangeState("arriving", PLANNED, null, LATER, TODAY)).toBe("planned");
    expect(combineChangeState("arriving", ENDED_AT_MARK, null, LATER, TODAY)).toBe("retired");
  });

  it("lets the less-present win when both are absent: retired over planned", () => {
    expect(combineChangeState("planned", ENDED, null, TODAY, TODAY)).toBe("retired");
    expect(combineChangeState("retired", PLANNED, null, TODAY, TODAY)).toBe("retired");
    expect(combineChangeState("planned", PLANNED, null, TODAY, TODAY)).toBe("planned");
  });

  it("is arriving at a future date when the path was not in effect today", () => {
    expect(combineChangeState(undefined, IN_EFFECT, PLANNED, LATER, TODAY)).toBe("arriving");
    expect(combineChangeState(undefined, IN_EFFECT, ENDED, LATER, TODAY)).toBe("arriving");
    expect(combineChangeState(undefined, IN_EFFECT, IN_EFFECT, LATER, TODAY)).toBeUndefined();
    expect(combineChangeState(undefined, IN_EFFECT, undefined, LATER, TODAY)).toBeUndefined();
    // Never in the past or today.
    expect(combineChangeState(undefined, IN_EFFECT, PLANNED, TODAY, TODAY)).toBeUndefined();
    expect(combineChangeState(undefined, IN_EFFECT, PLANNED, TODAY - DAY, TODAY)).toBeUndefined();
  });
});

describe("viewTransitions", () => {
  const card = (id: string, lifecycle?: Record<string, string>) => ({ id, name: id.toUpperCase(), lifecycle });

  it("returns the scope and its relations unchanged without a dated relation", () => {
    const scope = [card("c"), card("a", { active: "2027-01-01" })];
    const edges: ViewEdge[] = [
      { source: "c", target: "a" },
      { source: "a", target: "out" },
    ];
    const v = viewTransitions(scope, edges, { center: "c" });
    expect(v.cards).toEqual(scope);
    expect(v.cards[1]).toBe(scope[1]);
    expect(v.links).toEqual([undefined]);
  });

  it("passes on an empty lifecycle as it came", () => {
    const v = viewTransitions([card("c"), card("a")], [{ source: "c", target: "a", lifecycle: {} }], {
      center: "c",
    });
    expect(v.links).toEqual([{}]);
  });

  it("expands only through cards in effect at each date, as the view does", () => {
    // p is planned (or ended) from the centre at its turn, so it is not expanded
    // through, even once q lifts it: z behind it is not in the view in 2028.
    const scope = [card("c"), card("p"), card("q"), card("z", { active: "2028-01-01" })];
    const hops = { center: "c", expanded: ["p", "q"] };
    const rest: ViewEdge[] = [
      { source: "c", target: "q" },
      { source: "q", target: "p" },
      { source: "p", target: "z" },
    ];
    const planned = viewTransitions(
      scope,
      [{ source: "c", target: "p", lifecycle: { active: "2030-01-01" } }, ...rest],
      hops,
    );
    expect(planned.cards).toEqual([{ id: "z", name: "Z", lifecycle: { active: "2030-01-01" } }]);
    const ended = viewTransitions(
      scope,
      [{ source: "c", target: "p", lifecycle: { endOfLife: "2025-01-01" } }, ...rest],
      hops,
    );
    expect(ended.cards).toEqual([]);
  });

  it("makes a card leave when the relation reaching it ends on its own end of life", () => {
    const scope = [card("c"), card("x", { endOfLife: "2027-01-01" })];
    const edges: ViewEdge[] = [{ source: "c", target: "x", lifecycle: { endOfLife: "2027-01-01" } }];
    expect(viewTransitions(scope, edges, { center: "c" }).cards).toEqual([
      { id: "x", name: "X", lifecycle: { endOfLife: "2027-01-01" } },
    ]);
  });

  it("skips a card that goes live and retires on the same day", () => {
    const scope = [card("c"), card("x", { active: "2027-01-01", endOfLife: "2027-01-01" })];
    const edges: ViewEdge[] = [{ source: "c", target: "x", lifecycle: { active: "2020-01-01" } }];
    expect(viewTransitions(scope, edges, { center: "c" }).cards).toEqual([]);
  });

  it("names a date as the first relation wrote it, however others write the same day", () => {
    const scope = [card("c"), card("a")];
    const edges: ViewEdge[] = [
      { source: "c", target: "a", lifecycle: { active: "2027-01-01" } },
      { source: "a", target: "c", lifecycle: { active: "2027-01-01T00:00:00Z" } },
    ];
    expect(viewTransitions(scope, edges, { center: "c" }).cards).toEqual([
      { id: "a", name: "A", lifecycle: { active: "2027-01-01" } },
    ]);
  });

  it("counts no connection change for a link that ends the day it starts", () => {
    const scope = [card("c"), card("a")];
    const edges: ViewEdge[] = [
      { source: "c", target: "a" },
      { source: "c", target: "a", lifecycle: { active: "2027-01-01", endOfLife: "2027-01-01" } },
    ];
    expect(viewTransitions(scope, edges, { center: "c" }).links).toEqual([]);
  });

  it("does not count a link to a card retired at the date as a connection change", () => {
    const scope = [card("c"), card("b", { endOfLife: "2027-01-01" })];
    const edges: ViewEdge[] = [
      { source: "c", target: "b" },
      { source: "c", target: "b", lifecycle: { active: "2028-01-01" } },
    ];
    expect(viewTransitions(scope, edges, { center: "c" }).links).toEqual([]);
  });

  it("makes a relation bringing a card in an arrival on its start date, and its end a departure", () => {
    const scope = [card("c"), card("a", { active: "2020-01-01" })];
    const edges: ViewEdge[] = [
      { source: "c", target: "a", lifecycle: { active: "2027-01-01", endOfLife: "2029-01-01" } },
    ];
    const v = viewTransitions(scope, edges, { center: "c" });
    // The card's own go-live in 2020 is no change from here: nothing reached it.
    expect(v.cards).toEqual([
      { id: "a", name: "A", lifecycle: { active: "2027-01-01" } },
      { id: "a", name: "A", lifecycle: { endOfLife: "2029-01-01" } },
    ]);
    expect(v.links).toEqual([]);
    expect(computeTimelineMilestones(v.cards.map((c) => c.lifecycle), v.links)).toEqual([
      { value: ms("2027-01-01"), activating: 1, disappearing: 0 },
      { value: ms("2029-01-01"), activating: 0, disappearing: 1 },
    ]);
  });

  it("keeps a card's own dates while a path in effect reaches it", () => {
    const scope = [card("c"), card("a", { active: "2027-01-01", endOfLife: "2029-01-01" })];
    const edges: ViewEdge[] = [{ source: "c", target: "a", lifecycle: { active: "2020-01-01" } }];
    expect(viewTransitions(scope, edges, { center: "c" }).cards).toEqual([
      { id: "a", name: "A", lifecycle: { active: "2027-01-01" } },
      { id: "a", name: "A", lifecycle: { endOfLife: "2029-01-01" } },
    ]);
  });

  it("counts a change once when the card and the relation change the same day", () => {
    const scope = [card("c"), card("a", { active: "2027-01-01" })];
    const edges: ViewEdge[] = [{ source: "c", target: "a", lifecycle: { active: "2027-01-01" } }];
    expect(viewTransitions(scope, edges, { center: "c" }).cards).toEqual([
      { id: "a", name: "A", lifecycle: { active: "2027-01-01" } },
    ]);
  });

  it("skips a card that is never alive", () => {
    const scope = [card("c"), card("a", { active: "2027-01-01", endOfLife: "2026-01-01" })];
    const edges: ViewEdge[] = [{ source: "c", target: "a", lifecycle: { active: "2020-01-01" } }];
    expect(viewTransitions(scope, edges, { center: "c" }).cards).toEqual([]);
  });

  it("marks nothing for a relation with Plan / Phase In and no Active date", () => {
    const scope = [card("c"), card("a", { active: "2027-01-01" })];
    const edges: ViewEdge[] = [{ source: "c", target: "a", lifecycle: { plan: "2025-01-01", phaseIn: "2026-01-01" } }];
    const v = viewTransitions(scope, edges, { center: "c" });
    expect(v.cards).toEqual([]);
    expect(computeTimelineMilestones(v.cards.map((c) => c.lifecycle), v.links)).toEqual([]);
  });

  it("is no change when another relation in effect keeps the card", () => {
    const scope = [card("c"), card("a")];
    const edges: ViewEdge[] = [
      { source: "c", target: "a", lifecycle: { endOfLife: "2027-01-01" } },
      { source: "a", target: "c" },
    ];
    expect(viewTransitions(scope, edges, { center: "c" }).cards).toEqual([]);
  });

  it("counts a link starting or ending between two cards that both stay as a connection", () => {
    const scope = [card("c"), card("a"), card("b")];
    const edges: ViewEdge[] = [
      { source: "c", target: "a" },
      { source: "c", target: "b" },
      { source: "a", target: "b", lifecycle: { active: "2027-01-01", endOfLife: "2029-01-01" } },
    ];
    const v = viewTransitions(scope, edges, { center: "c" });
    expect(v.cards).toEqual([]);
    expect(v.links).toEqual([{ active: "2027-01-01", endOfLife: "2029-01-01" }]);
  });

  it("drops a link date that moves a card, and a link whose card is not in the view", () => {
    const scope = [card("c"), card("a"), card("b", { active: "2028-01-01" })];
    const edges: ViewEdge[] = [
      { source: "c", target: "a", lifecycle: { active: "2027-01-01" } },
      { source: "c", target: "b" },
      { source: "a", target: "b", lifecycle: { active: "2026-01-01", endOfLife: "2027-01-01" } },
      { source: "a", target: "b", lifecycle: { active: "2030-01-01", endOfLife: "2025-01-01" } },
    ];
    const v = viewTransitions(scope, edges, { center: "c" });
    // a arrives with its relation in 2027; b goes live in 2028.
    expect(v.cards).toEqual([
      { id: "b", name: "B", lifecycle: { active: "2028-01-01" } },
      { id: "a", name: "A", lifecycle: { active: "2027-01-01" } },
    ]);
    // The a–b link: in 2026 a is not in the view; in 2027 b is not yet live.
    expect(v.links).toEqual([]);
  });

  it("follows the expansions: a card reached through an expanded card arrives with it", () => {
    const scope = [card("c"), card("a"), card("x")];
    const edges: ViewEdge[] = [
      { source: "c", target: "a", lifecycle: { active: "2027-01-01" } },
      { source: "a", target: "x" },
    ];
    expect(viewTransitions(scope, edges, { center: "c", expanded: ["a"] }).cards).toEqual([
      { id: "a", name: "A", lifecycle: { active: "2027-01-01" } },
      { id: "x", name: "X", lifecycle: { active: "2027-01-01" } },
    ]);
  });
});

describe("viewMovesBetween", () => {
  it("collects arrivals and departures inside the span, inclusive, with their dates", () => {
    const cards = [
      { id: "a", name: "A", lifecycle: { active: "2027-01-01" } },
      { id: "b", name: "B", lifecycle: { endOfLife: "2027-01-02" } },
      { id: "c", name: "C", lifecycle: { active: "2027-01-03" } },
      { id: "d", name: "D", lifecycle: { endOfLife: "2026-12-31" } },
      { id: "e", name: "E", lifecycle: { endOfLife: "2027-01-03" } },
      { id: "f", name: "F", lifecycle: { active: "2026-12-31" } },
      { id: "g", name: "G" },
    ];
    const m = viewMovesBetween(cards, ms("2027-01-01"), ms("2027-01-02"));
    expect([...m.arriving]).toEqual([["a", ms("2027-01-01")]]);
    expect([...m.leaving]).toEqual([["b", ms("2027-01-02")]]);
  });
});

describe("treeChildReach", () => {
  const paths = (over: Partial<TreePaths> = {}): TreePaths => ({
    at: () => undefined,
    today: null,
    visibility: SHOW_NONE,
    forceShown: new Set(),
    dateMs: 0,
    todayMs: 0,
    ...over,
  });
  const root = { at: IN_EFFECT, today: IN_EFFECT };

  it("passes the parent's state on unchanged without paths", () => {
    expect(treeChildReach(null, root, "c", "a")).toBe(root);
  });

  it("lowers the child to the relation between the two, at the date and today", () => {
    const r = treeChildReach(
      paths({ at: () => ENDED, today: () => PLANNED, visibility: SHOW_ALL }),
      root,
      "c",
      "a",
    );
    expect(r).toEqual({ at: ENDED, today: PLANNED });
  });

  it("reads an undated pair as in effect, and keeps no today without one", () => {
    expect(treeChildReach(paths({ today: () => undefined }), root, "c", "a")).toEqual({
      at: IN_EFFECT,
      today: IN_EFFECT,
    });
    expect(treeChildReach(paths({ today: () => PLANNED }), { at: IN_EFFECT, today: null }, "c", "a")).toEqual({
      at: IN_EFFECT,
      today: null,
    });
  });

  it("draws a child its visibility hides only when the spotlight forces it", () => {
    const hidden = paths({ at: () => PLANNED });
    expect(treeChildReach(hidden, root, "c", "a")).toBeNull();
    expect(
      treeChildReach({ ...hidden, forceShown: new Set(["a"]) }, root, "c", "a"),
    ).toEqual({ at: PLANNED, today: IN_EFFECT });
  });
});

describe("viewScopeFor", () => {
  const scope = [
    { id: "c", name: "C" },
    { id: "a", name: "A" },
  ];
  const edges: ViewEdge[] = [
    { source: "c", target: "a", lifecycle: { active: "2027-01-01" } },
    { source: "a", target: "out", lifecycle: { active: "2028-01-01" } },
    { source: "out", target: "c", lifecycle: { active: "2029-01-01" } },
  ];

  it("without a centre: the scope, and the relations with both ends in it", () => {
    const v = viewScopeFor(scope, edges, null);
    expect(v.cards).toEqual(scope);
    expect(v.links).toEqual([{ active: "2027-01-01" }]);
  });

  it("with a centre: the cards entering and leaving the view", () => {
    const hops = { center: "c" };
    expect(viewScopeFor(scope, edges, hops)).toEqual(viewTransitions(scope, edges, hops));
  });
});

describe("viewHopsFor", () => {
  const base = {
    view: "chart",
    chartMode: "c4",
    center: "c",
    ldvExpanded: ["x"],
    placed: ["p"],
    treeExpanded: ["c:a", "c:a:b"],
  };

  it("is null without a centred chart", () => {
    expect(viewHopsFor({ ...base, view: "table" })).toBeNull();
    expect(viewHopsFor({ ...base, center: null })).toBeNull();
  });

  it("follows the Layered Dependency View's expansions and reveals", () => {
    expect(viewHopsFor(base)).toEqual({ center: "c", expanded: ["x"], placed: ["p"] });
  });

  it("follows the tree's expanded instances, by card", () => {
    expect(viewHopsFor({ ...base, chartMode: "tree" })).toEqual({ center: "c", expanded: ["a", "b"] });
  });
});
