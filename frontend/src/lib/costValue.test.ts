import { describe, expect, it } from "vitest";
import { costValue, isNumericText } from "./costValue";

describe("costValue", () => {
  it.each([
    [100, 100],
    [-25, -25],
    [50.5, 50.5],
    ["1200", 1200],
    [" 300.5 ", 300.5],
    ["1e3", 1000],
    ["1.", 1],
    [".5", 0.5],
    ["+40", 40],
  ])("counts %j as %d", (value, expected) => {
    expect(costValue(value)).toBe(expected);
  });

  it.each([
    "n/a",
    "",
    "   ",
    "0x10",
    "1_000",
    "1,200",
    "12abc",
    "Infinity",
    "1e400",
    NaN,
    Infinity,
    true,
    null,
    undefined,
    ["100"],
  ])("counts %j as nothing", (value) => {
    expect(costValue(value)).toBe(0);
  });
});

describe("isNumericText", () => {
  it("accepts plain decimals only", () => {
    expect(isNumericText(" 12.5 ")).toBe(true);
    expect(isNumericText("-7e-2")).toBe(true);
    expect(isNumericText("1_000")).toBe(false);
    expect(isNumericText(12)).toBe(false);
  });

  // A stored cost string is rendered in every viewer's browser. The old
  // pattern split a digit run between `\d+` and `\d*` in n ways, so a long
  // digit string with one stray character froze the tab.
  it.each([
    ["digits then junk", "1".repeat(50_000) + "x"],
    ["digits, spaces, junk", "1".repeat(50_000) + " ".repeat(50_000) + "x"],
    ["fraction then junk", "." + "1".repeat(50_000) + "x"],
    ["exponent then junk", "1e" + "1".repeat(50_000) + "x"],
  ])("rejects a long near miss quickly (%s)", (_label, value) => {
    const start = performance.now();
    expect(isNumericText(value)).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it("still accepts a long digit run", () => {
    expect(isNumericText("1".repeat(50_000))).toBe(true);
  });
});
