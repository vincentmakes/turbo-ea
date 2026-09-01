/**
 * The routing had no tests while it lived inside the gantt component — it was
 * a `useCallback` reachable only by rendering the whole chart. Lifting it out
 * is what makes the three cases assertable.
 */
import { describe, expect, it } from "vitest";
import { buildGanttArrowPath } from "./ganttArrowPath";

describe("buildGanttArrowPath", () => {
  it("draws one horizontal segment when both points share a row", () => {
    expect(buildGanttArrowPath(10, 50, 200, 50)).toBe("M 10 50 H 200");
  });

  it("routes forward as H–V–H with two arcs when the target starts later", () => {
    const d = buildGanttArrowPath(10, 20, 200, 80);
    expect(d.startsWith("M 10 20")).toBe(true);
    // Two arcs, one direction change, ending at the target.
    expect((d.match(/A /g) || []).length).toBe(2);
    expect(d.endsWith("H 200")).toBe(true);
  });

  it("loops back around the left when the bars overlap", () => {
    // Target starts BEFORE the source ends: the arrow cannot go straight.
    const d = buildGanttArrowPath(200, 20, 40, 80);
    expect((d.match(/A /g) || []).length).toBe(4);
    // The detour runs left of both points.
    const xs = [...d.matchAll(/[HM] (-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeLessThan(40);
  });

  it("insets the click-safe variant so it clears the endpoint handles", () => {
    const visible = buildGanttArrowPath(10, 50, 200, 50);
    const clickable = buildGanttArrowPath(10, 50, 200, 50, true);
    expect(clickable).not.toBe(visible);
    // Starts later and ends earlier than the drawn path — that gap is what
    // keeps a bar's relation handle grabbable once it has a dependency.
    expect(clickable).toBe("M 28 50 H 182");
  });

  it("never emits a percentage or a NaN — an SVG path takes numbers only", () => {
    for (const args of [
      [0, 0, 100, 100],
      [100, 100, 0, 0],
      [5, 10, 6, 10],
      [5, 10, 5, 200],
    ] as const) {
      const d = buildGanttArrowPath(...args);
      expect(d).not.toContain("%");
      expect(d).not.toContain("NaN");
    }
  });

  it("routes upward as well as downward", () => {
    const down = buildGanttArrowPath(10, 20, 200, 80);
    const up = buildGanttArrowPath(10, 80, 200, 20);
    expect(down).not.toBe(up);
    expect(up.startsWith("M 10 80")).toBe(true);
    expect(up.endsWith("H 200")).toBe(true);
  });
});
