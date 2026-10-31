import { describe, expect, it } from "vitest";
import type { DashboardWidget } from "@/types";
import { KPI_PRESET_KEYS } from "../widgets/kpiPresets";
import { WIDGET_TYPE_KEYS } from "../widgets/widgetMeta";
import i18n from "@/i18n";
import {
  APPLICATION_TYPE,
  BUSINESS_CAPABILITY_TYPE,
  CARD_TYPES,
  RELATION_TYPES,
  makeCardType,
  makeRelationType,
} from "@/test/fixtures/metamodel";
import {
  CATALOGUE,
  CHART_PRESETS,
  FAMILY_ORDER,
  SOURCE_CHART_PRESETS,
  SOURCE_KPI_PRESETS,
  catalogueFor,
  isAlreadyAdded,
  presetsFor,
} from "./catalogue";

const entry = (id: string) => CATALOGUE.find((e) => e.id === id)!;
const w = (type: DashboardWidget["type"], config: Record<string, unknown> = {}) => ({ type, config });

describe("CATALOGUE", () => {
  it("offers every widget type, every KPI preset and every chart preset once", () => {
    const ids = CATALOGUE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const type of WIDGET_TYPE_KEYS) expect(ids).toContain(type);
    for (const metric of KPI_PRESET_KEYS) expect(ids).toContain(`kpi:${metric}`);
    for (const preset of CHART_PRESETS) expect(ids).toContain(`chart:${preset.id}`);
    expect(ids).toHaveLength(
      WIDGET_TYPE_KEYS.length +
        KPI_PRESET_KEYS.length +
        CHART_PRESETS.length +
        SOURCE_KPI_PRESETS.length +
        SOURCE_CHART_PRESETS.length,
    );
  });

  it("groups into the five families", () => {
    expect(FAMILY_ORDER).toEqual(["kpi", "chart", "overview", "workspace", "admin"]);
    expect(new Set(CATALOGUE.map((e) => e.family))).toEqual(new Set(FAMILY_ORDER));
    expect(entry("kpi:active_users").family).toBe("kpi");
    expect(entry("top_contributors").family).toBe("admin");
    expect(entry("my_todos").family).toBe("workspace");
    expect(entry("recent_activity").family).toBe("overview");
    expect(entry("quality_leaderboard").family).toBe("overview");
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
    // The leaderboard starts from the backend's LEADERBOARD_DEFAULT_CONFIG.
    expect(entry("quality_leaderboard").config).toEqual({
      rank_by: "average_quality",
      min_cards: 3,
      counting_roles_only: true,
      max_rows: 10,
    });
    expect(entry("quality_leaderboard")).toMatchObject({
      labelKey: "dashboard.widgets.qualityLeaderboard",
      icon: "leaderboard",
      needsConfig: false,
      single: false,
    });
    expect(entry("my_todos").config).toEqual({});
  });
});

