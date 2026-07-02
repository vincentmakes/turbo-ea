import { describe, it, expect } from "vitest";
import { resolveDiagramLibs, DEFAULT_DIAGRAM_LIBS } from "./DiagramEditor";

describe("resolveDiagramLibs", () => {
  it("falls back to the default set when nothing is saved", () => {
    expect(resolveDiagramLibs(undefined)).toBe(DEFAULT_DIAGRAM_LIBS);
    expect(resolveDiagramLibs(null)).toBe(DEFAULT_DIAGRAM_LIBS);
    expect(resolveDiagramLibs([])).toBe(DEFAULT_DIAGRAM_LIBS);
  });

  it("joins the saved libraries into a Draw.io libs string", () => {
    expect(resolveDiagramLibs(["general", "uml", "archimate3"])).toBe(
      "general;uml;archimate3",
    );
  });

  it("restores a single remembered library", () => {
    expect(resolveDiagramLibs(["archimate3"])).toBe("archimate3");
  });
});
