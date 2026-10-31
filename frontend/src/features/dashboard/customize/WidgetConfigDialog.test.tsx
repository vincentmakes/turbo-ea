import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardWidget, User } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("@/hooks/useBpmEnabled", () => import("@/test/hooks").then((m) => m.useBpmEnabledModule()));
vi.mock("@/hooks/usePpmEnabled", () => import("@/test/hooks").then((m) => m.usePpmEnabledModule()));
vi.mock("@/hooks/useGrcEnabled", () => import("@/test/hooks").then((m) => m.useGrcEnabledModule()));
vi.mock("@/components/charts/EChart", () => ({
  default: (props: { ariaLabel?: string }) => <div data-testid="echart" aria-label={props.ariaLabel} />,
}));

import { mockApi } from "@/test/apiMock";
import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { adminUser, renderWithProviders, userWith } from "@/test/render";
import WidgetConfigDialog from "./WidgetConfigDialog";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

function widget(type: DashboardWidget["type"], config: Record<string, unknown>, title: string | null = null): DashboardWidget {
  return { id: "w-new", type, title, config, layout: { x: 0, y: 4, w: 6, h: 5 } };
}

const NEW_CHART = widget("chart", { query: { group_by: "type" }, chart: "bar", drill: true });

function renderDialog(w: DashboardWidget, { mode = "create", user = adminUser() }: { mode?: "create" | "edit"; user?: User } = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const result = renderWithProviders(<WidgetConfigDialog open widget={w} mode={mode} onClose={onClose} onSave={onSave} />, {
    user,
  });
  return { ...result, onSave, onClose };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const combo = (label: string) => screen.getByRole("combobox", { name: new RegExp(`^${escapeRegExp(label)}`) });
const saveButton = (mode: "create" | "edit" = "create") =>
  screen.getByRole("button", { name: mode === "create" ? tc("actions.add") : tc("actions.apply") });

async function choose(user: ReturnType<typeof renderDialog>["user"], label: string, option: string) {
  await user.click(combo(label));
  const listbox = await screen.findByRole("listbox");
  await user.click(within(listbox).getByRole("option", { name: option }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

async function options(user: ReturnType<typeof renderDialog>["user"], label: string): Promise<string[]> {
  await user.click(combo(label));
  const listbox = await screen.findByRole("listbox");
  const out = within(listbox).getAllByRole("option").map((o) => o.textContent ?? "");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  return out;
}

const problem = () => screen.queryByTestId("config-problem")?.textContent ?? null;

async function openFilters(user: ReturnType<typeof renderDialog>["user"]) {
  await user.click(screen.getByRole("button", { name: new RegExp(`^${tc("dashboard.config.filters")}`) }));
}

// The measure menu as it reads, headings included (MUI lists a ListSubheader among the options).
const MEASURES_APP = [
  tc("dashboard.config.group.computed"),
  "Number of relations (uses IT Component)",
  "Number of relations (supports Business Capability)",
  "Number of relations (sends data to Application)",
  "Number of relations (receives data from Application)",
  tc("dashboard.query.measure.data_quality"),
];

/** An option's accessible name starts with its label (a flag adds its description). */
const startsWith = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

beforeEach(() => {
  mockApi.reset();
  mockApi.lenient({ dimension: null, dimension_2: null, rows: [], total: 0 });
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
});

describe("WidgetConfigDialog — chart", () => {
  it("adds a valid chart and previews it with the real widget", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type", {
      dimension: "type",
      dimension_2: null,
      rows: [{ key: "Application", value: 3 }],
      total: 3,
    });
    const { user, onSave } = renderDialog(NEW_CHART);
    expect(screen.getByText(tc("dashboard.config.createTitle"))).toBeInTheDocument();
    expect(problem()).toBeNull();
    expect(await within(screen.getByTestId("config-preview")).findByTestId("echart")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", "/dashboards/query?group_by=type")).not.toHaveLength(0));
    await user.type(screen.getByLabelText(tc("dashboard.config.title")), "  Landscape  ");
    await user.click(saveButton());
    expect(onSave).toHaveBeenCalledWith({
      ...NEW_CHART,
      title: "Landscape",
      config: { query: { group_by: "type" }, chart: "bar", drill: true },
    });
  });

  it("needs two different groupings for a heatmap", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.heatmap"));
    expect(problem()).toBe(tc("dashboard.config.problem.secondDimensionRequired"));
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(tc("dashboard.config.previewInvalid"))).toBeInTheDocument();
    // The first grouping is not offered again.
    expect(await options(user, tc("dashboard.config.secondDimension"))).not.toContain(tc("dashboard.query.dimension.type"));
    await choose(user, tc("dashboard.config.secondDimension"), tc("dashboard.query.dimension.approval_status"));
    expect(problem()).toBeNull();
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: { group_by: "type", group_by_2: "approval_status" },
      chart: "heatmap",
      drill: true,
    });
  });

  it("offers the chosen card type's fields and subtypes as groupings", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    expect(await options(user, tc("dashboard.config.dimension"))).not.toContain(tc("dashboard.query.dimension.subtype"));
    // A hidden type is never offered.
    expect(await options(user, tc("dashboard.config.cardType"))).toEqual([
      tc("dashboard.config.allCardTypes"),
      "Business Capability",
      "Application",
      "IT Component",
      "Provider",
    ]);
    await choose(user, tc("dashboard.config.cardType"), "Application");
    const dims = await options(user, tc("dashboard.config.dimension"));
    expect(dims).toContain(tc("dashboard.query.dimension.subtype"));
    expect(dims).toContain("Business Criticality");
    expect(dims).toContain("Cloud Hosted");
    expect(dims).not.toContain("Regions");
    await choose(user, tc("dashboard.config.dimension"), "Business Criticality");
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config.query).toEqual({
      card_type: "Application",
      group_by: "field:businessCriticality",
    });
  });

  it("drops a field grouping the new card type does not have", async () => {
    const { user } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.cardType"), "Application");
    await choose(user, tc("dashboard.config.dimension"), "Cloud Hosted");
    expect(problem()).toBeNull();
    await choose(user, tc("dashboard.config.cardType"), "Provider");
    expect(problem()).toBe(tc("dashboard.config.problem.dimensionRequired"));
    expect(saveButton()).toBeDisabled();
  });

  it("needs the field of a sum, offering cost fields to cost readers only", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.cardType"), "Application");
    expect(combo(tc("dashboard.config.metricField"))).toHaveAttribute("aria-disabled", "true");
    await choose(user, tc("dashboard.config.metric"), tc("dashboard.query.metric.sum"));
    expect(problem()).toBe(tc("dashboard.config.problem.metricFieldRequired"));
    expect(await options(user, tc("dashboard.config.metricField"))).toEqual([
      tc("dashboard.config.group.fields"),
      "Total Annual Cost",
      "Test Coverage",
      "Vendor Score",
      ...MEASURES_APP,
    ]);
    await choose(user, tc("dashboard.config.metricField"), "Total Annual Cost");
    expect(problem()).toBeNull();
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config.query).toEqual({
      card_type: "Application",
      group_by: "type",
      metric: "sum",
      metric_field: "costTotalAnnual",
    });
  });

  it("hides cost fields from a reader without costs.view", async () => {
    const { user } = renderDialog(NEW_CHART, { user: userWith("reports.ea_dashboard", "admin.dashboards") });
    await choose(user, tc("dashboard.config.cardType"), "Application");
    await choose(user, tc("dashboard.config.metric"), tc("dashboard.query.metric.avg"));
    expect(await options(user, tc("dashboard.config.metricField"))).toEqual([
      tc("dashboard.config.group.fields"),
      "Test Coverage",
      "Vendor Score",
      ...MEASURES_APP,
    ]);
  });

  it("builds a sankey from a relation type alone", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.sankey"));
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.cardType")}`) })).toBeNull();
    expect(problem()).toBe(tc("dashboard.config.problem.relationTypeRequired"));
    await choose(user, tc("dashboard.config.relationType"), "Application → uses → IT Component");
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({ query: { relation_type: "relAppToITC" }, chart: "sankey", drill: true });
  });

  it("does not offer a sankey without a relation type", async () => {
    withMetamodel(CARD_TYPES, []);
    const { user } = renderDialog(NEW_CHART);
    const kinds = await options(user, tc("dashboard.config.chartKind"));
    expect(kinds).toHaveLength(9);
    expect(kinds).not.toContain(tc("dashboard.query.chart.sankey"));
  });

  it("draws a count gauge without grouping, against a required target", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.gauge"));
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.dimension")}`) })).toBeNull();
    expect(problem()).toBe(tc("dashboard.config.problem.targetRequired"));
    const max = screen.getByLabelText(new RegExp(`^${tc("dashboard.config.target")}`));
    await user.type(max, "0");
    expect(problem()).toBe(tc("dashboard.config.problem.maxPositive"));
    await user.clear(max);
    await user.type(max, "250");
    await user.type(screen.getByLabelText(tc("dashboard.config.thresholdWarn")), "300");
    await user.type(screen.getByLabelText(tc("dashboard.config.thresholdGood")), "400");
    expect(problem()).toBe(tc("dashboard.config.problem.invalidThresholds"));
    await user.clear(screen.getByLabelText(tc("dashboard.config.thresholdWarn")));
    await user.type(screen.getByLabelText(tc("dashboard.config.thresholdWarn")), "100");
    await user.clear(screen.getByLabelText(tc("dashboard.config.thresholdGood")));
    await user.type(screen.getByLabelText(tc("dashboard.config.thresholdGood")), "200");
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: {},
      chart: "gauge",
      drill: true,
      max: 250,
      thresholds: [100, 200],
      good_direction: "up",
    });
  });

  it("measures a rate on a gauge on the fixed scale, averaging only rates", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.gauge"));
    await choose(user, tc("dashboard.config.cardType"), "Application");
    await choose(user, tc("dashboard.config.metric"), tc("dashboard.query.metric.avg"));
    const fields = await options(user, tc("dashboard.config.metricField"));
    expect(fields).toEqual([
      tc("dashboard.config.group.fields"),
      "Test Coverage",
      tc("dashboard.config.group.computed"),
      tc("dashboard.query.measure.data_quality"),
    ]);
    await choose(user, tc("dashboard.config.metricField"), "Test Coverage");
    expect(screen.queryByLabelText(new RegExp(`^${tc("dashboard.config.target")}`))).toBeNull();
    expect(problem()).toBeNull();
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: { card_type: "Application", metric: "avg", metric_field: "coverage" },
      chart: "gauge",
      drill: true,
      good_direction: "up",
    });
  });

  it("turns click-through off", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await user.click(screen.getByLabelText(tc("dashboard.config.drill")));
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config.drill).toBe(false);
  });

  it("filters by approval status and lifecycle phase", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await openFilters(user);
    await choose(user, tc("dashboard.config.approvalFilter"), tc("status.approved"));
    await choose(user, tc("dashboard.config.lifecycleFilter"), tc("lifecycle.active"));
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config.query).toEqual({
      group_by: "type",
      approval_status: "APPROVED",
      lifecycle_phase: "active",
    });
  });

  it("forgets a built-in chart's title key once it shows something else", async () => {
    const builtIn = widget("chart", {
      query: { group_by: "type" },
      chart: "bar",
      drill: true,
      title_key: "dashboard.cardsByType",
    });
    const { user, onSave } = renderDialog(builtIn, { mode: "edit" });
    expect(screen.getByText(tc("dashboard.config.editTitle"))).toBeInTheDocument();
    await choose(user, tc("dashboard.config.dimension"), tc("dashboard.query.dimension.lifecycle_phase"));
    await user.click(saveButton("edit"));
    expect(onSave.mock.calls[0][0].config).toEqual({ query: { group_by: "lifecycle_phase" }, chart: "bar", drill: true });
  });

  it("cancels", async () => {
    const { user, onClose, onSave } = renderDialog(NEW_CHART);
    await user.click(screen.getByRole("button", { name: tc("actions.cancel") }));
    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("WidgetConfigDialog — new metrics", () => {
  it("groups each sankey side by its own end's fields and saves both sides", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.sankey"));
    await choose(user, tc("dashboard.config.relationType"), "Application → uses → IT Component");
    const source = tc("dashboard.config.sourceDimension", { type: "Application" });
    const target = tc("dashboard.config.targetDimension", { type: "IT Component" });
    expect(await options(user, source)).toContain("Business Criticality");
    expect(await options(user, target)).not.toContain("Business Criticality");
    await choose(user, source, "Business Criticality");
    await choose(user, target, tc("dashboard.query.dimension.card"));
    expect(problem()).toBeNull();
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: { relation_type: "relAppToITC", group_by: "field:businessCriticality", group_by_2: "card" },
      chart: "sankey",
      drill: true,
    });
  });

  it("stacks columns by a second grouping", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.stacked_column"));
    expect(problem()).toBe(tc("dashboard.config.problem.stackedColumnNeedsTwoDimensions"));
    await choose(user, tc("dashboard.config.secondDimension"), tc("dashboard.query.dimension.lifecycle_phase"));
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: { group_by: "type", group_by_2: "lifecycle_phase" },
      chart: "stacked_column",
      drill: true,
    });
  });

  it("saves flag chips and a relation-presence filter as canonical flags", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.cardType"), "IT Component");
    await openFilters(user);
    await user.click(combo(tc("dashboard.config.flags")));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: startsWith(tc("dashboard.query.flag.stale")) }));
    await user.click(within(listbox).getByRole("option", { name: startsWith(tc("dashboard.query.flag.orphaned")) }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await choose(user, tc("dashboard.config.relationPresence"), "is provided by Provider");
    await user.click(screen.getByRole("button", { name: tc("dashboard.config.lacks") }));
    expect(problem()).toBeNull();
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config.query).toEqual({
      card_type: "ITComponent",
      group_by: "type",
      flags: "orphaned,stale,unrelated:relProviderToITC",
    });
  });

  it("forgets a relation filter the new card type does not have", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.cardType"), "IT Component");
    await openFilters(user);
    await choose(user, tc("dashboard.config.relationPresence"), "is provided by Provider");
    await choose(user, tc("dashboard.config.cardType"), "Application");
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config.query).toEqual({ card_type: "Application", group_by: "type" });
  });

  it("keeps a retired flag already on the widget when it is saved again", async () => {
    const stored = widget("chart", { query: { group_by: "type", flags: "stale,with_stakeholders" }, chart: "bar", drill: true });
    const { user, onSave } = renderDialog(stored, { mode: "edit" });
    expect(screen.getByRole("button", { name: tc("dashboard.query.flag.with_stakeholders") })).toBeInTheDocument();
    await user.type(screen.getByLabelText(tc("dashboard.config.title")), "Kept");
    await user.click(saveButton("edit"));
    expect(onSave.mock.calls[0][0].config.query).toEqual({ group_by: "type", flags: "stale,with_stakeholders" });
  });

  it("charts each card of the chosen type, never on a grid", async () => {
    const { user, onSave } = renderDialog(NEW_CHART);
    expect(await options(user, tc("dashboard.config.dimension"))).not.toContain(tc("dashboard.query.dimension.card"));
    await choose(user, tc("dashboard.config.cardType"), "Application");
    await choose(user, tc("dashboard.config.dimension"), tc("dashboard.query.dimension.card"));
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.treemap"));
    await choose(user, tc("dashboard.config.metric"), tc("dashboard.query.metric.sum"));
    await choose(user, tc("dashboard.config.metricField"), "Total Annual Cost");
    expect(problem()).toBeNull();
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: { card_type: "Application", group_by: "card", metric: "sum", metric_field: "costTotalAnnual" },
      chart: "treemap",
      drill: true,
    });
  });

  it("drops each card when the chart becomes a grid", async () => {
    const { user } = renderDialog(NEW_CHART);
    await choose(user, tc("dashboard.config.cardType"), "Application");
    await choose(user, tc("dashboard.config.dimension"), tc("dashboard.query.dimension.card"));
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.stacked_column"));
    expect(problem()).toBe(tc("dashboard.config.problem.dimensionRequired"));
    expect(await options(user, tc("dashboard.config.dimension"))).not.toContain(tc("dashboard.query.dimension.card"));
  });

  it("opens the filters of a widget that already filters", () => {
    renderDialog(widget("chart", { query: { group_by: "type", flags: "stale" }, chart: "bar", drill: true }), { mode: "edit" });
    expect(screen.getByRole("button", { name: new RegExp(`^${tc("dashboard.config.filters")}`) })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("button", { name: tc("dashboard.query.flag.stale") })).toBeInTheDocument();
  });

  it("configures a module chart through the source form", async () => {
    mockApi.on("get", "/risks/metrics", { total: 3, by_status: {}, by_level: { high: 3 }, by_category: {}, overdue: 0 });
    const tile = widget("chart", {
      source: "risks_metrics",
      series: "by_level",
      chart: "donut",
      title_key: "dashboard.source.chart.risksByLevel",
    });
    const { user, onSave } = renderDialog(tile, { mode: "edit" });
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.cardType")}`) })).toBeNull();
    expect(screen.getByTestId("config-source-series")).toBeInTheDocument();
    expect(await within(screen.getByTestId("config-preview")).findByTestId("echart")).toBeInTheDocument();
    await choose(user, tc("dashboard.config.chartKind"), tc("dashboard.query.chart.bar"));
    await user.click(saveButton("edit"));
    expect(onSave.mock.calls[0][0].config).toEqual({
      source: "risks_metrics",
      series: "by_level",
      chart: "bar",
      title_key: "dashboard.source.chart.risksByLevel",
    });
  });
});

