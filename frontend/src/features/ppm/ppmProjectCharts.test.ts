/**
 * The initiative PDF's spend charts, drawn by real ECharts (SVG renderer,
 * server-side mode) in jsdom: which charts are drawn, for which fiscal year,
 * with which lines and budget lines, in the print chrome — and the SVG data
 * URI each one becomes.
 *
 * jsdom has no canvas to measure text, so ECharts is given the estimate the
 * other render tests use (6.6 px per character at 12 px).
 */
import { describe, expect, it } from "vitest";
import * as echarts from "echarts/core";
import i18n from "@/i18n";
import { PPM_COST_COLORS, PRINT_COLORS } from "@/theme/tokens";
import type { PpmBudgetLine, PpmCostLine } from "@/types";
import { BUDGET_DASH } from "./cumulativeChartOption";
import {
  PRINT_CHART_FONT,
  PRINT_CHART_HEIGHT,
  PRINT_CHART_WIDTH,
  buildSpendChartSpecs,
  printChartChrome,
  printFiscalYear,
  renderChartSvg,
  renderSpendCharts,
  svgDataUri,
  type SpendChartInput,
} from "./ppmProjectCharts";

/* eslint-disable @typescript-eslint/no-explicit-any -- the option is plain JSON a test digs into */

const CHAR_WIDTH_12 = 6.6;
echarts.setPlatformAPI({
  measureText: (text: string, font?: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font ?? "")?.[1] ?? 12);
    return { width: (text.length * CHAR_WIDTH_12 * size) / 12 } as TextMetrics;
  },
});

function cost(overrides: Partial<PpmCostLine> & { id: string }): PpmCostLine {
  return {
    initiative_id: "i1",
    description: overrides.id,
    category: "capex",
    planned: 0,
    actual: 0,
    date: null,
    created_at: "2020-01-01T00:00:00",
    updated_at: "2020-01-01T00:00:00",
    ...overrides,
  };
}

function budget(overrides: Partial<PpmBudgetLine> & { id: string }): PpmBudgetLine {
  return {
    initiative_id: "i1",
    fiscal_year: 2020,
    category: "capex",
    description: null,
    amount: 0,
    created_at: "2020-01-01T00:00:00",
    updated_at: "2020-01-01T00:00:00",
    ...overrides,
  };
}

const COSTS: PpmCostLine[] = [
  cost({ id: "c1", category: "capex", actual: 100, date: "2020-02-10" }),
  cost({ id: "c2", category: "opex", actual: 40, date: "2020-05-01" }),
  cost({ id: "c3", category: "capex", actual: 60, date: "2021-03-20" }),
  cost({ id: "c4", category: "opex", actual: 999, date: null }),
];

const BUDGETS: PpmBudgetLine[] = [
  budget({ id: "b1", fiscal_year: 2020, category: "capex", amount: 500 }),
  budget({ id: "b2", fiscal_year: 2020, category: "opex", amount: 200 }),
  budget({ id: "b3", fiscal_year: 2021, category: "capex", amount: 300 }),
];

const t = i18n.getFixedT("en", "ppm");

function input(overrides: Partial<SpendChartInput> = {}): SpendChartInput {
  return {
    costLines: COSTS,
    budgetLines: BUDGETS,
    fiscalYearStart: 1,
    // Mid FY2020: the year's line runs to July, the project's to March 2021.
    today: new Date(2020, 6, 15, 12),
    format: (v) => `$${v}.00`,
    formatShort: (v) => `$${v}`,
    isRtl: false,
    locale: "en",
    t,
    ...overrides,
  };
}

const specOf = (key: string, i = input()) => {
  const spec = buildSpendChartSpecs(i).find((s) => s.key === key);
  expect(spec, key).toBeDefined();
  return spec! as { key: string; title: string; option: any };
};

const decode = (src: string) => decodeURIComponent(src.slice(src.indexOf(",") + 1));

describe("printFiscalYear", () => {
  it("keeps the current year when it has data, or when no year has any", () => {
    expect(printFiscalYear([2019, 2020, 2021], 2020)).toBe(2020);
    expect(printFiscalYear([], 2020)).toBe(2020);
  });

  it("falls back to the latest year with data before the current one", () => {
    expect(printFiscalYear([2017, 2018, 2023], 2020)).toBe(2018);
    expect(printFiscalYear([2019], 2020)).toBe(2019);
  });

  it("takes the first year after it when every year with data is still to come", () => {
    expect(printFiscalYear([2022, 2023], 2020)).toBe(2022);
  });
});

