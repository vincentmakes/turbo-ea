import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardWidget } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
vi.mock("@/hooks/useIsRtl", () => import("@/test/hooks").then((m) => m.useIsRtlModule()));

const echart = vi.hoisted(() => ({ last: null as null | { option: any; onClick?: (p: unknown) => void; ariaLabel?: string } }));
vi.mock("../charts/EChart", () => ({
  default: (props: { option: any; onClick?: (p: unknown) => void; ariaLabel?: string }) => {
    echart.last = props;
    return <div data-testid="echart" aria-label={props.ariaLabel} />;
  },
}));

import { mockApi } from "@/test/apiMock";
import { APPLICATION_TYPE, CARD_TYPES } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { renderWithProviders } from "@/test/render";
import { APPROVAL_STATUS_COLORS, CHART_CATEGORICAL, STATUS_COLORS } from "@/theme/tokens";
import ChartWidget from "./ChartWidget";

const tc = (k: string) => i18n.t(`common:${k}`) as string;

function chart(config: Record<string, unknown>, title: string | null = null): DashboardWidget {
  return { id: "c1", type: "chart", title, config, layout: { x: 0, y: 0, w: 6, h: 5 } };
}

function renderChart(widget: DashboardWidget) {
  return renderWithProviders(<ChartWidget widget={widget} />, {
    routes: [
      { path: "/" },
      { path: "/inventory", element: <div>inventory page</div> },
      { path: "/reports/lifecycle", element: <div>lifecycle report</div> },
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
