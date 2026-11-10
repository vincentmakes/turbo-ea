import { describe, expect, it } from "vitest";
import type { CardQuery, CardQuerySet } from "@/types";
import {
  MAX_QUERY_HOPS,
  MAX_QUERY_LINES,
  addLine,
  canAddHop,
  canAddLine,
  fromGroups,
  groupsOf,
  hopTotal,
  isSetLevelProblem,
  lineCount,
  linesOf,
  matchKeyAt,
  matchNodes,
  pickedCardIdsOf,
  pruneViaKeys,
  removeLine,
  sameTypeSet,
  sendableQuerySet,
  setProblem,
  startTypes,
  startFiltersOnEol,
  updateLine,
} from "./querySet";

const APP: CardQuery = {
  type: "Application",
  where: { lifecycle_phase: ["active"] },
  related: [{ relation: "relAppToITC", type: "ITComponent" }],
};
const APP2: CardQuery = {
  type: "Application",
  related: [{ relation: "relInitiativeToApp", type: "Initiative" }],
};
const ORG: CardQuery = {
  type: "Organization",
  related: [{ relation: "relOrgToApp", type: "Application" }],
};
/** The plan's mockup: an Application group with an AND line, OR an Organization line. */
const STACK: CardQuerySet = { any_of: [{ all_of: [APP, APP2] }, ORG] };

describe("caps", () => {
  it("are 6 lines and 12 relations", () => {
    expect(MAX_QUERY_LINES).toBe(6);
    expect(MAX_QUERY_HOPS).toBe(12);
  });
});

describe("groupsOf", () => {
  it("reads a plain query as one group of one line", () => {
    expect(groupsOf(APP)).toEqual([[APP]]);
  });

  it("reads an AND group as one group of its lines", () => {
    expect(groupsOf({ all_of: [APP, APP2] })).toEqual([[APP, APP2]]);
  });

  it("reads an OR as its groups, a plain group as one line", () => {
    expect(groupsOf(STACK)).toEqual([[APP, APP2], [ORG]]);
  });

  it("hands back copies: changing them leaves the set alone", () => {
    const set: CardQuerySet = { all_of: [APP, APP2] };
    groupsOf(set)[0].push(ORG);
    expect(set).toEqual({ all_of: [APP, APP2] });
    const any: CardQuerySet = { any_of: [{ all_of: [APP, APP2] }, ORG] };
    groupsOf(any)[0].push(ORG);
    expect(any).toEqual(STACK);
  });
});

describe("fromGroups", () => {
  it("normalises one group of one line to the plain query", () => {
    expect(fromGroups([[APP]])).toEqual(APP);
  });

  it("makes one group of several lines an all_of", () => {
    expect(fromGroups([[APP, APP2]])).toEqual({ all_of: [APP, APP2] });
  });

  it("makes several groups an any_of, a group of one line plain inside it", () => {
    expect(fromGroups([[APP, APP2], [ORG]])).toEqual(STACK);
    expect(fromGroups([[APP], [ORG]])).toEqual({ any_of: [APP, ORG] });
  });

  it("drops empty groups, and is an empty line when nothing is left", () => {
    expect(fromGroups([[], [ORG], []])).toEqual(ORG);
    expect(fromGroups([])).toEqual({ type: "" });
    expect(fromGroups([[]])).toEqual({ type: "" });
  });

  it("round-trips groupsOf", () => {
    expect(fromGroups(groupsOf(STACK))).toEqual(STACK);
    expect(fromGroups(groupsOf(APP))).toEqual(APP);
  });
});

describe("linesOf", () => {
  it("names a plain query's one line with no connective", () => {
    expect(linesOf(APP)).toEqual([
      { group: 0, line: 0, query: APP, connective: null, fixedType: false, typeLocked: false },
    ]);
  });

  it("places every line, AND inside a group and OR at a new group", () => {
    expect(linesOf(STACK)).toEqual([
      { group: 0, line: 0, query: APP, connective: null, fixedType: false, typeLocked: true },
      { group: 0, line: 1, query: APP2, connective: "and", fixedType: true, typeLocked: false },
      { group: 1, line: 0, query: ORG, connective: "or", fixedType: false, typeLocked: false },
    ]);
  });
});

