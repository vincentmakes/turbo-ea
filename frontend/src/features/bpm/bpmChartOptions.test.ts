import { describe, it, expect, vi, beforeEach } from "vitest";

// The real builder, wrapped so a test can also read the context it was given.
vi.mock("@/features/dashboard/charts/buildOption", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/features/dashboard/charts/buildOption")>();
  return { ...mod, buildOption: vi.fn(mod.buildOption) };
});

import { buildOption, type BuildContext } from "@/features/dashboard/charts/buildOption";
import { buildEChartsChrome } from "@/components/charts/echartsTheme";
import { BPM_ASSESSMENT_COLORS, RAG_COLORS, SEVERITY_COLORS, STATUS_COLORS, brand } from "@/theme/tokens";
import {
  AUTOMATION_COLOR,
  BPM_COLUMN_LABEL_LINE_HEIGHT,
  BPM_COLUMN_LABEL_WIDTH,
  BPM_NEUTRAL_COLOR,
  DIMENSIONS,
  MATURITY_COLORS,
  RISK_COLORS,
  assessmentTrendOption,
  automationColumnOption,
  maturityColor,
  maturityColumnOption,
  processTypePieOption,
  riskColor,
  scaleColor,
  wrapAtSpace,
  wrapColumnLabels,
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

  it("derives the risk and maturity maps from the Process Navigator's overlays", async () => {
    // A level added to the navigator's overlay shows up on the dashboard without a second edit.
    vi.resetModules();
    vi.doMock("./processNavigatorState", async (importOriginal) => {
      const mod = await importOriginal<typeof import("./processNavigatorState")>();
      return {
        ...mod,
        ATTR_COLORS: {
          ...mod.ATTR_COLORS,
          riskLevel: { ...mod.ATTR_COLORS.riskLevel, extreme: { label: "Extreme", color: "#000001" } },
          maturity: { ...mod.ATTR_COLORS.maturity, legendary: { label: "6", color: "#000002" } },
        },
      };
    });
    try {
      const fresh = await import("./bpmChartOptions");
      expect(fresh.RISK_COLORS).toEqual({
        low: SEVERITY_COLORS.low,
        medium: SEVERITY_COLORS.medium,
        high: SEVERITY_COLORS.high,
        critical: SEVERITY_COLORS.critical,
        extreme: "#000001",
      });
      expect(fresh.MATURITY_COLORS.legendary).toBe("#000002");
      expect(fresh.MATURITY_COLORS.optimized).toBe(RAG_COLORS.green);
    } finally {
      vi.doUnmock("./processNavigatorState");
      vi.resetModules();
    }
  });

  it("keeps the neutral grey and the brand blue as the other two hues", () => {
    expect(BPM_NEUTRAL_COLOR).toBe(STATUS_COLORS.neutral);
    expect(AUTOMATION_COLOR).toBe(brand.primary);
  });
});

describe("scaleColor", () => {
  // Built inside each test: a describe body runs while the file is collected,
  // outside any test, so a resolver made there is invisible to the mutation run.
  const scale = () => scaleColor({ low: "#00aa00", high: "#aa0000" });

  it("returns a resolver", () => {
    expect(typeof scale()).toBe("function");
  });

  it("prefers the metamodel option's colour over the scale", () => {
    expect(scale()("low", "#123456")).toBe("#123456");
  });

  it("falls back to the scale when the option has no colour", () => {
    const color = scale();
    expect(color("low")).toBe("#00aa00");
    expect(color("high", "")).toBe("#aa0000");
  });

  it("falls back to neutral for a key neither knows", () => {
    const color = scale();
    expect(color("custom")).toBe(BPM_NEUTRAL_COLOR);
    expect(color("custom", "")).toBe(STATUS_COLORS.neutral);
  });
});

