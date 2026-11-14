/**
 * The app-wide React wrapper over `echarts/core` — dashboard widgets, reports
 * and extension charts all draw through it. It registers only the charts and
 * components the app uses (so the bundle tree-shakes), initialises on mount,
 * replaces the option on change, follows its container's size (and the switch
 * to and from print layout), prints as a flat picture of itself
 * (`printCopy.ts`) and disposes on unmount.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import * as echarts from "echarts/core";
import type { EChartsCoreOption, ECharts } from "echarts/core";
import {
  BarChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
} from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { drawPrintCopy, removePrintCopy } from "./printCopy";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  HeatmapChart,
  TreemapChart,
  SankeyChart,
  // An extension's quadrant plot: discs over shaded reference areas.
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  // Draws the PPM cost charts' dotted budget reference lines (a `markLine` on
  // the first line series, `features/ppm/cumulativeChartOption.ts`).
  MarkLineComponent,
  // The shaded reference areas behind that quadrant plot (a `markArea`).
  MarkAreaComponent,
  AriaComponent,
  CanvasRenderer,
]);

/**
 * The minimum canvas backing-store scale an exported report chart is drawn
 * at, so the PNG export's `pixelRatio: 2` capture (html-to-image) stays crisp
 * on a 1x screen. A denser screen keeps its own, higher scale.
 */
export const EXPORT_DPR = 2;

/** The class on every chart container — the hook `print.css` sizes charts by. */
export const ECHART_CLASS = "echart-container";

/** The subset of an ECharts mouse event a click handler needs. */
export interface EChartClickParams {
  componentType?: string;
  seriesType?: string;
  dataType?: string;
  name?: string;
  value?: unknown;
  data?: unknown;
  dataIndex?: number;
  event?: { event?: MouseEvent };
}

interface Props {
  option: EChartsCoreOption;
  onClick?: (params: EChartClickParams) => void;
  /** Right click on a datum; the native context menu is suppressed. */
  onContextMenu?: (params: EChartClickParams) => void;
  style?: CSSProperties;
  ariaLabel?: string;
  /** Id of the element that names the chart (its visible title). */
  labelledBy?: string;
  /**
   * The minimum canvas backing-store scale; the device's own when higher (and
   * when omitted). Read once, at init.
   */
  devicePixelRatio?: number;
  /**
   * Handed the ECharts instance once, right after it is created and before
   * the first option is set — for a consumer whose option reads the chart's
   * own state while ECharts renders it (the Cost treemap's tile rectangles).
   * The instance is disposed on unmount; a consumer that keeps it clears its
   * own reference if it cares.
   */
  onInit?: (chart: ECharts) => void;
}

export default function EChart({
  option,
  onClick,
  onContextMenu,
  style,
  ariaLabel,
  labelledBy,
  devicePixelRatio,
  onInit,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;
  const contextRef = useRef(onContextMenu);
  contextRef.current = onContextMenu;
  const dprRef = useRef(devicePixelRatio);
  // Read at init only: a new callback identity never re-creates the chart.
  const initRef = useRef(onInit);
  initRef.current = onInit;

  // Init / dispose with the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // A floor, not a pin: a 3x screen keeps drawing at 3x.
    const dpr = dprRef.current;
    const chart = echarts.init(el, null, {
      renderer: "canvas",
      ...(dpr !== undefined && { devicePixelRatio: Math.max(dpr, window.devicePixelRatio || 1) }),
    });
    chartRef.current = chart;
    initRef.current?.(chart);
    const handleClick = (params: unknown) => clickRef.current?.(params as EChartClickParams);
    chart.on("click", handleClick);
    const handleContext = (params: unknown) => {
      if (!contextRef.current) return;
      const p = params as EChartClickParams;
      p.event?.event?.preventDefault();
      contextRef.current?.(p);
    };
    chart.on("contextmenu", handleContext);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(el);
    }
    // Printing: entering print layout changes the page width without
    // necessarily firing the observer before the browser paginates, so the
    // chart is re-laid and drawn into its print copy synchronously (see
    // `drawPrintCopy`). Chrome and Firefox announce print through the print
    // media query; Safari through `beforeprint`. Both may fire: each start
    // redraws the one copy, so the last (print-layout) one wins.
    const startPrint = () => drawPrintCopy(el, chart);
    const endPrint = () => {
      removePrintCopy(el);
      if (chart.isDisposed()) return;
      chart.resize();
      chart.getZr().flush();
    };
    const media = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const print = typeof media?.addEventListener === "function" ? media : null;
    const onPrintChange = (event: MediaQueryListEvent) => (event.matches ? startPrint() : endPrint());
    print?.addEventListener("change", onPrintChange);
    window.addEventListener("beforeprint", startPrint);
    window.addEventListener("afterprint", endPrint);
    return () => {
      observer?.disconnect();
      print?.removeEventListener("change", onPrintChange);
      window.removeEventListener("beforeprint", startPrint);
      window.removeEventListener("afterprint", endPrint);
      removePrintCopy(el);
      chart.off("click", handleClick);
      chart.off("contextmenu", handleContext);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // A new option replaces the old one whole: a category that disappeared
  // must not linger from a merge. ECharts' aria component writes the
  // container's `aria-label`; a chart with a name of its own hands that name
  // to the component as its description, so the generated summary never
  // replaces it. Without one, the option goes through untouched.
  useEffect(() => {
    const named =
      ariaLabel === undefined
        ? option
        : {
            ...option,
            aria: {
              ...(option.aria as Record<string, unknown> | undefined),
              enabled: true,
              label: { description: ariaLabel },
            },
          };
    chartRef.current?.setOption(named, { notMerge: true });
  }, [option, ariaLabel]);

  return (
    <div
      ref={containerRef}
      role="img"
      className={ECHART_CLASS}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      style={{ width: "100%", height: "100%", minHeight: 0, ...style }}
    />
  );
}
