import { describe, it, expect } from "vitest";

import { hasExplicitFill } from "./BpmnViewer";

/**
 * Builds a stub standing in for a bpmn-js element's DI, which exposes its
 * attributes through a moddle `get(name)` accessor.
 */
function elementWithDi(attrs: Record<string, string | undefined>) {
  return { di: { get: (name: string) => attrs[name] } };
}

describe("hasExplicitFill", () => {
  it("detects a BPMN-in-Color fill", () => {
    expect(hasExplicitFill(elementWithDi({ "color:background-color": "#BBDEFB" }))).toBe(true);
  });

  it("detects the legacy bpmn.io bioc fill", () => {
    expect(hasExplicitFill(elementWithDi({ "bioc:fill": "#FFE0B2" }))).toBe(true);
  });

  it("is false for a shape carrying no colour, so the automation tint still applies", () => {
    expect(hasExplicitFill(elementWithDi({}))).toBe(false);
  });

  it("ignores a border colour set without a fill", () => {
    // Only the fill competes with the automation tint; a stroke-only colour
    // must not suppress it.
    expect(hasExplicitFill(elementWithDi({ "color:border-color": "#0D4372" }))).toBe(false);
  });

  it("is false for elements with no di, and for missing elements", () => {
    expect(hasExplicitFill({})).toBe(false);
    expect(hasExplicitFill(null)).toBe(false);
    expect(hasExplicitFill(undefined)).toBe(false);
  });
});