describe("printChartChrome", () => {
  it("draws in print inks on paper, in the print stylesheet's font", () => {
    const chrome = printChartChrome();
    expect(chrome).toMatchObject({
      mode: "light",
      fontFamily: PRINT_CHART_FONT,
      textPrimary: PRINT_COLORS.ink,
      textSecondary: PRINT_COLORS.inkSecondary,
      divider: PRINT_COLORS.rule,
      surface: PRINT_COLORS.paper,
      hover: PRINT_COLORS.panel,
    });
    expect(PRINT_CHART_FONT).toBe("'Segoe UI', Arial, sans-serif");
    // A4 content width; low enough that the first chart shares a page with the Budget & Costs tiles.
    expect([PRINT_CHART_WIDTH, PRINT_CHART_HEIGHT]).toEqual([620, 236]);
  });
});

describe("buildSpendChartSpecs", () => {
  it("draws the current fiscal year by category, then the whole project", () => {
    const specs = buildSpendChartSpecs(input());
    expect(specs.map((s) => [s.key, s.title])).toEqual([
      ["fiscalYear", "Cumulative spend by category · FY 2020"],
      ["project", "Project to date"],
    ]);
  });

  it("plots the fiscal year's months to today against that year's budgets", () => {
    const { option } = specOf("fiscalYear");
    expect(option.xAxis.data).toEqual([
      "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]);
    expect(option.series.map((s: any) => [s.id, s.name, s.lineStyle.color])).toEqual([
      ["capex", "Cumulative CapEx", PPM_COST_COLORS.light.capex],
      ["opex", "Cumulative OpEx", PPM_COST_COLORS.light.opex],
    ]);
    expect(option.series[0].data).toEqual([0, 100, 100, 100, 100, 100, 100, null, null, null, null, null]);
    expect(option.series[1].data).toEqual([0, 0, 0, 0, 40, 40, 40, null, null, null, null, null]);
    expect(
      option.series[0].markLine.data.map((r: any) => [r.name, r.yAxis, r.lineStyle.color, r.lineStyle.type]),
    ).toEqual([
      ["CapEx budget", 500, PPM_COST_COLORS.light.capex, BUDGET_DASH],
      ["OpEx budget", 200, PPM_COST_COLORS.light.opex, BUDGET_DASH],
    ]);
  });

  it("plots the whole dated range, year-qualified, against every year's budgets", () => {
    const { option } = specOf("project");
    expect(option.xAxis.data[0]).toBe("Feb '20");
    expect(option.xAxis.data.at(-1)).toBe("Mar '21");
    expect(option.xAxis.data).toHaveLength(14);
    expect(option.series[0].data.at(-1)).toBe(160);
    expect(option.series[1].data.at(-1)).toBe(40);
    expect(option.series[0].markLine.data.map((r: any) => [r.name, r.yAxis])).toEqual([
      ["CapEx budget", 800],
      ["OpEx budget", 200],
    ]);
  });

  it("is still, on paper, with no tooltip and the currency helpers on the axis", () => {
    const { option } = specOf("project");
    expect(option.animation).toBe(false);
    expect(option.tooltip).toBeUndefined();
    expect(option.backgroundColor).toBe(PRINT_COLORS.paper);
    expect(option.textStyle.fontFamily).toBe(PRINT_CHART_FONT);
    expect(option.yAxis.axisLabel.formatter(2500)).toBe("$2500");
    expect(option.legend.data).toEqual(["Cumulative CapEx", "Cumulative OpEx"]);
  });

  it("mirrors right to left when the interface does", () => {
    for (const spec of buildSpendChartSpecs(input({ isRtl: true }))) {
      expect(spec.option).toMatchObject({ xAxis: { inverse: true }, yAxis: { position: "right" } });
    }
    for (const spec of buildSpendChartSpecs(input())) {
      expect(spec.option).toMatchObject({ xAxis: { inverse: false }, yAxis: { position: "left" } });
    }
  });

  it("keeps two nearly equal budgets' names apart: the second moves to its line's start", () => {
    const { option } = specOf(
      "fiscalYear",
      input({
        budgetLines: [
          budget({ id: "c", fiscal_year: 2020, category: "capex", amount: 300 }),
          budget({ id: "o", fiscal_year: 2020, category: "opex", amount: 290 }),
        ],
      }),
    );
    expect(option.series[0].markLine.data.map((r: any) => [r.name, r.label.position])).toEqual([
      ["CapEx budget", "insideEndTop"],
      ["OpEx budget", "insideStartTop"],
    ]);
  });

  it("falls back to the latest year with data when the current one has none", () => {
    const specs = buildSpendChartSpecs(input({ today: new Date(2023, 4, 1, 12) }));
    expect(specs[0].title).toBe("Cumulative spend by category · FY 2021");
    const option = specs[0].option as any;
    expect(option.series[0].data.at(-1)).toBe(60);
    expect(option.series[0].markLine.data.map((r: any) => r.name)).toEqual(["CapEx budget"]);
  });

  it("names a straddling fiscal year by its span", () => {
    const [fy] = buildSpendChartSpecs(input({ fiscalYearStart: 10 }));
    expect(fy.title).toBe("Cumulative spend by category · FY 2019–2020");
  });

  it("draws a future-dated cost line, and leaves out a chosen year with no plotted month", () => {
    // The only data is in a later year: its first month still gets its point.
    const specs = buildSpendChartSpecs(
      input({ costLines: [cost({ id: "f", actual: 5, date: "2026-01-10" })], budgetLines: [], today: new Date(2020, 0, 1, 12) }),
    );
    expect(specs.map((s) => s.key)).toEqual(["fiscalYear", "project"]);
    const noFuture = buildSpendChartSpecs(
      input({
        costLines: [cost({ id: "f", actual: 5, date: "2026-01-10" })],
        budgetLines: [budget({ id: "x", fiscal_year: 2020, amount: 10 })],
        today: new Date(2019, 11, 1, 12),
      }),
    );
    // FY2019 (current, no data) → the first year after it, 2020, which has not begun.
    expect(noFuture.map((s) => s.key)).toEqual(["project"]);
  });

  it("draws nothing when no cost line is dated, budgets or not", () => {
    expect(buildSpendChartSpecs(input({ costLines: [] }))).toEqual([]);
    expect(buildSpendChartSpecs(input({ costLines: [cost({ id: "u", actual: 9 })] }))).toEqual([]);
    expect(buildSpendChartSpecs(input({ costLines: [], budgetLines: [] }))).toEqual([]);
  });
});

describe("renderSpendCharts", () => {
  it("returns both charts as SVG data URIs naming every line and budget line", () => {
    const charts = renderSpendCharts(input());
    expect(Object.keys(charts)).toEqual(["fiscalYear", "project"]);
    expect(charts.fiscalYear!.title).toBe("Cumulative spend by category · FY 2020");
    expect(charts.project!.title).toBe("Project to date");
    for (const chart of [charts.fiscalYear!, charts.project!]) {
      expect(chart.src.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
      const svg = decode(chart.src);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain(`width="${PRINT_CHART_WIDTH}"`);
      expect(svg).toContain(`height="${PRINT_CHART_HEIGHT}"`);
      for (const name of ["Cumulative CapEx", "Cumulative OpEx", "CapEx budget", "OpEx budget"]) {
        expect(svg, name).toContain(name);
      }
    }
  });

  it("returns nothing at all when there is nothing to chart", () => {
    expect(renderSpendCharts(input({ costLines: [] }))).toEqual({});
    expect(renderSpendCharts(input({ costLines: [cost({ id: "u", actual: 9 })] }))).toEqual({});
  });

  it("returns only the project chart when the chosen year has no plotted month", () => {
    const charts = renderSpendCharts(
      input({
        costLines: [cost({ id: "f", actual: 5, date: "2026-01-10" })],
        budgetLines: [budget({ id: "x", fiscal_year: 2020, amount: 10 })],
        today: new Date(2019, 11, 1, 12),
      }),
    );
    expect(Object.keys(charts)).toEqual(["project"]);
  });
});

describe("renderChartSvg / svgDataUri", () => {
  it("draws on paper in the print font, with the series colours", () => {
    const svg = renderChartSvg(specOf("project").option);
    expect(svg).toContain(PRINT_COLORS.paper);
    expect(svg).toContain("Segoe UI");
    expect(svg.toLowerCase()).toContain(PPM_COST_COLORS.light.capex);
    expect(svg.toLowerCase()).toContain(PPM_COST_COLORS.light.opex);
  });

  it("encodes the document so a #, a quote or a space cannot end the URI", () => {
    expect(svgDataUri('<svg a="#x"> </svg>')).toBe(
      "data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%22%23x%22%3E%20%3C%2Fsvg%3E",
    );
  });
});
