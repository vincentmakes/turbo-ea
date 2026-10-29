import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type { DashboardWidget } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the grid props are inspected as plain data */

const rgl = vi.hoisted(() => ({ props: null as any, width: 1280, renders: 0 }));
vi.mock("react-grid-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-grid-layout")>();
  return {
    ...actual,
    Responsive: (props: { children: ReactNode }) => {
      rgl.props = props;
      rgl.renders += 1;
      return <div data-testid="rgl">{props.children}</div>;
    },
    useContainerWidth: () => ({ width: rgl.width, containerRef: { current: null }, mounted: true }),
  };
});
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("./widgets/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./widgets/registry")>();
  const { useWidgetControls } = await import("./widgets/WidgetFrame");
  // Places the customize controls it is handed, as every widget that draws its own surface does.
  const Stub = ({ widget }: { widget: DashboardWidget }) => {
    const controls = useWidgetControls();
    return (
      <div>
        {controls?.handle}body {widget.id}
        {controls?.actions}
      </div>
    );
  };
  return {
    ...actual,
    WIDGET_REGISTRY: Object.fromEntries(
      Object.entries(actual.WIDGET_REGISTRY).map(([type, entry]) => [type, { ...entry, Component: Stub }]),
    ),
  };
});

import { hookState } from "@/test/hooks";
import { renderWithProviders, wrapWithProviders } from "@/test/render";
import DashboardGrid from "./DashboardGrid";

const tc = (k: string) => i18n.t(`common:${k}`) as string;

const CHART: DashboardWidget = {
  id: "chart-a",
  type: "chart",
  title: "Apps",
  config: { query: { group_by: "type" }, chart: "bar" },
  layout: { x: 0, y: 0, w: 7, h: 5 },
};
const TODOS: DashboardWidget = {
  id: "todos",
  type: "my_todos",
  title: null,
  config: {},
  layout: { x: 7, y: 0, w: 5, h: 6, minW: 4 },
};
const WIDGETS = [CHART, TODOS];

function renderGrid(props: Partial<Parameters<typeof DashboardGrid>[0]> = {}) {
  const handlers = { onLayoutChange: vi.fn(), onConfigure: vi.fn(), onRemove: vi.fn() };
  // A new element each time: React skips re-rendering an element it has already rendered.
  const ui = () => <DashboardGrid widgets={WIDGETS} editing={false} {...handlers} {...props} />;
  const result = renderWithProviders(ui());
  /** Render again with the same props, as a new measured width would. */
  const rerenderGrid = () => result.rerender(wrapWithProviders(ui()));
  return { ...result, ...handlers, rerenderGrid };
}

const layoutChange = (layout: unknown[]) => act(() => rgl.props.onLayoutChange(layout, { lg: layout }));

const START = [
  { i: "chart-a", x: 0, y: 0, w: 7, h: 5 },
  { i: "todos", x: 7, y: 0, w: 5, h: 6, minW: 4 },
];

type Item = { i: string; x: number; y: number; w: number; h: number; minW?: number };

const resizeStart = (start: Item[], item: Item) =>
  act(() => rgl.props.onResizeStart(start, item, item, null, new Event("mousedown"), null));
/** One pointer move: the library's fresh, not yet compacted array, which it compacts and keeps next. */
const resizeMove = (moved: Item[], oldItem: Item, newItem: Item) =>
  act(() => rgl.props.onResize(moved, oldItem, newItem, null, new Event("mousemove"), null));
const resizeStop = (layout: Item[], oldItem: Item, newItem: Item) =>
  act(() => rgl.props.onResizeStop(layout, oldItem, newItem, null, new Event("mouseup"), null));

/**
 * The library's resize sequence for one move: start, the move (which may fit
 * the neighbour into `moved`), stop, and the library's own `onLayoutChange`
 * with its compacted result — `moved` itself unless the compaction pushed
 * something down.
 */