describe("startTypes", () => {
  it("lists the distinct start types in reading order", () => {
    expect(startTypes(STACK)).toEqual(["Application", "Organization"]);
    expect(startTypes({ any_of: [ORG, APP, APP2] })).toEqual(["Organization", "Application"]);
  });

  it("leaves an untyped line out", () => {
    expect(startTypes({ any_of: [{ type: "" }, ORG] })).toEqual(["Organization"]);
    expect(startTypes({ type: "" })).toEqual([]);
  });
});

describe("sameTypeSet", () => {
  it("compares two type lists in any order", () => {
    expect(sameTypeSet(["A", "B"], ["B", "A"])).toBe(true);
    expect(sameTypeSet(["A"], ["A"])).toBe(true);
    expect(sameTypeSet([], [])).toBe(true);
    expect(sameTypeSet(["A"], ["A", "B"])).toBe(false);
    expect(sameTypeSet(["A", "B"], ["A"])).toBe(false);
    expect(sameTypeSet(["A", "C"], ["A", "B"])).toBe(false);
  });
});

describe("lineCount / hopTotal", () => {
  it("counts the lines", () => {
    expect(lineCount(APP)).toBe(1);
    expect(lineCount(STACK)).toBe(3);
  });

  it("counts every hop of every line, nested and branch hops included", () => {
    expect(hopTotal({ type: "Application" })).toBe(0);
    expect(hopTotal(STACK)).toBe(3);
    const deep: CardQuery = {
      type: "Organization",
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          related: [{ relation: "relAppToITC", type: "ITComponent" }],
        },
        { relation: "relOrgToInit", type: "Initiative" },
      ],
    };
    expect(hopTotal(deep)).toBe(3);
    expect(hopTotal({ any_of: [deep, APP] })).toBe(4);
  });
});

/** `n` lines of one start type, `hops` relations on the first. */
function lines(n: number, hops = 0): CardQuerySet {
  const first: CardQuery = {
    type: "Application",
    related: Array.from({ length: hops }, () => ({ relation: "r", type: "ITComponent" })),
  };
  const rest = Array.from({ length: n - 1 }, () => ({ type: "Application" }));
  return fromGroups([[first, ...rest]]);
}

describe("canAddLine / canAddHop", () => {
  it("allows a line below 6 lines and refuses one at 6", () => {
    expect(canAddLine(lines(5))).toBe(true);
    expect(canAddLine(lines(6))).toBe(false);
  });

  it("allows a relation below 12 relations and refuses one at 12", () => {
    expect(canAddHop(lines(1, 11))).toBe(true);
    expect(canAddHop(lines(1, 12))).toBe(false);
  });
});

describe("addLine", () => {
  it("AND appends a line seeded with the group's card type", () => {
    expect(addLine(APP, 0, "and")).toEqual({ all_of: [APP, { type: "Application" }] });
    expect(addLine(STACK, 1, "and")).toEqual({
      any_of: [{ all_of: [APP, APP2] }, { all_of: [ORG, { type: "Organization" }] }],
    });
  });

  it("AND is a no-op while the group has no type yet", () => {
    const untyped: CardQuerySet = { type: "" };
    expect(addLine(untyped, 0, "and")).toBe(untyped);
  });

  it("OR inserts a new group with an empty line right after its group", () => {
    expect(addLine(APP, 0, "or")).toEqual({ any_of: [APP, { type: "" }] });
    expect(addLine(STACK, 0, "or")).toEqual({
      any_of: [{ all_of: [APP, APP2] }, { type: "" }, ORG],
    });
    expect(addLine(STACK, 1, "or")).toEqual({
      any_of: [{ all_of: [APP, APP2] }, ORG, { type: "" }],
    });
  });

  it("is a no-op at the line cap or for a group that does not exist", () => {
    const full = lines(6);
    expect(addLine(full, 0, "or")).toBe(full);
    expect(addLine(full, 0, "and")).toBe(full);
    expect(addLine(APP, 1, "or")).toBe(APP);
    expect(addLine(APP, -1, "or")).toBe(APP);
  });

  it("still adds the sixth line", () => {
    expect(lineCount(addLine(lines(5), 0, "and"))).toBe(6);
  });
});

