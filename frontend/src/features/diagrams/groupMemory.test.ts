import { describe, expect, it } from "vitest";
import type { ChildLayout, ExpandChildData } from "./drawio-shapes";
import { applyMemory, hasDeletions, recordCollapse, recordExpansion } from "./groupMemory";
import type { GroupMemory } from "./groupMemory";

const child = (id: string, extra: Partial<ExpandChildData> = {}): ExpandChildData => ({
  id,
  name: id.toUpperCase(),
  type: "Application",
  color: "#0f7eb5",
  relationType: "rel",
  relationId: `r-${id}`,
  ...extra,
});

const layout = (x: number): ChildLayout => ({
  x,
  y: 10,
  width: 180,
  height: 50,
  style: `fillColor=#${x}`,
  detail: [],
});

const live = (
  cardIds: string[],
  relationIds: string[],
  layouts: [string, ChildLayout][] = [],
) => ({ cardIds: new Set(cardIds), relationIds: new Set(relationIds), layouts: new Map(layouts) });

const memory = (m: Partial<GroupMemory> = {}): GroupMemory => ({
  drawn: [],
  deletedCardIds: new Set(),
  deletedRelationIds: new Set(),
  layouts: new Map(),
  ...m,
});

describe("recordExpansion", () => {
  it("starts an empty memory for a group expanded for the first time", () => {
    const a = child("a");
    expect(recordExpansion(undefined, [a])).toEqual(memory({ drawn: [a] }));
  });

  it("replaces what was drawn but keeps what earlier collapses learned", () => {
    const prev = memory({
      drawn: [child("a"), child("b")],
      deletedCardIds: new Set(["b"]),
      deletedRelationIds: new Set(["r-x"]),
      layouts: new Map([["a", layout(500)]]),
    });
    const c = child("c");
    expect(recordExpansion(prev, [c])).toEqual(
      memory({
        drawn: [c],
        deletedCardIds: new Set(["b"]),
        deletedRelationIds: new Set(["r-x"]),
        layouts: new Map([["a", layout(500)]]),
      }),
    );
  });

  it("does not share its sets with the memory it was built from", () => {
    const prev = memory({ deletedCardIds: new Set(["b"]) });
    const next = recordExpansion(prev, []);
    next.deletedCardIds.add("z");
    next.deletedRelationIds.add("r-z");
    next.layouts.set("z", layout(1));
    expect(prev).toEqual(memory({ deletedCardIds: new Set(["b"]) }));
  });
});

describe("recordCollapse", () => {
  it("remembers the cards and relations removed while the group was expanded", () => {
    const a = child("a");
    const b = child("b");
    const prev = recordExpansion(undefined, [a, b]);
    expect(recordCollapse(prev, live(["a"], ["r-a"]))).toEqual(
      memory({ drawn: [a, b], deletedCardIds: new Set(["b"]), deletedRelationIds: new Set(["r-b"]) }),
    );
  });

  it("remembers an extra relation removed from a child that is still connected", () => {
    const b = child("b", {
      relationId: "r1",
      extraRelations: [{ relationType: "rel2", relationId: "r2" }],
    });
    const prev = recordExpansion(undefined, [b]);
    expect(recordCollapse(prev, live(["b"], ["r1"]))).toEqual(
      memory({ drawn: [b], deletedRelationIds: new Set(["r2"]) }),
    );
  });

  it("never records a relation that was never persisted", () => {
    const n = child("n", { relationId: undefined, extraRelations: [{ relationType: "rel2" }] });
    const prev = recordExpansion(undefined, [n]);
    expect(recordCollapse(prev, live([], []))).toEqual(
      memory({ drawn: [n], deletedCardIds: new Set(["n"]) }),
    );
  });

  it("adds to what earlier collapses removed", () => {
    const a = child("a");
    const prev = memory({
      drawn: [a],
      deletedCardIds: new Set(["old"]),
      deletedRelationIds: new Set(["r-old"]),
    });
    expect(recordCollapse(prev, live([], []))).toEqual(
      memory({
        drawn: [a],
        deletedCardIds: new Set(["old", "a"]),
        deletedRelationIds: new Set(["r-old", "r-a"]),
      }),
    );
  });

  it("records layouts and no deletions for a group it never drew", () => {
    expect(recordCollapse(undefined, live(["a"], ["r-a"], [["a", layout(500)]]))).toEqual(
      memory({ layouts: new Map([["a", layout(500)]]) }),
    );
  });

  it("lets a later collapse overwrite a card's layout and keeps the others", () => {
    const prev = memory({ layouts: new Map([["a", layout(1)], ["b", layout(2)]]) });
    expect(recordCollapse(prev, live([], [], [["a", layout(3)]]))).toEqual(
      memory({ layouts: new Map([["a", layout(3)], ["b", layout(2)]]) }),
    );
  });
});

describe("applyMemory", () => {
  it("returns the very same array when the group has no memory", () => {
    const children = [child("a")];
    expect(applyMemory(children, undefined)).toBe(children);
  });

  it("hides a removed card from any later subset, in order", () => {
    const [a, b, c] = [child("a"), child("b"), child("c")];
    const mem = recordCollapse(recordExpansion(undefined, [a, b]), live(["a"], ["r-a"]));
    expect(applyMemory([a, b], mem)).toEqual([a]);
    expect(applyMemory([b, c], mem)).toEqual([c]);
    expect(applyMemory([c, a], mem)).toEqual([c, a]);
  });

  it("keeps only the surviving relation of a child that lost one", () => {
    const b = child("b", {
      relationId: "r1",
      extraRelations: [{ relationType: "rel2", relationId: "r2" }],
    });
    const mem = recordCollapse(recordExpansion(undefined, [b]), live(["b"], ["r1"]));
    const [shown] = applyMemory([b], mem);
    expect(shown).toEqual({ ...b, extraRelations: undefined });
    expect(shown.extraRelations ?? []).toEqual([]);
  });

  it("drops a child once every relation it had is gone, keeps one that has none", () => {
    const b = child("b", {
      relationId: "r1",
      extraRelations: [{ relationType: "rel2", relationId: "r2" }],
    });
    const n = child("n", { relationId: undefined });
    // b is still drawn but both its edges are gone; n never had a relation id.
    const mem = recordCollapse(recordExpansion(undefined, [b, n]), live(["b", "n"], []));
    expect(applyMemory([b, n], mem)).toEqual([n]);
  });

  it("puts each child back where the user left it, by card id", () => {
    const [a, b] = [child("a"), child("b")];
    const mem = recordCollapse(
      recordExpansion(undefined, [a, b]),
      live(["a", "b"], ["r-a", "r-b"], [["b", layout(500)]]),
    );
    expect(applyMemory([a, b], mem)).toEqual([a, { ...b, layout: layout(500) }]);
    expect(applyMemory([a, b], mem)[0].layout).toBeUndefined();
  });

  it("does not modify the children it was given", () => {
    const b = child("b");
    const mem = memory({ layouts: new Map([["b", layout(500)]]) });
    applyMemory([b], mem);
    expect(b).toEqual(child("b"));
  });
});

describe("hasDeletions", () => {
  it.each([
    ["no memory", undefined, false],
    ["nothing removed", memory({ layouts: new Map([["a", layout(1)]]) }), false],
    ["a removed card", memory({ deletedCardIds: new Set(["a"]) }), true],
    ["a removed relation", memory({ deletedRelationIds: new Set(["r"]) }), true],
  ])("%s → %s", (_name, mem, expected) => {
    expect(hasDeletions(mem)).toBe(expected);
  });
});
