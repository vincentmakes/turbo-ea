import { describe, expect, it } from "vitest";
import type { DashboardWidget } from "@/types";
import {
  APPLICATION_TYPE,
  BUSINESS_CAPABILITY_TYPE,
  CARD_TYPES,
  IT_COMPONENT_TYPE,
  PROVIDER_TYPE,
  REL_APP_TO_APP,
  REL_APP_TO_ITC,
  RELATION_TYPES,
  makeCardType,
  makeField,
  makeSection,
} from "@/test/fixtures/metamodel";
import {
  draftQuery,
  gaugeIsPercent,
  gaugeMeasureOptions,
  queryProblem,
  thresholdsOf,
  flagOptions,
  hasFilters,
  measureOptions,
  parseSideKey,
  presenceFlag,
  relationPresenceOptions,
  relationSideKeys,
  relationSideProblem,
  sankeySideOptions,
  secondaryApplies,
  sourceChartKinds,
  splitFlags,
  availableChartKinds,
  cleanQuery,
  configKind,
  dimensionFields,
  dimensionOptions,
  draftFromWidget,
  draftProblem,
  needsCardType,
  numericFields,
  readableRelationTypes,
  widgetFromDraft,
  DIMENSION_GROUPS,
  chartDimensionOptions,
  dimensionGroup,
  keepsFlag,
  measureGroup,
  secondDimensionOptions,
  type ConfigDraft,
} from "./widgetConfigModel";

const widget = (type: DashboardWidget["type"], config: Record<string, unknown> = {}, title: string | null = null) =>
  ({ id: "w1", type, title, config, layout: { x: 0, y: 0, w: 6, h: 5 } }) as DashboardWidget;

const draft = (patch: Partial<ConfigDraft> = {}): ConfigDraft => ({
  title: "",
  query: { group_by: "type" },
  chart: "bar",
  drill: true,
  showValues: false,
  max: "",
  goodDirection: "up",
  thresholdWarn: "",
  thresholdGood: "",
  format: "number",
  maxRows: "12",
  activityFilter: "all",
  flags: [],
  relationPresence: { rt: null, has: true },
  sparkline: false,
  secondary: "",
  ...patch,
});

describe("configKind", () => {
  it("gives a preset KPI the title form and a query KPI the KPI form", () => {
    expect(configKind(widget("kpi", { metric: "total_cards" }))).toBe("title");
    expect(configKind(widget("kpi", { query: {} }))).toBe("kpi");
    expect(configKind(widget("kpi", { metric: "nope" }))).toBe("kpi");
  });

  it("gives charts and the activity feed their forms, and sections none", () => {
    expect(configKind(widget("chart"))).toBe("chart");
    expect(configKind(widget("recent_activity"))).toBe("activity");
    expect(configKind(widget("my_todos"))).toBeNull();
    expect(configKind(widget("browse_by_type"))).toBeNull();
  });
});

describe("metamodel helpers", () => {
  it("lists the dimensions a type offers, in menu order", () => {
    expect(dimensionOptions(undefined)).toEqual([
      "type",
      "approval_status",
      "lifecycle_phase",
      "data_quality_bucket",
      "created_month",
      "phase_month:active",
      "phase_month:endOfLife",
    ]);
    expect(dimensionOptions(APPLICATION_TYPE, RELATION_TYPES)).toEqual([
      "type",
      "subtype",
      "card",
      "approval_status",
      "lifecycle_phase",
      "data_quality_bucket",
      "created_month",
      "phase_month:active",
      "phase_month:endOfLife",
      "field:businessCriticality",
      "field:isCloud",
      "related:relAppToITC",
      "related:relAppToBC",
      // A self-referencing relation is offered once per direction.
      "related:relAppToApp__out",
      "related:relAppToApp__in",
      "eol_coverage",
    ]);
    expect(dimensionOptions(BUSINESS_CAPABILITY_TYPE)).toEqual([
      "type",
      "card",
      "approval_status",
      "lifecycle_phase",
      "data_quality_bucket",
      "created_month",
      "phase_month:active",
      "phase_month:endOfLife",
    ]);
    // Retired from the menu, still accepted.
    for (const retired of ["stakeholders", "phase_month:plan", "phase_month:phaseIn", "phase_month:phaseOut"]) {
      expect(dimensionOptions(APPLICATION_TYPE, RELATION_TYPES)).not.toContain(retired);
      expect(queryProblem({ group_by: retired })).toBeNull();
    }
    // EOL coverage only where EOL data can exist.
    expect(dimensionOptions(BUSINESS_CAPABILITY_TYPE)).not.toContain("eol_coverage");
    expect(dimensionOptions(BUSINESS_CAPABILITY_TYPE, RELATION_TYPES)).toContain("related:relAppToBC");
    // A hidden relation type is not offered.
    expect(dimensionOptions(APPLICATION_TYPE, [{ ...REL_APP_TO_ITC, is_hidden: true }])).not.toContain(
      "related:relAppToITC",
    );
    // No subtypes: no subtype dimension.
    expect(dimensionOptions(BUSINESS_CAPABILITY_TYPE)).not.toContain("subtype");
  });

  it("picks single selects and booleans as dimension fields", () => {
    expect(dimensionFields(APPLICATION_TYPE).map((f) => f.key)).toEqual(["businessCriticality", "isCloud"]);
    expect(dimensionFields(PROVIDER_TYPE)).toEqual([]);
  });

  it("offers cost fields as metrics only to cost readers", () => {
    expect(numericFields(APPLICATION_TYPE, true).map((f) => f.key)).toEqual([
      "costTotalAnnual",
      "coverage",
      "vendorScore",
    ]);
    expect(numericFields(APPLICATION_TYPE, false).map((f) => f.key)).toEqual(["coverage", "vendorScore"]);
    expect(numericFields(undefined, true)).toEqual([]);
  });

  it("knows which dimensions need a card type", () => {
    expect(needsCardType("subtype")).toBe(true);
    expect(needsCardType("field:x")).toBe(true);
    expect(needsCardType("type")).toBe(false);
    expect(needsCardType(null)).toBe(false);
  });

  it("offers relation types whose both ends are readable and not hidden", () => {
    const readable = new Set(["Application", "ITComponent"]);
    const out = readableRelationTypes(RELATION_TYPES, readable).map((r) => r.key);
    expect(out).toContain(REL_APP_TO_ITC.key);
    expect(out.every((key) => {
      const rt = RELATION_TYPES.find((r) => r.key === key)!;
      return readable.has(rt.source_type_key) && readable.has(rt.target_type_key);
    })).toBe(true);
    expect(readableRelationTypes([{ ...REL_APP_TO_ITC, is_hidden: true }], readable)).toEqual([]);
  });

  it("drops sankey when there is no relation type to draw", () => {
    expect(availableChartKinds(true)).toContain("sankey");
    expect(availableChartKinds(false)).not.toContain("sankey");
    expect(availableChartKinds(false)).toHaveLength(9);
    expect(availableChartKinds(false)).toContain("stacked_column");
  });
});