describe("removeLine", () => {
  it("removes an AND line, a group of one left plain", () => {
    expect(removeLine(STACK, 0, 1)).toEqual({ any_of: [APP, ORG] });
    expect(removeLine(STACK, 0, 0)).toEqual({ any_of: [APP2, ORG] });
  });

  it("removes a group with its last line", () => {
    expect(removeLine(STACK, 1, 0)).toEqual({ all_of: [APP, APP2] });
    expect(removeLine({ any_of: [APP, ORG] }, 0, 0)).toEqual(ORG);
  });

  it("is a no-op for a line that does not exist", () => {
    expect(removeLine(STACK, 2, 0)).toBe(STACK);
    expect(removeLine(STACK, 1, 1)).toBe(STACK);
    expect(removeLine(STACK, 0, -1)).toBe(STACK);
  });
});

describe("updateLine", () => {
  it("replaces one line, every other one untouched", () => {
    const next: CardQuery = { type: "Application", where: { subtype: ["web"] } };
    expect(updateLine(STACK, 0, 1, next)).toEqual({ any_of: [{ all_of: [APP, next] }, ORG] });
    expect(updateLine(APP, 0, 0, next)).toEqual(next);
  });

  it("is a no-op for a line that does not exist", () => {
    expect(updateLine(STACK, 1, 1, APP)).toBe(STACK);
    expect(updateLine(STACK, 3, 0, APP)).toBe(STACK);
    expect(updateLine(STACK, 0, -1, APP)).toBe(STACK);
  });
});

describe("setProblem", () => {
  it("is null when every line can be saved", () => {
    expect(setProblem(STACK)).toBeNull();
  });

  it("refuses more than 6 lines, but not 6", () => {
    expect(setProblem(lines(6))).toBeNull();
    expect(setProblem({ all_of: Array.from({ length: 7 }, () => ({ type: "Application" })) })).toBe(
      "too_many_lines",
    );
  });

  it("refuses more than 12 relations, but not 12", () => {
    expect(setProblem(lines(1, 12))).toBeNull();
    expect(setProblem(lines(1, 13))).toBe("too_many_hops");
  });

  it("refuses an AND group whose lines start from different types", () => {
    expect(setProblem({ all_of: [APP, ORG] })).toBe("all_of_type_mismatch");
    expect(setProblem({ any_of: [ORG, { all_of: [APP, ORG] }] })).toBe("all_of_type_mismatch");
    // An untyped line differs from nothing: it is still being filled in.
    expect(setProblem({ all_of: [APP, { type: "" }] })).toBe("empty_type");
  });

  it("reports the set's own problem before a line's", () => {
    const seven = { all_of: [...Array.from({ length: 6 }, () => APP), { type: "" }] };
    expect(setProblem(seven)).toBe("too_many_lines");
    expect(setProblem({ any_of: [lines(1, 13) as CardQuery, { type: "" }] })).toBe("too_many_hops");
    expect(setProblem({ all_of: [APP, ORG, { type: "" }] })).toBe("all_of_type_mismatch");
  });

  it("is the first line's problem", () => {
    expect(setProblem({ any_of: [APP, { type: "" }] })).toBe("empty_type");
    expect(
      setProblem({ any_of: [{ type: "Application", where: { subtype: [] } }, { type: "" }] }),
    ).toBe("empty_values");
  });
});

describe("sendableQuerySet", () => {
  it("drops an untyped line and collapses to a plain query", () => {
    expect(sendableQuerySet({ any_of: [APP, { type: "" }] })).toEqual(APP);
  });

  it("leaves every condition still waiting for values out, per line", () => {
    expect(
      sendableQuerySet({
        all_of: [APP, { type: "Application", where: { subtype: [] } }],
      }),
    ).toEqual({ all_of: [APP, { type: "Application" }] });
  });

  it("keeps a whole stack as it is", () => {
    expect(sendableQuerySet(STACK)).toEqual(STACK);
  });

  it("is null when no line has a type", () => {
    expect(sendableQuerySet({ type: "" })).toBeNull();
    expect(sendableQuerySet({ any_of: [{ type: "" }, { type: "" }] })).toBeNull();
  });
});

describe("pickedCardIdsOf", () => {
  it("names every picked card of every line once, in reading order", () => {
    expect(
      pickedCardIdsOf({
        any_of: [
          { type: "Application", where: { cards: ["a", "b"] } },
          {
            type: "Organization",
            where: { cards: ["o"] },
            related: [{ relation: "r", type: "Application", where: { cards: ["b", "c"] } }],
          },
        ],
      }),
    ).toEqual(["a", "b", "o", "c"]);
    expect(pickedCardIdsOf(APP)).toEqual([]);
  });
});

