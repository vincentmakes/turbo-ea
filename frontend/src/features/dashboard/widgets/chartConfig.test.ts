import { describe, expect, it } from "vitest";
import type { CardType } from "@/types";
import {
  CHART_KINDS,
  VALUE_LABEL_KINDS,
  chartPath,
  chartTop,
  isPercentMeasure,
  normalizeChartResult,
  readChartConfig,
  readThresholds,
  usesCardKeys,
} from "./chartConfig";

describe("readChartConfig", () => {
  it("reads a stored config", () => {
    expect(
      readChartConfig({ query: { group_by: "type" }, chart: "donut", drill: true, max: 5, series: "kpi_history" }),
    ).toEqual({
      query: { group_by: "type" },
      chart: "donut",
      drill: true,
      showValues: false,
      max: 5,
      series: "kpi_history",
    });
  });

  it("defaults anything missing or malformed", () => {
    expect(readChartConfig(undefined)).toEqual({
      query: {},
      chart: "bar",
      drill: false,
      showValues: false,
      max: undefined,
      series: undefined,
    });
    expect(readChartConfig({ chart: "radar", drill: "yes", max: -1, query: "x", series: 3 })).toEqual({
      query: {},
      chart: "bar",
      drill: false,
      showValues: false,
      max: undefined,
      series: undefined,
    });
  });
});

describe("show values", () => {
  it("reads show_values only when it is literally true", () => {
    expect(readChartConfig({ chart: "treemap", show_values: true }).showValues).toBe(true);
    expect(readChartConfig({ chart: "treemap", show_values: "true" }).showValues).toBe(false);
    expect(readChartConfig({ chart: "treemap", show_values: 1 }).showValues).toBe(false);
    expect(readChartConfig({ chart: "treemap" }).showValues).toBe(false);
  });

  it("offers value labels on bars, columns, stacked columns, treemaps and heatmaps only", () => {
    expect(CHART_KINDS.filter((kind) => VALUE_LABEL_KINDS.has(kind))).toEqual([
      "bar",
      "column",
      "heatmap",
      "treemap",
      "stacked_column",
    ]);
  });
});

describe("gauge bands", () => {
  it("reads thresholds and the good direction of a stored gauge", () => {
    const cfg = readChartConfig({ chart: "gauge", query: {}, thresholds: [40, 70], good_direction: "down" });
    expect(cfg.thresholds).toEqual([40, 70]);
    expect(cfg.goodDirection).toBe("down");
    expect(readChartConfig({ good_direction: "up" }).goodDirection).toBe("up");
    expect(readChartConfig({ good_direction: "sideways" }).goodDirection).toBeUndefined();
    expect(readChartConfig({}).thresholds).toBeUndefined();
  });

  it("accepts only two finite ascending numbers", () => {
    expect(readThresholds([0, 100])).toEqual([0, 100]);
    expect(readThresholds([50, 50])).toBeUndefined();
    expect(readThresholds([80, 50])).toBeUndefined();
    expect(readThresholds([50])).toBeUndefined();
    expect(readThresholds([10, 20, 30])).toBeUndefined();
    expect(readThresholds(["10", 20])).toBeUndefined();
    expect(readThresholds([10, "20"])).toBeUndefined();
    expect(readThresholds([10, Number.POSITIVE_INFINITY])).toBeUndefined();
    expect(readThresholds("10,20")).toBeUndefined();
  });
});

