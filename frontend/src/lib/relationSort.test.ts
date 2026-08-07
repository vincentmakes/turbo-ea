import { describe, it, expect } from "vitest";
import type { Relation } from "@/types";
import { otherEnd, sortRelationsByName } from "./relationSort";

const FS = "fs-1";

/** Outgoing relation: the card under view is the source. */
function outgoing(id: string, name: string): Relation {
  return {
    id,
    type: "app_to_org",
    source_id: FS,
    target_id: `t-${id}`,
    source: { id: FS, type: "Application", name: "Self" },
    target: { id: `t-${id}`, type: "Organization", name },
  };
}

/** Incoming relation: the card under view is the target. */
function incoming(id: string, name: string): Relation {
  return {
    id,
    type: "app_to_org",
    source_id: `s-${id}`,
    target_id: FS,
    source: { id: `s-${id}`, type: "Organization", name },
    target: { id: FS, type: "Application", name: "Self" },
  };
}

describe("otherEnd", () => {
  it("returns the target for an outgoing relation", () => {
    expect(otherEnd(outgoing("a", "Finance"), FS)?.name).toBe("Finance");
  });

  it("returns the source for an incoming relation", () => {
    expect(otherEnd(incoming("a", "Legal"), FS)?.name).toBe("Legal");
  });

  it("resolves a self-referencing relation type per row, not per type", () => {
    // Both ends are the same card type, so a static "am I the source type"
    // flag would resolve every row to the target and mislabel incoming rows.
    const selfRef: Relation = {
      id: "s1",
      type: "app_to_app",
      source_id: "other-app",
      target_id: FS,
      source: { id: "other-app", type: "Application", name: "Upstream" },
      target: { id: FS, type: "Application", name: "Self" },
    };
    expect(otherEnd(selfRef, FS)?.name).toBe("Upstream");
  });
});

describe("sortRelationsByName", () => {
  it("sorts alphabetically by the other card's name", () => {
    const sorted = sortRelationsByName(
      [outgoing("1", "Zeta"), outgoing("2", "Alpha"), outgoing("3", "Mid")],
      FS,
    );
    expect(sorted.map((r) => r.target?.name)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("is case-insensitive", () => {
    const sorted = sortRelationsByName(
      [outgoing("1", "zebra"), outgoing("2", "Apple"), outgoing("3", "Banana")],
      FS,
    );
    expect(sorted.map((r) => r.target?.name)).toEqual(["Apple", "Banana", "zebra"]);
  });

  it("sorts a mix of incoming and outgoing relations by the far end", () => {
    const sorted = sortRelationsByName(
      [outgoing("1", "Zeta"), incoming("2", "Alpha"), outgoing("3", "Mid")],
      FS,
    );
    expect(sorted.map((r) => otherEnd(r, FS)?.name)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("sorts a self-referencing type by the far end in both directions", () => {
    const rels: Relation[] = [
      {
        id: "1",
        type: "app_to_app",
        source_id: FS,
        target_id: "b",
        target: { id: "b", type: "Application", name: "Zeta App" },
      },
      {
        id: "2",
        type: "app_to_app",
        source_id: "a",
        target_id: FS,
        source: { id: "a", type: "Application", name: "Alpha App" },
      },
    ];
    expect(sortRelationsByName(rels, FS).map((r) => otherEnd(r, FS)?.name)).toEqual([
      "Alpha App",
      "Zeta App",
    ]);
  });

  it("tolerates a missing card ref without throwing", () => {
    const orphan: Relation = { id: "x", type: "app_to_org", source_id: FS, target_id: "gone" };
    const sorted = sortRelationsByName([outgoing("1", "Alpha"), orphan], FS);
    // The nameless row sorts first and, crucially, nothing throws.
    expect(sorted.map((r) => r.id)).toEqual(["x", "1"]);
  });

  it("does not mutate the input array", () => {
    const rels = [outgoing("1", "Zeta"), outgoing("2", "Alpha")];
    sortRelationsByName(rels, FS);
    expect(rels.map((r) => r.target?.name)).toEqual(["Zeta", "Alpha"]);
  });
});