describe("isSetLevelProblem", () => {
  it("is true only for a problem of the set as a whole", () => {
    expect(isSetLevelProblem("too_many_lines")).toBe(true);
    expect(isSetLevelProblem("too_many_hops")).toBe(true);
    expect(isSetLevelProblem("all_of_type_mismatch")).toBe(true);
    expect(isSetLevelProblem("empty_type")).toBe(false);
    expect(isSetLevelProblem("empty_values")).toBe(false);
    expect(isSetLevelProblem(null)).toBe(false);
  });
});

describe("startFiltersOnEol", () => {
  const eolApp: CardQuery = { type: "Application", where: { eol_status: ["eol"] } };

  it("is true when a line's start card filters on end-of-life status", () => {
    expect(startFiltersOnEol(eolApp)).toBe(true);
    expect(startFiltersOnEol({ any_of: [{ type: "Organization" }, eolApp] })).toBe(true);
    expect(startFiltersOnEol({ all_of: [{ type: "Application" }, eolApp] })).toBe(true);
  });

  it("is false for a condition on a hop, another condition, an empty list or no query", () => {
    const atHop: CardQuery = {
      type: "Organization",
      related: [{ relation: "r", type: "Application", where: { eol_status: ["eol"] } }],
    };
    expect(startFiltersOnEol(atHop)).toBe(false);
    expect(startFiltersOnEol({ type: "Application", where: { lifecycle_phase: ["active"] } })).toBe(false);
    expect(startFiltersOnEol({ type: "Application", where: { eol_status: [] } })).toBe(false);
    expect(startFiltersOnEol(null)).toBe(false);
    expect(startFiltersOnEol(undefined)).toBe(false);
  });
});

describe("matchNodes", () => {
  it("has no node for a missing query or a line without hops", () => {
    expect(matchNodes(null)).toEqual([]);
    expect(matchNodes(undefined)).toEqual([]);
    expect(matchNodes({ type: "Application" })).toEqual([]);
  });

  it("keys a plain chain's hops after the first card, nested ones dot-joined", () => {
    const q: CardQuery = {
      type: "Organization",
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          where: { lifecycle_phase: ["active"] },
          related: [{ relation: "relAppToITC", type: "ITComponent" }],
        },
      ],
    };
    expect(matchNodes(q)).toEqual([
      {
        key: "0:0",
        line: 0,
        type: "Application",
        relation: "relOrgToApp",
        startType: "Organization",
        path: [{ relation: "relOrgToApp", type: "Application" }],
        indices: [0],
      },
      {
        key: "0:0.0",
        line: 0,
        type: "ITComponent",
        relation: "relAppToITC",
        startType: "Organization",
        path: [
          { relation: "relOrgToApp", type: "Application" },
          { relation: "relAppToITC", type: "ITComponent" },
        ],
        indices: [0, 0],
      },
    ]);
  });

  it("numbers sibling hops by their place in `related`", () => {
    const q: CardQuery = {
      type: "Application",
      related: [
        {
          relation: "relAppToITC",
          type: "ITComponent",
          related: [
            { relation: "relProviderToITC", type: "Provider" },
            { relation: "relITCToTech", type: "TechCategory" },
          ],
        },
        { relation: "relAppToBC", type: "BusinessCapability" },
      ],
    };
    expect(matchNodes(q).map((n) => [n.key, n.type])).toEqual([
      ["0:0", "ITComponent"],
      ["0:0.0", "Provider"],
      ["0:0.1", "TechCategory"],
      ["0:1", "BusinessCapability"],
    ]);
  });

  it("leaves out a negated hop and everything below it, keeping later siblings' indices", () => {
    const q: CardQuery = {
      type: "Application",
      related: [
        {
          relation: "relAppToITC",
          type: "ITComponent",
          negate: true,
          related: [{ relation: "relProviderToITC", type: "Provider" }],
        },
        { relation: "relAppToBC", type: "BusinessCapability" },
      ],
    };
    expect(matchNodes(q).map((n) => n.key)).toEqual(["0:1"]);
  });

  it("numbers all_of lines in order", () => {
    expect(matchNodes({ all_of: [APP, APP2] }).map((n) => [n.key, n.line, n.type])).toEqual([
      ["0:0", 0, "ITComponent"],
      ["1:0", 1, "Initiative"],
    ]);
  });

  it("numbers any_of lines consecutively across groups", () => {
    expect(matchNodes(STACK).map((n) => [n.key, n.startType, n.type])).toEqual([
      ["0:0", "Application", "ITComponent"],
      ["1:0", "Application", "Initiative"],
      ["2:0", "Organization", "Application"],
    ]);
  });
});

