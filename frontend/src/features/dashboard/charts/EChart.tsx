/**
 * A minimal React wrapper over `echarts/core`: registers only the charts and
 * components the dashboard uses (so the bundle tree-shakes), initialises on
 * mount, replaces the option on change, follows its container's size and
 * disposes on unmount.
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
  TreemapChart,
} from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  HeatmapChart,
  TreemapChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  AriaComponent,
  CanvasRenderer,
]);

/** The subset of an ECharts mouse event a click handler needs. */
export interface EChartClickParams {
  componentType?: string;
  seriesType?: string;
  dataType?: string;
  name?: string;
  value?: unknown;
  data?: unknown;
  dataIndex?: number;
}

interface Props {
  option: EChartsCoreOption;
  onClick?: (params: EChartClickParams) => void;
  style?: CSSProperties;
  ariaLabel?: string;
}

export default function EChart({ option, onClick, style, ariaLabel }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  // Init / dispose with the container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, null, { renderer: "canvas" });
    chartRef.current = chart;
    const handleClick = (params: unknown) => clickRef.current?.(params as EChartClickParams);
    chart.on("click", handleClick);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => chart.resize());
      observer.observe(el);
    }
    return () => {
      observer?.disconnect();
      chart.off("click", handleClick);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // A new option replaces the old one whole: a category that disappeared
  // must not linger from a merge.
  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height: "100%", minHeight: 0, ...style }}
    />
  );
}