describe("WidgetConfigDialog — KPI", () => {
  it("adds a sparkline and a secondary figure to a narrowed count", async () => {
    mockApi.on("get", /^\/dashboards\/kpi/, { value: 4, trend: null, base: 10 });
    const kpi = widget("kpi", { query: {}, good_direction: "up", format: "number" });
    const { user, onSave } = renderDialog(kpi);
    expect(combo(tc("dashboard.config.secondary"))).toHaveAttribute("aria-disabled", "true");
    await openFilters(user);
    await choose(user, tc("dashboard.config.approvalFilter"), tc("status.approved"));
    await choose(user, tc("dashboard.config.secondary"), tc("dashboard.config.secondaryBase"));
    await user.click(screen.getByLabelText(tc("dashboard.config.sparkline")));
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: { approval_status: "APPROVED" },
      good_direction: "up",
      format: "number",
      sparkline: true,
      secondary: "base_count",
    });
  });

  it("configures a query KPI's direction and format", async () => {
    mockApi.on("get", /^\/dashboards\/kpi/, { value: 12, trend: null });
    const kpi = widget("kpi", { query: {}, good_direction: "up", format: "number" });
    const { user, onSave } = renderDialog(kpi);
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.chartKind")}`) })).toBeNull();
    expect(screen.queryByRole("combobox", { name: new RegExp(`^${tc("dashboard.config.dimension")}`) })).toBeNull();
    expect(await within(screen.getByTestId("config-preview")).findByText("12")).toBeInTheDocument();
    await choose(user, tc("dashboard.config.cardType"), "IT Component");
    await choose(user, tc("dashboard.kpi.goodDirection"), tc("dashboard.kpi.goodDirection.down"));
    await choose(user, tc("dashboard.config.format"), tc("dashboard.kpi.format.percent"));
    await user.click(saveButton());
    expect(onSave.mock.calls[0][0].config).toEqual({
      query: { card_type: "ITComponent" },
      good_direction: "down",
      format: "percent",
    });
  });

  it("lets a preset KPI change only its title", async () => {
    const preset = widget("kpi", { metric: "total_cards" });
    const { user, onSave } = renderDialog(preset, { mode: "edit" });
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    expect(screen.queryByTestId("config-preview")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(tc("dashboard.config.title")), "Everything");
    await user.click(saveButton("edit"));
    expect(onSave).toHaveBeenCalledWith({ ...preset, title: "Everything", config: { metric: "total_cards" } });
  });

  it("limits the title length", async () => {
    const { user } = renderDialog(widget("kpi", { metric: "total_cards" }), { mode: "edit" });
    await user.click(screen.getByLabelText(tc("dashboard.config.title")));
    await user.paste("x".repeat(121));
    expect(problem()).toBe(tc("dashboard.config.problem.titleTooLong"));
    expect(saveButton("edit")).toBeDisabled();
  });
});