describe("riskColor", () => {
  it("reads the risk scale behind the option's colour", () => {
    expect(riskColor("critical", "#654321")).toBe("#654321");
    expect(riskColor("critical")).toBe(RISK_COLORS.critical);
    expect(riskColor("custom")).toBe(STATUS_COLORS.neutral);
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

// Every category keeps its label, on two lines broken at a space, each line
// cut with an ellipsis rather than split mid-word.
const WRAPPED_LABEL = {
  color: "#666666",
  fontSize: 12,
  interval: 0,
  hideOverlap: false,
  overflow: "truncate",
  width: 64,
  lineHeight: 14,
  formatter: expect.any(Function),
};

describe("BPM column label constants", () => {
  it("fits five columns in a 350 px card, a label wrapping on a 14 px line", () => {
    expect(BPM_COLUMN_LABEL_WIDTH).toBe(64);
    expect(BPM_COLUMN_LABEL_LINE_HEIGHT).toBe(14);
  });
});

describe("wrapAtSpace", () => {
  it("breaks a two-word label at its space", () => {
    expect(wrapAtSpace("Partially Automated")).toBe("Partially\nAutomated");
  });

  it("breaks at the space closest to the middle, never after the level number", () => {
    expect(wrapAtSpace("2 - Managed")).toBe("2 -\nManaged");
    expect(wrapAtSpace("4 - Measured")).toBe("4 -\nMeasured");
  });

  it("breaks an Arabic label only at a space, never inside a word", () => {
    expect(wrapAtSpace("4 - مُقاس")).toBe("4 -\nمُقاس");
    expect(wrapAtSpace("مؤتمت بالكامل")).toBe("مؤتمت\nبالكامل");
  });

  it("leaves a single word whole, on one line", () => {
    expect(wrapAtSpace("Manual")).toBe("Manual");
    expect(wrapAtSpace("مُحسَّن")).toBe("مُحسَّن");
    expect(wrapAtSpace("")).toBe("");
  });

  it("makes exactly two lines of three words, split nearest the middle", () => {
    expect(wrapAtSpace("aaa b c")).toBe("aaa\nb c");
    expect(wrapAtSpace("a b ccc")).toBe("a b\nccc");
    // Both spaces are as far from the middle: the earlier one wins.
    expect(wrapAtSpace("a b c")).toBe("a\nb c");
  });

  it("trims spaces around the label and around the break", () => {
    expect(wrapAtSpace("  Manual  ")).toBe("Manual");
    expect(wrapAtSpace(" Partially Automated ")).toBe("Partially\nAutomated");
    expect(wrapAtSpace("a  bb")).toBe("a\nbb");
    expect(wrapAtSpace("aa  b")).toBe("aa\nb");
  });
});

describe("wrapColumnLabels", () => {
  const built = {
    grid: { top: 16, bottom: 8, left: 8, containLabel: true },
    xAxis: {
      type: "category",
      data: ["A", "B"],
      axisLabel: { color: "#666666", interval: 3, hideOverlap: true, width: 96, overflow: "break" },
    },
    yAxis: { type: "value" },
    series: [{ type: "bar" }],
  };

  it("shows every label, each line truncated within the given width", () => {
    const option = wrapColumnLabels(built, 50) as any;
    expect(option.xAxis.axisLabel).toEqual({
      color: "#666666",
      interval: 0,
      hideOverlap: false,
      overflow: "truncate",
      width: 50,
      lineHeight: 14,
      formatter: expect.any(Function),
    });
  });

  it("wraps each label at a space through its formatter", () => {
    const { formatter } = (wrapColumnLabels(built, 50) as any).xAxis.axisLabel;
    expect(formatter("2 - Managed")).toBe("2 -\nManaged");
    expect(formatter("مؤتمت بالكامل")).toBe("مؤتمت\nبالكامل");
    expect(formatter("Manual")).toBe("Manual");
  });

  it("leaves the grid as built: its containLabel already measures two-line labels", () => {
    const option = wrapColumnLabels(built, 50) as any;
    expect(option.grid).toBe(built.grid);
    expect(option.grid).toEqual({ top: 16, bottom: 8, left: 8, containLabel: true });
  });

  it("keeps the rest of the option and leaves its input untouched", () => {
    const option = wrapColumnLabels(built, 50) as any;
    expect(option.xAxis.type).toBe("category");
    expect(option.xAxis.data).toEqual(["A", "B"]);
    expect(option.yAxis).toBe(built.yAxis);
    expect(option.series).toBe(built.series);
    expect(built.xAxis.axisLabel).toEqual({
      color: "#666666",
      interval: 3,
      hideOverlap: true,
      width: 96,
      overflow: "break",
    });
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

  it("is the dashboard pie as built: no category labels to wrap, the grid untouched", () => {
    const option = processTypePieOption(rows, { chrome, isRtl: false, label, color, seriesName: "P" });
    const asBuilt = vi.mocked(buildOption).mock.results[0].value;
    expect(option).toBe(asBuilt);
    expect((option as any).xAxis).toBeUndefined();
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
    expect(option.yAxis.position).toBe("left");
    const s = option.series[0];
    expect(s.type).toBe("bar");
    expect(s.name).toBe("Processes");
    expect(s.cursor).toBe("pointer");
    expect(s.data.map((d: any) => d.key)).toEqual(["a", "b", "c"]);
    expect(s.data.map((d: any) => d.value)).toEqual([3, 5, 1]);
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual(["#aa0000", "#00bb00", "#0000cc"]);
  });

  it("keeps every level's label, wrapped at a space, the grid as built", () => {
    const option = maturityColumnOption(rows, { chrome, isRtl: false, label, color, seriesName: "P" }) as any;
    expect(option.xAxis.axisLabel).toEqual(WRAPPED_LABEL);
    expect(option.xAxis.axisLabel.formatter("4 - Measured")).toBe("4 -\nMeasured");
    expect(option.grid).toBe(vi.mocked(buildOption).mock.results[0].value.grid);
    expect(option.grid).toMatchObject({ top: 16, bottom: 8, containLabel: true });
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
    // One hue: no per-category resolver for nothing to read.
    expect(ctx).not.toHaveProperty("colors");
    expect(option.xAxis.data).toEqual(["Alpha", "Beta", "Gamma"]);
    const s = option.series[0];
    expect(s.name).toBe("Processes");
    expect(s.cursor).toBe("pointer");
    expect(s.data.map((d: any) => d.key)).toEqual(["a", "b", "c"]);
    expect(s.data.map((d: any) => d.itemStyle.color)).toEqual([brand.primary, brand.primary, brand.primary]);
  });

  it("keeps every level's label, wrapped at a space, the grid as built", () => {
    const option = automationColumnOption(rows, { chrome, isRtl: false, label, seriesName: "P" }) as any;
    expect(option.xAxis.axisLabel).toEqual(WRAPPED_LABEL);
    expect(option.xAxis.axisLabel.formatter("Partially Automated")).toBe("Partially\nAutomated");
    expect(option.grid).toBe(vi.mocked(buildOption).mock.results[0].value.grid);
    expect(option.grid).toMatchObject({ top: 16, bottom: 8, containLabel: true });
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
    expect(DIMENSIONS.map((d) => d.labelKey)).toEqual([
      "assessment.overall",
      "assessment.efficiency",
      "assessment.effectiveness",
      "assessment.compliance",
      "assessment.automation",
    ]);
  });

  it("carries a translation key, never an English name", () => {
    for (const d of DIMENSIONS) expect(d).not.toHaveProperty("label");
  });

  it("takes each dimension's colour from the assessment token, the same hues as before", () => {
    expect(DIMENSIONS.map((d) => d.color)).toEqual(DIMENSIONS.map((d) => BPM_ASSESSMENT_COLORS[d.key]));
    expect(BPM_ASSESSMENT_COLORS).toEqual({
      overall_score: "#1976d2",
      efficiency: "#4caf50",
      effectiveness: "#ff9800",
      compliance: "#9c27b0",
      automation: "#00bcd4",
    });
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
    const dimensions = DIMENSIONS.map((d) => ({ label: d.labelKey, color: d.color }));
    const option = assessmentTrendOption(points, dimensions, { chrome, isRtl: false }) as any;
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
