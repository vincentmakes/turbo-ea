/** Pure helpers of the grid filter sidebars' section headers. */
import { describe, it, expect } from "vitest";
import { isToggleKey, resetFilterKeys, showsSectionClear } from "./filterSections";

describe("resetFilterKeys", () => {
  it("resets only the named keys and leaves the input untouched", () => {
    const empty = { search: "", types: [] as string[], flag: false };
    const filters = { search: "abc", types: ["A", "B"], flag: true };
    const next = resetFilterKeys(filters, empty, ["types", "flag"]);
    expect(next).toEqual({ search: "abc", types: [], flag: false });
    expect(next).not.toBe(filters);
    expect(filters).toEqual({ search: "abc", types: ["A", "B"], flag: true });
  });

  it("is a copy even with no keys", () => {
    const f = { a: 1 };
    const next = resetFilterKeys(f, { a: 0 }, []);
    expect(next).toEqual({ a: 1 });
    expect(next).not.toBe(f);
  });
});

describe("isToggleKey", () => {
  it("accepts Enter and Space only", () => {
    expect(isToggleKey("Enter")).toBe(true);
    expect(isToggleKey(" ")).toBe(true);
    expect(isToggleKey("Tab")).toBe(false);
    expect(isToggleKey("Escape")).toBe(false);
  });
});

describe("showsSectionClear", () => {
  it("needs both a positive count and a handler", () => {
    const fn = () => {};
    expect(showsSectionClear(1, fn)).toBe(true);
    expect(showsSectionClear(0, fn)).toBe(false);
    expect(showsSectionClear(undefined, fn)).toBe(false);
    expect(showsSectionClear(3, undefined)).toBe(false);
  });
});
