import { describe, expect, it } from "vitest";
import {
  bestRankBySubtree,
  buildChildIndex,
  closureSize,
  dedupeScopeRoots,
  flattenTree,
  visibleForQuery,
  type TreeCard,
} from "@/lib/cardTree";

/**
 * A small three-level tree:
 *   Finance ─ Payments ─ Card payments
 *           └ Treasury
 *   People  ─ Payroll
 */
const CARDS: TreeCard[] = [
  { id: "fin", name: "Finance", type: "BusinessCapability", parent_id: null },
  { id: "pay", name: "Payments", type: "BusinessCapability", parent_id: "fin" },
  { id: "card", name: "Card payments", type: "BusinessCapability", parent_id: "pay" },
  { id: "tre", name: "Treasury", type: "BusinessCapability", parent_id: "fin" },
  { id: "ppl", name: "People", type: "BusinessCapability", parent_id: null },
  { id: "roll", name: "Payroll", type: "BusinessCapability", parent_id: "ppl" },
];

const byId = new Map(CARDS.map((c) => [c.id, c]));
const parentById = new Map(CARDS.map((c) => [c.id, c.parent_id ?? null]));
const byParent = buildChildIndex(byId);

describe("dedupeScopeRoots", () => {
  it("drops a pick already covered by an ancestor, whichever order they came in", () => {
    expect(dedupeScopeRoots(["fin", "card"], parentById)).toEqual(["fin"]);
    expect(dedupeScopeRoots(["card", "fin"], parentById)).toEqual(["fin"]);
  });

  it("keeps siblings and unrelated branches", () => {
    expect(dedupeScopeRoots(["pay", "tre", "ppl"], parentById)).toEqual(["pay", "tre", "ppl"]);
  });

  it("keeps an id whose parent chain is not in the map", () => {
    expect(dedupeScopeRoots(["ghost"], parentById)).toEqual(["ghost"]);
  });

  it("terminates on a parent cycle", () => {
    const cyclic = new Map([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(dedupeScopeRoots(["a"], cyclic)).toEqual(["a"]);
  });
});

describe("buildChildIndex", () => {
  it("files a card whose parent is outside the loaded set as a root", () => {
    const partial = new Map([["pay", byId.get("pay")!]]);
    expect(buildChildIndex(partial).get(null)?.map((c) => c.id)).toEqual(["pay"]);
  });

  it("sorts each level alphabetically", () => {
    expect(byParent.get("fin")?.map((c) => c.name)).toEqual(["Payments", "Treasury"]);
  });
});

describe("visibleForQuery", () => {
  it("returns null for an empty query", () => {
    expect(visibleForQuery(byId, "")).toBeNull();
  });

  it("keeps a match's ancestor chain so a deep hit is not orphaned", () => {
    const visible = visibleForQuery(byId, "Card payments");
    expect(visible).toEqual(new Set(["card", "pay", "fin"]));
  });
});

describe("bestRankBySubtree", () => {
  it("ranks a branch by the best match inside it, not by its own name", () => {
    const ranks = bestRankBySubtree(byId, byParent, "Card payments")!;
    // "Finance" doesn't match at all, but it holds the exact hit.
    expect(ranks.get("fin")).toBe(0);
    expect(ranks.get("ppl")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns null for an empty query", () => {
    expect(bestRankBySubtree(byId, byParent, "")).toBeNull();
  });
});

describe("flattenTree", () => {
  it("marks descendants of a pick as implied, not selected", () => {
    const rows = flattenTree({
      byParent,
      selectedIds: new Set(["fin"]),
      visibleSet: null,
      bestRank: null,
    });
    const map = new Map(rows.map((r) => [r.card.id, r]));
    expect(map.get("fin")!.selected).toBe(true);
    expect(map.get("pay")!.implied).toBe(true);
    expect(map.get("card")!.implied).toBe(true);
    expect(map.get("ppl")!.implied).toBe(false);
  });

  it("indents by depth", () => {
    const rows = flattenTree({
      byParent,
      selectedIds: new Set(),
      visibleSet: null,
      bestRank: null,
    });
    expect(rows.find((r) => r.card.id === "card")!.depth).toBe(2);
  });

  it("with impliedRows off, a descendant of a pick stays independently tickable", () => {
    const rows = flattenTree({
      byParent,
      selectedIds: new Set(["fin"]),
      visibleSet: null,
      bestRank: null,
      impliedRows: false,
    });
    expect(rows.every((r) => !r.implied)).toBe(true);
  });

  it("hides rows outside the visible set", () => {
    const rows = flattenTree({
      byParent,
      selectedIds: new Set(),
      visibleSet: visibleForQuery(byId, "Payroll"),
      bestRank: null,
    });
    expect(rows.map((r) => r.card.id)).toEqual(["ppl", "roll"]);
  });
});

describe("closureSize", () => {
  it("counts a root plus everything under it", () => {
    expect(closureSize(["fin"], byParent)).toBe(4);
  });

  it("never double-counts overlapping roots", () => {
    expect(closureSize(["fin", "pay"], byParent)).toBe(4);
  });

  it("counts an id with no children as itself", () => {
    expect(closureSize(["ghost"], byParent)).toBe(1);
  });

  it("is zero for an empty selection", () => {
    expect(closureSize([], byParent)).toBe(0);
  });
});
