import { describe, it, expect } from "vitest";
import { ldvFocusRing } from "./ldvFocusRing";

const ACCENT = "#0f7eb5";
const widthOf = (ring?: { outline: string }) => Number(ring?.outline.match(/^([\d.]+)px/)?.[1]);

describe("ldvFocusRing", () => {
  it("draws nothing on an ordinary card", () => {
    expect(ldvFocusRing(ACCENT, {})).toBeUndefined();
    expect(ldvFocusRing(ACCENT, { isCenter: false, isExpanded: false })).toBeUndefined();
  });

  it("draws a heavier ring on the centre than on an expanded card", () => {
    const center = ldvFocusRing(ACCENT, { isCenter: true });
    const expanded = ldvFocusRing(ACCENT, { isExpanded: true });
    expect(widthOf(center)).toBeGreaterThan(widthOf(expanded));
    expect(widthOf(expanded)).toBeGreaterThan(0);
  });

  it("gives the centre one ring when a card is both centre and expanded", () => {
    // Both claims are true of the centred card the moment it is expanded; it
    // gets the stronger one, not two rings or the thinner one.
    const both = ldvFocusRing(ACCENT, { isCenter: true, isExpanded: true });
    expect(both).toEqual(ldvFocusRing(ACCENT, { isCenter: true }));
  });

  it("wears the card type's own colour", () => {
    // Not a new palette entry: the ring is a reader's bearing, and the border
    // is already spoken for by the timeline grammar.
    for (const accent of ["#0f7eb5", "#d29270"]) {
      expect(ldvFocusRing(accent, { isCenter: true })?.outline).toContain(accent);
      expect(ldvFocusRing(accent, { isExpanded: true })?.outline).toContain(accent);
    }
  });

  it("offsets the ring so it reads as a second border, not a thicker one", () => {
    const ring = ldvFocusRing(ACCENT, { isCenter: true });
    expect(Number(ring?.outlineOffset.replace("px", ""))).toBeGreaterThan(0);
    expect(ring?.outline).toContain("solid");
  });
});