describe("draftFromWidget", () => {
  it("reads a chart config", () => {
    const d = draftFromWidget(
      widget("chart", { query: { group_by: "approval_status" }, chart: "donut", drill: false, max: 5 }, "Mine"),
    );
    expect(d).toMatchObject({
      title: "Mine",
      query: { group_by: "approval_status" },
      chart: "donut",
      drill: false,
      max: "5",
    });
  });

  it("reads a KPI config", () => {
    const d = draftFromWidget(
      widget("kpi", { query: { card_type: "Application" }, good_direction: "down", format: "percent" }),
    );
    expect(d).toMatchObject({ title: "", query: { card_type: "Application" }, goodDirection: "down", format: "percent" });
    expect(draftFromWidget(widget("kpi", {})).query).toEqual({});
    expect(draftFromWidget(widget("kpi", {})).goodDirection).toBe("up");
    expect(draftFromWidget(widget("kpi", {})).format).toBe("number");
  });

  it("reads an activity config with defaults", () => {
    expect(draftFromWidget(widget("recent_activity", { max_rows: 7, filter: "approvals" }))).toMatchObject({
      maxRows: "7",
      activityFilter: "approvals",
    });
    expect(draftFromWidget(widget("recent_activity", { filter: "bogus" }))).toMatchObject({
      maxRows: "12",
      activityFilter: "all",
    });
  });

  it("copies the query so editing the draft never edits the widget", () => {
    const w = widget("chart", { query: { group_by: "type" }, chart: "bar" });
    const d = draftFromWidget(w);
    d.query.group_by = "subtype";
    expect((w.config.query as { group_by: string }).group_by).toBe("type");
  });
});

describe("cleanQuery", () => {
  it("drops blanks and the default count metric", () => {
    expect(
      cleanQuery({ card_type: "", group_by: "type", metric: "count", metric_field: "x", subtype: null }, "chart", "bar"),
    ).toEqual({ group_by: "type" });
  });

  it("keeps a sum with its field", () => {
    expect(cleanQuery({ card_type: "Application", metric: "sum", metric_field: "coverage" }, "kpi", "bar")).toEqual({
      card_type: "Application",
      metric: "sum",
      metric_field: "coverage",
    });
  });

  it("strips grouping from a KPI and a gauge", () => {
    const q = { group_by: "type", group_by_2: "approval_status", relation_type: "r", approval_status: "APPROVED" };
    expect(cleanQuery(q, "kpi", "bar")).toEqual({ approval_status: "APPROVED" });
    expect(cleanQuery(q, "chart", "gauge")).toEqual({ approval_status: "APPROVED" });
  });

  it("keeps a sankey's relation, sides and filters, and drops a side left on the default type", () => {
    expect(cleanQuery({ relation_type: "r", card_type: "Application", group_by: "type" }, "chart", "sankey")).toEqual({
      relation_type: "r",
    });
    expect(
      cleanQuery(
        {
          relation_type: "r",
          card_type: "Application",
          group_by: "card",
          group_by_2: "field:x",
          approval_status: "APPROVED",
          lifecycle_phase: "active",
          flags: "stale,orphaned",
          metric: "sum",
          metric_field: "cost",
          subtype: "s",
        },
        "chart",
        "sankey",
      ),
    ).toEqual({
      relation_type: "r",
      group_by: "card",
      group_by_2: "field:x",
      approval_status: "APPROVED",
      lifecycle_phase: "active",
      flags: "orphaned,stale",
    });
    expect(cleanQuery({ card_type: "Application", group_by: "card" }, "chart", "sankey")).toEqual({});
  });

  it("canonicalises flags and drops an empty list", () => {
    expect(cleanQuery({ flags: " stale , orphaned,stale" }, "kpi", "bar")).toEqual({ flags: "orphaned,stale" });
    expect(cleanQuery({ flags: " , " }, "kpi", "bar")).toEqual({});
  });

  it("drops the field of a share", () => {
    expect(cleanQuery({ metric: "share", metric_field: "x", approval_status: "APPROVED" }, "kpi", "bar")).toEqual({
      metric: "share",
      approval_status: "APPROVED",
    });
  });

  it("keeps the second grouping of stacked columns", () => {
    expect(cleanQuery({ group_by: "type", group_by_2: "lifecycle_phase" }, "chart", "stacked_column")).toEqual({
      group_by: "type",
      group_by_2: "lifecycle_phase",
    });
  });

  it("keeps the second grouping for a heatmap only", () => {
    const q = { group_by: "type", group_by_2: "approval_status", relation_type: "r" };
    expect(cleanQuery(q, "chart", "heatmap")).toEqual({ group_by: "type", group_by_2: "approval_status" });
    expect(cleanQuery(q, "chart", "pie")).toEqual({ group_by: "type" });
  });
});

