import { describe, expect, it } from "vitest";
import { distinctTotal, isAttribution, sharedSourceCounts, splitShare } from "./costAttribution";

describe("isAttribution", () => {
  it("accepts full and split", () => {
    expect(isAttribution("full")).toBe(true);
    expect(isAttribution("split")).toBe(true);
  });

  it("rejects anything else", () => {
    for (const v of ["Full", "SPLIT", "", "both", null, undefined, 1, {}]) {
      expect(isAttribution(v)).toBe(false);
    }
  });
});

describe("sharedSourceCounts", () => {
  it("counts, per item, the sources another item carries too", () => {
    const counts = sharedSourceCounts([
      { id: "a", cost: 60, source_ids: ["i1", "i2"] },
      { id: "b", cost: 50, source_ids: ["i1"] },
      { id: "c", cost: 10, source_ids: ["i3"] },
    ]);
    expect([...counts.entries()]).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("counts every shared source of an item", () => {
    const counts = sharedSourceCounts([
      { id: "a", cost: 0, source_ids: ["i1", "i2", "i3"] },
      { id: "b", cost: 0, source_ids: ["i1", "i2"] },
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(2);
  });

  it("does not count a source listed twice on one item as shared", () => {
    expect(sharedSourceCounts([{ id: "a", cost: 0, source_ids: ["i1", "i1"] }]).size).toBe(0);
  });

  it("leaves out items without sources", () => {
    expect(
      sharedSourceCounts([
        { id: "a", cost: 5 },
        { id: "b", cost: 5, source_ids: [] },
      ]).size,
    ).toBe(0);
  });
});

describe("distinctTotal", () => {
  it("counts a shared source once", () => {
    expect(
      distinctTotal(
        [
          { id: "a", cost: 50, source_ids: ["i1"] },
          { id: "b", cost: 50, source_ids: ["i1"] },
          { id: "c", cost: 10, source_ids: ["i2"] },
        ],
        { i1: 50, i2: 10 },
      ),
    ).toBe(60);
  });

  it("adds an item's own cost when it names no sources", () => {
    expect(
      distinctTotal(
        [
          { id: "a", cost: 7 },
          { id: "b", cost: 50, source_ids: ["i1"] },
        ],
        { i1: 50 },
      ),
    ).toBe(57);
  });

  it("prices a source the server did not price at zero", () => {
    expect(distinctTotal([{ id: "a", cost: 50, source_ids: ["i1", "i9"] }], { i1: 50 })).toBe(50);
  });

  it("prices every source at zero without source costs", () => {
    expect(distinctTotal([{ id: "a", cost: 50, source_ids: ["i1"] }, { id: "b", cost: 3 }])).toBe(3);
  });

  it("totals nothing for no items", () => {
    expect(distinctTotal([], { i1: 50 })).toBe(0);
  });
});

describe("splitShare", () => {
  it("gives the part of the cost inside the set", () => {
    expect(splitShare(300, 1, 2)).toBe(150);
    expect(splitShare(300, 2, 3)).toBe(200);
    expect(splitShare(300, 0, 2)).toBe(0);
  });

  it("keeps the whole cost when there is nothing to split between", () => {
    expect(splitShare(300, 0, 0)).toBe(300);
    expect(splitShare(300, 1, -1)).toBe(300);
  });
});
