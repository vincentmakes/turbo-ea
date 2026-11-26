import { describe, it, expect } from "vitest";
import { LDV_LINE_STYLES, ldvEdgeStroke } from "./ldvLineStyle";

describe("ldvEdgeStroke", () => {
  it("draws the chosen style when the edge is idle", () => {
    expect(ldvEdgeStroke("solid")).toEqual({});
    expect(ldvEdgeStroke("dashed").strokeDasharray).toBe("5 3");
    expect(ldvEdgeStroke("longDash").strokeDasharray).toBe("12 5");
  });

  it("gives the dotted style a round linecap", () => {
    // A short dash with the default butt cap renders tiny rectangles; the
    // round cap is what makes dots read as dots.
    const dotted = ldvEdgeStroke("dotted");
    expect(dotted.strokeDasharray).toBe("1 4");
    expect(dotted.strokeLinecap).toBe("round");
  });

  it("draws a hovered edge solid whichever style is chosen", () => {
    // Hover keeps one consistent highlight; the colour and width carry it
    // when the idle style is already solid.
    for (const style of LDV_LINE_STYLES) {
      expect(ldvEdgeStroke(style, { active: true })).toEqual({});
    }
  });

  it("keeps a severed dependency's own dashes, over both hover and the style", () => {
    // Severed is a state — "this dependency is going away" must not be
    // silenced by a display preference.
    for (const style of LDV_LINE_STYLES) {
      expect(ldvEdgeStroke(style, { severed: true }).strokeDasharray).toBe("3 3");
      expect(ldvEdgeStroke(style, { severed: true, active: true }).strokeDasharray).toBe("3 3");
    }
  });

  it("draws a planned or ended relation in its own faded state, over hover and the style", () => {
    // Not by dashes alone — the idle style is itself a dash a reader picked —
    // so the state also fades the line.
    for (const style of LDV_LINE_STYLES) {
      for (const active of [false, true]) {
        expect(ldvEdgeStroke(style, { active, relationState: "planned" })).toEqual({
          strokeDasharray: "8 3 2 3",
          strokeOpacity: 0.7,
        });
        expect(ldvEdgeStroke(style, { active, relationState: "ended" })).toEqual({
          strokeDasharray: "1 3",
          strokeLinecap: "round",
          strokeOpacity: 0.5,
        });
      }
    }
  });

  it("lets severed win over a relation's own state", () => {
    expect(ldvEdgeStroke("solid", { severed: true, relationState: "planned" })).toEqual({
      strokeDasharray: "3 3",
    });
    expect(ldvEdgeStroke("solid", { severed: true, relationState: "ended" })).toEqual({
      strokeDasharray: "3 3",
    });
  });

  it("falls back to dashed for a missing or unknown style", () => {
    expect(ldvEdgeStroke(undefined).strokeDasharray).toBe("5 3");
    // A value from a hand-edited localStorage blob must not blank the lines.
    expect(ldvEdgeStroke("bogus" as never).strokeDasharray).toBe("5 3");
  });
});