describe("draftProblem", () => {
  it("accepts a valid chart and a valid KPI", () => {
    expect(draftProblem("chart", draft())).toBeNull();
    expect(draftProblem("kpi", draft({ query: {} }))).toBeNull();
    expect(draftProblem("chart", draft({ chart: "gauge", query: {}, max: "100" }))).toBeNull();
  });

  it("limits the title for every kind", () => {
    const long = "x".repeat(121);
    expect(draftProblem("title", draft({ title: long }))).toBe("titleTooLong");
    expect(draftProblem("title", draft({ title: "x".repeat(120) }))).toBeNull();
    expect(draftProblem("chart", draft({ title: `  ${"x".repeat(120)}  ` }))).toBeNull();
  });

  it("bounds the activity row count", () => {
    expect(draftProblem("activity", draft({ maxRows: "1" }))).toBeNull();
    expect(draftProblem("activity", draft({ maxRows: "50" }))).toBeNull();
    expect(draftProblem("activity", draft({ maxRows: "0" }))).toBe("maxRowsRange");
    expect(draftProblem("activity", draft({ maxRows: "51" }))).toBe("maxRowsRange");
    expect(draftProblem("activity", draft({ maxRows: "2.5" }))).toBe("maxRowsRange");
    expect(draftProblem("activity", draft({ maxRows: "" }))).toBe("maxRowsRange");
  });

  it("needs a relation type for a sankey", () => {
    expect(draftProblem("chart", draft({ chart: "sankey", query: {} }))).toBe("relationTypeRequired");
    expect(draftProblem("chart", draft({ chart: "sankey", query: { relation_type: "r" } }))).toBeNull();
  });

  it("needs a grouping for a categorical chart, two different ones for a heatmap", () => {
    expect(draftProblem("chart", draft({ query: {} }))).toBe("dimensionRequired");
    expect(draftProblem("chart", draft({ chart: "heatmap", query: { group_by: "type" } }))).toBe(
      "secondDimensionRequired",
    );
    expect(draftProblem("chart", draft({ chart: "heatmap", query: { group_by: "type", group_by_2: "type" } }))).toBe(
      "sameDimension",
    );
    expect(
      draftProblem("chart", draft({ chart: "heatmap", query: { group_by: "type", group_by_2: "approval_status" } })),
    ).toBeNull();
  });

  it("needs the field of a sum or average", () => {
    expect(draftProblem("kpi", draft({ query: { card_type: "Application", metric: "avg" } }))).toBe(
      "metricFieldRequired",
    );
  });

  it("needs a card type for a subtype or field grouping, a metric field or a subtype filter", () => {
    expect(draftProblem("chart", draft({ query: { group_by: "subtype" } }))).toBe("cardTypeRequired");
    expect(draftProblem("chart", draft({ query: { group_by: "field:isCloud" } }))).toBe("cardTypeRequired");
    expect(
      draftProblem("chart", draft({ chart: "heatmap", query: { group_by: "type", group_by_2: "field:isCloud" } })),
    ).toBe("cardTypeRequired");
    expect(draftProblem("kpi", draft({ query: { metric: "sum", metric_field: "coverage" } }))).toBe("cardTypeRequired");
    expect(draftProblem("kpi", draft({ query: { subtype: "microservice" } }))).toBe("cardTypeRequired");
    expect(draftProblem("chart", draft({ query: { card_type: "Application", group_by: "subtype" } }))).toBeNull();
  });

  it("wants a positive maximum when one is given", () => {
    expect(draftProblem("chart", draft({ max: "0" }))).toBe("maxPositive");
    expect(draftProblem("chart", draft({ max: "-3" }))).toBe("maxPositive");
    expect(draftProblem("chart", draft({ max: "abc" }))).toBe("maxPositive");
    expect(draftProblem("chart", draft({ max: " " }))).toBeNull();
    expect(draftProblem("chart", draft({ max: "8" }))).toBeNull();
  });
});

describe("widgetFromDraft", () => {
  it("saves a chart config and a trimmed title", () => {
    const out = widgetFromDraft(
      widget("chart", { query: { group_by: "type" }, chart: "bar" }),
      "chart",
      draft({ title: "  Apps  ", query: { card_type: "Application", group_by: "subtype" }, chart: "pie", drill: false, max: "6" }),
    );
    expect(out).toEqual({
      id: "w1",
      type: "chart",
      title: "Apps",
      config: { query: { card_type: "Application", group_by: "subtype" }, chart: "pie", drill: false, max: 6 },
      layout: { x: 0, y: 0, w: 6, h: 5 },
    });
  });

  it("keeps a built-in chart's title key only while the chart is unchanged", () => {
    const builtIn = widget("chart", {
      query: { group_by: "type" },
      chart: "bar",
      drill: true,
      title_key: "dashboard.cardsByType",
    });
    expect(widgetFromDraft(builtIn, "chart", draft()).config.title_key).toBe("dashboard.cardsByType");
    expect(widgetFromDraft(builtIn, "chart", draft({ chart: "column" })).config).not.toHaveProperty("title_key");
    expect(
      widgetFromDraft(builtIn, "chart", draft({ query: { group_by: "approval_status" } })).config,
    ).not.toHaveProperty("title_key");
  });

  it("keeps a KPI history series", () => {
    const line = widget("chart", { query: { card_type: "Application" }, chart: "line", series: "kpi_history" });
    expect(widgetFromDraft(line, "chart", draft({ chart: "line", query: { card_type: "Application", group_by: "type" } })).config.series).toBe(
      "kpi_history",
    );
  });

  it("saves a KPI config", () => {
    const out = widgetFromDraft(
      widget("kpi", { query: {}, icon: "rocket" }),
      "kpi",
      draft({ query: { card_type: "Application", group_by: "type" }, goodDirection: "down", format: "percent" }),
    );
    expect(out.title).toBeNull();
    expect(out.config).toEqual({
      query: { card_type: "Application" },
      good_direction: "down",
      format: "percent",
      icon: "rocket",
    });
  });

  it("saves only the title of a preset KPI", () => {
    const out = widgetFromDraft(widget("kpi", { metric: "total_cards" }), "title", draft({ title: "All" }));
    expect(out.title).toBe("All");
    expect(out.config).toEqual({ metric: "total_cards" });
  });

  it("saves the activity row count and filter", () => {
    const out = widgetFromDraft(
      widget("recent_activity", { max_rows: 12 }),
      "activity",
      draft({ maxRows: "20", activityFilter: "comments" }),
    );
    expect(out.config).toEqual({ max_rows: 20, filter: "comments" });
  });
});

const ctx = { types: CARD_TYPES, relationTypes: RELATION_TYPES };

