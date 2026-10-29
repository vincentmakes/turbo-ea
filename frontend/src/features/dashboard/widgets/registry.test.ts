/**
 * The widget catalogue: parity with the backend's closed set of widget types
 * (read off `dashboard_defaults.py` as text), and the per-widget permission,
 * source and title rules the grid and the shared sources rely on.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import type { DashboardWidget, WidgetType } from "@/types";
import { KPI_PRESET_KEYS, KPI_PRESETS } from "./kpiPresets";
import {
  WIDGET_META,
  WIDGET_REGISTRY,
  WIDGET_TYPE_KEYS,
  chartTitleKey,
  isKnownWidgetType,
  neededSources,
  visibleWidgets,
  widgetModule,
  widgetPermission,
  widgetSource,
  widgetSources,
  widgetTitle,
} from "./registry";
import KpiWidget from "./KpiWidget";
import ChartWidget from "./ChartWidget";
import SectionWidget from "./SectionWidget";
import RecentActivityWidget from "./RecentActivityWidget";
import BrowseByTypeWidget from "./BrowseByTypeWidget";

const DEFAULTS_FILE = path.resolve(__dirname, "../../../../../backend/app/services/dashboard_defaults.py");

/** The `WIDGET_TYPES` frozenset in the backend, read as text. */
function backendWidgetTypes(): string[] {
  const text = fs.readFileSync(DEFAULTS_FILE, "utf-8");
  const start = text.search(/^WIDGET_TYPES\b/m);
  expect(start, "WIDGET_TYPES is declared at the start of a line").toBeGreaterThan(-1);
  const open = text.indexOf("(", text.indexOf("frozenset", start));
  let depth = 0;
  let end = open;
  for (; end < text.length; end++) {
    if (text[end] === "(") depth++;
    else if (text[end] === ")" && --depth === 0) break;
  }
  const body = text.slice(open, end).replace(/#.*$/gm, "");
  return [...body.matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]).sort();
}

const t = i18n.getFixedT("en", "common");

function w(type: WidgetType, config: Record<string, unknown> = {}, title: string | null = null): DashboardWidget {
  return { id: `${type}-1`, type, title, config, layout: { x: 0, y: 0, w: 3, h: 3 } };
}

describeSourceScan("parity with the backend", () => {
  itSourceScan("knows exactly the widget types the backend accepts, both ways", () => {
    const backend = backendWidgetTypes();
    const frontend = [...WIDGET_TYPE_KEYS].sort();
    expect(frontend.filter((x) => !backend.includes(x)), "frontend-only types").toEqual([]);
    expect(backend.filter((x) => !frontend.includes(x as WidgetType)), "backend-only types").toEqual([]);
  });
});

describe("WIDGET_REGISTRY", () => {
  it("has an entry, a component and a translated label for every type", () => {
    for (const type of WIDGET_TYPE_KEYS) {
      const entry = WIDGET_REGISTRY[type];
      expect(entry.type).toBe(type);
      expect(typeof entry.Component).toBe("function");
      expect(i18n.exists(`common:${entry.labelKey}`), entry.labelKey).toBe(true);
      expect(entry.defaultLayout.w).toBeGreaterThanOrEqual(entry.defaultLayout.minW);
      expect(entry.defaultLayout.h).toBeGreaterThanOrEqual(entry.defaultLayout.minH);
      expect(entry.defaultLayout.w).toBeLessThanOrEqual(12);
    }
  });

  it("routes each type to its component", () => {
    expect(WIDGET_REGISTRY.kpi.Component).toBe(KpiWidget);
    expect(WIDGET_REGISTRY.chart.Component).toBe(ChartWidget);
    expect(WIDGET_REGISTRY.recent_activity.Component).toBe(RecentActivityWidget);
    expect(WIDGET_REGISTRY.browse_by_type.Component).toBe(BrowseByTypeWidget);
    expect(WIDGET_REGISTRY.my_todos.Component).toBe(SectionWidget);
    expect(WIDGET_REGISTRY.stakeholder_directory.Component).toBe(SectionWidget);
  });

  it("allows many KPIs and charts but one of every section", () => {
    for (const type of WIDGET_TYPE_KEYS) {
      expect(WIDGET_META[type].single, type).toBe(type !== "kpi" && type !== "chart");
    }
    expect(WIDGET_META.kpi.configurable).toBe("kpi");
    expect(WIDGET_META.chart.configurable).toBe("chart");
    expect(WIDGET_META.recent_activity.configurable).toBe("activity");
  });

  it("gates the overview family on the EA dashboard, admin on admin.users, workspace on nothing", () => {
    for (const type of WIDGET_TYPE_KEYS) {
      const meta = WIDGET_META[type];
      const expected =
        meta.family === "admin" ? "admin.users" : meta.family === "workspace" ? undefined : "reports.ea_dashboard";
      expect(meta.permission, type).toBe(expected);
    }
    expect(WIDGET_META.top_contributors.family).toBe("admin");
    expect(WIDGET_META.my_roles.family).toBe("workspace");
    expect(WIDGET_META.browse_by_type.family).toBe("overview");
  });

  it("recognises known types only", () => {
    expect(isKnownWidgetType("chart")).toBe(true);
    expect(isKnownWidgetType("toString")).toBe(false);
    expect(isKnownWidgetType("nope")).toBe(false);
  });
});

