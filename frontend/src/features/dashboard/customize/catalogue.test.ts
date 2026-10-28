import { describe, expect, it } from "vitest";
import type { DashboardWidget } from "@/types";
import { KPI_PRESET_KEYS } from "../widgets/kpiPresets";
import { WIDGET_TYPE_KEYS } from "../widgets/widgetMeta";
import { CATALOGUE, CHART_PRESETS, FAMILY_ORDER, catalogueFor, isAlreadyAdded } from "./catalogue";

const entry = (id: string) => CATALOGUE.find((e) => e.id === id)!;
const w = (type: DashboardWidget["type"], config: Record<string, unknown> = {}) => ({ type, config });

describe("CATALOGUE", () => {
  it("offers every widget type, every KPI preset and every chart preset once", () => {
    const ids = CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const type of WIDGET_TYPE_KEYS) expect(ids).toContain(type);
    for (const metric of KPI_PRESET_KEYS) expect(ids).toContain(`kpi:${metric}`);
    for (const preset of CHART_PRESETS) expect(ids).toContain(`chart:${preset.id}`);
    expect(ids).toHaveLength(WIDGET_TYPE_KEYS.length + KPI_PRESET_KEYS.length + CHART_PRESETS.length);
  });

  it("groups into the five families", () => {
    expect(FAMILY_ORDER).toEqual(["kpi", "chart", "overview", "workspace", "admin"]);
    expect(new Set(CATALOGUE.map((e) => e.family))).toEqual(new Set(FAMILY_ORDER));
    expect(entry("kpi:active_users").family).toBe("kpi");
    expect(entry("top_contributors").family).toBe("admin");
    expect(entry("my_todos").family).toBe("workspace");
    expect(entry("recent_activity").family).toBe("overview");
  });

  it("asks for configuration only for the generic KPI and chart", () => {
    expect(CATALOGUE.filter((e) => e.needsConfig).map((e) => e.id)).toEqual(["kpi", "chart"]);
    expect(entry("kpi").config).toEqual({ query: {}, good_direction: "up", format: "number" });
    expect(entry("chart").config).toEqual({ query: { group_by: "type" }, chart: "bar", drill: true });
  });

  it("carries the preset configs the built-in dashboards use", () => {
    expect(entry("kpi:total_cards").config).toEqual({ metric: "total_cards" });
    expect(entry("kpi:total_cards").labelKey).toBe("dashboard.totalCards");
    expect(entry("chart:cards_by_type").config).toEqual({
      query: { group_by: "type" },
      chart: "bar",
      drill: true,
      title_key: "dashboard.cardsByType",
    });
    expect(entry("chart:cards_by_type").labelKey).toBe("dashboard.cardsByType");
    expect(entry("recent_activity").config).toEqual({ max_rows: 12 });
    expect(entry("my_todos").config).toEqual({});
  });
});

describe("isAlreadyAdded", () => {
  it("never greys a multi-instance entry", () => {
    expect(isAlreadyAdded(entry("kpi"), [w("kpi", { query: {} })])).toBe(false);
    expect(isAlreadyAdded(entry("chart"), [w("chart", { query: { group_by: "type" } })])).toBe(false);
  });

  it("matches a KPI preset by metric", () => {
    expect(isAlreadyAdded(entry("kpi:total_cards"), [w("kpi", { metric: "total_cards" })])).toBe(true);
    expect(isAlreadyAdded(entry("kpi:total_cards"), [w("kpi", { metric: "broken_count" })])).toBe(false);
    expect(isAlreadyAdded(entry("kpi:total_cards"), [w("chart", { metric: "total_cards" })])).toBe(false);
  });

  it("matches a chart preset by its title key", () => {
    expect(isAlreadyAdded(entry("chart:lifecycle"), [w("chart", { title_key: "dashboard.lifecycleOverview" })])).toBe(
      true,
    );
    expect(isAlreadyAdded(entry("chart:lifecycle"), [w("chart", { title_key: "dashboard.cardsByType" })])).toBe(false);
  });

  it("matches any other single widget by type", () => {
    expect(isAlreadyAdded(entry("recent_activity"), [w("recent_activity")])).toBe(true);
    expect(isAlreadyAdded(entry("recent_activity"), [w("browse_by_type")])).toBe(false);
    expect(isAlreadyAdded(entry("recent_activity"), [])).toBe(false);
  });
});

describe("catalogueFor", () => {
  const ids = (perms: Record<string, boolean>) => catalogueFor(perms).map((e) => e.id);

  it("offers everything to the wildcard", () => {
    expect(ids({ "*": true })).toHaveLength(CATALOGUE.length);
  });

  it("offers only the workspace family without permissions", () => {
    const out = ids({});
    expect(out).toContain("my_todos");
    expect(out).toContain("kpi:favorites");
    expect(out).not.toContain("kpi");
    expect(out).not.toContain("chart");
    expect(out).not.toContain("kpi:total_cards");
    expect(out).not.toContain("top_contributors");
    expect(out).not.toContain("kpi:active_users");
  });

  it("adds the overview and generic widgets with reports.ea_dashboard, the admin ones with admin.users", () => {
    const ea = ids({ "reports.ea_dashboard": true });
    expect(ea).toEqual(expect.arrayContaining(["kpi", "chart", "kpi:total_cards", "chart:completion", "recent_activity"]));
    expect(ea).not.toContain("idle_users");
    const admin = ids({ "admin.users": true });
    expect(admin).toEqual(expect.arrayContaining(["idle_users", "kpi:active_users", "kpi:overall_quality"]));
    expect(admin).not.toContain("chart");
  });
});
