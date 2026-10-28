import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardWidget } from "@/types";
import {
  FULL_WIDTH,
  GRID_COLS,
  applyGridLayout,
  bottomOf,
  mirrorLayout,
  newWidgetId,
  newWidgetLayout,
  toGridItem,
} from "./layoutUtils";

function widget(id: string, layout: DashboardWidget["layout"], type: DashboardWidget["type"] = "chart"): DashboardWidget {
  return { id, type, title: null, config: {}, layout };
}

afterEach(() => vi.restoreAllMocks());

describe("mirrorLayout", () => {
  it("mirrors x around the grid (x' = cols - x - w) and keeps everything else", () => {
    const out = mirrorLayout(
      [
        { i: "a", x: 0, y: 0, w: 3, h: 2 },
        { i: "b", x: 7, y: 2, w: 5, h: 5 },
        { i: "c", x: 0, y: 7, w: 12, h: 1 },
      ],
      12,
    );
    expect(out).toEqual([
      { i: "a", x: 9, y: 0, w: 3, h: 2 },
      { i: "b", x: 0, y: 2, w: 5, h: 5 },
      { i: "c", x: 0, y: 7, w: 12, h: 1 },
    ]);
  });

  it("is its own inverse", () => {
    const layout = [
      { x: 2, w: 4 },
      { x: 5, w: 1 },
    ];
    expect(mirrorLayout(mirrorLayout(layout, 12), 12)).toEqual(layout);
  });

  it("uses the given column count", () => {
    expect(mirrorLayout([{ x: 1, w: 2 }], 6)).toEqual([{ x: 3, w: 2 }]);
  });

  it("never yields a negative x for an item wider than the grid", () => {
    expect(mirrorLayout([{ x: 0, w: 14 }], 12)).toEqual([{ x: 0, w: 14 }]);
  });

  it("does not mutate its input", () => {
    const input = [{ x: 1, w: 2 }];
    mirrorLayout(input, 12);
    expect(input).toEqual([{ x: 1, w: 2 }]);
  });
});

describe("toGridItem", () => {
  it("maps the stored layout and adds the catalogue minimum", () => {
    expect(toGridItem(widget("c1", { x: 1, y: 2, w: 6, h: 5 }))).toEqual({
      i: "c1",
      x: 1,
      y: 2,
      w: 6,
      h: 5,
      minW: 3,
      minH: 3,
    });
  });

  it("prefers a stored minimum and never exceeds the current size", () => {
    expect(toGridItem(widget("k", { x: 0, y: 0, w: 2, h: 2, minW: 1, minH: 1 }, "kpi"))).toEqual({
      i: "k",
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      minW: 1,
      minH: 1,
    });
    // The chart minimum is 3x3; a 2x2 chart keeps resizable bounds it fits in.
    expect(toGridItem(widget("c", { x: 0, y: 0, w: 2, h: 2 }))).toMatchObject({ minW: 2, minH: 2 });
  });

  it("adds no minimum for an unknown widget type", () => {
    const item = toGridItem({ ...widget("u", { x: 0, y: 0, w: 2, h: 2 }), type: "nope" as DashboardWidget["type"] });
    expect(item).toEqual({ i: "u", x: 0, y: 0, w: 2, h: 2 });
  });
});

describe("applyGridLayout", () => {
  const a = widget("a", { x: 0, y: 0, w: 6, h: 5, minW: 2 });
  const b = widget("b", { x: 6, y: 0, w: 6, h: 5 });

  it("returns the same array when nothing moved", () => {
    const widgets = [a, b];
    expect(
      applyGridLayout(widgets, [
        { i: "a", x: 0, y: 0, w: 6, h: 5 },
        { i: "b", x: 6, y: 0, w: 6, h: 5 },
      ]),
    ).toBe(widgets);
  });

  it("writes position and size back and keeps the stored minimum", () => {
    const out = applyGridLayout([a, b], [
      { i: "a", x: 0, y: 5, w: 4, h: 5 },
      { i: "b", x: 6, y: 0, w: 6, h: 5 },
    ]);
    expect(out[0].layout).toEqual({ x: 0, y: 5, w: 4, h: 5, minW: 2 });
    expect(out[1]).toBe(b);
  });

  it.each([
    ["x", { x: 1, y: 0, w: 6, h: 5 }],
    ["y", { x: 0, y: 1, w: 6, h: 5 }],
    ["w", { x: 0, y: 0, w: 5, h: 5 }],
    ["h", { x: 0, y: 0, w: 6, h: 4 }],
  ])("notices a change of %s alone", (_name, item) => {
    const widgets = [a];
    const out = applyGridLayout(widgets, [{ i: "a", ...item }]);
    expect(out).not.toBe(widgets);
    expect(out[0].layout).toMatchObject(item);
  });

  it("leaves widgets the layout does not mention alone", () => {
    const widgets = [a, b];
    const out = applyGridLayout(widgets, [{ i: "b", x: 0, y: 9, w: 6, h: 5 }]);
    expect(out[0]).toBe(a);
    expect(out[1].layout).toEqual({ x: 0, y: 9, w: 6, h: 5 });
  });
});

describe("bottomOf / newWidgetLayout", () => {
  it("finds the first free row", () => {
    expect(bottomOf([])).toBe(0);
    expect(
      bottomOf([
        widget("a", { x: 0, y: 0, w: 6, h: 5 }),
        widget("b", { x: 6, y: 3, w: 6, h: 4 }),
        widget("c", { x: 0, y: 5, w: 6, h: 1 }),
      ]),
    ).toBe(7);
  });

  it("places a new widget at the bottom with its default size", () => {
    expect(newWidgetLayout("chart", [widget("a", { x: 0, y: 2, w: 6, h: 5 })])).toEqual({ x: 0, y: 7, w: 6, h: 5 });
    expect(newWidgetLayout("kpi", [])).toEqual({ x: 0, y: 0, w: 3, h: 2 });
  });
});

describe("newWidgetId", () => {
  it("is prefixed by the type, fits the backend pattern and avoids taken ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(36 ** 3);
    const random = vi.spyOn(Math, "random");
    random.mockReturnValueOnce(0.5).mockReturnValueOnce(0.25);
    const first = "recentactivity-1000" + (0.5).toString(36).slice(2, 6);
    const id = newWidgetId("recent_activity", [{ id: first }]);
    expect(id).toBe("recentactivity-1000" + (0.25).toString(36).slice(2, 6));
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
  });

  it("falls back to a generic prefix", () => {
    expect(newWidgetId("__", [])).toMatch(/^widget-/);
  });
});

describe("grid constants", () => {
  it("stores a 12-column layout shown as-is on the two wide breakpoints", () => {
    expect(GRID_COLS).toBe(12);
    expect([...FULL_WIDTH].sort()).toEqual(["lg", "md"]);
  });
});