describe("gauge", () => {
  const gauge = (patch: Partial<ConfigDraft> = {}) => draft({ chart: "gauge", query: {}, ...patch });
  const share = { card_type: "Application", metric: "share" as const, approval_status: "APPROVED" };
  const coverage = { card_type: "Application", metric: "avg" as const, metric_field: "coverage" };

  it("offers rates for an average and totals for a sum", () => {
    expect(gaugeMeasureOptions(APPLICATION_TYPE, true, "avg")).toEqual(["coverage", "@data_quality"]);
    expect(gaugeMeasureOptions(undefined, true, "avg")).toEqual(["@data_quality"]);
    expect(gaugeMeasureOptions(APPLICATION_TYPE, true, "sum", RELATION_TYPES)).toEqual([
      "costTotalAnnual",
      "vendorScore",
      "@relations:relAppToITC",
      "@relations:relAppToBC",
      "@relations:relAppToApp__out",
      "@relations:relAppToApp__in",
    ]);
    expect(gaugeMeasureOptions(APPLICATION_TYPE, false, "sum")).toEqual(["vendorScore"]);
  });

  it("tells a rate on 0–100 from a count or sum against a target", () => {
    expect(gaugeIsPercent("chart", gauge({ query: share }), ctx)).toBe(true);
    expect(gaugeIsPercent("chart", gauge({ query: { metric: "avg", metric_field: "@data_quality" } }))).toBe(true);
    expect(gaugeIsPercent("chart", gauge({ query: coverage }), ctx)).toBe(true);
    // A percentage field is recognised only with the metamodel at hand.
    expect(gaugeIsPercent("chart", gauge({ query: coverage }))).toBe(false);
    expect(gaugeIsPercent("chart", gauge({ query: { card_type: "Application", metric: "sum", metric_field: "vendorScore" } }), ctx)).toBe(false);
    expect(gaugeIsPercent("chart", gauge(), ctx)).toBe(false);
    const score = widget("chart", { source: "compliance_overview", series: "score_avg", chart: "gauge" });
    const open = widget("chart", { source: "risks_metrics", series: "open", chart: "gauge" });
    expect(gaugeIsPercent("source", gauge(), ctx, score)).toBe(true);
    expect(gaugeIsPercent("source", gauge(), ctx, open)).toBe(false);
    expect(gaugeIsPercent("source", gauge(), ctx)).toBe(false);
  });

  it("requires a positive Target for a count or sum, and none for a rate", () => {
    expect(draftProblem("chart", gauge(), ctx)).toBe("targetRequired");
    expect(draftProblem("chart", gauge({ max: "  " }), ctx)).toBe("targetRequired");
    expect(draftProblem("chart", gauge({ max: "0" }), ctx)).toBe("maxPositive");
    expect(draftProblem("chart", gauge({ max: "120" }), ctx)).toBeNull();
    expect(draftProblem("chart", gauge({ query: share }), ctx)).toBeNull();
    expect(draftProblem("chart", gauge({ query: coverage, max: "0" }), ctx)).toBeNull();
  });

  it("wants both band edges, ascending, within the scale", () => {
    const rate = (warn: string, good: string) =>
      draftProblem("chart", gauge({ query: share, thresholdWarn: warn, thresholdGood: good }), ctx);
    expect(rate("", "")).toBeNull();
    expect(rate("50", "80")).toBeNull();
    expect(rate("0", "100")).toBeNull();
    expect(rate("50", "")).toBe("invalidThresholds");
    expect(rate(" ", "80")).toBe("invalidThresholds");
    expect(rate("80", "50")).toBe("invalidThresholds");
    expect(rate("50", "50")).toBe("invalidThresholds");
    expect(rate("-1", "50")).toBe("invalidThresholds");
    expect(rate("50", "101")).toBe("invalidThresholds");
    expect(rate("abc", "80")).toBe("invalidThresholds");
    // A target gauge's scale is its target.
    const target = (good: string) =>
      draftProblem("chart", gauge({ max: "200", thresholdWarn: "100", thresholdGood: good }), ctx);
    expect(target("200")).toBeNull();
    expect(target("201")).toBe("invalidThresholds");
    // A score gauge is a rate.
    const score = widget("chart", { source: "compliance_overview", series: "score_avg", chart: "gauge" });
    expect(draftProblem("source", gauge({ thresholdWarn: "60", thresholdGood: "90" }), ctx, score)).toBeNull();
    expect(draftProblem("source", gauge({ thresholdWarn: "60", thresholdGood: "190" }), ctx, score)).toBe(
      "invalidThresholds",
    );
  });

  it("reads the band edges as typed", () => {
    expect(thresholdsOf(gauge())).toBeNull();
    expect(thresholdsOf(gauge({ thresholdWarn: " 40 ", thresholdGood: "70" }))).toEqual([40, 70]);
    expect(thresholdsOf(gauge({ thresholdWarn: "40" }))).toBe("invalid");
    expect(thresholdsOf(gauge({ thresholdGood: "40" }))).toBe("invalid");
    expect(thresholdsOf(gauge({ thresholdWarn: "x", thresholdGood: "40" }))).toBe("invalid");
  });

  it("loads the bands and direction of a stored gauge", () => {
    const d = draftFromWidget(widget("chart", { query: {}, chart: "gauge", thresholds: [30, 60], good_direction: "down" }));
    expect(d).toMatchObject({ thresholdWarn: "30", thresholdGood: "60", goodDirection: "down" });
    expect(draftFromWidget(widget("chart", { query: {}, chart: "gauge" }))).toMatchObject({
      thresholdWarn: "",
      thresholdGood: "",
    });
  });

  it("saves a rate's bands and direction without a target", () => {
    const out = widgetFromDraft(
      widget("chart", { query: {}, chart: "bar" }),
      "chart",
      gauge({ query: share, max: "500", thresholdWarn: "40", thresholdGood: "70", goodDirection: "down" }),
      ctx,
    );
    expect(out.config).toEqual({
      query: share,
      chart: "gauge",
      drill: true,
      thresholds: [40, 70],
      good_direction: "down",
    });
  });

  it("saves a target gauge's target, and no bands when none are set", () => {
    const out = widgetFromDraft(widget("chart", { query: {}, chart: "gauge" }), "chart", gauge({ max: "120" }), ctx);
    expect(out.config).toEqual({ query: {}, chart: "gauge", drill: true, max: 120, good_direction: "up" });
  });

  it("drops a gauge's bands from any other chart", () => {
    const stored = widget("chart", { query: {}, chart: "gauge", thresholds: [1, 2], good_direction: "down" });
    const out = widgetFromDraft(stored, "chart", draft({ thresholdWarn: "1", thresholdGood: "2" }), ctx);
    expect(out.config).not.toHaveProperty("thresholds");
    expect(out.config).not.toHaveProperty("good_direction");
  });

  it("saves a module gauge's bands, dropping the target of a score, and none on a module chart", () => {
    const score = widget("chart", { source: "compliance_overview", series: "score_avg", chart: "gauge", max: 10 });
    expect(
      widgetFromDraft(score, "source", gauge({ max: "10", thresholdWarn: "60", thresholdGood: "90" }), ctx).config,
    ).toEqual({ source: "compliance_overview", series: "score_avg", chart: "gauge", thresholds: [60, 90], good_direction: "up" });
    const open = widget("chart", { source: "risks_metrics", series: "open", chart: "gauge" });
    expect(widgetFromDraft(open, "source", gauge({ max: "25" }), ctx).config).toEqual({
      source: "risks_metrics",
      series: "open",
      chart: "gauge",
      max: 25,
      good_direction: "up",
    });
    const donut = widget("chart", { source: "risks_metrics", series: "by_level", chart: "gauge", thresholds: [1, 2], good_direction: "up" });
    expect(widgetFromDraft(donut, "source", draft({ chart: "donut" }), ctx).config).toEqual({
      source: "risks_metrics",
      series: "by_level",
      chart: "donut",
    });
  });
});

