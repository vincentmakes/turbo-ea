import { describe, it, expect } from "vitest";
import { makeCard } from "@/test/fixtures/metamodel";
import type { InitiativeTreeNode } from "./useInitiativeData";
import { treeKeyAction, visibleTreeRows } from "./treeKeys";

const key = (k: string, shiftKey = false) => ({ key: k, shiftKey });
const leaf = { hasChildren: false, expanded: false };
const open = { hasChildren: true, expanded: true };
const closed = { hasChildren: true, expanded: false };

describe("treeKeyAction", () => {
  it("selects on Enter and Space, on any row", () => {
    for (const item of [leaf, open, closed]) {
      expect(treeKeyAction(key("Enter"), item)).toBe("select");
      expect(treeKeyAction(key(" "), item)).toBe("select");
    }
  });

  it("moves with the arrows, Home and End", () => {
    expect(treeKeyAction(key("ArrowDown"), leaf)).toBe("next");
    expect(treeKeyAction(key("ArrowUp"), leaf)).toBe("prev");
    expect(treeKeyAction(key("Home"), leaf)).toBe("first");
    expect(treeKeyAction(key("End"), leaf)).toBe("last");
  });

  it("expands a closed parent with Right, and steps into an open one", () => {
    expect(treeKeyAction(key("ArrowRight"), closed)).toBe("expand");
    expect(treeKeyAction(key("ArrowRight"), open)).toBe("next");
    expect(treeKeyAction(key("ArrowRight"), leaf)).toBeNull();
  });

  it("collapses an open parent with Left, and goes to the parent otherwise", () => {
    expect(treeKeyAction(key("ArrowLeft"), open)).toBe("collapse");
    expect(treeKeyAction(key("ArrowLeft"), closed)).toBe("parent");
    expect(treeKeyAction(key("ArrowLeft"), leaf)).toBe("parent");
  });

  it("marks a favourite with Shift+F only", () => {
    expect(treeKeyAction(key("F", true), leaf)).toBe("favourite");
    expect(treeKeyAction(key("f", true), leaf)).toBe("favourite");
    expect(treeKeyAction(key("f"), leaf)).toBeNull();
    expect(treeKeyAction(key("F"), leaf)).toBeNull();
  });

  it("asks nothing of other keys", () => {
    expect(treeKeyAction(key("a"), open)).toBeNull();
    expect(treeKeyAction(key("Tab"), open)).toBeNull();
    expect(treeKeyAction(key("Escape"), leaf)).toBeNull();
  });
});

function node(id: string, children: InitiativeTreeNode[] = [], level = 0): InitiativeTreeNode {
  return {
    initiative: makeCard({ id, type: "Initiative", name: id }),
    children,
    level,
    diagrams: [],
    soaws: [],
    adrs: [],
  };
}

/**
 *  a
 *   ├─ a1
 *   │   └─ a1x
 *   └─ a2
 *  b
 */
const TREE = [node("a", [node("a1", [node("a1x", [], 2)], 1), node("a2", [], 1)]), node("b")];

describe("visibleTreeRows", () => {
  it("walks depth-first with each row's parent as rendered", () => {
    expect(visibleTreeRows(TREE, new Set(), null)).toEqual([
      { id: "a", parentId: null },
      { id: "a1", parentId: "a" },
      { id: "a1x", parentId: "a1" },
      { id: "a2", parentId: "a" },
      { id: "b", parentId: null },
    ]);
  });

  it("skips everything beneath a collapsed branch, however deep", () => {
    expect(visibleTreeRows(TREE, new Set(["a1"]), null).map((r) => r.id)).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
    expect(visibleTreeRows(TREE, new Set(["a"]), null).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("puts the unlinked row first, at the top level, when it is shown", () => {
    expect(visibleTreeRows(TREE, new Set(), "__unlinked__")[0]).toEqual({
      id: "__unlinked__",
      parentId: null,
    });
    expect(visibleTreeRows(TREE, new Set(), "__unlinked__")).toHaveLength(6);
  });
});
