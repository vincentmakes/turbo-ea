import { describe, expect, it } from "vitest";
import {
  buildDisplayRows,
  isExpanded,
  toggleId,
  type RelationLifecycleEntry,
  type RowItem,
} from "./lifecycleRows";

const entry = (related_id: string, over: Partial<RelationLifecycleEntry> = {}): RelationLifecycleEntry => ({
  relation_type: "relAppToITC",
  direction: "outgoing",
  related_id,
  related_name: related_id.toUpperCase(),
  related_type: "ITComponent",
  lifecycle: { active: "2030-01-01" },
  ...over,
});

const A: RowItem = { id: "a", relation_lifecycles: [entry("x"), entry("y", { direction: "incoming" })] };
const B: RowItem = { id: "b" };
const C: RowItem = { id: "c", relation_lifecycles: [] };
const D: RowItem = { id: "d", relation_lifecycles: [entry("z")] };

const verbOf = (e: RelationLifecycleEntry) => (e.direction === "incoming" ? "is run by" : "runs");
const opts = (over: Partial<Parameters<typeof buildDisplayRows>[1]> = {}) => ({
  enabled: true,
  expandAll: false,
  toggled: new Set<string>(),
  verbOf,
  ...over,
});

describe("isExpanded", () => {
  it("follows expand-all unless the card was toggled the other way", () => {
    expect(isExpanded("a", false, new Set())).toBe(false);
    expect(isExpanded("a", false, new Set(["a"]))).toBe(true);
    expect(isExpanded("a", true, new Set())).toBe(true);
    expect(isExpanded("a", true, new Set(["a"]))).toBe(false);
    expect(isExpanded("a", true, new Set(["b"]))).toBe(true);
  });
});

describe("toggleId", () => {
  it("adds a missing id at the end and removes a present one", () => {
    expect(toggleId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(toggleId([], "a")).toEqual(["a"]);
  });

  it("returns a new array", () => {
    const ids = ["a"];
    expect(toggleId(ids, "b")).not.toBe(ids);
    expect(ids).toEqual(["a"]);
  });
});

describe("buildDisplayRows", () => {
  it("lists collapsed cards with their relation counts and no relation rows", () => {
    const rows = buildDisplayRows([A, B, C], opts());
    expect(rows).toEqual([
      { kind: "card", key: "a", item: A, relationCount: 2, expanded: false },
      { kind: "card", key: "b", item: B, relationCount: 0, expanded: false },
      { kind: "card", key: "c", item: C, relationCount: 0, expanded: false },
    ]);
  });

  it("puts an expanded card's relations right beneath it, each with its side's verb", () => {
    const rows = buildDisplayRows([A, B], opts({ toggled: new Set(["a"]) }));
    expect(rows).toEqual([
      { kind: "card", key: "a", item: A, relationCount: 2, expanded: true },
      {
        kind: "relation",
        key: "a|relAppToITC|outgoing|x",
        parent: A,
        entry: A.relation_lifecycles![0],
        verb: "runs",
      },
      {
        kind: "relation",
        key: "a|relAppToITC|incoming|y",
        parent: A,
        entry: A.relation_lifecycles![1],
        verb: "is run by",
      },
      { kind: "card", key: "b", item: B, relationCount: 0, expanded: false },
    ]);
  });

  it("opens every card with expand-all except the toggled ones, never one without relations", () => {
    const rows = buildDisplayRows([A, B, C, D], opts({ expandAll: true, toggled: new Set(["d"]) }));
    expect(rows.map((r) => r.key)).toEqual([
      "a",
      "a|relAppToITC|outgoing|x",
      "a|relAppToITC|incoming|y",
      "b",
      "c",
      "d",
    ]);
    const flags = rows.filter((r) => r.kind === "card").map((r) => r.kind === "card" && r.expanded);
    expect(flags).toEqual([true, false, false, false]);
  });

  it("shows cards only, with no count, when relation rows are off", () => {
    const rows = buildDisplayRows([A, D], opts({ enabled: false, expandAll: true }));
    expect(rows).toEqual([
      { kind: "card", key: "a", item: A, relationCount: 0, expanded: false },
      { kind: "card", key: "d", item: D, relationCount: 0, expanded: false },
    ]);
  });
});