describe("show values", () => {
  it("reads the switch from a stored chart", () => {
    expect(draftFromWidget(widget("chart", { query: {}, chart: "treemap", show_values: true })).showValues).toBe(true);
    expect(draftFromWidget(widget("chart", { query: {}, chart: "treemap" })).showValues).toBe(false);
  });

  it("saves show_values on a query chart that can print values", () => {
    const treemap = widget("chart", { query: { group_by: "type" }, chart: "treemap", drill: true });
    expect(widgetFromDraft(treemap, "chart", draft({ chart: "treemap", showValues: true })).config).toEqual({
      query: { group_by: "type" },
      chart: "treemap",
      drill: true,
      show_values: true,
    });
    expect(widgetFromDraft(treemap, "chart", draft({ chart: "heatmap", showValues: true })).config.show_values).toBe(true);
    expect(widgetFromDraft(treemap, "chart", draft({ chart: "bar", showValues: true })).config.show_values).toBe(true);
  });

  it("drops show_values when switched off or on a kind that cannot print values", () => {
    const stored = widget("chart", { query: { group_by: "type" }, chart: "treemap", drill: true, show_values: true });
    expect(widgetFromDraft(stored, "chart", draft({ chart: "treemap", showValues: false })).config).not.toHaveProperty(
      "show_values",
    );
    expect(widgetFromDraft(stored, "chart", draft({ chart: "line", showValues: true })).config).not.toHaveProperty(
      "show_values",
    );
    expect(widgetFromDraft(stored, "chart", draft({ chart: "donut", showValues: true })).config).not.toHaveProperty(
      "show_values",
    );
  });

  it("leaves a config that never used it unchanged", () => {
    const plain = { query: { group_by: "type" }, chart: "bar", drill: true };
    const out = widgetFromDraft(widget("chart", plain), "chart", draftFromWidget(widget("chart", plain)));
    expect(JSON.stringify(out.config)).toBe(JSON.stringify(plain));
  });

  it("saves and drops it on a module chart too, keeping the source", () => {
    const chart = widget("chart", { source: "risks_metrics", series: "by_level", chart: "bar" });
    expect(widgetFromDraft(chart, "source", draft({ chart: "column", showValues: true })).config).toEqual({
      source: "risks_metrics",
      series: "by_level",
      chart: "column",
      show_values: true,
    });
    const stored = widget("chart", { source: "risks_metrics", series: "by_level", chart: "bar", show_values: true });
    expect(widgetFromDraft(stored, "source", draft({ chart: "pie", showValues: true })).config).not.toHaveProperty(
      "show_values",
    );
    expect(widgetFromDraft(stored, "source", draft({ chart: "bar", showValues: false })).config).not.toHaveProperty(
      "show_values",
    );
    const single = widget("chart", { source: "risks_metrics", series: "open", chart: "gauge", max: 10 });
    expect(widgetFromDraft(single, "source", draft({ chart: "gauge", max: "10", showValues: true })).config).not.toHaveProperty(
      "show_values",
    );
  });
});

describe("module widgets", () => {
  it("open the source form", () => {
    expect(configKind(widget("kpi", { source: "risks_metrics", series: "open" }))).toBe("source");
    expect(configKind(widget("chart", { source: "risks_metrics", series: "by_level", chart: "donut" }))).toBe("source");
    expect(configKind(widget("chart", { source: "bogus", series: "x" }))).toBe("chart");
  });

  it("offer the chart kinds that fit the series' shape", () => {
    expect(sourceChartKinds("open")).toEqual(["gauge"]);
    const keyed = sourceChartKinds("by_level");
    expect(keyed).toContain("donut");
    expect(keyed).not.toContain("gauge");
    expect(keyed).not.toContain("heatmap");
    expect(keyed).not.toContain("sankey");
    expect(keyed).not.toContain("stacked_column");
  });

  it("refuse a chart kind the series cannot be drawn as, and a bad maximum", () => {
    const chart = widget("chart", { source: "risks_metrics", series: "by_level", chart: "donut" });
    expect(draftProblem("source", draft({ chart: "donut" }), ctx, chart)).toBeNull();
    expect(draftProblem("source", draft({ chart: "heatmap" }), ctx, chart)).toBe("sourceChartKind");
    expect(draftProblem("source", draft({ chart: "stacked_column" }), ctx, chart)).toBe("sourceChartKind");
    expect(draftProblem("source", draft({ chart: "sankey" }), ctx, chart)).toBe("sourceChartKind");
    expect(draftProblem("source", draft({ chart: "gauge" }), ctx, chart)).toBe("seriesShapeMismatch");
    const single = widget("chart", { source: "risks_metrics", series: "open", chart: "gauge" });
    expect(draftProblem("source", draft({ chart: "bar" }), ctx, single)).toBe("seriesShapeMismatch");
    expect(draftProblem("source", draft({ chart: "gauge" }), ctx, single)).toBe("targetRequired");
    expect(draftProblem("source", draft({ chart: "gauge", max: "10" }), ctx, single)).toBeNull();
    expect(draftProblem("source", draft({ chart: "donut", max: "0" }), ctx, chart)).toBe("maxPositive");
    const kpi = widget("kpi", { source: "risks_metrics", series: "open" });
    expect(draftProblem("source", draft({ chart: "bar" }), ctx, kpi)).toBeNull();
  });

  it("save only the title, chart kind and maximum, keeping the source", () => {
    const chart = widget("chart", { source: "risks_metrics", series: "by_level", chart: "donut", max: 3, title_key: "dashboard.x" });
    expect(widgetFromDraft(chart, "source", draft({ title: " Mine ", chart: "bar", max: "" }))).toEqual({
      ...chart,
      title: "Mine",
      config: { source: "risks_metrics", series: "by_level", chart: "bar", title_key: "dashboard.x" },
    });
    expect(widgetFromDraft(chart, "source", draft({ chart: "pie", max: "4" })).config).toMatchObject({ chart: "pie", max: 4 });
    const kpi = widget("kpi", { source: "risks_metrics", series: "open", format: "number" });
    expect(widgetFromDraft(kpi, "source", draft({ chart: "pie", max: "4" })).config).toEqual({
      source: "risks_metrics",
      series: "open",
      format: "number",
    });
  });
});