describe("isPercentMeasure", () => {
  const types = [
    {
      key: "Application",
      fields_schema: [
        {
          section: "s",
          fields: [
            { key: "coverage", type: "percentage" },
            { key: "users", type: "number" },
          ],
        },
      ],
    },
  ] as unknown as CardType[];
  const q = (query: Record<string, unknown>) => ({ query });

  it("is a share, the average data quality, the average of a percentage field, or a module score", () => {
    expect(isPercentMeasure(q({ metric: "share", approval_status: "APPROVED" }), types)).toBe(true);
    expect(isPercentMeasure(q({ metric: "avg", metric_field: "@data_quality" }), types)).toBe(true);
    expect(isPercentMeasure(q({ card_type: "Application", metric: "avg", metric_field: "coverage" }), types)).toBe(true);
    expect(isPercentMeasure({ query: {}, source: "compliance_overview", series: "score_avg" }, types)).toBe(true);
  });

  it("is not a count, a sum, an average of another field or another module series", () => {
    expect(isPercentMeasure(q({}), types)).toBe(false);
    expect(isPercentMeasure(q({ metric: "sum", metric_field: "coverage", card_type: "Application" }), types)).toBe(false);
    expect(isPercentMeasure(q({ metric: "avg", metric_field: "users", card_type: "Application" }), types)).toBe(false);
    expect(isPercentMeasure(q({ metric: "avg", metric_field: "@age_days" }), types)).toBe(false);
    expect(isPercentMeasure(q({ metric: "avg" }), types)).toBe(false);
    expect(isPercentMeasure({ query: {}, source: "risks_metrics", series: "open" }, types)).toBe(false);
    expect(isPercentMeasure({ query: {}, source: "risks_metrics" }, types)).toBe(false);
  });
});

describe("chartPath", () => {
  it("reads the query endpoint, or the KPI history for a KPI line", () => {
    const base = { query: { group_by: "type" }, chart: "bar" as const, drill: false };
    expect(chartPath(base)).toBe("/dashboards/query?group_by=type");
    expect(chartPath({ ...base, chart: "line", series: "kpi_history" })).toBe(
      "/dashboards/kpi-history?group_by=type&days=90",
    );
    expect(chartPath({ ...base, chart: "bar", series: "kpi_history" })).toBe("/dashboards/query?group_by=type");
    expect(chartPath({ ...base, query: {} })).toBe("/dashboards/query");
  });
});

describe("module sources", () => {
  it("reads a known source series and never fetches the query endpoint for it", () => {
    const cfg = readChartConfig({ source: "risks_metrics", series: "by_level", chart: "donut" });
    expect(cfg.source).toBe("risks_metrics");
    expect(cfg.series).toBe("by_level");
    expect(chartPath(cfg)).toBeNull();
  });

  it("ignores an unknown source or a series the source does not have", () => {
    expect(readChartConfig({ source: "nope", series: "by_level" }).source).toBeUndefined();
    expect(readChartConfig({ source: "risks_metrics", series: "scores" }).source).toBeUndefined();
    expect(readChartConfig({ source: "risks_metrics" }).source).toBeUndefined();
  });

  it("knows stacked columns", () => {
    expect(CHART_KINDS).toContain("stacked_column");
    expect(readChartConfig({ chart: "stacked_column" }).chart).toBe("stacked_column");
  });
});

describe("top", () => {
  const base = { chart: "bar" as const, drill: false };

  it("is appended only for a card-keyed grouping, never stored in the query", () => {
    const related = { ...base, query: { card_type: "Application", group_by: "related:relAppToITC" } };
    expect(usesCardKeys(related)).toBe(true);
    expect(chartPath(related)).toBe("/dashboards/query?card_type=Application&group_by=related%3ArelAppToITC&top=20");
    expect(related.query).not.toHaveProperty("top");
    const sankey = { ...base, chart: "sankey" as const, query: { relation_type: "r", group_by_2: "card" } };
    expect(chartPath(sankey)).toBe("/dashboards/query?group_by_2=card&relation_type=r&top=20");
    const plain = { ...base, query: { group_by: "type" } };
    expect(usesCardKeys(plain)).toBe(false);
    expect(chartPath(plain)).toBe("/dashboards/query?group_by=type");
  });

  it("is sent for each card of an ordinary query, at the widget's maximum", () => {
    const cost = {
      chart: "treemap" as const,
      drill: true,
      max: 30,
      query: { card_type: "Application", group_by: "card", metric: "sum" as const, metric_field: "costTotalAnnual" },
    };
    expect(usesCardKeys(cost)).toBe(true);
    expect(chartPath(cost)).toBe(
      "/dashboards/query?card_type=Application&group_by=card&metric=sum&metric_field=costTotalAnnual&top=30",
    );
    expect(cost.query).not.toHaveProperty("top");
    expect(chartPath({ ...base, query: { card_type: "Application", group_by: "card" } })).toBe(
      "/dashboards/query?card_type=Application&group_by=card&top=20",
    );
  });

  it("follows the widget's maximum, within 1–200", () => {
    expect(chartTop({ ...base, query: {}, max: 8 })).toBe(8);
    expect(chartTop({ ...base, query: {} })).toBe(20);
    expect(chartTop({ ...base, query: {}, max: 900 })).toBe(200);
    expect(chartTop({ ...base, query: {}, max: 0.2 })).toBe(1);
    expect(chartPath({ ...base, query: { card_type: "A", group_by: "related:r" }, max: 5 })).toContain("&top=5");
  });
});

