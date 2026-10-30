import { describe, it, expect, vi, beforeEach } from "vitest";

// The real builder, wrapped so a test can also read the context it was given.
vi.mock("@/features/dashboard/charts/buildOption", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/features/dashboard/charts/buildOption")>();
  return { ...mod, buildOption: vi.fn(mod.buildOption) };
});

import { buildOption, type BuildContext } from "@/features/dashboard/charts/buildOption";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { RAG_COLORS, SEVERITY_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import {
  AUTOMATION_COLOR,
  BPM_NEUTRAL_COLOR,
  DIMENSIONS,
  MATURITY_COLORS,
  assessmentTrendOption,
  automationColumnOption,
  maturityColor,
  maturityColumnOption,
  processTypePieOption,
} from "./bpmChartOptions";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

const chrome = buildEChartsChrome({
  mode: "light",
  text: { primary: "#111111", secondary: "#666666" },
  divider: "#dddddd",
  background: { paper: "#ffffff" },
  action: { hover: "#f5f5f5" },
});

const LABELS: Record<string, string> = { a: "Alpha", b: "Beta", c: "Gamma" };
const COLORS: Record<string, string> = { a: "#aa0000", b: "#00bb00", c: "#0000cc" };
const label = (key: string) => LABELS[key] ?? key;
const color = (key: string) => COLORS[key] ?? "#999999";
const rows = [
  { key: "a", value: 3 },
  { key: "b", value: 5 },
  { key: "c", value: 1 },
];

const ctxOf = (call = 0) => vi.mocked(buildOption).mock.calls[call][2] as BuildContext;

beforeEach(() => {
  vi.mocked(buildOption).mockClear();
});

describe("MATURITY_COLORS", () => {
  it("maps the CMMI scale worst-to-best onto the severity hues", () => {
    expect(MATURITY_COLORS).toEqual({
      initial: SEVERITY_COLORS.critical,
      managed: SEVERITY_COLORS.high,
      defined: SEVERITY_COLORS.medium,
      measured: SEVERITY_COLORS.low,
      optimized: RAG_COLORS.green,
    });
  });

  it("keeps the neutral grey and the brand blue as the other two hues", () => {
    expect(BPM_NEUTRAL_COLOR).toBe(STATUS_COLORS.neutral);
    expect(AUTOMATION_COLOR).toBe(brand.primary);
  });
});

describe("maturityColor", () => {
  it("prefers the metamodel option's colour", () => {
    expect(maturityColor("initial", "#123456")).toBe("#123456");
  });

  it("falls back to the CMMI scale when the option has no colour", () => {
    expect(maturityColor("measured")).toBe(SEVERITY_COLORS.low);
    expect(maturityColor("optimized", "")).toBe(RAG_COLORS.green);
  });

  it("falls back to neutral for a level the scale does not know", () => {
    expect(maturityColor("custom")).toBe(STATUS_COLORS.neutral);
  });
});

describe("processTypePieOption", () => {
  it("draws a clickable pie of resolved labels and colours, keyed by the raw key", () => {
    const option = processTypePieOption(rows, { chrome, isRtl: false, label, color, seriesName: "Processes" }) as any;
    expect(vi.mocked(buildOption).mock.calls[0][0]).toBe("pie");
    const s = option.series[0];
    expect(s.type).toBe("pie");
    expect(s.name).toBe("Processes");
    expect(s.cursor).toBe("pointer");
    expect(s.data).toEqual([
      expect.objectContaining({ key: "a", name: "Alpha", value: 3, itemStyle: { color: "#aa0000" } }),
      expect.objectContaining({ key: "b", name: "Beta", value: 5, itemStyle: { color: "#00bb00" } }),
      expect.objectContaining({ key: "c", name: "Gamma", value: 1, itemStyle: { color: "#0000cc" } }),
    ]);
    expect(option.legend.data).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(option.legend.left).toBe("left");
  });

  it("hands the chrome and the RTL flag through", () => {
    const option = processTypePieOption(rows, { chrome, isRtl: true, label, color, seriesName: "P" }) as any;
    expect(ctxOf().theme).toBe(chrome);
    expect(ctxOf().isRtl).toBe(true);
    expect(option.legend.left).toBe("right");
  });
});

describe("maturityColumnOption", () => {
  it("draws one clickable column per level in its own colour, labelled by the resolver", () => {
    const option = maturityColumnOption(rows, { chrome, isRtl: false, label, color, seriesName: "Processes" }) as any;
    expect(vi.mocked(buildOption).mock.calls[0][0]).toBe("column");
    expect(ctxOf().colorByCategory).toBe(true);
    expect(option.xAxis.data).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(option.xAxis.inverse).toBe(false);
    expect(option.xAxis.axisLabel).toMatchObject({ interval: 0, hideOverlap: true });
    expect(option.yAxis.position).toBe("left");
    const s = option.series[0];
    expect(s.type).toBe("bar");
    expect(s.name).toBe("Processes");
    expect(s.cursor).toBe("pointer");
    expect(s.data.map((d: any) => d.key)).toEqual(["a", "b", "c"]);
    expect(s.data.map((d: any) => d.value)).toEqual([3, 5, 1]);
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual(["#aa0000", "#00bb00", "#0000cc"]);
  });

  it("mirrors in RTL", () => {
    const option = maturityColumnOption(rows, { chrome, isRtl: true, label, color, seriesName: "P" }) as any;
    expect(ctxOf().theme).toBe(chrome);
    expect(option.xAxis.inverse).toBe(true);
    expect(option.yAxis.position).toBe("right");
  });
});

describe("automationColumnOption", () => {
  it("draws one clickable series in the brand blue, labelled by the resolver", () => {
    const option = automationColumnOption(rows, { chrome, isRtl: false, label, seriesName: "Processes" }) as any;
    expect(vi.mocked(buildOption).mock.calls[0][0]).toBe("column");
    const ctx = ctxOf();
    expect(ctx.colorByCategory).toBe(false);
    expect(ctx.seriesColor).toBe(brand.primary);
    expect(ctx.colors("anything", 0)).toBe(brand.primary);
    expect(option.xAxis.data).toEqual(["Alpha", "Beta", "Gamma"]);
    const s = option.series[0];
    expect(s.name).toBe("Processes");
    expect(s.cursor).toBe("pointer");
    expect(s.data.map((d: any) => d.key)).toEqual(["a", "b", "c"]);
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual([brand.primary, brand.primary, brand.primary]);
  });

  it("mirrors in RTL", () => {
    const option = automationColumnOption(rows, { chrome, isRtl: true, label, seriesName: "P" }) as any;
    expect(ctxOf().theme).toBe(chrome);
    expect(option.xAxis.inverse).toBe(true);
    expect(option.yAxis.position).toBe("right");
  });
});

describe("DIMENSIONS", () => {
  it("lists the five assessment dimensions in form order", () => {
    expect(DIMENSIONS.map((d) => d.key)).toEqual([
      "overall_score",
      "efficiency",
      "effectiveness",
      "compliance",
      "automation",
    ]);
    expect(DIMENSIONS.map((d) => d.label)).toEqual([
      "Overall",
      "Efficiency",
      "Effectiveness",
      "Compliance",
      "Automation",
    ]);
    expect(DIMENSIONS.map((d) => d.color)).toEqual(["#1976d2", "#4caf50", "#ff9800", "#9c27b0", "#00bcd4"]);
  });
});

describe("assessmentTrendOption", () => {
  const points = [
    { date: "01 May 2025", scores: [3, 2, 3, 4, 1] },
    { date: "15 Jun 2025", scores: [4, 3, 4, 5, 2] },
  ];
  const dims = [
    { label: "One", color: "#010101" },
    { label: "Two", color: "#020202" },
  ];

  it("spreads the shared base and insets the grid above the legend band", () => {
    const option = assessmentTrendOption(points, dims, { chrome, isRtl: false }) as any;
    expect(option.backgroundColor).toBe("transparent");
    expect(option.textStyle.fontFamily).toBe(chrome.fontFamily);
    expect(option.grid).toMatchObject({ top: 8, bottom: 40, containLabel: true, left: 8 });
  });

  it("puts the dates on a category x axis, oldest first", () => {
    const option = assessmentTrendOption(points, dims, { chrome, isRtl: false }) as any;
    expect(option.xAxis).toMatchObject({
      type: "category",
      boundaryGap: false,
      inverse: false,
      data: ["01 May 2025", "15 Jun 2025"],
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#dddddd" } },
    });
    expect(option.xAxis.axisLabel).toEqual({ color: "#666666", fontSize: 11, hideOverlap: true });
  });

  it("fixes the y axis to the 1-5 scale, one step a tick", () => {
    const option = assessmentTrendOption(points, dims, { chrome, isRtl: false }) as any;
    expect(option.yAxis).toEqual({
      type: "value",
      min: 1,
      max: 5,
      interval: 1,
      position: "left",
      axisLabel: { color: "#666666", fontSize: 11 },
      splitLine: { show: true, lineStyle: { color: "#dddddd", type: "dashed" } },
    });
  });

  it("shows every dimension on hover and keeps the legend a key", () => {
    const option = assessmentTrendOption(points, dims, { chrome, isRtl: false }) as any;
    expect(option.tooltip.trigger).toBe("axis");
    expect(option.tooltip.axisPointer).toEqual({ type: "line", lineStyle: { color: "#dddddd" } });
    expect(option.tooltip.extraCssText).toBe("");
    expect(option.legend.data).toEqual(["One", "Two"]);
    expect(option.legend.selectedMode).toBe(false);
    expect(option.legend.left).toBe("left");
  });

  it("draws one smooth line per dimension, in its colour, from its score", () => {
    const option = assessmentTrendOption(points, dims, { chrome, isRtl: false }) as any;
    expect(option.series).toEqual([
      {
        type: "line",
        name: "One",
        smooth: true,
        smoothMonotone: "x",
        showSymbol: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, color: "#010101" },
        itemStyle: { color: "#010101" },
        data: [3, 4],
      },
      {
        type: "line",
        name: "Two",
        smooth: true,
        smoothMonotone: "x",
        showSymbol: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, color: "#020202" },
        itemStyle: { color: "#020202" },
        data: [2, 3],
      },
    ]);
  });

  it("mirrors the axes, the legend and the tooltip in RTL", () => {
    const option = assessmentTrendOption(points, dims, { chrome, isRtl: true }) as any;
    expect(option.xAxis.inverse).toBe(true);
    expect(option.yAxis.position).toBe("right");
    expect(option.legend.left).toBe("right");
    expect(option.grid.right).toBe(8);
    expect(option.tooltip.extraCssText).toContain("direction: rtl");
  });

  it("draws the five assessment dimensions", () => {
    const option = assessmentTrendOption(points, DIMENSIONS, { chrome, isRtl: false }) as any;
    expect(option.series).toHaveLength(5);
    expect(option.series.map((s: any) => s.data)).toEqual([
      [3, 4],
      [2, 3],
      [3, 4],
      [4, 5],
      [1, 2],
    ]);
  });
});
