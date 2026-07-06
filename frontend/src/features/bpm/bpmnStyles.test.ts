import { describe, it, expect } from "vitest";

import { BPMN_ICON_COLOR, bpmnCanvasSx } from "./bpmnStyles";

describe("bpmnCanvasSx", () => {
  it("pins the context pad icon color so it stays visible in dark mode (#770)", () => {
    expect(bpmnCanvasSx["& .djs-context-pad .entry"]).toEqual({ color: BPMN_ICON_COLOR });
  });

  it("pins the replace/append popup menu color (same white-background bug)", () => {
    expect(bpmnCanvasSx["& .djs-popup .djs-popup-body"]).toEqual({ color: BPMN_ICON_COLOR });
  });

  it("uses a dark glyph color (the boxes/panels behind them are always white)", () => {
    // hsl(225, 10%, 15%) — low lightness => dark. Guards against an accidental
    // light value that would reintroduce white-on-white.
    expect(BPMN_ICON_COLOR).toMatch(/^hsl\(\s*225,\s*10%,\s*15%\s*\)$/);
  });
});