describe("relation sides", () => {
  it("split a side key", () => {
    expect(parseSideKey("r__out")).toEqual({ rt: "r", dir: "out" });
    expect(parseSideKey("r__in")).toEqual({ rt: "r", dir: "in" });
    expect(parseSideKey("r")).toEqual({ rt: "r", dir: null });
  });

  it("name a cross-type relation bare and a self-referencing one per direction", () => {
    expect(relationSideKeys(REL_APP_TO_ITC, "Application")).toEqual(["relAppToITC"]);
    expect(relationSideKeys(REL_APP_TO_ITC, "ITComponent")).toEqual(["relAppToITC"]);
    expect(relationSideKeys(REL_APP_TO_ITC, "Provider")).toEqual([]);
    expect(relationSideKeys(REL_APP_TO_APP, "Application")).toEqual(["relAppToApp__out", "relAppToApp__in"]);
  });

  it("check a side key against the card type, like the backend's resolve_side", () => {
    expect(relationSideProblem("relAppToITC", "ITComponent", RELATION_TYPES)).toBeNull();
    expect(relationSideProblem("relAppToITC", "Provider", RELATION_TYPES)).toBe("unknownRelationType");
    expect(relationSideProblem("nope", "Application", RELATION_TYPES)).toBe("unknownRelationType");
    expect(relationSideProblem("relAppToITC", "Application", [{ ...REL_APP_TO_ITC, is_hidden: true }])).toBe(
      "unknownRelationType",
    );
    // A suffix on a cross-type relation is refused before the end is checked.
    expect(relationSideProblem("relAppToITC__out", "Provider", RELATION_TYPES)).toBe("badSuffix");
    expect(relationSideProblem("relAppToApp", "Application", RELATION_TYPES)).toBe("relationSideRequired");
    expect(relationSideProblem("relAppToApp__in", "Application", RELATION_TYPES)).toBeNull();
    expect(relationSideProblem("relAppToApp__in", "ITComponent", RELATION_TYPES)).toBe("unknownRelationType");
  });
});

describe("option lists", () => {
  it("offer each sankey side its own type's fields, and cards", () => {
    const source = sankeySideOptions(REL_APP_TO_ITC, "source", CARD_TYPES);
    const target = sankeySideOptions(REL_APP_TO_ITC, "target", CARD_TYPES);
    expect(source).toEqual([
      "type",
      "subtype",
      "approval_status",
      "lifecycle_phase",
      "data_quality_bucket",
      "field:businessCriticality",
      "field:isCloud",
      "card",
    ]);
    expect(target).toEqual(["type", "subtype", "approval_status", "lifecycle_phase", "data_quality_bucket", "card"]);
    expect(sankeySideOptions(undefined, "source", CARD_TYPES)).toEqual([]);
  });

  it("offer numeric fields, relation counts and data quality — not age", () => {
    expect(measureOptions(APPLICATION_TYPE, true, RELATION_TYPES)).toEqual([
      "costTotalAnnual",
      "coverage",
      "vendorScore",
      "@relations:relAppToITC",
      "@relations:relAppToBC",
      "@relations:relAppToApp__out",
      "@relations:relAppToApp__in",
      "@data_quality",
    ]);
    expect(measureOptions(undefined, true, RELATION_TYPES)).toEqual(["@data_quality"]);
    expect(measureOptions(APPLICATION_TYPE, false)).toEqual(["coverage", "vendorScore", "@data_quality"]);
  });

  it("group the measures into fields and computed ones", () => {
    expect(measureGroup("costTotalAnnual")).toBe("fields");
    expect(measureGroup("@relations:relAppToITC")).toBe("computed");
    expect(measureGroup("@data_quality")).toBe("computed");
  });

  it("group the dimensions into card, dates, fields, related cards and health", () => {
    expect(DIMENSION_GROUPS).toEqual(["card", "dates", "fields", "related", "health"]);
    expect(dimensionOptions(APPLICATION_TYPE, RELATION_TYPES).map(dimensionGroup)).toEqual([
      "card",
      "card",
      "card",
      "card",
      "card",
      "card",
      "dates",
      "dates",
      "dates",
      "fields",
      "fields",
      "related",
      "related",
      "related",
      "related",
      "health",
    ]);
  });

  it("offer the four flags, EOL only where EOL data can exist", () => {
    expect(flagOptions(APPLICATION_TYPE)).toEqual(["orphaned", "stale", "without_stakeholders", "eol_missing"]);
    expect(flagOptions(undefined)).toEqual(["orphaned", "stale", "without_stakeholders", "eol_missing"]);
    expect(flagOptions(BUSINESS_CAPABILITY_TYPE)).toEqual(["orphaned", "stale", "without_stakeholders"]);
  });

  it("keep a retired flag on a widget while the type can carry it", () => {
    expect(keepsFlag("with_stakeholders", BUSINESS_CAPABILITY_TYPE)).toBe(true);
    expect(keepsFlag("eol_linked", APPLICATION_TYPE)).toBe(true);
    expect(keepsFlag("eol_manual", undefined)).toBe(true);
    expect(keepsFlag("eol_linked", BUSINESS_CAPABILITY_TYPE)).toBe(false);
    expect(keepsFlag("eol_missing", BUSINESS_CAPABILITY_TYPE)).toBe(false);
    expect(keepsFlag("unrelated:relAppToITC", BUSINESS_CAPABILITY_TYPE)).toBe(true);
    expect(keepsFlag("bogus", undefined)).toBe(false);
  });

  it("keep each card off a grid, and never as the second grouping", () => {
    const dims = dimensionOptions(APPLICATION_TYPE, RELATION_TYPES);
    expect(chartDimensionOptions(dims, "bar")).toEqual(dims);
    expect(chartDimensionOptions(dims, "treemap")).toContain("card");
    expect(chartDimensionOptions(dims, "heatmap")).toEqual(dims.filter((d) => d !== "card"));
    expect(chartDimensionOptions(dims, "stacked_column")).not.toContain("card");
    expect(secondDimensionOptions(dims, "type")).toEqual(dims.filter((d) => d !== "card" && d !== "type"));
    expect(secondDimensionOptions(dims, null)).not.toContain("card");
  });

  it("offer the relations of the chosen type for a presence filter", () => {
    expect(relationPresenceOptions(IT_COMPONENT_TYPE, RELATION_TYPES)).toEqual(["relAppToITC", "relProviderToITC"]);
    expect(relationPresenceOptions(undefined, RELATION_TYPES)).toEqual([]);
  });
});

