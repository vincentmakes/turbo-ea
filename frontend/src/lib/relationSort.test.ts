import { describe, it, expect } from "vitest";
import type { Relation } from "@/types";
import {
  effectiveSideFlags,
  expandSides,
  onSide,
  orderRelationTypesByOtherEnd,
  otherEnd,
  parseSideKey,
  runsAgainstType,
  sideKey,
  sortRelationsByName,
  subtypeOptionalSides,
} from "./relationSort";

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

describe("orderRelationTypesByOtherEnd", () => {
  const rt = (key: string, source_type_key: string, target_type_key: string) => ({
    key,
    source_type_key,
    target_type_key,
  });

  it("pulls a second type on the same pair up next to the first", () => {
    const ordered = orderRelationTypesByOtherEnd(
      [
        rt("relOrgToApp", "Organization", "Application"),
        rt("relOrgToObj", "Organization", "Objective"),
        rt("relOrgToAppOwns", "Organization", "Application"),
      ],
      "Organization",
    );
    expect(ordered.map((r) => r.key)).toEqual([
      "relOrgToApp",
      "relOrgToAppOwns",
      "relOrgToObj",
    ]);
  });

  it("anchors each run on its FIRST appearance, so no run jumps ahead", () => {
    // relOrgToObj came first in the metamodel and stays first; only the
    // stragglers move, and only far enough to join their own run.
    const ordered = orderRelationTypesByOtherEnd(
      [
        rt("relOrgToObj", "Organization", "Objective"),
        rt("relOrgToApp", "Organization", "Application"),
        rt("relOrgToObj2", "Organization", "Objective"),
      ],
      "Organization",
    );
    expect(ordered.map((r) => r.key)).toEqual([
      "relOrgToObj",
      "relOrgToObj2",
      "relOrgToApp",
    ]);
  });

  it("groups an incoming type with an outgoing one on the same card type", () => {
    // Both describe the card's relationship to an Application, so they read
    // together whichever way the metamodel declared them.
    const ordered = orderRelationTypesByOtherEnd(
      [
        rt("relOrgToApp", "Organization", "Application"),
        rt("relOrgToObj", "Organization", "Objective"),
        rt("relAppToOrg", "Application", "Organization"),
      ],
      "Organization",
    );
    expect(ordered.map((r) => r.key)).toEqual([
      "relOrgToApp",
      "relAppToOrg",
      "relOrgToObj",
    ]);
  });

  it("keeps a self-referencing type in one run", () => {
    const ordered = orderRelationTypesByOtherEnd(
      [
        rt("relAppDependency", "Application", "Application"),
        rt("relAppToOrg", "Application", "Organization"),
        rt("relAppIntegration", "Application", "Application"),
      ],
      "Application",
    );
    expect(ordered.map((r) => r.key)).toEqual([
      "relAppDependency",
      "relAppIntegration",
      "relAppToOrg",
    ]);
  });

  it("leaves an already-contiguous list byte-for-byte alone", () => {
    const input = [
      rt("relOrgToApp", "Organization", "Application"),
      rt("relOrgToObj", "Organization", "Objective"),
    ];
    expect(orderRelationTypesByOtherEnd(input, "Organization").map((r) => r.key)).toEqual([
      "relOrgToApp",
      "relOrgToObj",
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(orderRelationTypesByOtherEnd([], "Organization")).toEqual([]);
  });
});

describe("expandSides", () => {
  const rt = (key: string, source_type_key: string, target_type_key: string) => ({
    key,
    source_type_key,
    target_type_key,
  });

  it("gives a cross-type rt one side, from the right end", () => {
    const out = rt("relOrgToApp", "Organization", "Application");
    expect(expandSides([out], "Organization")).toEqual([{ rt: out, isSource: true }]);
    expect(expandSides([out], "Application")).toEqual([{ rt: out, isSource: false }]);
  });

  it("gives a self-referencing rt two sides, outgoing first and adjacent", () => {
    const self = rt("orgToOrg", "Organization", "Organization");
    const other = rt("relOrgToApp", "Organization", "Application");
    expect(expandSides([self, other], "Organization")).toEqual([
      { rt: self, isSource: true },
      { rt: self, isSource: false },
      { rt: other, isSource: true },
    ]);
  });

  it("drops a type that touches neither end rather than guessing", () => {
    expect(expandSides([rt("x", "A", "B")], "C")).toEqual([]);
  });
});

describe("sideKey", () => {
  it("keeps a cross-type rt's bare key so persisted filters keep resolving", () => {
    const out = { key: "relOrgToApp", source_type_key: "Organization", target_type_key: "Application" };
    expect(sideKey(out, true)).toBe("relOrgToApp");
    expect(sideKey(out, false)).toBe("relOrgToApp");
  });

  it("suffixes a self-referencing rt per side, the mass-edit way", () => {
    const self = { key: "orgToOrg", source_type_key: "Organization", target_type_key: "Organization" };
    expect(sideKey(self, true)).toBe("orgToOrg__out");
    expect(sideKey(self, false)).toBe("orgToOrg__in");
  });
});

describe("sideKey parity with the backend", () => {
  // The same cases as `TestSideKey` in backend/tests/services/test_relation_orientation.py:
  // a subtype's `optional_relations` (#1296) is written here and read there.
  it("matches side_key for a cross-type rt and a self-pair", () => {
    const appToIf = { key: "relAppToInterface", source_type_key: "Application", target_type_key: "Interface" };
    const orgToOrg = { key: "relOrgToOrg", source_type_key: "Organization", target_type_key: "Organization" };
    expect([sideKey(appToIf, true), sideKey(appToIf, false)]).toEqual([
      "relAppToInterface",
      "relAppToInterface",
    ]);
    expect([sideKey(orgToOrg, true), sideKey(orgToOrg, false)]).toEqual([
      "relOrgToOrg__out",
      "relOrgToOrg__in",
    ]);
  });
});

describe("subtypeOptionalSides", () => {
  const type = {
    subtypes: [
      { key: "saas", optional_relations: ["relAppToOrg", "relAppFeeds__in"] },
      { key: "inhouse" },
    ],
  };

  it("returns the subtype's exemption list", () => {
    expect([...subtypeOptionalSides(type, "saas")]).toEqual(["relAppToOrg", "relAppFeeds__in"]);
  });

  it("exempts nothing for another subtype, no subtype, an unknown one or no type", () => {
    expect(subtypeOptionalSides(type, "inhouse").size).toBe(0);
    expect(subtypeOptionalSides(type, null).size).toBe(0);
    expect(subtypeOptionalSides(type, "").size).toBe(0);
    expect(subtypeOptionalSides(type, "gone").size).toBe(0);
    expect(subtypeOptionalSides(undefined, "saas").size).toBe(0);
    // A type with no subtypes array at all (a custom type before any was added).
    expect(subtypeOptionalSides({}, "saas").size).toBe(0);
    expect(subtypeOptionalSides({ subtypes: undefined }, "saas").size).toBe(0);
  });

  it("reads the list only for the matching key, never by position", () => {
    const type = { subtypes: [{ key: "a", optional_relations: ["x"] }, { key: "b" }] };
    expect(subtypeOptionalSides(type, "b").size).toBe(0);
    expect([...subtypeOptionalSides(type, "a")]).toEqual(["x"]);
  });

  it("ignores a malformed list", () => {
    const bad = { subtypes: [{ key: "saas", optional_relations: "relX" as unknown as string[] }] };
    expect(subtypeOptionalSides(bad, "saas").size).toBe(0);
    const mixed = { subtypes: [{ key: "saas", optional_relations: ["relX", 3 as unknown as string] }] };
    expect([...subtypeOptionalSides(mixed, "saas")]).toEqual(["relX"]);
  });
});

describe("effectiveSideFlags", () => {
  const flags = {
    source_visible: true,
    target_visible: false,
    source_mandatory: true,
    target_mandatory: true,
  };
  const cross = { key: "relAppToOrg", source_type_key: "Application", target_type_key: "Organization", ...flags };
  const self = { key: "relAppFeeds", source_type_key: "Application", target_type_key: "Application", ...flags };

  it("reads an exempted side as not mandatory, visibility untouched", () => {
    expect(effectiveSideFlags(cross, true, new Set(["relAppToOrg"]))).toEqual({
      visible: true,
      mandatory: false,
    });
    expect(effectiveSideFlags(cross, false, new Set(["relAppToOrg"]))).toEqual({
      visible: false,
      mandatory: false,
    });
  });

  it("keeps a side the subtype does not list mandatory", () => {
    expect(effectiveSideFlags(cross, true, new Set())).toEqual({ visible: true, mandatory: true });
    expect(effectiveSideFlags(cross, true, new Set(["relOther"]))).toEqual({
      visible: true,
      mandatory: true,
    });
  });

  it("exempts each side of a self-pair on its own key", () => {
    const outOnly = new Set(["relAppFeeds__out"]);
    expect(effectiveSideFlags(self, true, outOnly).mandatory).toBe(false);
    expect(effectiveSideFlags(self, false, outOnly).mandatory).toBe(true);
    // The bare key names no side of a self-pair.
    expect(effectiveSideFlags(self, true, new Set(["relAppFeeds"])).mandatory).toBe(true);
  });

  it("leaves a non-mandatory side alone", () => {
    const optional = { ...cross, source_mandatory: false };
    expect(effectiveSideFlags(optional, true, new Set(["relAppToOrg"]))).toEqual({
      visible: true,
      mandatory: false,
    });
  });
});

describe("onSide", () => {
  const row = (source_id: string, target_id: string, type = "orgToOrg") => ({ type, source_id, target_id });

  it("files a row by the card's end, per row", () => {
    expect(onSide(row("me", "them"), "orgToOrg", "me", true)).toBe(true);
    expect(onSide(row("me", "them"), "orgToOrg", "me", false)).toBe(false);
    expect(onSide(row("them", "me"), "orgToOrg", "me", false)).toBe(true);
    expect(onSide(row("them", "me"), "orgToOrg", "me", true)).toBe(false);
  });

  it("never matches another type", () => {
    expect(onSide(row("me", "them", "other"), "orgToOrg", "me", true)).toBe(false);
  });

  it("puts a self-loop on the outgoing side, once", () => {
    expect(onSide(row("me", "me"), "orgToOrg", "me", true)).toBe(true);
    expect(onSide(row("me", "me"), "orgToOrg", "me", false)).toBe(false);
  });
});

describe("parseSideKey", () => {
  it("returns a bare key as 'either side'", () => {
    expect(parseSideKey("relOrgToApp")).toEqual({ key: "relOrgToApp" });
  });

  it("splits a side key back into key and side", () => {
    expect(parseSideKey("orgToOrg__out")).toEqual({ key: "orgToOrg", isSource: true });
    expect(parseSideKey("orgToOrg__in")).toEqual({ key: "orgToOrg", isSource: false });
  });

  it("round-trips sideKey", () => {
    const self = { key: "orgToOrg", source_type_key: "Organization", target_type_key: "Organization" };
    expect(parseSideKey(sideKey(self, true))).toEqual({ key: "orgToOrg", isSource: true });
    expect(parseSideKey(sideKey(self, false))).toEqual({ key: "orgToOrg", isSource: false });
  });
});

describe("runsAgainstType", () => {
  const appToIf = { source_type_key: "Application", target_type_key: "Interface" };
  const selfPair = { source_type_key: "Organization", target_type_key: "Organization" };

  it("is false for a row stored the type's way", () => {
    expect(runsAgainstType(appToIf, "Application", "Interface")).toBe(false);
  });

  it("is true for a row stored the other way round (#1140)", () => {
    expect(runsAgainstType(appToIf, "Interface", "Application")).toBe(true);
  });

  it("is never true for a self-referencing type", () => {
    expect(runsAgainstType(selfPair, "Organization", "Organization")).toBe(false);
  });

  it("is false when anything is unknown", () => {
    expect(runsAgainstType(undefined, "Interface", "Application")).toBe(false);
    expect(runsAgainstType(appToIf, undefined, "Application")).toBe(false);
    expect(runsAgainstType(appToIf, "Interface", undefined)).toBe(false);
  });

  it("is false for a pair that matches neither orientation", () => {
    expect(runsAgainstType(appToIf, "ITComponent", "Application")).toBe(false);
  });
});
