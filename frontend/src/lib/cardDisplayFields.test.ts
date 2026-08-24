import { describe, it, expect } from "vitest";
import {
  buildFieldCatalog,
  groupFieldCatalog,
  formatFieldValue,
  hasCardLabelLines,
  EMPTY_VALUE,
} from "./cardDisplayFields";
import type { CardType } from "@/types";

function type(key: string, fields: { key: string; label: string; type?: string }[]): CardType {
  return {
    key,
    label: key,
    icon: "apps",
    color: "#000000",
    category: "Application & Data",
    fields_schema: [{ section: "Details", fields: fields.map((f) => ({ type: "text", ...f })) }],
  } as unknown as CardType;
}

const deps = { optionLabel: (o: { label: string }) => o.label, yes: "Yes", no: "No" };

describe("buildFieldCatalog", () => {
  it("only offers fields from types actually in play", () => {
    const types = [type("Application", [{ key: "owner", label: "Owner" }]), type("Provider", [{ key: "tier", label: "Tier" }])];
    const out = buildFieldCatalog(types, new Set(["Application"]));
    expect(out.map((f) => f.key)).toEqual(["owner"]);
  });

  it("de-duplicates a field key shared by two types and sorts by label", () => {
    const types = [
      type("Application", [
        { key: "zeta", label: "Zeta" },
        { key: "owner", label: "Owner" },
      ]),
      type("ITComponent", [{ key: "owner", label: "Owner (duplicate)" }]),
    ];
    const out = buildFieldCatalog(types, new Set(["Application", "ITComponent"]));
    expect(out.map((f) => f.key)).toEqual(["owner", "zeta"]);
    // First definition wins — the picker offers one row per key.
    expect(out[0].label).toBe("Owner");
  });

  it("records every owning type on a shared key, so it can be filed correctly", () => {
    const types = [
      type("Application", [{ key: "owner", label: "Owner" }, { key: "cost", label: "Cost" }]),
      type("ITComponent", [{ key: "owner", label: "Owner" }]),
    ];
    const out = buildFieldCatalog(types, new Set(["Application", "ITComponent"]));
    const byKey = new Map(out.map((f) => [f.key, f]));
    expect(byKey.get("owner")!.typeKeys).toEqual(["Application", "ITComponent"]);
    expect(byKey.get("cost")!.typeKeys).toEqual(["Application"]);
  });

  it("ignores a type that is not in play, even if it defines the same key", () => {
    const types = [
      type("Application", [{ key: "owner", label: "Owner" }]),
      type("ITComponent", [{ key: "owner", label: "Owner" }]),
    ];
    const out = buildFieldCatalog(types, new Set(["Application"]));
    expect(out[0].typeKeys).toEqual(["Application"]);
  });
});

describe("groupFieldCatalog", () => {
  const types = [
    type("Application", [
      { key: "owner", label: "Owner" },
      { key: "cost", label: "Cost" },
    ]),
    type("ITComponent", [
      { key: "owner", label: "Owner" },
      { key: "hosting", label: "Hosting" },
    ]),
    type("Provider", [{ key: "tier", label: "Tier" }]),
  ];
  const present = new Set(["Application", "ITComponent"]);

  it("puts a multi-type key in one shared group, listed first", () => {
    const groups = groupFieldCatalog(buildFieldCatalog(types, present), types);
    expect(groups[0].kind).toBe("shared");
    expect(groups[0].fields.map((f) => f.key)).toEqual(["owner"]);
  });

  it("files single-owner keys under their type, in metamodel order", () => {
    const groups = groupFieldCatalog(buildFieldCatalog(types, present), types);
    const typed = groups.filter((g) => g.kind === "type");
    expect(typed.map((g) => (g.kind === "type" ? g.type.key : ""))).toEqual([
      "Application",
      "ITComponent",
    ]);
    expect(typed[0].fields.map((f) => f.key)).toEqual(["cost"]);
    expect(typed[1].fields.map((f) => f.key)).toEqual(["hosting"]);
  });

  it("drops empty groups — a type not on the canvas gets no heading", () => {
    const groups = groupFieldCatalog(buildFieldCatalog(types, present), types);
    expect(groups.some((g) => g.kind === "type" && g.type.key === "Provider")).toBe(false);
  });

  it("emits no shared group when nothing is shared", () => {
    const groups = groupFieldCatalog(
      buildFieldCatalog(types, new Set(["Application"])),
      types,
    );
    expect(groups.every((g) => g.kind === "type")).toBe(true);
  });

  it("flattens group-contiguously — Autocomplete.groupBy repeats a heading otherwise", () => {
    const groups = groupFieldCatalog(buildFieldCatalog(types, present), types);
    const flat = groups.flatMap((g) =>
      g.fields.map(() => (g.kind === "shared" ? "shared" : g.type.key)),
    );
    // Every run of a given group name occurs exactly once.
    const runs = flat.filter((name, i) => i === 0 || flat[i - 1] !== name);
    expect(new Set(runs).size).toBe(runs.length);
  });

  it("lists each field exactly once across all groups", () => {
    const catalog = buildFieldCatalog(types, present);
    const groups = groupFieldCatalog(catalog, types);
    const keys = groups.flatMap((g) => g.fields.map((f) => f.key));
    expect(keys.sort()).toEqual(catalog.map((f) => f.key).sort());
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("formatFieldValue", () => {
  const meta = {
    key: "criticality",
    label: "Criticality",
    type: "single_select",
    options: [{ key: "high", label: "High" }],
  };

  it("returns the empty sentinel for nothing-to-show values", () => {
    for (const v of [null, undefined, ""]) {
      expect(formatFieldValue(v, undefined, deps)).toBe(EMPTY_VALUE);
    }
  });

  it("renders booleans with the caller's yes/no strings", () => {
    expect(formatFieldValue(true, undefined, deps)).toBe("Yes");
    expect(formatFieldValue(false, undefined, deps)).toBe("No");
  });

  it("resolves option keys to their labels, single and multi", () => {
    expect(formatFieldValue("high", meta, deps)).toBe("High");
    expect(formatFieldValue(["high", "unknown"], meta, deps)).toBe("High, unknown");
  });

  it("falls back to the raw key when an option is no longer in the metamodel", () => {
    expect(formatFieldValue("gone", meta, deps)).toBe("gone");
  });

  it("stringifies numbers and objects", () => {
    expect(formatFieldValue(42, undefined, deps)).toBe("42");
    expect(formatFieldValue({ a: 1 }, undefined, deps)).toBe('{"a":1}');
  });
});

describe("hasCardLabelLines", () => {
  it("is false only when nothing at all would render", () => {
    expect(hasCardLabelLines(undefined)).toBe(false);
    expect(hasCardLabelLines({ fields: [] })).toBe(false);
    expect(hasCardLabelLines({ fields: [], showType: true })).toBe(true);
    expect(hasCardLabelLines({ fields: [], showSubtype: true })).toBe(true);
    expect(hasCardLabelLines({ fields: ["owner"] })).toBe(true);
  });
});
