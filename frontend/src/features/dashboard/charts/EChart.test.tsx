import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getDom: vi.fn(),
}));
const core = vi.hoisted(() => ({ init: vi.fn(() => chart), use: vi.fn() }));
vi.mock("echarts/core", () => core);
vi.mock("echarts/charts", () => ({
  BarChart: "BarChart",
  LineChart: "LineChart",
  PieChart: "PieChart",
  GaugeChart: "GaugeChart",
  HeatmapChart: "HeatmapChart",
  TreemapChart: "TreemapChart",
  SankeyChart: "SankeyChart",
}));
vi.mock("echarts/components", () => ({
  GridComponent: "GridComponent",
  TooltipComponent: "TooltipComponent",
  LegendComponent: "LegendComponent",
  VisualMapComponent: "VisualMapComponent",
  AriaComponent: "AriaComponent",
}));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: "CanvasRenderer" }));

import { installResizeObserver } from "@/test/dom";
import EChart from "./EChart";

let restoreRo: ReturnType<typeof installResizeObserver>;

beforeEach(() => {
  vi.clearAllMocks();
  restoreRo = installResizeObserver();
});
afterEach(() => restoreRo());

describe("EChart", () => {
  it("initialises a canvas chart on its container and sets the option whole", () => {
    const option = { series: [] };
    render(<EChart option={option} ariaLabel="Cards by Type" />);
    const el = screen.getByRole("img", { name: "Cards by Type" });
    expect(core.init).toHaveBeenCalledWith(el, null, { renderer: "canvas" });
    expect(chart.setOption).toHaveBeenCalledWith(option, { notMerge: true });
    expect(restoreRo.observed).toContain(el);
  });

  it("replaces the option on change without re-initialising", () => {
    const { rerender } = render(<EChart option={{ a: 1 }} />);
    const next = { a: 2 };
    rerender(<EChart option={next} />);
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenLastCalledWith(next, { notMerge: true });
  });

  it("passes clicks to the latest handler", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<EChart option={{}} onClick={first} />);
    const handler = chart.on.mock.calls.find((c) => c[0] === "click")?.[1] as (p: unknown) => void;
    rerender(<EChart option={{}} onClick={second} />);
    handler({ data: { key: "Application" } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ data: { key: "Application" } });
  });

  it("disposes the chart and stops listening on unmount", () => {
    const { unmount } = render(<EChart option={{}} />);
    const handler = chart.on.mock.calls[0][1];
    unmount();
    expect(chart.off).toHaveBeenCalledWith("click", handler);
    expect(chart.dispose).toHaveBeenCalledTimes(1);
  });

  it("fills its parent and accepts extra style", () => {
    render(<EChart option={{}} ariaLabel="x" style={{ minHeight: 120 }} />);
    const el = screen.getByRole("img", { name: "x" });
    expect(el.style.width).toBe("100%");
    expect(el.style.height).toBe("100%");
    expect(el.style.minHeight).toBe("120px");
  });
});

describe("EChart registration", () => {
  it("registers only the charts, components and renderer the dashboard uses", async () => {
    vi.resetModules();
    core.use.mockClear();
    await import("./EChart");
    expect(core.use).toHaveBeenCalledTimes(1);
    expect(core.use.mock.calls[0][0]).toEqual([
      "BarChart",
      "LineChart",
      "PieChart",
      "GaugeChart",
      "HeatmapChart",
      "TreemapChart",
      "SankeyChart",
      "GridComponent",
      "TooltipComponent",
      "LegendComponent",
      "VisualMapComponent",
      "AriaComponent",
      "CanvasRenderer",
    ]);
  });
});
