import { describe, expect, it } from "vitest";
import { CHART_SEQUENTIAL, RAG_COLORS, SEVERITY_COLORS } from "@/theme/tokens";
import { HEAT_EMPTY, HEAT_SCALES, heatShade, mixHex } from "./heatScale";

describe("mixHex", () => {
  it("returns either end at 0 and 1, normalised to #rrggbb", () => {
    expect(mixHex("#fff", "#d32f2f", 0)).toBe("#ffffff");
    // Each shorthand digit doubles in place: #abc is #aabbcc, not #abcabc.
    expect(mixHex("#abc", "#000", 0)).toBe("#aabbcc");
    expect(mixHex("#fff", "#d32f2f", 1)).toBe("#d32f2f");
  });

  it("mixes each channel on its own and rounds to the nearest step", () => {
    // r: 0→255, g: 16→32, b: 255→0
    expect(mixHex("#0010ff", "#ff2000", 0.5)).toBe("#801880");
    expect(mixHex("#000000", "#0a0a0a", 0.25)).toBe("#030303");
  });
});

describe("heatShade", () => {
  it("runs each scale from its pale end to its token deep end", () => {
    expect(heatShade("amount", 0)).toBe(CHART_SEQUENTIAL.light[0]);
    expect(heatShade("amount", 1)).toBe(CHART_SEQUENTIAL.light[1]);
    expect(heatShade("risk", 0)).toBe("#ffffff");
    expect(heatShade("risk", 1)).toBe(SEVERITY_COLORS.critical);
    expect(heatShade("better", 1)).toBe(RAG_COLORS.green);
  });

  it("shades a value in between by its share of the range", () => {
    // #e3f2fd → #1976d2 at a half: (227+25)/2, (242+118)/2, (253+210)/2 rounded
    expect(heatShade("amount", 0.5)).toBe("#7eb4e8");
  });

  it("names three scales", () => {
    expect(Object.keys(HEAT_SCALES)).toEqual(["amount", "risk", "better"]);
  });
});

describe("HEAT_EMPTY", () => {
  it("is a faint neutral grey", () => {
    expect(HEAT_EMPTY).toBe("rgba(158, 158, 158, 0.1)");
  });
});
