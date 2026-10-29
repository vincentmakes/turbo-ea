import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardWidget } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));
vi.mock("@/hooks/useComplianceRegulations", () =>
  import("@/test/hooks").then((m) => m.useComplianceRegulationsModule()),
);

const echart = vi.hoisted(() => ({ last: null as null | { option: any; onClick?: (p: unknown) => void; ariaLabel?: string } }));
vi.mock("../charts/EChart", () => ({
  default: (props: { option: any; onClick?: (p: unknown) => void; ariaLabel?: string }) => {
    echart.last = props;
    return <div data-testid="echart" aria-label={props.ariaLabel} />;
  },
}));

import { mockApi } from "@/test/apiMock";
import { APPLICATION_TYPE, CARD_TYPES, IT_COMPONENT_TYPE, RELATION_TYPES } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { APPROVAL_STATUS_COLORS, CHART_CATEGORICAL, SEVERITY_COLORS, STATUS_COLORS } from "@/theme/tokens";
import ChartWidget from "./ChartWidget";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

function chart(config: Record<string, unknown>, title: string | null = null): DashboardWidget {
  return { id: "c1", type: "chart", title, config, layout: { x: 0, y: 0, w: 6, h: 5 } };
}

function renderChart(widget: DashboardWidget) {
  return renderWithProviders(<ChartWidget widget={widget} />, {
    routes: [
      { path: "/" },
      { path: "/inventory", element: <div>inventory page</div> },
      { path: "/reports/lifecycle", element: <div>lifecycle report</div> },
      { path: "/cards/:id", element: <div>card page</div> },
    ],
  });
}

const series = () => echart.last!.option.series[0];
const click = (data: unknown) => echart.last!.onClick?.({ data });

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  withMetamodel(CARD_TYPES);
  echart.last = null;
});

