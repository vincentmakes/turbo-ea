import { describe, it, expect } from "vitest";
import {
  contrastRatio,
  isHexColor,
  readableTextColor,
  readableTypeColor,
  relativeLuminance,
} from "./color";

describe("isHexColor", () => {
  it("accepts 6-digit hex colors", () => {
    expect(isHexColor("#1a2b3c")).toBe(true);
    expect(isHexColor("#FFFFFF")).toBe(true);
    expect(isHexColor("#1a1a2e")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isHexColor("#12345")).toBe(false);
    expect(isHexColor("#1234567")).toBe(false);
    expect(isHexColor("1a2b3c")).toBe(false);
    expect(isHexColor("#12345g")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });
});

describe("contrastRatio", () => {
  it("returns 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(
      contrastRatio("#000000", "#ffffff"),
      5,
    );
  });

  it("returns 1 for identical colors", () => {
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#1a1a2e", "#1a1a2e")).toBe(1);
  });

  it("brand blue on white passes AA (~4.6)", () => {
    const ratio = contrastRatio("#1976d2", "#ffffff");
    expect(ratio).toBeGreaterThan(4.5);
    expect(ratio).toBeLessThan(5);
  });

  it("default navy navbar on white text passes AA comfortably", () => {
    expect(contrastRatio("#1a1a2e", "#ffffff")).toBeGreaterThan(10);
  });

  it("returns 1 for invalid input", () => {
    expect(contrastRatio("red", "#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "")).toBe(1);
  });
});

describe("readableTextColor", () => {
  it("picks white text on dark type colors", () => {
    expect(readableTextColor("#003399")).toBe("#ffffff"); // BusinessCapability navy
    expect(readableTextColor("#0f7eb5")).toBe("#ffffff"); // Application blue
    expect(readableTextColor("#774fcc")).toBe("#ffffff"); // DataObject purple
  });

  it("picks black text on pale colors (ArchiMate yellows etc.)", () => {
    expect(readableTextColor("#FFFFB5")).toBe("#000000");
    expect(readableTextColor("#fde68a")).toBe("#000000");
    expect(readableTextColor("#90EE90")).toBe("#000000"); // light green
  });

  it("keeps white text on every seed default, including Provider orange", () => {
    for (const hex of ["#ffa31f", "#d29270", "#33cc58", "#02afa4", "#fe6690"]) {
      expect(readableTextColor(hex)).toBe("#ffffff");
    }
  });

  it("falls back to white for invalid input (historical default)", () => {
    expect(readableTextColor("red")).toBe("#ffffff");
    expect(readableTextColor("")).toBe("#ffffff");
  });
});

describe("readableTypeColor", () => {
  it("lightens dark colors in dark mode", () => {
    expect(readableTypeColor("#003399", true)).not.toBe("#003399");
  });

  it("passes pale colors through untouched in dark mode (no washout)", () => {
    expect(readableTypeColor("#fde68a", true)).toBe("#fde68a");
    expect(readableTypeColor("#FFFFB5", true)).toBe("#FFFFB5");
  });

  it("passes the default palette through untouched in light mode", () => {
    for (const hex of ["#003399", "#0f7eb5", "#ffa31f", "#33cc58"]) {
      expect(readableTypeColor(hex, false)).toBe(hex);
    }
  });

  it("darkens near-white colors in light mode so accents stay visible", () => {
    expect(readableTypeColor("#FFFFB5", false)).not.toBe("#FFFFB5");
  });

  it("returns invalid input unchanged", () => {
    expect(readableTypeColor("red", true)).toBe("red");
    expect(readableTypeColor("", false)).toBe("");
  });
});

describe("relativeLuminance", () => {
  it("orders black < mid < white", () => {
    const black = relativeLuminance("#000000");
    const mid = relativeLuminance("#808080");
    const white = relativeLuminance("#ffffff");
    expect(black).toBe(0);
    expect(white).toBeCloseTo(1, 5);
    expect(mid).toBeGreaterThan(black);
    expect(mid).toBeLessThan(white);
  });
});
