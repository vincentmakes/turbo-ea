import { describe, expect, it } from "vitest";
import type { DashboardWidget } from "@/types";
import {
  APPLICATION_TYPE,
  BUSINESS_CAPABILITY_TYPE,
  PROVIDER_TYPE,
  REL_APP_TO_ITC,
  RELATION_TYPES,
} from "@/test/fixtures/metamodel";
import {
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
  type ConfigDraft,
} from "./widgetConfigModel";

const widget = (type: DashboardWidget["type"], config: Record<string, unknown> = {}, title: string | null = null) =>
  ({ id: "w1", type, title, config, layout: { x: 0, y: 0, w: 6, h: 5 } }) as DashboardWidget;

const draft = (patch: Partial<ConfigDraft> = {}): ConfigDraft => ({
  title: "",
  query: { group_by: "type" },
  chart: "bar",
  drill: true,
  max: "",
  goodDirection: "up",
  format: "number",
  maxRows: "12",
  activityFilter: "all",
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
  it("lists the dimensions a type offers", () => {
    expect(dimensionOptions(undefined)).toEqual([
      "type",
      "approval_status",
      "lifecycle_phase",
      "data_quality_bucket",
      "created_month",
    ]);
    expect(dimensionOptions(APPLICATION_TYPE)).toEqual([
      "type",
      "subtype",
      "approval_status",
      "lifecycle_phase",
      "data_quality_bucket",
      "created_month",
      "field:businessCriticality",
      "field:isCloud",
    ]);
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
    expect(availableChartKinds(false)).toHaveLength(8);
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

  it("keeps only the relation type of a sankey", () => {
    expect(cleanQuery({ relation_type: "r", card_type: "Application", group_by: "type" }, "chart", "sankey")).toEqual({
      relation_type: "r",
    });
    expect(cleanQuery({ card_type: "Application" }, "chart", "sankey")).toEqual({});
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
    expect(draftProblem("chart", draft({ chart: "gauge", query: {} }))).toBeNull();
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