describe("ChartWidget", () => {
  it("draws Cards by type as horizontal bars in type colours and drills into the inventory", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type", {
      dimension: "type",
      dimension_2: null,
      rows: [
        { key: "BusinessCapability", value: 3 },
        { key: "Application", value: 8 },
      ],
      total: 11,
    });
    renderChart(chart({ query: { group_by: "type" }, chart: "bar", drill: true, title_key: "dashboard.cardsByType" }));
    expect(await screen.findByTestId("echart")).toHaveAttribute("aria-label", tc("dashboard.cardsByType"));
    const o = echart.last!.option;
    expect(o.yAxis.data).toEqual(["Application", "Business Capability"]);
    expect(series().data[0].itemStyle.color).toBe(APPLICATION_TYPE.color);
    expect(series().cursor).toBe("pointer");
    expect(series().name).toBe(tc("labels.cards"));
    click({ key: "Application" });
    expect(await screen.findByText("inventory page")).toBeInTheDocument();
  });

  it("labels approval statuses and colours them by status", async () => {
    mockApi.on("get", "/dashboards/query?group_by=approval_status", {
      dimension: "approval_status",
      dimension_2: null,
      rows: [
        { key: "APPROVED", value: 4 },
        { key: "DRAFT", value: 2 },
      ],
      total: 6,
    });
    renderChart(chart({ query: { group_by: "approval_status" }, chart: "donut", drill: true }));
    await screen.findByTestId("echart");
    expect(series().data.map((d: any) => d.name)).toEqual([tc("status.draft"), tc("status.approved")]);
    expect(series().data.map((d: any) => d.itemStyle.color)).toEqual([
      APPROVAL_STATUS_COLORS.DRAFT,
      APPROVAL_STATUS_COLORS.APPROVED,
    ]);
  });

  it("drills a lifecycle column into the lifecycle report", async () => {
    mockApi.on("get", "/dashboards/query?group_by=lifecycle_phase", {
      dimension: "lifecycle_phase",
      dimension_2: null,
      rows: [{ key: "active", value: 4 }],
      total: 4,
    });
    renderChart(chart({ query: { group_by: "lifecycle_phase" }, chart: "column", drill: true }));
    await screen.findByTestId("echart");
    expect(echart.last!.option.xAxis.data).toHaveLength(6);
    click({ key: "active" });
    expect(await screen.findByText("lifecycle report")).toBeInTheDocument();
  });

  it("does not navigate when drill is off, or from the folded Other slice", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type", {
      dimension: "type",
      dimension_2: null,
      rows: [{ key: "Application", value: 8 }],
      total: 8,
    });
    renderChart(chart({ query: { group_by: "type" }, chart: "bar", drill: false }));
    await screen.findByTestId("echart");
    expect(series().cursor).toBe("default");
    click({ key: "Application" });
    click({ key: "__other__" });
    click(undefined);
    expect(screen.queryByText("inventory page")).toBeNull();
  });

  it("folds a part-to-whole chart without own colours past the palette", async () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ key: `opt${i}`, value: 20 - i }));
    mockApi.on("get", "/dashboards/query?card_type=Application&group_by=field%3Aregions", {
      dimension: "field:regions",
      dimension_2: null,
      rows,
      total: 0,
    });
    renderChart(chart({ query: { card_type: "Application", group_by: "field:regions" }, chart: "pie", drill: true }));
    await screen.findByTestId("echart");
    const data = series().data;
    expect(data).toHaveLength(CHART_CATEGORICAL.light.length);
    expect(data.at(-1).name).toBe(tc("dashboard.query.other"));
    expect(data.at(-1).itemStyle.color).toBe(STATUS_COLORS.neutral);
    click({ key: "__other__" });
    click({ key: "opt0" });
    expect(await screen.findByText("inventory page")).toBeInTheDocument();
  });

  it("draws a KPI's history as a line over 90 days", async () => {
    mockApi.on("get", "/dashboards/kpi-history?card_type=Application&days=90", {
      points: [
        { date: "2026-10-01", value: 3 },
        { date: "2026-10-02", value: 5 },
      ],
    });
    renderChart(chart({ query: { card_type: "Application" }, chart: "line", series: "kpi_history", drill: false }));
    await screen.findByTestId("echart");
    expect(echart.last!.option.xAxis.data).toEqual(["Oct 1", "Oct 2"]);
    expect(series().data.map((d: any) => d.value)).toEqual([3, 5]);
  });

  it("draws a gauge from the total", async () => {
    mockApi.on("get", "/dashboards/query?card_type=Application", { dimension: null, dimension_2: null, rows: [], total: 37 });
    renderChart(chart({ query: { card_type: "Application" }, chart: "gauge", drill: true, max: 100 }));
    await screen.findByTestId("echart");
    expect(series().data[0].value).toBe(37);
    expect(series().max).toBe(100);
    // A count reads against its target, with no bands unless given.
    expect(series().detail.formatter(37)).toBe(`{value|37}\n{target|${tc("dashboard.config.ofTarget", { target: "100" })}}`);
    expect(echart.last!.option.series).toHaveLength(1);
  });

  it("puts a share on a 0–100 gauge in %, banded by its thresholds and direction", async () => {
    const query = { card_type: "Application", metric: "share", flags: "without_stakeholders" };
    mockApi.on("get", "/dashboards/query?card_type=Application&flags=without_stakeholders&metric=share", {
      dimension: null,
      dimension_2: null,
      rows: [],
      total: 35,
    });
    renderChart(chart({ query, chart: "gauge", max: 400, thresholds: [20, 40], good_direction: "down" }));
    await screen.findByTestId("echart");
    expect(series().max).toBe(100);
    expect(series().detail.formatter(35)).toBe("{value|35%}");
    expect(series().progress.itemStyle.color).toBe(STATUS_COLORS.warning);
    expect(echart.last!.option.series[1].axisLine.lineStyle.color).toEqual([
      [0.2, STATUS_COLORS.success],
      [0.4, STATUS_COLORS.warning],
      [1, STATUS_COLORS.error],
    ]);
  });

  it("reads the average data quality and a percentage field in %, with the default bands", async () => {
    mockApi.on("get", "/dashboards/query?metric=avg&metric_field=%40data_quality", {
      dimension: null,
      dimension_2: null,
      rows: [],
      total: 64.5,
    });
    const { unmount } = renderChart(chart({ query: { metric: "avg", metric_field: "@data_quality" }, chart: "gauge" }));
    await screen.findByTestId("echart");
    expect(series().detail.formatter(64.5)).toBe("{value|64.5%}");
    expect(echart.last!.option.series[1].axisLine.lineStyle.color.map((b: [number, string]) => b[0])).toEqual([0.5, 0.8, 1]);
    unmount();
    mockApi.on("get", "/dashboards/query?card_type=Application&metric=avg&metric_field=coverage", {
      dimension: null,
      dimension_2: null,
      rows: [],
      total: 90,
    });
    renderChart(chart({ query: { card_type: "Application", metric: "avg", metric_field: "coverage" }, chart: "gauge" }));
    await screen.findByTestId("echart");
    expect(series().detail.formatter(90)).toBe("{value|90%}");
    expect(series().progress.itemStyle.color).toBe(STATUS_COLORS.success);
  });

  it("keeps a share's % on other chart kinds, and no gauge settings", async () => {
    const query = { group_by: "type", metric: "share", approval_status: "APPROVED" };
    mockApi.on("get", "/dashboards/query?approval_status=APPROVED&group_by=type&metric=share", {
      dimension: "type",
      dimension_2: null,
      rows: [{ key: "Application", value: 40 }],
      total: 40,
    });
    renderChart(chart({ query, chart: "bar", thresholds: [1, 2] }));
    await screen.findByTestId("echart");
    expect(echart.last!.option.tooltip.valueFormatter(40)).toBe("40%");
  });

  it("names both heatmap axes", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type&group_by_2=approval_status", {
      dimension: "type",
      dimension_2: "approval_status",
      rows: [{ x: "Application", y: "DRAFT", value: 2 }],
      total: 2,
    });
    renderChart(chart({ query: { group_by: "type", group_by_2: "approval_status" }, chart: "heatmap", drill: true }));
    await screen.findByTestId("echart");
    expect(echart.last!.option.xAxis.data).toEqual(["Application"]);
    expect(echart.last!.option.yAxis.data).toEqual([tc("status.draft")]);
  });

  it("names a summed metric's series", async () => {
    mockApi.on("get", "/dashboards/query?card_type=Application&group_by=subtype&metric=sum&metric_field=costTotalAnnual", {
      dimension: "subtype",
      dimension_2: null,
      rows: [{ key: "microservice", value: 10 }],
      total: 10,
    });
    renderChart(
      chart({
        query: { card_type: "Application", group_by: "subtype", metric: "sum", metric_field: "costTotalAnnual" },
        chart: "column",
        drill: false,
      }),
    );
    await screen.findByTestId("echart");
    expect(series().name).toBe(tc("dashboard.query.metric.sum"));
    expect(echart.last!.option.xAxis.data).toEqual(["Microservice"]);
    // A dimension without colours draws one series in one hue.
    expect(series().data[0].itemStyle.color).toBe(CHART_CATEGORICAL.light[0]);
  });

  it("says when there are no cards, or no data", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type", { dimension: "type", dimension_2: null, rows: [], total: 0 });
    const { unmount } = renderChart(chart({ query: { group_by: "type" }, chart: "bar", drill: true }));
    expect(await screen.findByText(tc("dashboard.noCardsYet"))).toBeInTheDocument();
    unmount();
    mockApi.on("get", "/dashboards/query?group_by=subtype", { dimension: "subtype", dimension_2: null, rows: [], total: 0 });
    renderChart(chart({ query: { group_by: "subtype" }, chart: "pie", drill: true }));
    expect(await screen.findByText(tc("emptyStates.noData"))).toBeInTheDocument();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows the error when the query fails", async () => {
    mockApi.fail("get", "/dashboards/query?group_by=type", 400, "unknown_field");
    renderChart(chart({ query: { group_by: "type" }, chart: "bar", drill: true }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("mirrors in RTL", async () => {
    hookState.isRtl = true;
    mockApi.on("get", "/dashboards/query?group_by=type", {
      dimension: "type",
      dimension_2: null,
      rows: [{ key: "Application", value: 1 }],
      total: 1,
    });
    renderChart(chart({ query: { group_by: "type" }, chart: "bar", drill: true }));
    await screen.findByTestId("echart");
    expect(echart.last!.option.xAxis.inverse).toBe(true);
    expect(echart.last!.option.yAxis.position).toBe("right");
  });
});

describe("ChartWidget — relation-aware and module charts", () => {
  beforeEach(() => withMetamodel(CARD_TYPES, RELATION_TYPES));

  it("asks the server to fold a card-keyed grouping and names its cards from the answer", async () => {
    mockApi.on("get", "/dashboards/query?card_type=Application&group_by=related%3ArelAppToITC&top=20", {
      dimension: "related:relAppToITC",
      dimension_2: null,
      rows: [
        { key: "c1", value: 3 },
        { key: "none", value: 1 },
        { key: "__other__", value: 5 },
        { key: "c2", value: 4 },
      ],
      total: 13,
      labels: { c1: "Postgres", c2: "Kafka" },
    });
    renderChart(
      chart({ query: { card_type: "Application", group_by: "related:relAppToITC" }, chart: "bar", drill: true }),
    );
    await screen.findByTestId("echart");
    expect(echart.last!.option.yAxis.data).toEqual([
      "Kafka",
      "Postgres",
      tc("dashboard.query.other"),
      tc("dashboard.query.noRelated"),
    ]);
    click({ key: "none" });
    expect(screen.queryByText("card page")).toBeNull();
    click({ key: "c2" });
    expect(await screen.findByText("card page")).toBeInTheDocument();
  });

  it("tiles cost per application: one named tile per card in the type's colour, drilling into the card", async () => {
    mockApi.on(
      "get",
      "/dashboards/query?card_type=Application&group_by=card&metric=sum&metric_field=costTotalAnnual&top=30",
      {
        dimension: "card",
        dimension_2: null,
        rows: [
          { key: "app-1", value: 1200 },
          { key: "app-2", value: 800 },
        ],
        total: 2000,
        labels: { "app-1": "CRM", "app-2": "ERP" },
        fiscal_year: 2026,
        fiscal_year_start: 1,
      },
    );
    renderChart(
      chart({
        query: { card_type: "Application", group_by: "card", metric: "sum", metric_field: "costTotalAnnual" },
        chart: "treemap",
        drill: true,
        max: 30,
      }),
    );
    await screen.findByTestId("echart");
    const s = series();
    expect(s.data.map((d: { name: string }) => d.name)).toEqual(["CRM", "ERP"]);
    expect(s.data.map((d: { itemStyle: { color: string } }) => d.itemStyle.color)).toEqual([
      APPLICATION_TYPE.color,
      APPLICATION_TYPE.color,
    ]);
    expect(screen.getByTestId("chart-caption")).toBeInTheDocument();
    click({ key: "app-2" });
    expect(await screen.findByText("card page")).toBeInTheDocument();
  });

  it("names each sankey side through its own type and drills a card node into the card", async () => {
    mockApi.on("get", "/dashboards/query?group_by=field%3AbusinessCriticality&group_by_2=card&relation_type=relAppToITC&top=20", {
      dimension: "field:businessCriticality",
      dimension_2: "card",
      rows: [{ source: "missionCritical", target: "itc-1", value: 2 }],
      total: 2,
      labels: { "itc-1": "Postgres" },
    });
    renderChart(
      chart({
        query: { relation_type: "relAppToITC", group_by: "field:businessCriticality", group_by_2: "card" },
        chart: "sankey",
        drill: true,
      }),
    );
    await screen.findByTestId("echart");
    const s = series();
    expect(s.label.formatter({ name: "s:missionCritical" })).toBe("Mission Critical");
    expect(s.label.formatter({ name: "t:itc-1" })).toBe("Postgres");
    // A card node takes its side's type colour.
    expect(s.data[1].itemStyle.color).toBe(IT_COMPONENT_TYPE.color);
    expect(s.cursor).toBe("pointer");
    // A flow joins two cards: no single destination.
    click({ source: "s:missionCritical", target: "t:itc-1" });
    click({ key: "itc-1" });
    expect(screen.queryByText("card page")).toBeNull();
    click({ key: "itc-1", side: "target" });
    expect(await screen.findByText("card page")).toBeInTheDocument();
  });

  it("drills a sankey source node into the inventory of its own type", async () => {
    mockApi.on("get", "/dashboards/query?group_by=field%3AbusinessCriticality&relation_type=relAppToITC", {
      dimension: "field:businessCriticality",
      dimension_2: "type",
      rows: [{ source: "missionCritical", target: "ITComponent", value: 2 }],
      total: 2,
    });
    renderChart(
      chart({ query: { relation_type: "relAppToITC", group_by: "field:businessCriticality" }, chart: "sankey", drill: true }),
    );
    await screen.findByTestId("echart");
    click({ key: "missionCritical", side: "source" });
    expect(await screen.findByText("inventory page")).toBeInTheDocument();
  });

  it("stacks columns by the second grouping and drills a segment by its column", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type&group_by_2=lifecycle_phase", {
      dimension: "type",
      dimension_2: "lifecycle_phase",
      rows: [
        { x: "Application", y: "active", value: 3 },
        { x: "Application", y: "phaseOut", value: 1 },
        { x: "ITComponent", y: "active", value: 2 },
      ],
      total: 6,
    });
    renderChart(chart({ query: { group_by: "type", group_by_2: "lifecycle_phase" }, chart: "stacked_column", drill: true }));
    await screen.findByTestId("echart");
    const o = echart.last!.option;
    expect(o.xAxis.data).toEqual(["Application", "IT Component"]);
    expect(o.series.map((x: any) => x.name)).toEqual([tc("lifecycle.active"), tc("lifecycle.phaseOut")]);
    expect(o.series[0].itemStyle.color).toBe(STATUS_COLORS.success);
    expect(o.legend.data).toHaveLength(2);
    click({ key: "ITComponent", key2: "active" });
    expect(await screen.findByText("inventory page")).toBeInTheDocument();
  });

  it("names the fiscal year a cost sum counts", async () => {
    mockApi.on("get", "/dashboards/query?card_type=Application&group_by=subtype&metric=sum&metric_field=costTotalAnnual", {
      dimension: "subtype",
      dimension_2: null,
      rows: [{ key: "microservice", value: 10 }],
      total: 10,
      fiscal_year: 2026,
      fiscal_year_start: 1,
    });
    renderChart(
      chart({
        query: { card_type: "Application", group_by: "subtype", metric: "sum", metric_field: "costTotalAnnual" },
        chart: "column",
        drill: false,
      }),
    );
    expect(await screen.findByTestId("chart-caption")).toHaveTextContent(
      tc("dashboard.config.fiscalYear", { year: tc("fiscalYear.single", { year: 2026 }) }),
    );
  });

  it("shows no caption without a fiscal year", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type", {
      dimension: "type",
      dimension_2: null,
      rows: [{ key: "Application", value: 1 }],
      total: 1,
    });
    renderChart(chart({ query: { group_by: "type" }, chart: "bar", drill: false }));
    await screen.findByTestId("echart");
    expect(screen.queryByTestId("chart-caption")).toBeNull();
  });

  it("says how many cards a folded treemap merged into Other", async () => {
    mockApi.on("get", "/dashboards/query?card_type=Application&group_by=card&top=20", {
      dimension: "card",
      dimension_2: null,
      rows: [
        { key: "app-1", value: 1 },
        { key: "__other__", value: 5 },
      ],
      total: 6,
      labels: { "app-1": "CRM" },
      folded: { top: 20, cards: 5 },
    });
    renderChart(chart({ query: { card_type: "Application", group_by: "card" }, chart: "treemap", drill: false }));
    const caption = await screen.findByTestId("chart-caption");
    expect(caption).toHaveTextContent(tc("dashboard.chart.folded", { count: 5, top: 20 }));
    expect(caption).toHaveTextContent("Showing the 20 largest cards; 5 more are in Other");
  });

  it("says how many cards a folded sankey merged into Other", async () => {
    mockApi.on("get", "/dashboards/query?group_by=field%3AbusinessCriticality&group_by_2=card&relation_type=relAppToITC&top=20", {
      dimension: "field:businessCriticality",
      dimension_2: "card",
      rows: [{ source: "missionCritical", target: "itc-1", value: 2 }],
      total: 2,
      labels: { "itc-1": "Postgres" },
      folded: { top: 20, cards: 1 },
    });
    renderChart(
      chart({
        query: { relation_type: "relAppToITC", group_by: "field:businessCriticality", group_by_2: "card" },
        chart: "sankey",
        drill: false,
      }),
    );
    expect(await screen.findByTestId("chart-caption")).toHaveTextContent(
      "Showing the 20 largest cards; 1 more is in Other",
    );
  });

  it("says an average dropped the cards past the largest ones rather than merging them", async () => {
    mockApi.on(
      "get",
      "/dashboards/query?card_type=Application&group_by=card&metric=avg&metric_field=vendorScore&top=10",
      {
        dimension: "card",
        dimension_2: null,
        rows: [{ key: "app-1", value: 4 }],
        total: 4,
        labels: { "app-1": "CRM" },
        folded: { top: 10, cards: 3 },
      },
    );
    renderChart(
      chart({
        query: { card_type: "Application", group_by: "card", metric: "avg", metric_field: "vendorScore" },
        chart: "bar",
        drill: false,
        max: 10,
      }),
    );
    const caption = await screen.findByTestId("chart-caption");
    expect(caption).toHaveTextContent(tc("dashboard.chart.foldedDropped", { count: 3, top: 10 }));
    expect(caption).toHaveTextContent("Showing the 10 largest cards; 3 more are not shown");
    expect(caption).not.toHaveTextContent("Other");
  });

  it("says nothing of a fold when a card-keyed result kept every card", async () => {
    mockApi.on("get", "/dashboards/query?card_type=Application&group_by=card&top=20", {
      dimension: "card",
      dimension_2: null,
      rows: [{ key: "app-1", value: 1 }],
      total: 1,
      labels: { "app-1": "CRM" },
    });
    renderChart(chart({ query: { card_type: "Application", group_by: "card" }, chart: "treemap", drill: false }));
    await screen.findByTestId("echart");
    expect(screen.queryByTestId("chart-caption")).toBeNull();
  });

  it("joins the fiscal year and the fold on a folded cost treemap", async () => {
    mockApi.on(
      "get",
      "/dashboards/query?card_type=Application&group_by=card&metric=sum&metric_field=costTotalAnnual&top=20",
      {
        dimension: "card",
        dimension_2: null,
        rows: [{ key: "app-1", value: 1200 }],
        total: 1200,
        labels: { "app-1": "CRM" },
        fiscal_year: 2026,
        fiscal_year_start: 1,
        folded: { top: 20, cards: 37 },
      },
    );
    renderChart(
      chart({
        query: { card_type: "Application", group_by: "card", metric: "sum", metric_field: "costTotalAnnual" },
        chart: "treemap",
        drill: false,
      }),
    );
    expect(await screen.findByTestId("chart-caption")).toHaveTextContent(
      `${tc("dashboard.config.fiscalYear", { year: tc("fiscalYear.single", { year: 2026 }) })} · ${tc(
        "dashboard.chart.folded",
        { count: 37, top: 20 },
      )}`,
    );
  });

  it("says what the server refused", async () => {
    mockApi.fail("get", "/dashboards/query?flags=x&group_by=type", 400, "unknown_flag");
    renderChart(chart({ query: { group_by: "type", flags: "x" }, chart: "bar", drill: false }));
    expect(await screen.findByText(tc("dashboard.config.problem.unknownFlag"))).toBeInTheDocument();
  });

  it("draws a module series from the shared report, in the module's colours", async () => {
    mockApi.on("get", "/risks/metrics", {
      total: 7,
      by_status: {},
      by_level: { critical: 1, low: 6 },
      by_category: {},
      overdue: 0,
    });
    renderChart(
      chart({ source: "risks_metrics", series: "by_level", chart: "donut", title_key: "dashboard.source.chart.risksByLevel" }),
    );
    expect(await screen.findByTestId("echart")).toHaveAttribute("aria-label", tc("dashboard.source.chart.risksByLevel"));
    const data = series().data;
    expect(data.map((d: any) => d.name)).toEqual([i18n.t("grc:risks.level.critical"), i18n.t("grc:risks.level.low")]);
    expect(data.map((d: any) => d.itemStyle.color)).toEqual([SEVERITY_COLORS.critical, SEVERITY_COLORS.low]);
    expect(series().name).toBe(tc("dashboard.source.series.risks_metrics.by_level"));
    expect(mockApi.calls.filter((c) => c.path.startsWith("/dashboards/"))).toHaveLength(0);
    // A module chart does not drill.
    expect(series().cursor).toBe("default");
  });

  it("draws a single module number on a gauge, and names regulations", async () => {
    mockApi.on("get", "/compliance/overview", { compliance_scores: { gdpr: 90, custom_reg: 70 } });
    hookState.complianceRegulations = [
      { key: "custom_reg", label: "Our policy", is_enabled: true } as never,
    ];
    const { unmount } = renderChart(
      chart({ source: "compliance_overview", series: "score_avg", chart: "gauge", max: 100 }),
    );
    await screen.findByTestId("echart");
    expect(series().data[0].value).toBe(80);
    expect(series().max).toBe(100);
    // A score is a rate: in %, on the default bands, no "of N".
    expect(series().detail.formatter(80)).toBe("{value|80%}");
    expect(series().progress.itemStyle.color).toBe(STATUS_COLORS.success);
    unmount();
    renderChart(chart({ source: "compliance_overview", series: "scores", chart: "column" }));
    await screen.findByTestId("echart");
    expect(echart.last!.option.xAxis.data).toEqual([i18n.t("admin:compliance_regulation_gdpr"), "Our policy"]);
  });

  it("prints the figures when the widget asks for them, on a query chart and a module chart", async () => {
    mockApi.on("get", "/dashboards/query?group_by=type", {
      dimension: "type",
      dimension_2: null,
      rows: [{ key: "Application", value: 8 }],
      total: 8,
    });
    const { unmount } = renderChart(chart({ query: { group_by: "type" }, chart: "column", show_values: true }));
    await screen.findByTestId("echart");
    expect(series().label).toMatchObject({ show: true, position: "top" });
    expect(series().label.formatter({ value: 8 })).toBe("8");
    unmount();
    renderChart(chart({ query: { group_by: "type" }, chart: "column" }));
    await screen.findByTestId("echart");
    expect(series()).not.toHaveProperty("label");
  });

  it("prints a module chart's figures too", async () => {
    mockApi.on("get", "/risks/metrics", {
      total: 7,
      by_status: {},
      by_level: { critical: 1, low: 6 },
      by_category: {},
      overdue: 0,
    });
    renderChart(chart({ source: "risks_metrics", series: "by_level", chart: "bar", show_values: true }));
    await screen.findByTestId("echart");
    expect(series().label).toMatchObject({ show: true, position: "right" });
  });

  it("says when a module report has nothing to draw", async () => {
    mockApi.on("get", "/reports/bpm/dashboard", { total_processes: 0, by_maturity: {} });
    renderChart(chart({ source: "bpm_dashboard", series: "by_maturity", chart: "pie" }));
    expect(await screen.findByText(tc("emptyStates.noData"))).toBeInTheDocument();
  });
});
