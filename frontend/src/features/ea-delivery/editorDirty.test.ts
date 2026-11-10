import { describe, expect, it } from "vitest";

import { hasUnsavedEdits, stableJson } from "./editorDirty";

describe("stableJson", () => {
  it("sorts object keys at every level and keeps array order", () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
    expect(stableJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("writes plain values as JSON does", () => {
    expect(stableJson("x")).toBe('"x"');
    expect(stableJson(null)).toBe("null");
    expect(stableJson(3)).toBe("3");
  });
});

describe("hasUnsavedEdits", () => {
  it("is false for the same content, whatever the key order", () => {
    expect(hasUnsavedEdits({ title: "T", links: [] }, { links: [], title: "T" })).toBe(false);
  });

  it("is true for any difference, nested ones and array order included", () => {
    expect(hasUnsavedEdits({ title: "T2" }, { title: "T" })).toBe(true);
    expect(hasUnsavedEdits({ p: [{ id: "a" }] }, { p: [{ id: "b" }] })).toBe(true);
    expect(hasUnsavedEdits({ p: ["a", "b"] }, { p: ["b", "a"] })).toBe(true);
    expect(hasUnsavedEdits({ v: null }, { v: "" })).toBe(true);
  });

  it("treats a missing baseline as unsaved", () => {
    expect(hasUnsavedEdits({ title: "T" }, null)).toBe(true);
    expect(hasUnsavedEdits({ title: "T" }, undefined)).toBe(true);
  });
});
