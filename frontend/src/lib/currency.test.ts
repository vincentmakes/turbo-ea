import { describe, it, expect, beforeAll, vi } from "vitest";
import { CURRENCY_SYMBOL_OVERRIDES, currencySymbolOverride } from "./currency";

// jsdom has no real canvas; stub getContext to null so glyph measurement is
// skipped (canRenderGlyph then defaults to "supported") instead of throwing.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("currency symbol overrides", () => {
  it("maps SAR to the U+20C1 Saudi Riyal sign", () => {
    expect(CURRENCY_SYMBOL_OVERRIDES.SAR).toBe("⃁");
  });

  it("returns the override glyph for SAR when the glyph is renderable", () => {
    // In jsdom canvas measurement is unavailable, so canRenderGlyph defaults to
    // true and the override is preferred.
    expect(currencySymbolOverride("SAR")).toBe("⃁");
  });

  it("returns null for currencies without an override", () => {
    expect(currencySymbolOverride("USD")).toBeNull();
    expect(currencySymbolOverride("EUR")).toBeNull();
  });
});
