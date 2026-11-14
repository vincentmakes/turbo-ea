import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

const zr = vi.hoisted(() => ({ flush: vi.fn() }));
const chart = vi.hoisted(() => ({
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  getDom: vi.fn(),
  getZr: vi.fn(() => zr),
  isDisposed: vi.fn(() => false),
  renderToCanvas: vi.fn(),
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
import { ECHART_PRINT_COPY_CLASS, ECHART_PRINTING_CLASS, PRINT_PIXEL_RATIO } from "./printCopy";

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

  it("calls onContextMenu with the datum and prevents the native menu", () => {
    const onContextMenu = vi.fn();
    render(<EChart option={{}} onContextMenu={onContextMenu} />);
    const handler = chart.on.mock.calls.find((c) => c[0] === "contextmenu")?.[1] as (
      p: unknown,
    ) => void;
    const preventDefault = vi.fn();
    const params = { data: { id: "a" }, event: { event: { preventDefault } } };
    handler(params);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onContextMenu).toHaveBeenCalledWith(params);
  });

  it("leaves the native menu alone without the prop", () => {
    render(<EChart option={{}} />);
    const handler = chart.on.mock.calls.find((c) => c[0] === "contextmenu")?.[1] as (
      p: unknown,
    ) => void;
    const preventDefault = vi.fn();
    handler({ event: { event: { preventDefault } } });
    expect(preventDefault).not.toHaveBeenCalled();
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

describe("EChart print copy", () => {
  const original = window.matchMedia;
  type ChangeListener = (event: { matches: boolean }) => void;
  let changeListeners: Set<ChangeListener>;
  let list: { addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
  let calls: string[];
  let drawImage: ReturnType<typeof vi.fn>;
  let getContext: ReturnType<typeof vi.spyOn>;

  /** A stand-in for the bitmap ECharts renders the chart into. */
  function picture(width = 900, height = 300) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  beforeEach(() => {
    changeListeners = new Set();
    list = {
      addEventListener: vi.fn((type: string, cb: ChangeListener) => {
        if (type === "change") changeListeners.add(cb);
      }),
      removeEventListener: vi.fn((type: string, cb: ChangeListener) => {
        if (type === "change") changeListeners.delete(cb);
      }),
    };
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => list),
      configurable: true,
      writable: true,
    });
    calls = [];
    chart.resize.mockImplementation(() => calls.push("resize"));
    zr.flush.mockImplementation(() => calls.push("flush"));
    chart.isDisposed.mockReturnValue(false);
    chart.renderToCanvas.mockImplementation(() => {
      calls.push("render");
      return picture();
    });
    drawImage = vi.fn();
    getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => ({ drawImage }) as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { value: original, configurable: true, writable: true });
    chart.resize.mockReset();
    zr.flush.mockReset();
    chart.renderToCanvas.mockReset();
    getContext.mockRestore();
  });

  const mediaChange = (matches: boolean) => act(() => changeListeners.forEach((cb) => cb({ matches })));
  const windowEvent = (type: "beforeprint" | "afterprint") =>
    act(() => {
      window.dispatchEvent(new Event(type));
    });
  const copies = (el: HTMLElement) => el.querySelectorAll(`.${ECHART_PRINT_COPY_CLASS}`);

  function mount() {
    const view = render(
      <div style={{ backgroundColor: "rgb(10, 20, 30)" }}>
        <EChart option={{}} ariaLabel="Spend" />
      </div>,
    );
    const el = screen.getByRole("img", { name: "Spend" });
    calls = [];
    chart.resize.mockClear();
    zr.flush.mockClear();
    return { ...view, el };
  }

  it("on the print media change, re-lays the chart, flushes it, then shows a flat opaque copy in its place", () => {
    const { el } = mount();
    expect(copies(el)).toHaveLength(0);
    mediaChange(true);
    expect(calls).toEqual(["resize", "flush", "render"]);
    expect(chart.renderToCanvas).toHaveBeenCalledWith({
      pixelRatio: PRINT_PIXEL_RATIO,
      backgroundColor: "rgb(10, 20, 30)",
    });
    expect(PRINT_PIXEL_RATIO).toBe(3);
    const [copy] = copies(el) as NodeListOf<HTMLCanvasElement>;
    expect(copy.tagName).toBe("CANVAS");
    expect(copy.parentElement).toBe(el);
    expect(el.lastElementChild).toBe(copy);
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    expect(copy.width).toBe(900);
    expect(copy.height).toBe(300);
    expect(copy.style.width).toBe("100%");
    expect(copy.style.height).toBe("100%");
    // The copy's only drawing: one image of the rendered bitmap.
    const rendered = chart.renderToCanvas.mock.results[0].value;
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage).toHaveBeenCalledWith(rendered, 0, 0);
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(el).toHaveClass(ECHART_PRINTING_CLASS);
    expect(ECHART_PRINT_COPY_CLASS).toBe("echart-print-copy");
    expect(ECHART_PRINTING_CLASS).toBe("echart-printing");
  });

  it("does the same on beforeprint, and keeps one copy, drawn last, when the media change follows", () => {
    const { el } = mount();
    windowEvent("beforeprint");
    expect(calls).toEqual(["resize", "flush", "render"]);
    expect(copies(el)).toHaveLength(1);
    const first = copies(el)[0];
    mediaChange(true);
    expect(copies(el)).toHaveLength(1);
    expect(copies(el)[0]).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(chart.renderToCanvas).toHaveBeenCalledTimes(2);
    expect(drawImage).toHaveBeenLastCalledWith(chart.renderToCanvas.mock.results[1].value, 0, 0);
    expect(el).toHaveClass(ECHART_PRINTING_CLASS);
  });

  it.each([
    ["afterprint", () => windowEvent("afterprint")],
    ["the media change back", () => mediaChange(false)],
  ])("on %s, removes the copy, shows the live chart and re-lays it", (_why, end) => {
    const { el } = mount();
    mediaChange(true);
    calls = [];
    end();
    expect(copies(el)).toHaveLength(0);
    expect(el).not.toHaveClass(ECHART_PRINTING_CLASS);
    expect(calls).toEqual(["resize", "flush"]);
    expect(chart.renderToCanvas).toHaveBeenCalledTimes(1);
  });

  it("cleans up the copy and every print listener when unmounted mid-print", () => {
    const { el, unmount } = mount();
    windowEvent("beforeprint");
    expect(copies(el)).toHaveLength(1);
    const change = list.addEventListener.mock.calls[0][1];
    unmount();
    expect(copies(el)).toHaveLength(0);
    expect(el).not.toHaveClass(ECHART_PRINTING_CLASS);
    expect(list.removeEventListener).toHaveBeenCalledWith("change", change);
    expect(changeListeners.size).toBe(0);
    chart.renderToCanvas.mockClear();
    calls = [];
    windowEvent("beforeprint");
    windowEvent("afterprint");
    expect(chart.renderToCanvas).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("does nothing for a disposed chart, on either end of printing", () => {
    const { el } = mount();
    chart.isDisposed.mockReturnValue(true);
    expect(() => windowEvent("beforeprint")).not.toThrow();
    expect(() => windowEvent("afterprint")).not.toThrow();
    expect(calls).toEqual([]);
    expect(copies(el)).toHaveLength(0);
    expect(el).not.toHaveClass(ECHART_PRINTING_CLASS);
  });

  it.each([
    ["no width", 0, 300],
    ["no height", 900, 0],
  ])("leaves the live chart in place when it renders with %s", (_why, width, height) => {
    const { el } = mount();
    chart.renderToCanvas.mockImplementation(() => picture(width, height));
    expect(() => mediaChange(true)).not.toThrow();
    expect(copies(el)).toHaveLength(0);
    expect(el).not.toHaveClass(ECHART_PRINTING_CLASS);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("still puts the copy in place where the canvas has no 2D context", () => {
    getContext.mockImplementation(() => null);
    const { el } = mount();
    expect(() => mediaChange(true)).not.toThrow();
    expect(copies(el)).toHaveLength(1);
  });
});

describe("EChart without a print media query", () => {
  const original = window.matchMedia;
  afterEach(() => {
    Object.defineProperty(window, "matchMedia", { value: original, configurable: true, writable: true });
  });

  it("mounts where matchMedia is missing or legacy-only, and still prints on beforeprint", () => {
    Object.defineProperty(window, "matchMedia", { value: undefined, configurable: true, writable: true });
    const first = render(<EChart option={{}} ariaLabel="a" />);
    expect(screen.getByRole("img", { name: "a" })).toBeInTheDocument();
    first.unmount();

    const addListener = vi.fn();
    Object.defineProperty(window, "matchMedia", {
      value: vi.fn(() => ({ addListener })),
      configurable: true,
      writable: true,
    });
    // A zero-size render: the print path runs, no copy is drawn.
    chart.renderToCanvas.mockImplementation(() => Object.assign(document.createElement("canvas"), { width: 0 }));
    const second = render(<EChart option={{}} ariaLabel="b" />);
    expect(screen.getByRole("img", { name: "b" })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(chart.renderToCanvas).toHaveBeenCalledTimes(1);
    expect(() => second.unmount()).not.toThrow();
    expect(addListener).not.toHaveBeenCalled();
    expect(chart.dispose).toHaveBeenCalledTimes(2);
    chart.renderToCanvas.mockReset();
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
