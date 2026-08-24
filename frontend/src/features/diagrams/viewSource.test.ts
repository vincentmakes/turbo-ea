import { describe, it, expect } from "vitest";
import {
  buildColorMap,
  colorKey,
  colorKeyForCard,
  describeView,
  normaliseViewSource,
  toggleFieldRule,
  NO_VALUE,
  NO_VALUE_COLOR,
  type ViewResolvers,
  type ViewSource,
} from "./viewSource";
import type { CardType } from "@/types";

function type(
  key: string,
  fields: Array<{
    key: string;
    label: string;
    options?: Array<{ key: string; label: string; color?: string }>;
  }>,
): CardType {
  return {
    key,
    label: key,
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    fields_schema: [
      { section: "Details", fields: fields.map((f) => ({ type: "single_select", ...f })) },
    ],
  } as unknown as CardType;
}

const APPLICATION = type("Application", [
  {
    key: "criticality",
    label: "Criticality",
    options: [
      { key: "high", label: "High", color: "#ff0000" },
      { key: "low", label: "Low", color: "#00ff00" },
    ],
  },
]);

// Deliberately the SAME field key and the SAME option key as Application.
const PROCESS = type("Process", [
  {
    key: "criticality",
    label: "Criticality",
    options: [{ key: "high", label: "High", color: "#0000ff" }],
  },
]);

const PROVIDER = type("Provider", [
  { key: "tier", label: "Tier", options: [{ key: "gold", label: "Gold" }] },
]);

const TYPES = [APPLICATION, PROCESS, PROVIDER];

const R: ViewResolvers = {
  typeLabel: (t) => t.label,
  fieldLabel: (f) => f.label,
  optionLabel: (o) => o.label,
  t: (k) => k,
};

const bothRules: ViewSource = {
  kind: "card_fields",
  fields: { Application: "criticality", Process: "criticality" },
};

describe("normaliseViewSource", () => {
  it("migrates the legacy single-type shape", () => {
    expect(
      normaliseViewSource({ kind: "card_field", type_key: "Application", field_key: "criticality" }),
    ).toEqual({ kind: "card_fields", fields: { Application: "criticality" } });
  });

  it("falls back to card colours for anything it does not recognise", () => {
    for (const raw of [
      undefined,
      null,
      "",
      42,
      {},
      { kind: "nope" },
      { kind: "card_field" },
      { kind: "card_field", type_key: "Application" },
      { kind: "card_fields", fields: {} },
      { kind: "card_fields", fields: { Application: 7 } },
      { kind: "card_fields" },
    ]) {
      expect(normaliseViewSource(raw)).toEqual({ kind: "card_type" });
    }
  });

  it("passes through the shapes it does recognise", () => {
    expect(normaliseViewSource({ kind: "approval_status" })).toEqual({ kind: "approval_status" });
    expect(normaliseViewSource(bothRules)).toEqual(bothRules);
  });

  it("drops a __proto__ key rather than letting it through", () => {
    const out = normaliseViewSource({
      kind: "card_fields",
      fields: { __proto__: "criticality", Application: "criticality" },
    });
    expect(out).toEqual({ kind: "card_fields", fields: { Application: "criticality" } });
  });
});