describe("matchKeyAt", () => {
  const q: CardQuerySet = {
    any_of: [
      { type: "Application", related: [{ relation: "relAppToITC", type: "ITComponent" }] },
      {
        type: "Application",
        related: [
          {
            relation: "relAppToITC",
            type: "ITComponent",
            negate: true,
            related: [{ relation: "relProviderToITC", type: "Provider" }],
          },
          {
            relation: "relAppToITC",
            type: "ITComponent",
            related: [{ relation: "relProviderToITC", type: "Provider" }],
          },
        ],
      },
    ],
  };

  it("gives each node the key matchNodes gives it", () => {
    const keyAt = matchKeyAt(q);
    for (const node of matchNodes(q)) expect(keyAt(node.line, node.indices)).toBe(node.key);
    expect(keyAt(1, [1, 0])).toBe("1:1.0");
  });

  it("has none for a first card, a has-no hop, a hop below one or a missing place", () => {
    const keyAt = matchKeyAt(q);
    expect(keyAt(0, [])).toBeNull();
    expect(keyAt(1, [0])).toBeNull();
    expect(keyAt(1, [0, 0])).toBeNull();
    expect(keyAt(0, [1])).toBeNull();
    expect(keyAt(2, [0])).toBeNull();
    expect(matchKeyAt(null)(0, [0])).toBeNull();
  });
});

describe("pruneViaKeys", () => {
  const CHAIN: CardQuery = {
    type: "Organization",
    related: [
      {
        relation: "relOrgToApp",
        type: "Application",
        related: [{ relation: "relAppToITC", type: "ITComponent" }],
      },
    ],
  };

  it("keeps every key across a condition change, in order, without duplicates", () => {
    const next: CardQuery = {
      ...CHAIN,
      where: { subtype: ["unit"] },
      related: [{ ...CHAIN.related![0], where: { lifecycle_phase: ["endOfLife"] } }],
    };
    expect(pruneViaKeys(["0:0.0", "0:0", "0:0.0"], CHAIN, next)).toEqual(["0:0.0", "0:0"]);
  });

  it("drops the key of a removed step", () => {
    const next: CardQuery = { ...CHAIN, related: [{ relation: "relOrgToApp", type: "Application" }] };
    expect(pruneViaKeys(["0:0", "0:0.0"], CHAIN, next)).toEqual(["0:0"]);
  });

  it("drops a key whose step changed type or relation", () => {
    const retyped: CardQuery = {
      ...CHAIN,
      related: [
        {
          relation: "relOrgToApp",
          type: "Application",
          related: [{ relation: "relAppToITC", type: "Interface" }],
        },
      ],
    };
    expect(pruneViaKeys(["0:0", "0:0.0"], CHAIN, retyped)).toEqual(["0:0"]);
    const related: CardQuery = {
      ...CHAIN,
      related: [{ ...CHAIN.related![0], relation: "relOrgToAppOwns" }],
    };
    // The step above changed relation: both keys' chains differ now.
    expect(pruneViaKeys(["0:0", "0:0.0"], CHAIN, related)).toEqual([]);
  });

  it("drops a key whose line changed start type, or that is negated now", () => {
    expect(pruneViaKeys(["0:0"], CHAIN, { ...CHAIN, type: "Provider" })).toEqual([]);
    const negated: CardQuery = { ...CHAIN, related: [{ ...CHAIN.related![0], negate: true }] };
    expect(pruneViaKeys(["0:0", "0:0.0"], CHAIN, negated)).toEqual([]);
  });

  it("drops a key not in the previous query, and everything without one side", () => {
    expect(pruneViaKeys(["0:1"], CHAIN, CHAIN)).toEqual([]);
    expect(pruneViaKeys(["0:0"], null, CHAIN)).toEqual([]);
    expect(pruneViaKeys(["0:0"], CHAIN, null)).toEqual([]);
    expect(pruneViaKeys([], CHAIN, CHAIN)).toEqual([]);
  });
});
