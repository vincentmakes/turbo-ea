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
  ScatterChart: "ScatterChart",
}));
vi.mock("echarts/components", () => ({
  GridComponent: "GridComponent",
  TooltipComponent: "TooltipComponent",
  LegendComponent: "LegendComponent",
  VisualMapComponent: "VisualMapComponent",
  MarkLineComponent: "MarkLineComponent",
  MarkAreaComponent: "MarkAreaComponent",
  AriaComponent: "AriaComponent",
}));
vi.mock("echarts/renderers", () => ({ CanvasRenderer: "CanvasRenderer" }));

import { installResizeObserver } from "@/test/dom";
import EChart, { ECHART_CLASS, EXPORT_DPR } from "./EChart";

let restoreRo: ReturnType<typeof installResizeObserver>;

beforeEach(() => {
  vi.clearAllMocks();
  restoreRo = installResizeObserver();
});
afterEach(() => restoreRo());

describe("EChart", () => {
  it("initialises a canvas chart on its container and sets the option whole", () => {
    const option = { series: [] };
    render(<EChart option={option} />);
    const el = screen.getByRole("img");
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

describe("EChart props", () => {
  const originalDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  function stubDeviceDpr(value: number | undefined) {
    Object.defineProperty(window, "devicePixelRatio", { value, configurable: true, writable: true });
  }
  afterEach(() => {
    if (originalDpr) Object.defineProperty(window, "devicePixelRatio", originalDpr);
    else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
  });

  it("passes a backing-store scale to init only when one is given", () => {
    stubDeviceDpr(1);
    const { unmount } = render(<EChart option={{}} ariaLabel="plain" />);
    expect(core.init.mock.calls[0][2]).toEqual({ renderer: "canvas" });
    expect(core.init.mock.calls[0][2]).not.toHaveProperty("devicePixelRatio");
    unmount();
    render(<EChart option={{}} ariaLabel="export" devicePixelRatio={EXPORT_DPR} />);
    const el = screen.getByRole("img", { name: "export" });
    expect(core.init).toHaveBeenLastCalledWith(el, null, { renderer: "canvas", devicePixelRatio: 2 });
  });

  it.each([
    ["a 1x screen", 1, 2],
    ["a 3x screen", 3, 3],
    ["a screen that reports no ratio", undefined, 2],
  ])("treats the given scale as a floor on %s", (_why, device, expected) => {
    stubDeviceDpr(device);
    render(<EChart option={{}} devicePixelRatio={2} />);
    expect(core.init.mock.calls[0][2]).toEqual({ renderer: "canvas", devicePixelRatio: expected });
  });

  it("raises a sub-1 floor to 1 on a screen that reports no ratio", () => {
    stubDeviceDpr(undefined);
    render(<EChart option={{}} devicePixelRatio={0.5} />);
    expect(core.init.mock.calls[0][2]).toEqual({ renderer: "canvas", devicePixelRatio: 1 });
  });

  it("keeps the scale it was initialised with", () => {
    stubDeviceDpr(1);
    const { rerender } = render(<EChart option={{}} devicePixelRatio={2} />);
    rerender(<EChart option={{}} devicePixelRatio={3} />);
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(core.init.mock.calls[0][2]).toEqual({ renderer: "canvas", devicePixelRatio: 2 });
  });

  it("hands the new instance to onInit once, before the first option is set", () => {
    const onInit = vi.fn(() => {
      // The option has not reached the chart yet.
      expect(chart.setOption).not.toHaveBeenCalled();
    });
    render(<EChart option={{ a: 1 }} onInit={onInit} />);
    expect(onInit).toHaveBeenCalledTimes(1);
    expect(onInit).toHaveBeenCalledWith(core.init.mock.results[0].value);
    expect(onInit.mock.calls[0]).toEqual([chart]);
    expect(chart.setOption).toHaveBeenCalledTimes(1);
  });

  it("does not re-initialise or call again when the onInit callback changes", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<EChart option={{}} onInit={first} />);
    rerender(<EChart option={{}} onInit={second} />);
    rerender(<EChart option={{ a: 2 }} onInit={second} />);
    expect(core.init).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(chart.dispose).not.toHaveBeenCalled();
  });

  it("mounts without an onInit callback", () => {
    expect(() => render(<EChart option={{}} ariaLabel="bare" />)).not.toThrow();
    expect(core.init).toHaveBeenCalledTimes(1);
  });

  it("is named by the element labelledBy points at", () => {
    render(
      <>
        <h2 id="chart-title">Cost by type</h2>
        <EChart option={{}} labelledBy="chart-title" />
      </>,
    );
    const el = screen.getByRole("img", { name: "Cost by type" });
    expect(el.getAttribute("aria-labelledby")).toBe("chart-title");
    expect(el.hasAttribute("aria-label")).toBe(false);
  });

  it("hands its name to ECharts' aria component as the description, on every option", () => {
    const { rerender } = render(<EChart option={{ a: 1 }} ariaLabel="Cards by Type" />);
    // The first paint is named by the attribute itself.
    expect(screen.getByRole("img", { name: "Cards by Type" })).toBeInTheDocument();
    expect(chart.setOption).toHaveBeenCalledTimes(1);
    expect(chart.setOption).toHaveBeenLastCalledWith(
      { a: 1, aria: { enabled: true, label: { description: "Cards by Type" } } },
      { notMerge: true },
    );
    rerender(<EChart option={{ a: 2 }} ariaLabel="Cards by Type" />);
    expect(chart.setOption).toHaveBeenCalledTimes(2);
    expect(chart.setOption.mock.calls[1][0].aria.label.description).toBe("Cards by Type");
    // A renamed chart describes itself by its new name, even with the same option.
    const same = { a: 2 };
    rerender(<EChart option={same} ariaLabel="Cards by Status" />);
    expect(chart.setOption.mock.calls[2][0].aria.label.description).toBe("Cards by Status");
    expect(screen.getByRole("img", { name: "Cards by Status" })).toBeInTheDocument();
    rerender(<EChart option={same} ariaLabel="Cards by Status" />);
    expect(chart.setOption).toHaveBeenCalledTimes(3);
  });

  it("keeps the option's own aria keys when it adds the description", () => {
    const option = { a: 1, aria: { enabled: false, decal: { show: true } } };
    render(<EChart option={option} ariaLabel="Cost" />);
    expect(chart.setOption).toHaveBeenCalledWith(
      { a: 1, aria: { enabled: true, decal: { show: true }, label: { description: "Cost" } } },
      { notMerge: true },
    );
    // The caller's option is not mutated.
    expect(option.aria).toEqual({ enabled: false, decal: { show: true } });
  });

  it("passes the option through untouched when it has no name of its own", () => {
    const option = { a: 1, aria: { enabled: true } };
    render(<EChart option={option} labelledBy="nowhere" />);
    expect(chart.setOption.mock.calls[0][0]).toBe(option);
    expect(screen.getByRole("img").hasAttribute("aria-label")).toBe(false);
  });

  it("carries the container class print.css sizes charts by", () => {
    render(<EChart option={{}} ariaLabel="x" />);
    expect(ECHART_CLASS).toBe("echart-container");
    expect(screen.getByRole("img", { name: "x" })).toHaveClass("echart-container");
    expect(EXPORT_DPR).toBe(2);
  });
});

describe("EChart print layout", () => {
  const original = window.matchMedia;
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { value: original, configurable: true, writable: true });
  });

  function installPrintQuery(list: Partial<MediaQueryList>) {
    const matchMedia = vi.fn(() => list as MediaQueryList);
    Object.defineProperty(window, "matchMedia", { value: matchMedia, configurable: true, writable: true });
    return matchMedia;
  }

  it("resizes when print layout starts or ends and stops listening on unmount", () => {
    const listeners = new Set<() => void>();
    const list = {
      addEventListener: vi.fn((type: string, cb: () => void) => {
        if (type === "change") listeners.add(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: () => void) => {
        if (type === "change") listeners.delete(cb);
      }),
    };
    const matchMedia = installPrintQuery(list as unknown as Partial<MediaQueryList>);
    const { unmount } = render(<EChart option={{}} />);
    expect(matchMedia).toHaveBeenCalledWith("print");
    expect(listeners.size).toBe(1);
    chart.resize.mockClear();
    for (const cb of listeners) cb();
    expect(chart.resize).toHaveBeenCalledTimes(1);
    const handler = list.addEventListener.mock.calls[0][1];
    unmount();
    expect(list.removeEventListener).toHaveBeenCalledWith("change", handler);
    expect(listeners.size).toBe(0);
  });

  it("mounts without a print listener where matchMedia is missing or legacy-only", () => {
    Object.defineProperty(window, "matchMedia", { value: undefined, configurable: true, writable: true });
    const first = render(<EChart option={{}} ariaLabel="a" />);
    expect(screen.getByRole("img", { name: "a" })).toBeInTheDocument();
    first.unmount();

    const addListener = vi.fn();
    installPrintQuery({ addListener } as unknown as Partial<MediaQueryList>);
    const second = render(<EChart option={{}} ariaLabel="b" />);
    expect(screen.getByRole("img", { name: "b" })).toBeInTheDocument();
    expect(() => second.unmount()).not.toThrow();
    expect(addListener).not.toHaveBeenCalled();
    expect(chart.dispose).toHaveBeenCalledTimes(2);
  });
});

describe("EChart registration", () => {
  it("registers only the charts, components and renderer the app uses", async () => {
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
      "ScatterChart",
      "GridComponent",
      "TooltipComponent",
      "LegendComponent",
      "VisualMapComponent",
      "MarkLineComponent",
      "MarkAreaComponent",
      "AriaComponent",
      "CanvasRenderer",
    ]);
  });
});
