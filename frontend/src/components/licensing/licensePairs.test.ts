import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import type { LicenseMetricItem, YearLicenses } from "@/types";
import { buildPairGroups, pairHistoryRows, pairHues, pairName } from "./licensePairs";

const type = (metric: string, key: string, label: string, sort: number, archived = false) => ({
  id: `${metric}-${key}`,
  metric_key: metric,
  key,
  label,
  sort_order: sort,
  archived,
  translations: {},
});
const metric = (key: string, label: string, types: LicenseMetricItem["types"], archived = false): LicenseMetricItem => ({
  id: key,
  key,
  label,
  sort_order: 1,
  archived,
  translations: {},
  types,
});
const CATALOGUE = [
  metric("users", "Users", [type("users", "admin", "Admin", 1), type("users", "dev", "Dev", 2, true)]),
  metric("cores", "Cores", [type("cores", "xeon", "Xeon", 1)], true),
];
const t = ((k: string) => k) as unknown as TFunction;
const SUFFIX = " (archived)";

describe("pairName", () => {
  it("is `Metric: Type`", () => {
    expect(pairName(CATALOGUE, "users", "admin", "en", SUFFIX)).toBe("Users: Admin");
  });
  it("marks an archived type or metric", () => {
    expect(pairName(CATALOGUE, "users", "dev", "en", SUFFIX)).toBe("Users: Dev (archived)");
    expect(pairName(CATALOGUE, "cores", "xeon", "en", SUFFIX)).toBe("Cores: Xeon (archived)");
  });
});

describe("pairHues", () => {
  it("gives a hue per pair by sort order inside its metric", () => {
    const h = pairHues(CATALOGUE, ["a", "b", "c"], "grey");
    expect(h.get("users:admin")).toBe("a");
    expect(h.get("users:dev")).toBe("b");
    expect(h.get("cores:xeon")).toBe("a");
  });
});

describe("buildPairGroups", () => {
  const result = {
    metric: "users",
    status: "over" as const,
    types: [{ key: "admin", licensed: 10, actual: 12, pct: 120, no_licence: false, status: "over" as const }],
  };
  const opts = { catalogue: CATALOGUE, locale: "en", t, suffix: SUFFIX, colorOf: () => "hue" };
  it("builds a group per metric with the pair's percentage and status", () => {
    const [g] = buildPairGroups([result], { ...opts, forecast: false });
    expect(g.label).toBe("Users");
    expect(g.status).toBe("licensing.status.over");
    expect(g.pairs[0]).toMatchObject({ key: "users:admin", label: "Admin", licensed: 10, actual: 12, pct: "120 %" });
  });
  it("the Forecast has no status and no actual", () => {
    const [g] = buildPairGroups([result], { ...opts, forecast: true });
    expect(g.status).toBe("");
    expect(g.statusColor).toBeNull();
    expect(g.pairs[0].actual).toBeNull();
    expect(g.pairs[0].pct).toBe("");
  });
});

describe("pairHistoryRows", () => {
  const year = (fy: number, cell: boolean, forecast = false): YearLicenses => ({
    fiscal_year: fy,
    is_current: false,
    is_forecast: forecast,
    confirmed: true,
    fallback_from: null,
    status: null,
    metrics: cell
      ? [{ metric: "users", has_actual: true, status: "compliant", worst_pct: null, worst_no_licence: false, licensed_total: 5, actual_total: 3, types: [{ key: "admin", licensed: 5, actual: 3, pct: 60, no_licence: false, status: "compliant" }] }]
      : [],
  });
  it("a year without the pair is null, not zero", () => {
    expect(pairHistoryRows([year(2025, true), year(2026, false, true)], "users", "admin")).toEqual([
      { year: "FY25", licensed: 5, actual: 3, forecast: false },
      { year: "FY26", licensed: null, actual: null, forecast: true },
    ]);
  });
});
