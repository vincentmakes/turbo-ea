import { describe, it, expect } from "vitest";
import { modelsEqual, pruneAction, type MirrorEntry } from "./facetColumnSync";

const MODEL = { filterType: "text", type: "equals", filter: "BROKEN" };
const entry = (over: Partial<MirrorEntry> = {}): MirrorEntry => ({
  facetValue: "BROKEN",
  model: { ...MODEL },
  ...over,
});

describe("modelsEqual", () => {
  it("deep-compares plain filter models", () => {
    expect(modelsEqual(MODEL, { ...MODEL })).toBe(true);
    expect(modelsEqual(MODEL, { ...MODEL, filter: "DRAFT" })).toBe(false);
    expect(modelsEqual(MODEL, undefined)).toBe(false);
    expect(modelsEqual(null, null)).toBe(true);
    expect(
      modelsEqual(
        { filterType: "date", type: "equals", dateFrom: "2026-01-01 00:00:00", dateTo: null },
        { filterType: "date", type: "equals", dateFrom: "2026-01-01 00:00:00", dateTo: null },
      ),
    ).toBe(true);
    // Extra keys matter both ways.
    expect(modelsEqual(MODEL, { ...MODEL, extra: 1 })).toBe(false);
    expect(modelsEqual({ ...MODEL, extra: 1 }, MODEL)).toBe(false);
  });
});

describe("pruneAction", () => {
  it("keeps the mirror while the facet holds exactly the mirrored value", () => {
    expect(pruneAction(entry(), ["BROKEN"], { ...MODEL })).toBe("keep");
  });

  it("drops the column model when the facet gains extra values (panel edit wins)", () => {
    expect(pruneAction(entry(), ["BROKEN", "APPROVED"], { ...MODEL })).toBe("dropColumnModel");
  });

  it("drops the column model when the mirrored value is removed or the facet cleared", () => {
    expect(pruneAction(entry(), ["APPROVED"], { ...MODEL })).toBe("dropColumnModel");
    expect(pruneAction(entry(), [], { ...MODEL })).toBe("dropColumnModel");
  });

  it("unregisters without touching anything when the grid model diverged (popup-authored)", () => {
    expect(pruneAction(entry(), ["BROKEN"], { ...MODEL, filter: "DRAFT" })).toBe("unregister");
    expect(pruneAction(entry(), [], { ...MODEL, type: "contains" })).toBe("unregister");
  });

  it("unregisters when the grid model vanished (Clear filters / saved-view apply)", () => {
    expect(pruneAction(entry(), ["BROKEN"], undefined)).toBe("unregister");
  });

  it("never asks for a grid write on facet-only entries (model: null)", () => {
    expect(pruneAction(entry({ model: null }), ["BROKEN"], undefined)).toBe("keep");
    expect(pruneAction(entry({ model: null }), ["APPROVED"], undefined)).toBe("unregister");
    expect(pruneAction(entry({ model: null }), [], undefined)).toBe("unregister");
  });
});