describe("module tiles", () => {
  it("are the five KPIs and five charts, single, with translated names", () => {
    const tiles = CATALOGUE.filter((e) => typeof e.config.source === "string");
    expect(tiles.map((e) => e.id)).toEqual([
      "kpi:risks_metrics:open",
      "kpi:risks_metrics:overdue",
      "kpi:compliance_overview:score_avg",
      "kpi:ppm_dashboard:at_risk",
      "kpi:bpm_dashboard:without_diagram",
      "chart:risks_metrics:by_level",
      "chart:risks_metrics:by_status",
      "chart:compliance_overview:scores",
      "chart:ppm_dashboard:health_schedule",
      "chart:bpm_dashboard:by_maturity",
    ]);
    for (const tile of tiles) {
      expect(tile.single).toBe(true);
      expect(tile.needsConfig).toBe(false);
      expect(i18n.exists(`common:${tile.labelKey}`), tile.labelKey).toBe(true);
    }
  });

  it("store no title key on a KPI and one under dashboard.source on a chart", () => {
    expect(entry("kpi:compliance_overview:score_avg").config).toEqual({
      source: "compliance_overview",
      series: "score_avg",
      format: "percent",
    });
    expect(entry("chart:risks_metrics:by_level").config).toEqual({
      source: "risks_metrics",
      series: "by_level",
      chart: "donut",
      title_key: "dashboard.source.chart.risksByLevel",
    });
    expect(entry("chart:bpm_dashboard:by_maturity").config.chart).toBe("column");
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

  it("matches a module tile by source and series", () => {
    const open = entry("kpi:risks_metrics:open");
    expect(isAlreadyAdded(open, [w("kpi", { source: "risks_metrics", series: "open" })])).toBe(true);
    expect(isAlreadyAdded(open, [w("kpi", { source: "risks_metrics", series: "overdue" })])).toBe(false);
    expect(isAlreadyAdded(open, [w("kpi", { source: "ppm_dashboard", series: "open" })])).toBe(false);
    expect(isAlreadyAdded(open, [w("chart", { source: "risks_metrics", series: "open" })])).toBe(false);
    const byLevel = entry("chart:risks_metrics:by_level");
    // Retitled or redrawn, it is still the same tile.
    expect(isAlreadyAdded(byLevel, [w("chart", { source: "risks_metrics", series: "by_level", chart: "bar" })])).toBe(true);
    expect(isAlreadyAdded(byLevel, [w("chart", { title_key: "dashboard.source.chart.risksByLevel" })])).toBe(false);
  });

  it("matches any other single widget by type", () => {
    expect(isAlreadyAdded(entry("recent_activity"), [w("recent_activity")])).toBe(true);
    expect(isAlreadyAdded(entry("recent_activity"), [w("browse_by_type")])).toBe(false);
    expect(isAlreadyAdded(entry("recent_activity"), [])).toBe(false);
  });

  it("never greys the leaderboard: a dashboard may hold several", () => {
    expect(isAlreadyAdded(entry("quality_leaderboard"), [w("quality_leaderboard")])).toBe(false);
  });
});

describe("catalogueFor", () => {
  const ids = (perms: Record<string, boolean>) => catalogueFor(perms).map((e) => e.id);

  const ALL = { bpm: true, ppm: true, grc: true };

  it("offers everything to the wildcard with every module on", () => {
    expect(catalogueFor({ "*": true }, ALL)).toHaveLength(CATALOGUE.length);
  });

  it("offers a module's tiles only while the module is on", () => {
    const none = ids({ "*": true });
    expect(none.filter((id) => id.split(":").length === 3)).toEqual([]);
    const grc = catalogueFor({ "*": true }, { bpm: false, ppm: false, grc: true }).map((e) => e.id);
    expect(grc).toEqual(
      expect.arrayContaining([
        "kpi:risks_metrics:open",
        "kpi:risks_metrics:overdue",
        "kpi:compliance_overview:score_avg",
        "chart:risks_metrics:by_level",
        "chart:risks_metrics:by_status",
        "chart:compliance_overview:scores",
      ]),
    );
    expect(grc).not.toContain("kpi:ppm_dashboard:at_risk");
    expect(grc).not.toContain("chart:bpm_dashboard:by_maturity");
  });

  it("offers a module's tiles only with the permission its report needs", () => {
    const risksOnly = catalogueFor({ "risks.view": true }, ALL).map((e) => e.id);
    expect(risksOnly).toEqual(
      expect.arrayContaining(["kpi:risks_metrics:open", "kpi:risks_metrics:overdue", "chart:risks_metrics:by_level"]),
    );
    expect(risksOnly).not.toContain("kpi:compliance_overview:score_avg");
    expect(risksOnly).not.toContain("kpi:ppm_dashboard:at_risk");
    expect(catalogueFor({ "ppm.view": true }, ALL).map((e) => e.id)).toEqual(
      expect.arrayContaining(["kpi:ppm_dashboard:at_risk", "chart:ppm_dashboard:health_schedule"]),
    );
    expect(catalogueFor({ "reports.bpm_dashboard": true }, ALL).map((e) => e.id)).toEqual(
      expect.arrayContaining(["kpi:bpm_dashboard:without_diagram", "chart:bpm_dashboard:by_maturity"]),
    );
    expect(catalogueFor({ "compliance.view": true }, ALL).map((e) => e.id)).toEqual(
      expect.arrayContaining(["kpi:compliance_overview:score_avg", "chart:compliance_overview:scores"]),
    );
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
    expect(ea).toContain("quality_leaderboard");
    expect(ea).not.toContain("idle_users");
    expect(ids({ "admin.users": true })).not.toContain("quality_leaderboard");
    const admin = ids({ "admin.users": true });
    expect(admin).toEqual(expect.arrayContaining(["idle_users", "kpi:active_users", "kpi:overall_quality"]));
    expect(admin).not.toContain("chart");
  });
});

describe("presetsFor — metamodel-aware charts", () => {
  const ORGANIZATION = makeCardType({ key: "Organization" });
  const REL_ORG_TO_APP = makeRelationType({
    key: "relOrgToApp",
    source_type_key: "Organization",
    target_type_key: "Application",
  });
  const REL_APP_TO_ORG = makeRelationType({
    key: "relAppToOrg",
    source_type_key: "Application",
    target_type_key: "Organization",
  });
  const TYPES = [...CARD_TYPES, ORGANIZATION];
  const RELS = [...RELATION_TYPES, REL_ORG_TO_APP];
  const COSTS = { "reports.ea_dashboard": true, "costs.view": true };
  const ids = (presets: { id: string }[]) => presets.map((p) => p.id);
  const preset = (id: string, types = TYPES, rels = RELS) => presetsFor(types, rels).find((p) => p.id === id)?.config;

  it("offers all six on a landscape that has their pieces, in order", () => {
    expect(ids(presetsFor(TYPES, RELS))).toEqual([
      "applications_per_organization",
      "end_of_life_calendar",
      "stale_by_type",
      "organization_to_application",
      "data_quality_gauge",
      "approved_applications_gauge",
    ]);
  });

  it("offers two banded gauges: the average data quality, and the share of approved Applications", () => {
    expect(preset("data_quality_gauge")).toEqual({
      query: { metric: "avg", metric_field: "@data_quality" },
      chart: "gauge",
      thresholds: [50, 80],
      title_key: "dashboard.preset.dataQualityGauge",
    });
    expect(preset("approved_applications_gauge")).toEqual({
      query: { card_type: "Application", metric: "share", approval_status: "APPROVED" },
      chart: "gauge",
      thresholds: [50, 80],
      title_key: "dashboard.preset.approvedApplicationsGauge",
    });
    // The data-quality gauge needs any type; the approval gauge the Application type.
    expect(preset("data_quality_gauge", [BUSINESS_CAPABILITY_TYPE], [])).toBeDefined();
    expect(preset("approved_applications_gauge", [BUSINESS_CAPABILITY_TYPE], [])).toBeUndefined();
    expect(preset("approved_applications_gauge", [{ ...APPLICATION_TYPE, is_hidden: true }], [])).toBeUndefined();
    expect(preset("data_quality_gauge", [{ ...APPLICATION_TYPE, is_hidden: true }], [])).toBeUndefined();
  });

  it("offers no cost-per-application treemap, even to a cost reader", () => {
    expect(ids(presetsFor(TYPES, RELS))).not.toContain("cost_per_application");
    expect(catalogueFor(COSTS, undefined, { types: TYPES, relationTypes: RELS }).map((e) => e.id)).not.toContain(
      "chart:cost_per_application",
    );
  });

  it("groups Applications by the Organization relation, and draws it as a sankey", () => {
    expect(preset("applications_per_organization")).toEqual({
      query: { card_type: "Application", group_by: "related:relOrgToApp" },
      chart: "bar",
      drill: true,
      title_key: "dashboard.preset.applicationsPerOrganization",
    });
    expect(preset("organization_to_application")).toEqual({
      query: { relation_type: "relOrgToApp", group_by: "card", group_by_2: "card" },
      chart: "sankey",
      max: 20,
      title_key: "dashboard.preset.organizationToApplication",
    });
  });

  it("prefers Organization → Application, falls back to the reverse, and skips a hidden one", () => {
    const both = [...RELATION_TYPES, REL_APP_TO_ORG, REL_ORG_TO_APP];
    expect(preset("applications_per_organization", TYPES, both)).toMatchObject({
      query: { group_by: "related:relOrgToApp" },
    });
    const reverse = [...RELATION_TYPES, REL_APP_TO_ORG];
    expect(preset("applications_per_organization", TYPES, reverse)).toMatchObject({
      query: { card_type: "Application", group_by: "related:relAppToOrg" },
    });
    expect(preset("organization_to_application", TYPES, reverse)).toMatchObject({
      query: { relation_type: "relAppToOrg" },
    });
    const hidden = [...RELATION_TYPES, { ...REL_ORG_TO_APP, is_hidden: true }];
    expect(preset("applications_per_organization", TYPES, hidden)).toBeUndefined();
    expect(preset("organization_to_application", TYPES, hidden)).toBeUndefined();
  });

  it("needs both the Organization type and the relation for the two relation charts", () => {
    expect(preset("applications_per_organization", CARD_TYPES, RELS)).toBeUndefined();
    expect(preset("organization_to_application", CARD_TYPES, RELS)).toBeUndefined();
    expect(preset("applications_per_organization", TYPES, RELATION_TYPES)).toBeUndefined();
    expect(preset("organization_to_application", TYPES, RELATION_TYPES)).toBeUndefined();
  });

  it("charts Applications by end-of-life month, and stale cards by type", () => {
    expect(preset("end_of_life_calendar")).toEqual({
      query: { card_type: "Application", group_by: "phase_month:endOfLife" },
      chart: "column",
      drill: true,
      title_key: "dashboard.preset.endOfLifeCalendar",
    });
    expect(preset("end_of_life_calendar", [BUSINESS_CAPABILITY_TYPE])).toBeUndefined();
    expect(preset("stale_by_type")).toEqual({
      query: { group_by: "type", flags: "stale" },
      chart: "bar",
      drill: true,
      title_key: "dashboard.preset.staleByType",
    });
    expect(preset("stale_by_type", [BUSINESS_CAPABILITY_TYPE], [])).toBeDefined();
    expect(presetsFor([], [])).toEqual([]);
  });

  it("names every preset in English", () => {
    for (const p of presetsFor(TYPES, RELS)) {
      expect(i18n.exists(`common:${p.config.title_key as string}`), String(p.config.title_key)).toBe(true);
    }
  });

  it("joins the catalogue after the built-in charts, single, and only for chart readers", () => {
    const meta = { types: TYPES, relationTypes: RELS };
    const all = catalogueFor(COSTS, undefined, meta).map((e) => e.id);
    const at = all.indexOf("chart:lifecycle");
    expect(all.slice(at + 1, at + 7)).toEqual([
      "chart:applications_per_organization",
      "chart:end_of_life_calendar",
      "chart:stale_by_type",
      "chart:organization_to_application",
      "chart:data_quality_gauge",
      "chart:approved_applications_gauge",
    ]);
    const entry = catalogueFor(COSTS, undefined, meta).find((e) => e.id === "chart:end_of_life_calendar")!;
    expect(entry).toMatchObject({ type: "chart", family: "chart", single: true, needsConfig: false });
    expect(entry.labelKey).toBe("dashboard.preset.endOfLifeCalendar");
    // Without reports.ea_dashboard no chart is offered, preset or not.
    expect(catalogueFor({ "costs.view": true }, undefined, meta).filter((e) => e.type === "chart")).toEqual([]);
    // Without a metamodel, nothing extra.
    expect(catalogueFor(COSTS).map((e) => e.id)).not.toContain("chart:stale_by_type");
  });

  it("greys a preset already on the dashboard by its title key", () => {
    const entry = catalogueFor(COSTS, undefined, { types: TYPES, relationTypes: RELS }).find(
      (e) => e.id === "chart:stale_by_type",
    )!;
    expect(isAlreadyAdded(entry, [w("chart", { title_key: "dashboard.preset.staleByType", chart: "column" })])).toBe(true);
    expect(isAlreadyAdded(entry, [w("chart", { title_key: "dashboard.preset.endOfLifeCalendar" })])).toBe(false);
  });
});