describe("buildColorMap", () => {
  it("keeps two types' palettes apart when they share a field AND an option key", () => {
    // Keying on the option key alone made the last rule win, so every Process
    // rendered in the Application palette.
    const map = buildColorMap(bothRules, TYPES, R);
    expect(map.get(colorKey("Application", "criticality", "high"))?.color).toBe("#ff0000");
    expect(map.get(colorKey("Process", "criticality", "high"))?.color).toBe("#0000ff");
  });

  it("emits exactly one no-value entry per rule, in the neutral colour", () => {
    const map = buildColorMap(bothRules, TYPES, R);
    const none = Array.from(map.values()).filter((e) => e.value === NO_VALUE);
    expect(none).toHaveLength(2);
    expect(none.every((e) => e.color === NO_VALUE_COLOR)).toBe(true);
  });

  it("gives an option with no colour a deterministic palette slot", () => {
    const view: ViewSource = { kind: "card_fields", fields: { Provider: "tier" } };
    const entry = buildColorMap(view, TYPES, R).get(colorKey("Provider", "tier", "gold"));
    expect(entry?.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("is empty for card colours, and contributes nothing for an unknown rule", () => {
    expect(buildColorMap({ kind: "card_type" }, TYPES, R).size).toBe(0);
    expect(
      buildColorMap({ kind: "card_fields", fields: { Nope: "gone" } }, TYPES, R).size,
    ).toBe(0);
  });

  it("labels approval statuses through translation, not a raw key", () => {
    const map = buildColorMap({ kind: "approval_status" }, TYPES, R);
    const labels = Array.from(map.values()).map((e) => e.label);
    expect(labels).toContain("common:status.approved");
  });
});

describe("colorKeyForCard", () => {
  it("returns null for a card whose type carries no rule — the #986 bug", () => {
    // The same option value on an uncovered type must NOT resolve. Painting
    // these is what greyed out the rest of the canvas.
    const view: ViewSource = { kind: "card_fields", fields: { Application: "criticality" } };
    expect(
      colorKeyForCard(view, { type: "Provider", attributes: { criticality: "high" } }),
    ).toBeNull();
  });

  it("resolves a covered card to its own type's key", () => {
    expect(
      colorKeyForCard(bothRules, { type: "Process", attributes: { criticality: "high" } }),
    ).toBe(colorKey("Process", "criticality", "high"));
  });

  it("resolves a covered card with no value to the no-value key", () => {
    const view: ViewSource = { kind: "card_fields", fields: { Application: "criticality" } };
    for (const attributes of [{}, { criticality: null }, { criticality: "" }]) {
      expect(colorKeyForCard(view, { type: "Application", attributes })).toBe(
        colorKey("Application", "criticality", NO_VALUE),
      );
    }
  });

  it("stringifies a non-string attribute", () => {
    const view: ViewSource = { kind: "card_fields", fields: { Application: "criticality" } };
    expect(colorKeyForCard(view, { type: "Application", attributes: { criticality: 3 } })).toBe(
      colorKey("Application", "criticality", "3"),
    );
  });

  it("covers every card under approval status, and none under card colours", () => {
    expect(colorKeyForCard({ kind: "approval_status" }, { type: "X", approval_status: "DRAFT" })).toBe(
      colorKey("", "approval_status", "DRAFT"),
    );
    expect(colorKeyForCard({ kind: "card_type" }, { type: "X", approval_status: "DRAFT" })).toBeNull();
  });
});

describe("describeView", () => {
  it("names one section per rule, in metamodel order", () => {
    const { sections } = describeView(bothRules, TYPES, R);
    expect(sections.map((s) => s.title)).toEqual([
      "Application · Criticality",
      "Process · Criticality",
    ]);
  });

  it("shortens to the first rule — the button can only show one", () => {
    expect(describeView(bothRules, TYPES, R).shortLabel).toBe("Application · Criticality");
  });

  it("has no sections for card colours, and one for approval", () => {
    expect(describeView({ kind: "card_type" }, TYPES, R).sections).toEqual([]);
    expect(describeView({ kind: "approval_status" }, TYPES, R).sections).toHaveLength(1);
  });

  it("falls back to card colours when every rule names a field that is gone", () => {
    const stale: ViewSource = { kind: "card_fields", fields: { Application: "removed" } };
    expect(describeView(stale, TYPES, R).sections).toEqual([]);
  });
});

describe("toggleFieldRule", () => {
  const one: ViewSource = { kind: "card_fields", fields: { Application: "criticality" } };

  it("replaces the rule within a type, but adds across types", () => {
    expect(toggleFieldRule(one, "Application", "other")).toEqual({
      kind: "card_fields",
      fields: { Application: "other" },
    });
    expect(toggleFieldRule(one, "Process", "criticality")).toEqual({
      kind: "card_fields",
      fields: { Application: "criticality", Process: "criticality" },
    });
  });

  it("collapses to card colours when the last rule is unticked", () => {
    expect(toggleFieldRule(one, "Application", "criticality")).toEqual({ kind: "card_type" });
  });

  it("discards a global perspective — the two are mutually exclusive", () => {
    expect(toggleFieldRule({ kind: "approval_status" }, "Application", "criticality")).toEqual({
      kind: "card_fields",
      fields: { Application: "criticality" },
    });
  });
});