describe("flags in the draft", () => {
  it("split a stored flag list into chips and a relation-presence filter", () => {
    expect(splitFlags("unrelated:relAppToITC,stale,orphaned")).toEqual({
      flags: ["orphaned", "stale"],
      relationPresence: { rt: "relAppToITC", has: false },
    });
    expect(splitFlags("related:relAppToBC")).toEqual({ flags: [], relationPresence: { rt: "relAppToBC", has: true } });
    expect(splitFlags(null)).toEqual({ flags: [], relationPresence: { rt: null, has: true } });
  });

  it("write the relation presence back into the flags, canonical", () => {
    expect(presenceFlag({ rt: "relAppToITC", has: true })).toBe("related:relAppToITC");
    expect(presenceFlag({ rt: "relAppToITC", has: false })).toBe("unrelated:relAppToITC");
    expect(presenceFlag({ rt: null, has: true })).toBeNull();
    expect(
      draftQuery(draft({ flags: ["stale", "orphaned"], relationPresence: { rt: "relAppToITC", has: false } })).flags,
    ).toBe("orphaned,stale,unrelated:relAppToITC");
    expect(draftQuery(draft()).flags).toBeNull();
  });

  it("round-trip through draftFromWidget and widgetFromDraft", () => {
    const kpi = widget("kpi", {
      query: { card_type: "Application", flags: "orphaned,related:relAppToITC" },
      good_direction: "up",
      format: "number",
    });
    const d = draftFromWidget(kpi);
    expect(d.query).toEqual({ card_type: "Application" });
    expect(d.flags).toEqual(["orphaned"]);
    expect(d.relationPresence).toEqual({ rt: "relAppToITC", has: true });
    expect(widgetFromDraft(kpi, "kpi", { ...d, relationPresence: { rt: "relAppToITC", has: false } }).config.query).toEqual({
      card_type: "Application",
      flags: "orphaned,unrelated:relAppToITC",
    });
  });

  it("know when a filter is set", () => {
    expect(hasFilters(draft())).toBe(false);
    expect(hasFilters(draft({ flags: ["stale"] }))).toBe(true);
    expect(hasFilters(draft({ relationPresence: { rt: "r", has: true } }))).toBe(true);
    expect(hasFilters(draft({ query: { lifecycle_phase: "active" } }))).toBe(true);
  });
});

describe("draftProblem — new rules", () => {
  const app = (query: Record<string, unknown>, patch: Partial<ConfigDraft> = {}) =>
    draft({ query: { card_type: "Application", ...query }, ...patch });

  it("needs two different groupings for stacked columns", () => {
    expect(draftProblem("chart", draft({ chart: "stacked_column", query: { group_by: "type" } }))).toBe(
      "stackedColumnNeedsTwoDimensions",
    );
    expect(
      draftProblem("chart", draft({ chart: "stacked_column", query: { group_by: "type", group_by_2: "type" } })),
    ).toBe("sameDimension");
    expect(
      draftProblem("chart", draft({ chart: "stacked_column", query: { group_by: "type", group_by_2: "lifecycle_phase" } })),
    ).toBeNull();
  });

  it("refuses an unknown dimension, and each card without a card type or as a second grouping", () => {
    expect(draftProblem("chart", draft({ query: { group_by: "bogus" } }))).toBe("unknownDimension");
    expect(draftProblem("chart", draft({ query: { group_by: "phase_month:never" } }))).toBe("unknownPhase");
    expect(draftProblem("chart", draft({ query: { group_by: "card" } }))).toBe("cardDimensionNeedsCardType");
    expect(draftProblem("chart", app({ group_by: "card" }))).toBeNull();
    expect(draftProblem("chart", app({ group_by: "card", metric: "sum", metric_field: "costTotalAnnual" }), ctx)).toBeNull();
    expect(
      draftProblem("chart", app({ group_by: "type", group_by_2: "card" }, { chart: "stacked_column" })),
    ).toBe("cardDimensionNotSecond");
    // Not second even without a card type: that rule comes first, like the backend's.
    expect(queryProblem({ group_by: "type", group_by_2: "card" })).toBe("cardDimensionNotSecond");
    expect(draftProblem("chart", draft({ query: { group_by: "phase_month:endOfLife" } }))).toBeNull();
    expect(draftProblem("chart", draft({ query: { group_by: "stakeholders" } }))).toBeNull();
    expect(draftProblem("chart", app({ group_by: "eol_coverage" }))).toBeNull();
  });

  it("checks a related-card grouping against the card type and the relation's sides", () => {
    expect(draftProblem("chart", draft({ query: { group_by: "related:relAppToITC" } }), ctx)).toBe("relatedNeedsCardType");
    expect(draftProblem("chart", app({ group_by: "related:relAppToITC" }), ctx)).toBeNull();
    expect(draftProblem("chart", app({ group_by: "related:relProviderToITC" }), ctx)).toBe("unknownRelationType");
    expect(draftProblem("chart", app({ group_by: "related:relAppToApp" }), ctx)).toBe("relationSideRequired");
    expect(draftProblem("chart", app({ group_by: "related:relAppToApp__out" }), ctx)).toBeNull();
    expect(draftProblem("chart", app({ group_by: "related:relAppToITC__in" }), ctx)).toBe("unknownDimension");
    // Without the metamodel only the shape is checked.
    expect(draftProblem("chart", app({ group_by: "related:relProviderToITC" }))).toBeNull();
  });

  it("checks each sankey side against its own end of the relation", () => {
    const sankey = (query: Record<string, unknown>) => draft({ chart: "sankey", query: { relation_type: "relAppToITC", ...query } });
    expect(draftProblem("chart", sankey({ group_by: "field:businessCriticality", group_by_2: "card" }), ctx)).toBeNull();
    // The target (IT Component) has no such field.
    expect(draftProblem("chart", sankey({ group_by_2: "field:businessCriticality" }), ctx)).toBe("unknownField");
    expect(draftProblem("chart", sankey({ group_by: "related:relAppToBC" }), ctx)).toBe("relationTypeConflict");
    expect(draftProblem("chart", sankey({ group_by: "eol_coverage" }), ctx)).toBe("unknownDimension");
    expect(draftProblem("chart", draft({ chart: "sankey", query: { relation_type: "gone" } }), ctx)).toBe(
      "unknownRelationType",
    );
  });

  it("needs a narrowing filter for a share, and no field", () => {
    expect(draftProblem("kpi", draft({ query: { metric: "share" } }))).toBe("shareNeedsFilter");
    expect(draftProblem("kpi", draft({ query: { metric: "share", approval_status: "APPROVED" } }))).toBeNull();
    expect(draftProblem("kpi", draft({ query: { metric: "share" }, flags: ["stale"] }))).toBeNull();
    expect(draftProblem("kpi", draft({ query: { metric: "share", lifecycle_phase: "active" } }))).toBeNull();
    // The field of a share is dropped before the query is sent.
    expect(
      draftProblem("kpi", draft({ query: { metric: "share", metric_field: "coverage", approval_status: "APPROVED" } })),
    ).toBeNull();
    expect(queryProblem({ metric: "share", metric_field: "coverage", approval_status: "APPROVED" })).toBe(
      "metricFieldUnused",
    );
    expect(queryProblem({ metric_field: "coverage", card_type: "Application" })).toBe("metricFieldUnused");
  });

  it("lets the computed measures go without a card type, but not a relation count", () => {
    expect(draftProblem("kpi", draft({ query: { metric: "avg", metric_field: "@data_quality" } }))).toBeNull();
    expect(draftProblem("kpi", draft({ query: { metric: "avg", metric_field: "@age_days" } }))).toBeNull();
    expect(draftProblem("kpi", draft({ query: { metric: "sum", metric_field: "@relations:relAppToITC" } }))).toBe(
      "relatedNeedsCardType",
    );
    expect(draftProblem("kpi", draft({ query: { metric: "avg", metric_field: "@bogus" } }))).toBe("unknownField");
    expect(draftProblem("kpi", app({ metric: "sum", metric_field: "@relations:relAppToITC__in" }), ctx)).toBe(
      "unknownField",
    );
    expect(draftProblem("kpi", app({ metric: "sum", metric_field: "@relations:relAppToITC" }), ctx)).toBeNull();
    expect(draftProblem("kpi", app({ metric: "sum", metric_field: "@relations:relAppToApp" }), ctx)).toBe(
      "relationSideRequired",
    );
    expect(draftProblem("kpi", app({ metric: "sum", metric_field: "@relations:relProviderToITC" }), ctx)).toBe(
      "unknownRelationType",
    );
  });

  it("checks the flags", () => {
    expect(draftProblem("kpi", draft({ flags: ["bogus"] }))).toBe("unknownFlag");
    expect(draftProblem("kpi", draft({ flags: ["with_stakeholders", "without_stakeholders"] }))).toBe("flagsConflict");
    expect(draftProblem("kpi", draft({ flags: ["eol_linked", "eol_missing"] }))).toBe("flagsConflict");
    expect(draftProblem("kpi", draft({ flags: ["orphaned", "stale", "eol_manual", "with_stakeholders"] }))).toBeNull();
  });

  it("checks a relation-presence filter", () => {
    const presence = (rt: string, has = true) => ({ relationPresence: { rt, has } });
    expect(draftProblem("kpi", draft(presence("relAppToITC")), ctx)).toBe("relatedNeedsCardType");
    expect(draftProblem("kpi", app({}, presence("relAppToITC")), ctx)).toBeNull();
    expect(draftProblem("kpi", app({}, presence("relProviderToITC")), ctx)).toBe("unknownRelationType");
    expect(draftProblem("kpi", app({}, presence("relAppToITC__out")), ctx)).toBe("unknownFlag");
    expect(draftProblem("kpi", app({}, presence("relAppToApp")), ctx)).toBe("relationSideRequired");
    expect(draftProblem("kpi", app({}, { flags: ["related:relAppToITC"], ...presence("relAppToITC", false) }), ctx)).toBe(
      "flagsConflict",
    );
    // A relation flag never rides on a sankey's own relation.
    expect(
      draftProblem("chart", draft({ chart: "sankey", query: { relation_type: "relAppToITC" }, flags: ["related:relAppToBC"] })),
    ).toBe("relationTypeConflict");
  });

  it("refuses a query too long to key a snapshot on", () => {
    const longType = makeCardType({
      key: "T",
      fields_schema: [makeSection({ fields: [makeField({ key: "x".repeat(300), type: "single_select" })] })],
    });
    expect(longType.key).toBe("T");
    expect(draftProblem("chart", draft({ query: { card_type: "T", group_by: `field:${"x".repeat(300)}` } }))).toBe(
      "queryTooLong",
    );
  });
});