describe("KPI presets", () => {
  it("each have a translated label and a family-matching permission", () => {
    for (const key of KPI_PRESET_KEYS) {
      const preset = KPI_PRESETS[key];
      expect(i18n.exists(`common:${preset.labelKey}`), preset.labelKey).toBe(true);
      const expected =
        preset.family === "admin" ? "admin.users" : preset.family === "overview" ? "reports.ea_dashboard" : undefined;
      expect(widgetPermission(w("kpi", { metric: key })), key).toBe(expected);
    }
  });
});

describe("widgetPermission / widgetSources", () => {
  it("resolves a KPI by its preset, and a query KPI to the EA dashboard", () => {
    expect(widgetPermission(w("kpi", { metric: "favorites" }))).toBeUndefined();
    expect(widgetPermission(w("kpi", { metric: "active_users" }))).toBe("admin.users");
    expect(widgetPermission(w("kpi", { query: { card_type: "Application" } }))).toBe("reports.ea_dashboard");
    expect(widgetSources(w("kpi", { metric: "total_cards" }))).toEqual(["reports.dashboard"]);
    expect(widgetSources(w("kpi", { metric: "overall_quality" }))).toEqual(["data_quality"]);
    expect(widgetSources(w("kpi", { query: {} }))).toEqual([]);
  });

  it("reads the registry for other types and nothing for an unknown one", () => {
    expect(widgetPermission(w("chart"))).toBe("reports.ea_dashboard");
    expect(widgetSources(w("my_created"))).toEqual(["my_workspace"]);
    expect(widgetSources(w("idle_users"))).toEqual(["admin_dashboard"]);
    expect(widgetSources(w("my_todos"))).toEqual([]);
    expect(widgetPermission(w("ghost" as WidgetType))).toBeUndefined();
    expect(widgetSources(w("ghost" as WidgetType))).toEqual([]);
  });
});

describe("visibleWidgets", () => {
  const all = [
    w("kpi", { metric: "total_cards" }),
    w("kpi", { metric: "favorites" }),
    w("chart"),
    w("my_todos"),
    w("idle_users"),
    w("ghost" as WidgetType),
  ];

  it("keeps what the viewer may see, drops unknown types", () => {
    expect(visibleWidgets(all, { "*": true }).map((x) => x.type)).toEqual(["kpi", "kpi", "chart", "my_todos", "idle_users"]);
    expect(visibleWidgets(all, {}).map((x) => x.config.metric ?? x.type)).toEqual(["favorites", "my_todos"]);
    expect(visibleWidgets(all, { "reports.ea_dashboard": true }).map((x) => x.config.metric ?? x.type)).toEqual([
      "total_cards",
      "favorites",
      "chart",
      "my_todos",
    ]);
    expect(visibleWidgets(all, undefined).map((x) => x.type)).toEqual(["kpi", "my_todos"]);
  });

  it("collects the sources of visible widgets only", () => {
    expect([...neededSources(all, { "*": true })].sort()).toEqual(["admin_dashboard", "my_workspace", "reports.dashboard"]);
    expect([...neededSources(all, {})]).toEqual(["my_workspace"]);
    expect([...neededSources([], { "*": true })]).toEqual([]);
  });
});