describe("normalizeChartResult", () => {
  const cfg = readChartConfig({ query: { group_by: "type", group_by_2: "subtype" } });

  it("takes the dimensions from the answer, falling back to the query", () => {
    expect(normalizeChartResult({ dimension: "type", dimension_2: null, rows: [{ key: "a", value: 1 }], total: 1 }, cfg)).toEqual({
      dimension: "type",
      dimension2: "subtype",
      rows: [{ key: "a", value: 1 }],
      total: 1,
      labels: {},
      fiscalYear: null,
      fiscalYearStart: null,
      folded: null,
    });
    const empty = { rows: [], total: 0, labels: {}, fiscalYear: null, fiscalYearStart: null, folded: null };
    expect(normalizeChartResult({}, cfg)).toEqual({ dimension: "type", dimension2: "subtype", ...empty });
    expect(normalizeChartResult({}, readChartConfig({}))).toEqual({ dimension: null, dimension2: null, ...empty });
  });

  it("keeps the card labels and the fiscal year of the answer", () => {
    const out = normalizeChartResult(
      {
        dimension: "related:relAppToITC",
        dimension_2: null,
        rows: [{ key: "c1", value: 2 }],
        total: 2,
        labels: { c1: "Postgres" },
        fiscal_year: 2026,
        fiscal_year_start: 10,
      },
      cfg,
    );
    expect(out?.labels).toEqual({ c1: "Postgres" });
    expect(out?.fiscalYear).toBe(2026);
    expect(out?.fiscalYearStart).toBe(10);
    expect(normalizeChartResult({ labels: "x", fiscal_year: "2026" }, cfg)).toMatchObject({
      labels: {},
      fiscalYear: null,
      fiscalYearStart: null,
    });
  });

  it("turns KPI history points into dated rows", () => {
    const line = readChartConfig({ chart: "line", series: "kpi_history" });
    expect(normalizeChartResult({ points: [{ date: "2026-10-01", value: 2 }, { date: "2026-10-02", value: 4 }] }, line)).toEqual({
      dimension: "date",
      dimension2: null,
      rows: [
        { key: "2026-10-01", value: 2 },
        { key: "2026-10-02", value: 4 },
      ],
      total: 4,
      labels: {},
      fiscalYear: null,
      fiscalYearStart: null,
      folded: null,
    });
    expect(normalizeChartResult([{ date: "2026-10-01", value: 2 }], line)?.rows).toHaveLength(1);
    expect(normalizeChartResult({}, line)?.total).toBe(0);
  });

  it("carries how many cards the server folded, and nothing malformed", () => {
    const keyed = readChartConfig({ query: { group_by: "card" } });
    expect(normalizeChartResult({ rows: [], total: 0, folded: { top: 20, cards: 5 } }, keyed)?.folded).toEqual({
      top: 20,
      cards: 5,
    });
    expect(normalizeChartResult({ rows: [], total: 0 }, keyed)?.folded).toBeNull();
    expect(normalizeChartResult({ folded: { top: "20", cards: 5 } }, keyed)?.folded).toBeNull();
    expect(normalizeChartResult({ folded: { top: 20, cards: "5" } }, keyed)?.folded).toBeNull();
  });

  it("is null before data arrives", () => {
    expect(normalizeChartResult(undefined, cfg)).toBeNull();
    expect(normalizeChartResult(null, cfg)).toBeNull();
  });
});
