import { describe, expect, it } from "vitest";
import { chartPath, normalizeChartResult, readChartConfig } from "./chartConfig";

describe("readChartConfig", () => {
  it("reads a stored config", () => {
    expect(
      readChartConfig({ query: { group_by: "type" }, chart: "donut", drill: true, max: 5, series: "kpi_history" }),
    ).toEqual({ query: { group_by: "type" }, chart: "donut", drill: true, max: 5, series: "kpi_history" });
  });

  it("defaults anything missing or malformed", () => {
    expect(readChartConfig(undefined)).toEqual({ query: {}, chart: "bar", drill: false, max: undefined, series: undefined });
    expect(readChartConfig({ chart: "radar", drill: "yes", max: -1, query: "x", series: 3 })).toEqual({
      query: {},
      chart: "bar",
      drill: false,
      max: undefined,
      series: undefined,
    });
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

describe("normalizeChartResult", () => {
  const cfg = readChartConfig({ query: { group_by: "type", group_by_2: "subtype" } });

  it("takes the dimensions from the answer, falling back to the query", () => {
    expect(normalizeChartResult({ dimension: "type", dimension_2: null, rows: [{ key: "a", value: 1 }], total: 1 }, cfg)).toEqual({
      dimension: "type",
      dimension2: "subtype",
      rows: [{ key: "a", value: 1 }],
      total: 1,
    });
    expect(normalizeChartResult({}, cfg)).toEqual({ dimension: "type", dimension2: "subtype", rows: [], total: 0 });
    expect(normalizeChartResult({}, readChartConfig({}))).toEqual({ dimension: null, dimension2: null, rows: [], total: 0 });
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
    });
    expect(normalizeChartResult([{ date: "2026-10-01", value: 2 }], line)?.rows).toHaveLength(1);
    expect(normalizeChartResult({}, line)?.total).toBe(0);
  });

  it("is null before data arrives", () => {
    expect(normalizeChartResult(undefined, cfg)).toBeNull();
    expect(normalizeChartResult(null, cfg)).toBeNull();
  });
});
