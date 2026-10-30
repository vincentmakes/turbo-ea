import { describe, expect, it } from "vitest";
import { isModifiedClick } from "./modifiedClick";

const plain = { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, button: 0 };

describe("isModifiedClick", () => {
  it("is false for a plain left click", () => {
    expect(isModifiedClick(plain)).toBe(false);
  });

  it.each([
    ["Ctrl", { ...plain, ctrlKey: true }],
    ["Cmd", { ...plain, metaKey: true }],
    ["Shift", { ...plain, shiftKey: true }],
    ["Alt", { ...plain, altKey: true }],
    ["the middle button", { ...plain, button: 1 }],
  ])("is true with %s", (_label, e) => {
    expect(isModifiedClick(e)).toBe(true);
  });

  it("is false for the right button (the context menu handles it)", () => {
    expect(isModifiedClick({ ...plain, button: 2 })).toBe(false);
  });
});