describe("module widgets", () => {
  const ALL = { bpm: true, ppm: true, grc: true };
  const risks = w("kpi", { source: "risks_metrics", series: "open" });
  const bpm = w("chart", { source: "bpm_dashboard", series: "by_maturity", chart: "column" });

  it("need their source's permission and read that source", () => {
    expect(widgetSource(risks)).toBe("risks_metrics");
    expect(widgetSource(w("kpi", { source: "nope", series: "open" }))).toBeNull();
    expect(widgetSource(w("my_todos", { source: "risks_metrics" }))).toBeNull();
    expect(widgetModule(risks)).toBe("grc");
    expect(widgetModule(bpm)).toBe("bpm");
    expect(widgetModule(w("kpi", { query: {} }))).toBeUndefined();
    expect(widgetPermission(risks)).toBe("risks.view");
    expect(widgetPermission(bpm)).toBe("reports.bpm_dashboard");
    expect(widgetSources(risks)).toEqual(["risks_metrics"]);
    expect(widgetSources(bpm)).toEqual(["bpm_dashboard"]);
  });

  it("show only while their module is on and the viewer holds the permission", () => {
    expect(visibleWidgets([risks, bpm], { "*": true })).toEqual([]);
    expect(visibleWidgets([risks, bpm], { "*": true }, { bpm: true, ppm: false, grc: false })).toEqual([bpm]);
    expect(visibleWidgets([risks, bpm], { "risks.view": true }, ALL)).toEqual([risks]);
    expect([...neededSources([risks, bpm], { "*": true }, ALL)].sort()).toEqual(["bpm_dashboard", "risks_metrics"]);
    expect([...neededSources([risks, bpm], { "*": true }, { bpm: false, ppm: true, grc: true })]).toEqual([
      "risks_metrics",
    ]);
  });

  it("name themselves by their title key, else their series", () => {
    expect(widgetTitle(risks, t)).toBe(t("dashboard.source.series.risks_metrics.open"));
    expect(widgetTitle({ ...bpm, config: { ...bpm.config, title_key: "dashboard.source.chart.bpmMaturity" } }, t)).toBe(
      t("dashboard.source.chart.bpmMaturity"),
    );
  });
});

describe("widgetTitle", () => {
  it("prefers the admin's own title", () => {
    expect(widgetTitle(w("chart", {}, "  My chart "), t)).toBe("My chart");
  });

  it("uses a preset's label and today's chart titles", () => {
    expect(widgetTitle(w("kpi", { metric: "total_cards" }), t)).toBe(t("dashboard.totalCards"));
    expect(widgetTitle(w("chart", { query: { group_by: "type" } }), t)).toBe(t("dashboard.cardsByType"));
    expect(widgetTitle(w("chart", { query: { group_by: "lifecycle_phase" } }), t)).toBe(t("dashboard.lifecycleOverview"));
  });

  it("falls back to the catalogue label", () => {
    expect(widgetTitle(w("chart", { query: { group_by: "subtype" } }), t)).toBe(t("dashboard.widgets.chart"));
    expect(widgetTitle(w("kpi", { query: {} }), t)).toBe(t("dashboard.widgets.kpi"));
    expect(widgetTitle(w("my_todos", {}, "   "), t)).toBe(t("dashboard.workspace.myTodos"));
    expect(widgetTitle(w("ghost" as WidgetType), t)).toBe(t("dashboard.widgets.unknown"));
  });
});

describe("chartTitleKey", () => {
  it("names only a plain landscape-wide count by one known dimension", () => {
    expect(chartTitleKey({ group_by: "approval_status" })).toBe("dashboard.approvalStatusDistribution");
    expect(chartTitleKey({ group_by: "data_quality_bucket", metric: "count" })).toBe("dashboard.completionDistribution");
    expect(chartTitleKey({ group_by: "type", card_type: "Application" })).toBeNull();
    expect(chartTitleKey({ group_by: "type", metric: "sum" })).toBeNull();
    expect(chartTitleKey({ group_by: "type", group_by_2: "approval_status" })).toBeNull();
    expect(chartTitleKey({ group_by: "type", relation_type: "r" })).toBeNull();
    expect(chartTitleKey({ group_by: "type", approval_status: "DRAFT" })).toBeNull();
    expect(chartTitleKey({ group_by: "subtype" })).toBeNull();
    expect(chartTitleKey({})).toBeNull();
    expect(chartTitleKey(null)).toBeNull();
  });
});

describe("built-in chart titles", () => {
  it("translate the backend's title_key, and only dashboard keys", () => {
    expect(widgetTitle(w("chart", { title_key: "dashboard.lifecycleOverview", query: {} }), t)).toBe(
      t("dashboard.lifecycleOverview"),
    );
    expect(widgetTitle(w("chart", { title_key: "errors.generic", query: {} }), t)).toBe(t("dashboard.widgets.chart"));
    expect(widgetTitle(w("chart", { title_key: "dashboard.cardsByType" }, "Mine"), t)).toBe("Mine");
  });
});

describe("widget chrome", () => {
  it("lets every KPI tile and every section draw its own surface and place the customize controls itself", () => {
    for (const type of WIDGET_TYPE_KEYS) {
      const { Component, chrome } = WIDGET_REGISTRY[type];
      const self = Component === SectionWidget || Component === KpiWidget;
      expect(chrome === "self", type).toBe(self);
    }
    expect(WIDGET_META.kpi.chrome).toBe("self");
    expect(WIDGET_META.my_todos.chrome).toBe("self");
    expect(WIDGET_META.needs_attention.chrome).toBe("self");
    expect(WIDGET_META.chart.chrome).toBe("titled");
    expect(WIDGET_META.browse_by_type.chrome).toBe("titled");
    expect(WIDGET_META.recent_activity.chrome).toBe("card");
  });
});