describe("WidgetConfigDialog — recent activity", () => {
  it("bounds the row count and saves the default filter", async () => {
    const activity = widget("recent_activity", { max_rows: 12 });
    const { user, onSave } = renderDialog(activity, { mode: "edit" });
    const rows = screen.getByLabelText(tc("dashboard.config.maxRows"));
    await user.clear(rows);
    await user.type(rows, "0");
    expect(problem()).toBe(tc("dashboard.config.problem.maxRowsRange"));
    await user.clear(rows);
    await user.type(rows, "20");
    await choose(user, tc("dashboard.config.activityFilter"), tc("dashboard.activity.filter.approvals"));
    await user.click(saveButton("edit"));
    expect(onSave.mock.calls[0][0].config).toEqual({ max_rows: 20, filter: "approvals" });
  });
});

describe("WidgetConfigDialog — data quality leaderboard", () => {
  const LEADERBOARD = widget("quality_leaderboard", {
    rank_by: "average_quality",
    min_cards: 3,
    counting_roles_only: true,
    max_rows: 10,
  });
  const DEFAULT_PATH = "/dashboards/leaderboard?rank_by=average_quality&min_cards=3&counting_roles_only=true&top=10";

  /** Pick one option of a multi-select (it stays open on a pick) and close it. */
  async function pick(user: ReturnType<typeof renderDialog>["user"], label: string, option: string) {
    await user.click(combo(label));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: option }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  }

  it("previews the real board and saves the chosen keys", async () => {
    mockApi.on("get", DEFAULT_PATH, {
      rows: [{ rank: 1, user: { id: "u1", display_name: "Alice" }, cards: 4, average_quality: 88 }],
      total_people: 1,
    });
    const { user, onSave } = renderDialog(LEADERBOARD, { mode: "edit" });
    const preview = screen.getByTestId("config-preview");
    expect(await within(preview).findByTestId("quality-leaderboard")).toHaveTextContent("Alice");
    expect(within(preview).getByText(tc("dashboard.widgets.qualityLeaderboard"))).toBeInTheDocument();

    await choose(user, tc("dashboard.leaderboard.rankBy"), tc("dashboard.leaderboard.rankByCount"));
    const minCards = screen.getByLabelText(tc("dashboard.leaderboard.minCards"));
    await user.clear(minCards);
    await user.type(minCards, "2");
    const rows = screen.getByLabelText(tc("dashboard.leaderboard.maxRows"));
    await user.clear(rows);
    await user.type(rows, "15");

    // Every readable type is offered; hidden ones are not.
    expect(await options(user, tc("dashboard.leaderboard.cardTypes"))).toEqual([
      "Business Capability",
      "Application",
      "IT Component",
      "Provider",
    ]);
    expect(await options(user, tc("dashboard.leaderboard.roles"))).toEqual([
      "Capability Owner",
      "Application Owner",
      "Technical Application Owner",
      "Technical Owner",
    ]);
    await pick(user, tc("dashboard.leaderboard.cardTypes"), "Application");
    // The roles narrow to the chosen types'.
    expect(await options(user, tc("dashboard.leaderboard.roles"))).toEqual([
      "Application Owner",
      "Technical Application Owner",
    ]);
    await pick(user, tc("dashboard.leaderboard.roles"), "Application Owner");
    await user.click(screen.getByRole("checkbox", { name: tc("dashboard.leaderboard.countingRolesOnly") }));

    expect(problem()).toBeNull();
    await user.click(saveButton("edit"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].config).toEqual({
      rank_by: "card_count",
      min_cards: 2,
      counting_roles_only: false,
      max_rows: 15,
      card_types: ["Application"],
      roles: ["applicationOwner"],
    });
  });

  it("refuses a minimum or a row count the backend would", async () => {
    const { user } = renderDialog(LEADERBOARD, { mode: "edit" });
    const minCards = screen.getByLabelText(tc("dashboard.leaderboard.minCards"));
    await user.clear(minCards);
    await user.type(minCards, "101");
    expect(problem()).toBe(tc("dashboard.config.problem.leaderboardMinCards"));
    expect(saveButton("edit")).toBeDisabled();
    expect(screen.getByText(tc("dashboard.config.previewInvalid"))).toBeInTheDocument();
    await user.clear(minCards);
    await user.type(minCards, "1");
    const rows = screen.getByLabelText(tc("dashboard.leaderboard.maxRows"));
    await user.clear(rows);
    await user.type(rows, "2");
    expect(problem()).toBe(tc("dashboard.config.problem.leaderboardMaxRows"));
    expect(saveButton("edit")).toBeDisabled();
    await user.clear(rows);
    await user.type(rows, "3");
    expect(problem()).toBeNull();
    expect(saveButton("edit")).toBeEnabled();
  });

  it("shows no query, filter or chart settings", () => {
    renderDialog(LEADERBOARD, { mode: "edit" });
    expect(screen.getByTestId("config-leaderboard")).toBeInTheDocument();
    expect(screen.queryByTestId("config-filters")).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-card-type")).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-max-rows")).not.toBeInTheDocument();
  });
});

it("renders nothing without a widget", () => {
  renderWithProviders(<WidgetConfigDialog open widget={null} mode="edit" onClose={() => {}} onSave={() => {}} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
