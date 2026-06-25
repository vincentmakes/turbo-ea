import { describe, it, expect } from "vitest";
import { EMPTY_VALUE, tagEmptyToken, valueIsEmpty } from "./InventoryFilterSidebar";

describe("valueIsEmpty", () => {
  it("treats null, undefined, empty string and empty array as empty", () => {
    expect(valueIsEmpty(null)).toBe(true);
    expect(valueIsEmpty(undefined)).toBe(true);
    expect(valueIsEmpty("")).toBe(true);
    expect(valueIsEmpty([])).toBe(true);
  });

  it("treats any actual value as non-empty", () => {
    expect(valueIsEmpty("active")).toBe(false);
    expect(valueIsEmpty(0)).toBe(false);
    expect(valueIsEmpty(false)).toBe(false);
    expect(valueIsEmpty(["a"])).toBe(false);
  });
});

describe("tagEmptyToken", () => {
  it("scopes the empty sentinel per group", () => {
    expect(tagEmptyToken("grp-1")).toBe(`${EMPTY_VALUE}:grp-1`);
    expect(tagEmptyToken("grp-1")).not.toBe(tagEmptyToken("grp-2"));
  });

  it("can be parsed back to its group id with the shared prefix", () => {
    const token = tagEmptyToken("grp-42");
    const prefix = `${EMPTY_VALUE}:`;
    expect(token.startsWith(prefix)).toBe(true);
    expect(token.slice(prefix.length)).toBe("grp-42");
  });
});