describe("queryProblem — the backend's order", () => {
  it("refuses a bad phase before anything else, and a second grouping without a first", () => {
    expect(queryProblem({ group_by: "phase_month:x", metric: "sum" })).toBe("unknownPhase");
    expect(queryProblem({ group_by_2: "type" })).toBe("dimensionRequired");
  });

  it("refuses a sankey that also names a card type, a measure or a relation side", () => {
    expect(queryProblem({ relation_type: "r", card_type: "Application" })).toBe("relationTypeConflict");
    expect(queryProblem({ relation_type: "r", subtype: "s" })).toBe("relationTypeConflict");
    // Checked before the share's own rule.
    expect(queryProblem({ relation_type: "r", metric: "share" })).toBe("relationTypeConflict");
    expect(queryProblem({ relation_type: "r", flags: "unrelated:x" })).toBe("relationTypeConflict");
    expect(queryProblem({ relation_type: "r", group_by: "card", flags: "stale" })).toBeNull();
  });

  it("checks the flags before the card type", () => {
    expect(queryProblem({ flags: "related:r,unrelated:r" })).toBe("flagsConflict");
    expect(queryProblem({ flags: "related:r" })).toBe("relatedNeedsCardType");
  });
});

describe("KPI presentation", () => {
  it("offers a secondary figure only for a narrowed count", () => {
    expect(secondaryApplies({})).toBe(false);
    expect(secondaryApplies({ approval_status: "APPROVED" })).toBe(true);
    expect(secondaryApplies({ flags: "stale" })).toBe(true);
    expect(secondaryApplies({ metric: "sum", metric_field: "x", lifecycle_phase: "active" })).toBe(false);
  });

  it("saves the sparkline and a secondary figure that applies", () => {
    const kpi = widget("kpi", { query: {} });
    const out = widgetFromDraft(
      kpi,
      "kpi",
      draft({ query: { card_type: "Application" }, flags: ["orphaned"], sparkline: true, secondary: "share_of_total" }),
    );
    expect(out.config).toEqual({
      query: { card_type: "Application", flags: "orphaned" },
      good_direction: "up",
      format: "number",
      sparkline: true,
      secondary: "share_of_total",
    });
    // Without a narrowing filter there is no base to measure against.
    expect(widgetFromDraft(kpi, "kpi", draft({ query: {}, secondary: "base_count" })).config).not.toHaveProperty("secondary");
    expect(widgetFromDraft(kpi, "kpi", draft({ query: {} })).config).not.toHaveProperty("sparkline");
  });

  it("reads them back", () => {
    expect(draftFromWidget(widget("kpi", { query: {}, sparkline: true, secondary: "base_count" }))).toMatchObject({
      sparkline: true,
      secondary: "base_count",
    });
    expect(draftFromWidget(widget("kpi", { query: {}, secondary: "odd" }))).toMatchObject({ sparkline: false, secondary: "" });
  });
});