function resize(oldItem: Item, newItem: Item, moved: Item[], compacted: (moved: Item[]) => Item[] = (m) => m) {
  resizeStart(START, oldItem);
  resizeMove(moved, oldItem, newItem);
  resizeStop(compacted(moved), oldItem, newItem);
  layoutChange(compacted(moved));
}

/** The CSS rules of the grid container's own emotion class (not its nested handle rules). */
function ownRules(el: Element): string[] {
  const css = Array.from(document.head.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  const classes = Array.from(el.classList).filter((c) => c.startsWith("css-"));
  return classes.flatMap((c) => css.split("}").filter((rule) => rule.trim().startsWith(`.${c}{`)));
}

beforeEach(() => {
  hookState.reset();
  rgl.props = null;
  rgl.width = 1280;
  rgl.renders = 0;
});

describe("DashboardGrid", () => {
  it("renders every widget in its own grid item, inside its frame", () => {
    renderGrid();
    expect(within(screen.getByTestId("grid-item-chart-a")).getByText("body chart-a")).toBeInTheDocument();
    expect(within(screen.getByTestId("grid-item-chart-a")).getByText("Apps")).toBeInTheDocument();
    expect(within(screen.getByTestId("grid-item-todos")).getByText("body todos")).toBeInTheDocument();
  });

  it("hands react-grid-layout the stored 12-column layout for both wide breakpoints", () => {
    renderGrid();
    const p = rgl.props;
    expect(p.width).toBe(1280);
    expect(p.breakpoints).toEqual({ lg: 1200, md: 996, sm: 768, xs: 480 });
    expect(p.cols).toEqual({ lg: 12, md: 12, sm: 6, xs: 2 });
    expect(p.rowHeight).toBe(60);
    expect(p.margin).toEqual([16, 16]);
    expect(p.containerPadding).toEqual([0, 0]);
    expect(p.layouts.lg).toEqual([
      { i: "chart-a", x: 0, y: 0, w: 7, h: 5, minW: 3, minH: 3 },
      { i: "todos", x: 7, y: 0, w: 5, h: 6, minW: 4, minH: 3 },
    ]);
    expect(p.layouts.md).toBe(p.layouts.lg);
  });

  describe("narrow breakpoints", () => {
    const KPI_ROW: DashboardWidget[] = [0, 3, 6, 9].map((x, n) => ({
      id: `kpi-${n + 1}`,
      type: "kpi",
      title: null,
      config: {},
      layout: { x, y: 0, w: 3, h: 2 },
    }));
    const BELOW: DashboardWidget = { ...CHART, id: "chart-below", layout: { x: 0, y: 2, w: 12, h: 5 } };

    it("hands the library reflowed 6- and 2-column layouts instead of letting it clamp", () => {
      renderGrid({ widgets: [...KPI_ROW, BELOW] });
      const { sm, xs } = rgl.props.layouts;
      expect(sm.map((item: any) => [item.i, item.x, item.y, item.w, item.h])).toEqual([
        ["kpi-1", 0, 0, 2, 2],
        ["kpi-2", 2, 0, 2, 2],
        ["kpi-3", 4, 0, 2, 2],
        ["kpi-4", 0, 2, 2, 2],
        ["chart-below", 0, 4, 6, 5],
      ]);
      expect(xs.map((item: any) => [item.i, item.x, item.y, item.w])).toEqual([
        ["kpi-1", 0, 0, 2],
        ["kpi-2", 0, 2, 2],
        ["kpi-3", 0, 4, 2],
        ["kpi-4", 0, 6, 2],
        ["chart-below", 0, 8, 2],
      ]);
    });

    it("never puts two tiles of a row in the same column on six columns", () => {
      renderGrid({ widgets: KPI_ROW });
      const cells = rgl.props.layouts.sm.map((item: any) => `${item.y}:${item.x}`);
      expect(new Set(cells).size).toBe(KPI_ROW.length);
      expect(rgl.props.layouts.sm.every((item: any) => item.x + item.w <= 6)).toBe(true);
    });

    it("leaves the stored layout alone for the 12-column breakpoints", () => {
      renderGrid({ widgets: KPI_ROW });
      expect(rgl.props.layouts.lg.map((item: any) => item.x)).toEqual([0, 3, 6, 9]);
    });

    it("mirrors the reflowed layout in a right-to-left locale, the first widget opening the top-right row", () => {
      hookState.isRtl = true;
      renderGrid({ widgets: KPI_ROW });
      expect(rgl.props.layouts.sm.map((item: any) => [item.i, item.x, item.y])).toEqual([
        ["kpi-1", 4, 0],
        ["kpi-2", 2, 0],
        ["kpi-3", 0, 0],
        ["kpi-4", 4, 2],
      ]);
      expect(rgl.props.layouts.xs.map((item: any) => [item.i, item.x, item.y])).toEqual([
        ["kpi-1", 0, 0],
        ["kpi-2", 0, 2],
        ["kpi-3", 0, 4],
        ["kpi-4", 0, 6],
      ]);
    });
  });

  it("locks the grid outside customize mode and shows no widget toolbar", () => {
    renderGrid();
    expect(rgl.props.dragConfig).toEqual({ enabled: false, handle: ".dashboard-widget-drag-handle" });
    expect(rgl.props.resizeConfig).toEqual({ enabled: false, handles: ["e", "s", "se"] });
    expect(screen.queryByRole("button", { name: tc("dashboard.widgets.remove") })).not.toBeInTheDocument();
    expect(screen.queryByTestId("widget-drag-handle")).not.toBeInTheDocument();
  });

  it("enables dragging by the header and resizing in customize mode", () => {
    renderGrid({ editing: true });
    expect(rgl.props.dragConfig).toEqual({ enabled: true, handle: ".dashboard-widget-drag-handle" });
    expect(rgl.props.resizeConfig).toEqual({ enabled: true, handles: ["e", "s", "se"] });
    expect(screen.getAllByTestId("widget-drag-handle")).toHaveLength(2);
  });

  it("styles the handles for touch while customising only", () => {
    // The grid's own emotion class carries the handle rules: find them in the injected CSS.
    const rulesOf = (el: Element) => {
      const css = Array.from(document.head.querySelectorAll("style"))
        .map((s) => s.textContent ?? "")
        .join("\n");
      const classes = Array.from(el.classList).filter((c) => c.startsWith("css-"));
      return classes.flatMap((c) => css.split("}").filter((rule) => rule.includes(`.${c} .react-grid-item`) || rule.includes(`.${c} .dashboard-widget-drag-handle`)));
    };
    const { container, unmount } = renderGrid({ editing: true });
    const grid = container.querySelector(".dashboard-grid")!;
    const rules = rulesOf(grid);
    expect(rules.some((r) => r.includes(".react-resizable-handle{") && r.includes("touch-action:none"))).toBe(true);
    expect(rules.some((r) => r.includes(".dashboard-widget-drag-handle") && r.includes("touch-action:none"))).toBe(true);
    unmount();
    const locked = renderGrid({ editing: false }).container.querySelector(".dashboard-grid")!;
    expect(rulesOf(locked)).toEqual([]);
  });

  it("offers configure only on configurable widgets and reports configure / remove", async () => {
    const { user, onConfigure, onRemove } = renderGrid({ editing: true });
    const chartItem = within(screen.getByTestId("grid-item-chart-a"));
    const todosItem = within(screen.getByTestId("grid-item-todos"));
    expect(todosItem.queryByRole("button", { name: tc("dashboard.widgets.configure") })).not.toBeInTheDocument();
    await user.click(chartItem.getByRole("button", { name: tc("dashboard.widgets.configure") }));
    expect(onConfigure).toHaveBeenCalledWith(CHART);
    await user.click(todosItem.getByRole("button", { name: tc("dashboard.widgets.remove") }));
    expect(onRemove).toHaveBeenCalledWith(TODOS);
  });

  it("writes a moved widget back while customising", () => {
    const { onLayoutChange } = renderGrid({ editing: true });
    layoutChange([
      { i: "chart-a", x: 0, y: 6, w: 7, h: 5 },
      { i: "todos", x: 7, y: 0, w: 5, h: 6 },
    ]);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    expect(onLayoutChange).toHaveBeenCalledWith([{ ...CHART, layout: { x: 0, y: 6, w: 7, h: 5 } }, TODOS]);
  });

  describe("resizing", () => {
    const TODOS_AT = (x: number, w: number, y = 0) => ({ i: "todos", x, y, w, h: 6, minW: 4 });

    it("narrows the widget beside a widened one on the move itself, and writes it once", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const grown = { i: "chart-a", x: 0, y: 0, w: 8, h: 5 };
      const moved = [grown, { ...START[1] }];
      resizeMove(moved, START[0], grown); // no start yet: nothing to measure from
      expect(moved[1]).toEqual(START[1]);
      resizeStart(START, START[0]);
      resizeMove(moved, START[0], grown);
      // The library compacts this array next: the neighbour is fitted in it, not pushed below.
      expect(moved[0]).toBe(grown);
      expect(moved[1]).toEqual(TODOS_AT(8, 4));
      resizeStop(moved, START[0], grown);
      expect(onLayoutChange).not.toHaveBeenCalled();
      layoutChange(moved);
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      expect(onLayoutChange).toHaveBeenCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 8, h: 5 } },
        { ...TODOS, layout: { x: 8, y: 0, w: 4, h: 6, minW: 4 } },
      ]);
    });

    it("widens the widget beside a narrowed one", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const shrunk = { i: "chart-a", x: 0, y: 0, w: 5, h: 5 };
      const moved = [shrunk, { ...START[1] }];
      resize(START[0], shrunk, moved);
      expect(moved[1]).toEqual(TODOS_AT(5, 7));
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      expect(onLayoutChange).toHaveBeenCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 5, h: 5 } },
        { ...TODOS, layout: { x: 5, y: 0, w: 7, h: 6, minW: 4 } },
      ]);
    });

    it("leaves a neighbour that cannot give the width up to wrap below", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const grown = { i: "chart-a", x: 0, y: 0, w: 9, h: 5 };
      const todos = { ...START[1] };
      const moved = [grown, todos];
      // The library's compaction pushes the untouched todos under the chart.
      resize(START[0], grown, moved, (m) => [m[0], { ...m[1], y: 5 }]);
      expect(moved[1]).toBe(todos);
      expect(todos).toEqual(START[1]);
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      expect(onLayoutChange).toHaveBeenCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 9, h: 5 } },
        { ...TODOS, layout: { x: 7, y: 5, w: 5, h: 6, minW: 4 } },
      ]);
    });

    it("gives the neighbour its place back when the widget returns to its starting width", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const grown = { i: "chart-a", x: 0, y: 0, w: 8, h: 5 };
      resizeStart(START, START[0]);
      const first = [grown, { ...START[1] }];
      resizeMove(first, START[0], grown);
      // The next move starts from the library's layout, which holds the fitted neighbour.
      const fitted = first[1];
      const back = [{ ...START[0] }, fitted];
      resizeMove(back, START[0], START[0]);
      expect(back[1]).toEqual(START[1]);
      expect(fitted).toEqual(TODOS_AT(8, 4));
      resizeStop(back, START[0], START[0]);
      layoutChange(back);
      expect(onLayoutChange).not.toHaveBeenCalled();
    });

    it("pushes the neighbour below at its own width once the widget outgrows what it can give", () => {
      renderGrid({ editing: true });
      resizeStart(START, START[0]);
      const first = [{ ...START[0], w: 8 }, { ...START[1] }];
      resizeMove(first, START[0], first[0]);
      const fitted = first[1];
      const further = [{ ...START[0], w: 9 }, fitted];
      resizeMove(further, START[0], further[0]);
      // Back to its starting column and width, still overlapping: the compaction wraps it.
      expect(further[1]).toEqual(START[1]);
      expect(fitted).toEqual(TODOS_AT(8, 4));
    });

    it("keeps a pushed-down neighbour's row when it gives it its width back", () => {
      renderGrid({ editing: true });
      resizeStart(START, START[0]);
      const pushed = TODOS_AT(7, 5, 5);
      const moved = [{ ...START[0], w: 9 }, pushed];
      resizeMove(moved, START[0], moved[0]);
      expect(moved[1]).toBe(pushed);
    });

    it("touches nothing on a height-only resize", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const taller = { i: "chart-a", x: 0, y: 0, w: 7, h: 7 };
      const todos = { ...START[1] };
      const moved = [taller, todos];
      resize(START[0], taller, moved);
      expect(moved).toEqual([taller, START[1]]);
      expect(moved[1]).toBe(todos);
      expect(onLayoutChange).toHaveBeenCalledWith([{ ...CHART, layout: { x: 0, y: 0, w: 7, h: 7 } }, TODOS]);
    });

    it("touches nothing outside customize mode", () => {
      const { onLayoutChange } = renderGrid({ editing: false });
      const grown = { i: "chart-a", x: 0, y: 0, w: 8, h: 5 };
      const todos = { ...START[1] };
      const moved = [grown, todos];
      resize(START[0], grown, moved, (m) => [m[0], { ...m[1], y: 5 }]);
      expect(moved[1]).toBe(todos);
      expect(onLayoutChange).not.toHaveBeenCalled();
    });

    it("measures the next resize from its own start", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const grown = { i: "chart-a", x: 0, y: 0, w: 8, h: 5 };
      resize(START[0], grown, [grown, { ...START[1] }]);
      // After the stop, a stray move without a new start changes nothing.
      const stray = [{ ...grown, w: 9 }, TODOS_AT(8, 4)];
      resizeMove(stray, grown, stray[0]);
      expect(stray[1]).toEqual(TODOS_AT(8, 4));
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
    });
  });

  describe("width during a gesture", () => {
    it("holds the grid's width from the start of a resize to its end", () => {
      const { rerenderGrid } = renderGrid({ editing: true });
      resizeStart(START, START[0]);
      rgl.width = 1265; // a scrollbar appeared
      rerenderGrid();
      expect(rgl.props.width).toBe(1280);
      resizeStop([...START], START[0], START[0]);
      rerenderGrid();
      expect(rgl.props.width).toBe(1265);
    });

    it("holds the grid's width from the start of a drag to its end", () => {
      const { rerenderGrid } = renderGrid({ editing: true });
      act(() => rgl.props.onDragStart(START, START[0], START[0], null, new Event("mousedown"), null));
      rgl.width = 1265;
      rerenderGrid();
      expect(rgl.props.width).toBe(1280);
      act(() => rgl.props.onDragStop(START, START[0], START[0], null, new Event("mouseup"), null));
      rerenderGrid();
      expect(rgl.props.width).toBe(1265);
    });

    it("keeps customize mode on while a gesture holds the width", () => {
      const { rerenderGrid } = renderGrid({ editing: true });
      act(() => rgl.props.onDragStart(START, START[0], START[0], null, new Event("mousedown"), null));
      rgl.width = 700;
      rerenderGrid();
      expect(rgl.props.dragConfig.enabled).toBe(true);
      act(() => rgl.props.onDragStop(START, START[0], START[0], null, new Event("mouseup"), null));
      expect(rgl.props.dragConfig.enabled).toBe(false);
    });
  });

  describe("customize-mode room below", () => {
    it("leaves four empty rows under the last widget while customising, and draws no dots", () => {
      const { container } = renderGrid({ editing: true });
      const rules = ownRules(container.querySelector(".dashboard-grid")!).join("\n");
      expect(rules).toContain("padding-bottom:256px");
      expect(rules).not.toContain("radial-gradient");
      expect(rules).not.toContain("background-size");
    });

    it("has no room below outside customize mode", () => {
      const { container } = renderGrid({ editing: false });
      expect(ownRules(container.querySelector(".dashboard-grid")!).join("\n")).not.toContain("padding-bottom");
    });

    it("has no room below on a narrow screen, where nothing can be arranged", () => {
      rgl.width = 700;
      const { container } = renderGrid({ editing: true });
      expect(ownRules(container.querySelector(".dashboard-grid")!).join("\n")).not.toContain("padding-bottom");
    });
  });

  describe("snapping the resized widget", () => {
    /** The grid's rules for the item being resized, from its injected emotion CSS. */
    function resizingRules(el: Element): string[] {
      const css = Array.from(document.head.querySelectorAll("style"))
        .map((s) => s.textContent ?? "")
        .join("\n");
      const classes = Array.from(el.classList).filter((c) => c.startsWith("css-"));
      return classes.flatMap((c) =>
        css.split("}").filter((rule) => rule.trim().startsWith(`.${c} .react-grid-item.resizing{`)),
      );
    }
    const FOUR_BY_TWO = { i: "chart-a", x: 0, y: 0, w: 4, h: 2 };

    it("draws the widget at its snapped size while it is resized, growing with its neighbour", () => {
      const { container } = renderGrid({ editing: true });
      const grid = container.querySelector(".dashboard-grid")!;
      expect(resizingRules(grid)).toEqual([]);
      resizeStart(START, START[0]);
      expect(resizingRules(grid)).toEqual([]);
      resizeMove([FOUR_BY_TWO, { ...START[1] }], START[0], FOUR_BY_TWO);
      const rules = resizingRules(grid);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toContain("width:416px!important");
      expect(rules[0]).toContain("height:136px!important");
      expect(rules[0]).toContain("transition:width 200ms ease,height 200ms ease");
    });

    it("measures the snapped size on the width held for the gesture", () => {
      const { container, rerenderGrid } = renderGrid({ editing: true });
      resizeStart(START, START[0]);
      rgl.width = 1000;
      rerenderGrid();
      resizeMove([FOUR_BY_TWO, { ...START[1] }], START[0], FOUR_BY_TWO);
      // On the held 1280 px, not the new 1000 px (where it would be 323 px).
      expect(resizingRules(container.querySelector(".dashboard-grid")!)[0]).toContain("width:416px!important");
    });

    it("follows the size as the pointer crosses into another cell", () => {
      const { container } = renderGrid({ editing: true });
      const grid = container.querySelector(".dashboard-grid")!;
      resizeStart(START, START[0]);
      resizeMove([FOUR_BY_TWO, { ...START[1] }], START[0], FOUR_BY_TWO);
      const wider = { ...FOUR_BY_TWO, w: 5, h: 3 };
      resizeMove([wider, { ...START[1] }], START[0], wider);
      const rules = resizingRules(grid);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toContain("width:524px!important");
      expect(rules[0]).toContain("height:212px!important");
    });

    it("lets the library size the widget again once the resize stops", () => {
      const { container } = renderGrid({ editing: true });
      const grid = container.querySelector(".dashboard-grid")!;
      resizeStart(START, START[0]);
      resizeMove([FOUR_BY_TWO, { ...START[1] }], START[0], FOUR_BY_TWO);
      resizeStop([FOUR_BY_TWO, { ...START[1] }], START[0], FOUR_BY_TWO);
      expect(resizingRules(grid)).toEqual([]);
    });

    it("re-renders nothing for a move that stays inside the same cell", () => {
      const { container } = renderGrid({ editing: true });
      const grid = container.querySelector(".dashboard-grid")!;
      resizeStart(START, START[0]);
      resizeMove([FOUR_BY_TWO, { ...START[1] }], START[0], FOUR_BY_TWO);
      const renders = rgl.renders;
      const className = grid.className;
      resizeMove([{ ...FOUR_BY_TWO }, { ...START[1] }], START[0], { ...FOUR_BY_TWO });
      expect(rgl.renders).toBe(renders);
      expect(grid.className).toBe(className);
      expect(resizingRules(grid)).toHaveLength(1);
    });

    it("snaps a widget with no row neighbour too", () => {
      const { container } = renderGrid({ editing: true, widgets: [CHART] });
      resizeStart([START[0]], START[0]);
      resizeMove([FOUR_BY_TWO], START[0], FOUR_BY_TWO);
      expect(resizingRules(container.querySelector(".dashboard-grid")!)[0]).toContain("width:416px!important");
    });

    it("snaps nothing outside customize mode", () => {
      const { container } = renderGrid({ editing: false });
      resizeStart(START, START[0]);
      resizeMove([FOUR_BY_TWO, { ...START[1] }], START[0], FOUR_BY_TWO);
      expect(resizingRules(container.querySelector(".dashboard-grid")!)).toEqual([]);
    });
  });

  it("ignores a layout callback that moves nothing", () => {
    const { onLayoutChange } = renderGrid({ editing: true });
    layoutChange([
      { i: "chart-a", x: 0, y: 0, w: 7, h: 5 },
      { i: "todos", x: 7, y: 0, w: 5, h: 6 },
    ]);
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("ignores layout callbacks outside customize mode", () => {
    const { onLayoutChange } = renderGrid();
    layoutChange([{ i: "chart-a", x: 3, y: 0, w: 7, h: 5 }]);
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("keeps a narrow screen from rearranging or rewriting the stored layout", () => {
    rgl.width = 700;
    const { onLayoutChange } = renderGrid({ editing: true });
    expect(rgl.props.dragConfig.enabled).toBe(false);
    expect(rgl.props.resizeConfig.enabled).toBe(false);
    layoutChange([{ i: "chart-a", x: 0, y: 3, w: 2, h: 5 }]);
    expect(onLayoutChange).not.toHaveBeenCalled();
  });

  it("still arranges on the medium breakpoint, which shows the same 12 columns", () => {
    rgl.width = 1000;
    const { onLayoutChange } = renderGrid({ editing: true });
    expect(rgl.props.dragConfig.enabled).toBe(true);
    layoutChange([{ i: "todos", x: 7, y: 1, w: 5, h: 6 }]);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
  });

  describe("right-to-left", () => {
    beforeEach(() => {
      hookState.isRtl = true;
    });

    it("lays the grid out left-to-right with mirrored items, each widget right-to-left", () => {
      const { container } = renderGrid();
      expect(container.querySelector(".dashboard-grid")).toHaveAttribute("dir", "ltr");
      expect(screen.getByTestId("grid-item-chart-a")).toHaveAttribute("dir", "rtl");
      expect(rgl.props.layouts.lg.map((item: any) => [item.i, item.x])).toEqual([
        ["chart-a", 5],
        ["todos", 0],
      ]);
    });

    it("mirrors a resize adjustment back before writing it", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      // Mirrored: the chart sits at x=5 (visual right), the todos at x=0.
      const start = [
        { i: "chart-a", x: 5, y: 0, w: 7, h: 5 },
        { i: "todos", x: 0, y: 0, w: 5, h: 6, minW: 4 },
      ];
      const shrunk = { i: "todos", x: 0, y: 0, w: 4, h: 6, minW: 4 };
      const moved = [{ ...start[0] }, shrunk];
      resizeStart(start, start[1]);
      resizeMove(moved, start[1], shrunk);
      expect(moved[0]).toEqual({ i: "chart-a", x: 4, y: 0, w: 8, h: 5 });
      resizeStop(moved, start[1], shrunk);
      layoutChange(moved);
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      expect(onLayoutChange).toHaveBeenCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 8, h: 5 } },
        { ...TODOS, layout: { x: 8, y: 0, w: 4, h: 6, minW: 4 } },
      ]);
    });

    it("mirrors a change back before writing it", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      // The admin drags the chart to the visual right edge of the mirrored grid.
      layoutChange([
        { i: "chart-a", x: 5, y: 6, w: 7, h: 5 },
        { i: "todos", x: 0, y: 0, w: 5, h: 6 },
      ]);
      expect(onLayoutChange).toHaveBeenCalledWith([{ ...CHART, layout: { x: 0, y: 6, w: 7, h: 5 } }, TODOS]);
    });
  });

  it("leaves left-to-right items without a dir of their own", () => {
    renderGrid();
    expect(screen.getByTestId("grid-item-chart-a")).not.toHaveAttribute("dir");
  });
});
