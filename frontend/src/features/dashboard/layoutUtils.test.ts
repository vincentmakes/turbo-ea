import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardWidget } from "@/types";
import {
  FULL_WIDTH,
  GRID_COLS,
  RESIZE_HANDLES,
  applyGridLayout,
  bottomOf,
  fitRowNeighbour,
  mirrorLayout,
  rowNeighbour,
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

describe("rowNeighbour", () => {
  const a = { i: "a", x: 0, y: 0, w: 6, h: 5 };

  it("finds the nearest widget to the right on the same rows", () => {
    const near = { i: "near", x: 6, y: 0, w: 3, h: 5 };
    const far = { i: "far", x: 9, y: 0, w: 3, h: 5 };
    expect(rowNeighbour([far, a, near], a)).toBe(near);
  });

  it("counts a widget that overlaps the rows only partly", () => {
    const low = { i: "low", x: 6, y: 4, w: 6, h: 5 };
    expect(rowNeighbour([a, low], a)).toBe(low);
  });

  it("ignores widgets below, above or to the left, and the widget itself", () => {
    const below = { i: "below", x: 0, y: 5, w: 6, h: 5 };
    const left = { i: "left", x: 6, y: 0, w: 6, h: 5 };
    const b = { i: "b", x: 6, y: 0, w: 6, h: 5 };
    expect(rowNeighbour([a, below], a)).toBeUndefined();
    expect(rowNeighbour([left, b], b)).toBeUndefined();
    expect(rowNeighbour([a], a)).toBeUndefined();
  });
});

describe("fitRowNeighbour", () => {
  const a = { i: "a", x: 0, y: 0, w: 6, h: 5 };
  const b = { i: "b", x: 6, y: 0, w: 6, h: 5, minW: 3 };
  const under = { i: "under", x: 0, y: 5, w: 12, h: 4 };
  const before = [a, b, under];

  it("narrows the neighbour and keeps it on its row when the widget grows", () => {
    const grown = { ...a, w: 8 };
    // The library pushed b under the grown widget and the row below further down.
    const after = [grown, { ...b, x: 6, y: 5 }, { ...under, y: 10 }];
    const out = fitRowNeighbour(before, after, a, grown);
    expect(out).toEqual([grown, { i: "b", x: 8, y: 0, w: 4, h: 5, minW: 3 }, { ...under, y: 10 }]);
    expect(after[1]).toEqual({ ...b, x: 6, y: 5 });
  });

  it("leaves the library's result when the neighbour cannot give up the width", () => {
    const grown = { ...a, w: 10 };
    const after = [grown, { ...b, y: 5 }, { ...under, y: 10 }];
    expect(fitRowNeighbour(before, after, a, grown)).toBe(after);
  });

  it("lets a neighbour without a stored minimum shrink down to one column", () => {
    const wide = { i: "wide", x: 6, y: 0, w: 6, h: 5 };
    const grown = { ...a, w: 11 };
    const out = fitRowNeighbour([a, wide], [grown, { ...wide, y: 5 }], a, grown);
    expect(out[1]).toEqual({ i: "wide", x: 11, y: 0, w: 1, h: 5 });
    expect(fitRowNeighbour([a, wide], [{ ...a, w: 12 }, { ...wide, y: 5 }], a, { ...a, w: 12 })).toEqual([
      { ...a, w: 12 },
      { ...wide, y: 5 },
    ]);
  });

  it("slides the neighbour left and widens it when the widget shrinks", () => {
    const shrunk = { ...a, w: 4 };
    const after = [shrunk, b, under];
    expect(fitRowNeighbour(before, after, a, shrunk)[1]).toEqual({ i: "b", x: 4, y: 0, w: 8, h: 5, minW: 3 });
  });

  it("adjusts only the nearest of two candidates", () => {
    const c = { i: "c", x: 9, y: 0, w: 3, h: 5 };
    const bb = { i: "b", x: 6, y: 0, w: 3, h: 5 };
    const shrunk = { ...a, w: 5 };
    const out = fitRowNeighbour([a, bb, c], [shrunk, bb, c], a, shrunk);
    expect(out).toEqual([shrunk, { i: "b", x: 5, y: 0, w: 4, h: 5 }, c]);
  });

  it("returns the library's layout as is for a height-only change or with nothing to the right", () => {
    const taller = { ...a, h: 7 };
    const afterTaller = [taller, b, { ...under, y: 7 }];
    expect(fitRowNeighbour(before, afterTaller, a, taller)).toBe(afterTaller);
    const shrunkB = { ...b, w: 3 };
    const afterB = [a, shrunkB, under];
    expect(fitRowNeighbour(before, afterB, b, shrunkB)).toBe(afterB);
  });

  it("does not mutate its inputs", () => {
    const grown = { ...a, w: 8 };
    const after = [grown, { ...b, y: 5 }, { ...under, y: 10 }];
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);
    fitRowNeighbour(before, after, a, grown);
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });

  it("offers the right edge, the bottom edge and the corner as handles", () => {
    expect(RESIZE_HANDLES).toEqual(["e", "s", "se"]);
  });
});
