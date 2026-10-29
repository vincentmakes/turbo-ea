import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import i18n from "@/i18n";
import type { DashboardWidget } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the grid props are inspected as plain data */

const rgl = vi.hoisted(() => ({ props: null as any, width: 1280 }));
vi.mock("react-grid-layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-grid-layout")>();
  return {
    ...actual,
    Responsive: (props: { children: ReactNode }) => {
      rgl.props = props;
      return <div data-testid="rgl">{props.children}</div>;
    },
    useContainerWidth: () => ({ width: rgl.width, containerRef: { current: null }, mounted: true }),
  };
});
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("./widgets/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./widgets/registry")>();
  const Stub = ({ widget }: { widget: DashboardWidget }) => <div>body {widget.id}</div>;
  return {
    ...actual,
    WIDGET_REGISTRY: Object.fromEntries(
      Object.entries(actual.WIDGET_REGISTRY).map(([type, entry]) => [type, { ...entry, Component: Stub }]),
    ),
  };
});

import { hookState } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
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
  const result = renderWithProviders(<DashboardGrid widgets={WIDGETS} editing={false} {...handlers} {...props} />);
  return { ...result, ...handlers };
}

const layoutChange = (layout: unknown[]) => act(() => rgl.props.onLayoutChange(layout, { lg: layout }));

const START = [
  { i: "chart-a", x: 0, y: 0, w: 7, h: 5 },
  { i: "todos", x: 7, y: 0, w: 5, h: 6, minW: 4 },
];

/** The library's resize sequence: start, stop with its own result, then the same result echoed. */
function resize(oldItem: (typeof START)[number], newItem: (typeof START)[number], after: unknown[]) {
  act(() => rgl.props.onResizeStart(START, oldItem, oldItem, null, new Event("mousedown"), null));
  act(() => rgl.props.onResizeStop(after, oldItem, newItem, null, new Event("mouseup"), null));
  layoutChange(after);
}

beforeEach(() => {
  hookState.reset();
  rgl.props = null;
  rgl.width = 1280;
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
    it("narrows the widget beside a widened one and ignores the library's echo", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const grown = { i: "chart-a", x: 0, y: 0, w: 8, h: 5 };
      // The library pushed the todos under the chart.
      resize(START[0], grown, [grown, { i: "todos", x: 7, y: 5, w: 5, h: 6, minW: 4 }]);
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      expect(onLayoutChange).toHaveBeenCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 8, h: 5 } },
        { ...TODOS, layout: { x: 8, y: 0, w: 4, h: 6, minW: 4 } },
      ]);
    });

    it("widens the widget beside a narrowed one", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const shrunk = { i: "chart-a", x: 0, y: 0, w: 5, h: 5 };
      resize(START[0], shrunk, [shrunk, START[1]]);
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      expect(onLayoutChange).toHaveBeenCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 5, h: 5 } },
        { ...TODOS, layout: { x: 5, y: 0, w: 7, h: 6, minW: 4 } },
      ]);
    });

    it("keeps the library's result when the neighbour cannot make room", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const grown = { i: "chart-a", x: 0, y: 0, w: 9, h: 5 };
      const pushed = { i: "todos", x: 7, y: 5, w: 5, h: 6, minW: 4 };
      resize(START[0], grown, [grown, pushed]);
      expect(onLayoutChange).toHaveBeenCalledTimes(1);
      expect(onLayoutChange).toHaveBeenCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 9, h: 5 } },
        { ...TODOS, layout: { x: 7, y: 5, w: 5, h: 6, minW: 4 } },
      ]);
    });

    it("still writes a later, different change after an adjustment", () => {
      const { onLayoutChange } = renderGrid({ editing: true });
      const grown = { i: "chart-a", x: 0, y: 0, w: 8, h: 5 };
      resize(START[0], grown, [grown, { i: "todos", x: 7, y: 5, w: 5, h: 6, minW: 4 }]);
      layoutChange([grown, { i: "todos", x: 8, y: 6, w: 4, h: 6, minW: 4 }]);
      expect(onLayoutChange).toHaveBeenCalledTimes(2);
      expect(onLayoutChange).toHaveBeenLastCalledWith([
        { ...CHART, layout: { x: 0, y: 0, w: 8, h: 5 } },
        { ...TODOS, layout: { x: 8, y: 6, w: 4, h: 6, minW: 4 } },
      ]);
    });

    it("writes nothing outside customize mode", () => {
      const { onLayoutChange } = renderGrid({ editing: false });
      const grown = { i: "chart-a", x: 0, y: 0, w: 8, h: 5 };
      resize(START[0], grown, [grown, { i: "todos", x: 7, y: 5, w: 5, h: 6, minW: 4 }]);
      expect(onLayoutChange).not.toHaveBeenCalled();
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
      act(() => rgl.props.onResizeStart(start, start[1], start[1], null, new Event("mousedown"), null));
      act(() => rgl.props.onResizeStop([start[0], shrunk], start[1], shrunk, null, new Event("mouseup"), null));
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
