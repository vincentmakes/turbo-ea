import { describe, it, expect } from "vitest";
import { contrastRatio, isHexColor } from "./color";

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
