import { describe, it, expect } from "vitest";
import {
  buildFieldCatalog,
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
