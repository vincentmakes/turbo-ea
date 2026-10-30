import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardData, DashboardWidget } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

/* eslint-disable @typescript-eslint/no-explicit-any -- option trees are plain JSON here */
const echart = vi.hoisted(() => ({ options: [] as any[] }));
vi.mock("@/components/charts/EChart", () => ({
  default: (props: { option: any }) => {
    echart.options.push(props.option);
    return <div data-testid="echart" />;
  },
}));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { CARD_SHADOW, DASHBOARD_KPI_COLORS } from "@/theme/tokens";
import { DashboardSourcesProvider } from "../DashboardSources";
import KpiWidget from "./KpiWidget";
import WidgetFrame, { DRAG_HANDLE_CLASS } from "./WidgetFrame";
import { formatKpiValue, qualityColor, secondaryCaption } from "./kpiPresets";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

function kpi(config: Record<string, unknown>, title: string | null = null, id = "k"): DashboardWidget {
  return { id, type: "kpi", title, config, layout: { x: 0, y: 0, w: 3, h: 2 } };
}

const trend = (delta_pct: number | null, delta_abs: number | null) => ({
  current: 0,
  previous: 0,
  delta_pct,
  delta_abs,
});

const DASHBOARD: DashboardData = {
  total_cards: 120,
  by_type: { Application: 80 },
  avg_data_quality: 72,
  approval_statuses: { APPROVED: 40, BROKEN: 3 },
  data_quality_distribution: {},
  lifecycle_distribution: {},
  recent_events: [],
  trends: {
    comparison_days: 14,
    snapshot_available: true,
    snapshot_date: "2026-10-14",
    total_cards: trend(5, 6),
    avg_data_quality: trend(2.5, 1.8),
    approved_count: trend(0, 0),
    broken_count: trend(50, 1),
  },
};

const WORKSPACE = {
  favorite_count: 4,
  stakeholder_card_count: 9,
  open_todo_count: 2,
  pending_survey_count: 1,
  attention_count: 0,
  overdue_todo_count: 0,
  broken_card_count: 0,
  created_count: 3,
};

const ADMIN = {
  kpis: {
    total_users: 10,
    active_users_30d: 3,
    cards_without_stakeholders: 17,
    overdue_todos_total: 5,
    stuck_approvals: 2,
    broken_total: 4,
    pending_sso_invitations: 0,
    unassigned_todo_count: 1,
  },
  top_contributors: [],
  stakeholder_coverage: [],
  idle_users: [],
  approval_pipeline: [],
  recent_activity: [],
  oldest_overdue_todos: [],
};

function renderKpis(widgets: DashboardWidget[], route = "/", modules = { bpm: true, ppm: true, grc: true }) {
  return renderWithProviders(
    <DashboardSourcesProvider widgets={widgets} modules={modules}>
      {widgets.map((w) => (
        <KpiWidget key={w.id} widget={w} />
      ))}
    </DashboardSourcesProvider>,
    {
      route,
      routes: [{ path: "/" }, { path: "/reports/data-quality", element: <div>quality report</div> }],
    },
  );
}

/** The tiles inside their frames, as the grid mounts them. */
function renderFramed(
  widgets: DashboardWidget[],
  editing: boolean,
  handlers: { onConfigure?: () => void; onRemove?: () => void } = {},
) {
  return renderWithProviders(
    <DashboardSourcesProvider widgets={widgets}>
      {widgets.map((w) => (
        <WidgetFrame key={w.id} widget={w} editing={editing} {...handlers}>
          <KpiWidget widget={w} />
        </WidgetFrame>
      ))}
    </DashboardSourcesProvider>,
    {
      // The app theme: its outlined card has no shadow of its own.
      theme: true,
      routes: [{ path: "/" }, { path: "/reports/data-quality", element: <div>quality report</div> }],
    },
  );
}

/** The material symbol named `icon`. */
function symbol(icon: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>(".material-symbols-outlined")).find(
    (el) => el.textContent === icon,
  );
  if (!found) throw new Error(`no ${icon} symbol`);
  return found;
}

const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  echart.options = [];
  mockApi.reset();
  mockApi.on("get", "/reports/dashboard", DASHBOARD);
  mockApi.on("get", "/reports/my-workspace", WORKSPACE);
  mockApi.on("get", "/reports/admin-dashboard", ADMIN);
  mockApi.on("get", "/reports/data-quality", { overall_data_quality: 81, total_items: 10 });
});

describe("overview presets", () => {
  it("show today's four tiles from one shared fetch, trends and window included", async () => {
    renderKpis([
      kpi({ metric: "total_cards" }, null, "a"),
      kpi({ metric: "avg_data_quality" }, null, "b"),
      kpi({ metric: "approved_count" }, null, "c"),
      kpi({ metric: "broken_count" }, null, "d"),
    ]);
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.totalCards"))).toBeInTheDocument();
    expect(screen.getByText("72%")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("+5.0%")).toBeInTheDocument();
    expect(screen.getByText("(+6)")).toBeInTheDocument();
    // A percentage KPI shows no point change.
    expect(screen.getByText("+2.5%")).toBeInTheDocument();
    expect(screen.queryByText("(+1.8)")).toBeNull();
    expect(screen.getAllByText(tc("dashboard.trend.vsDays", { count: 14 }))).toHaveLength(4);
    expect(mockApi.callsOf("get", "/reports/dashboard")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/reports/my-workspace")).toHaveLength(0);
  });

  it("in customize mode is the live tile plus the handle before its icon and the buttons in the trend's place", async () => {
    const onConfigure = vi.fn();
    const onRemove = vi.fn();
    const { user } = renderFramed([kpi({ metric: "total_cards" })], true, { onConfigure, onRemove });
    const value = await screen.findByText("120");
    // The live tile: full-size number, live padding, window caption.
    expect(value).toHaveClass("MuiTypography-h4");
    expect(document.querySelector("[data-compact]")).toBeNull();
    expect(value.closest(".MuiCardContent-root")).toHaveStyle({ padding: "16px" });
    expect(screen.getByText(tc("dashboard.trend.vsDays", { count: 14 }))).toBeInTheDocument();
    // One card, one title: the frame adds neither.
    expect(document.querySelectorAll(".MuiCard-root")).toHaveLength(1);
    expect(screen.getAllByText(tc("dashboard.totalCards"))).toHaveLength(1);
    // [handle][icon][label …][actions], all in the tile's top row; the trend
    // chip gives its place to the buttons so a narrow tile keeps its label.
    const handle = screen.getByTestId("widget-drag-handle");
    const icon = symbol("inventory_2");
    const label = screen.getByText(tc("dashboard.totalCards"));
    expect(screen.queryByText("+5.0%")).toBeNull();
    const configure = screen.getByRole("button", { name: tc("dashboard.widgets.configure") });
    const remove = screen.getByRole("button", { name: tc("dashboard.widgets.remove") });
    expect(value.closest(".MuiCard-root")).toContainElement(handle);
    expect(follows(handle, icon)).toBe(true);
    expect(follows(icon, label)).toBe(true);
    expect(follows(label, configure)).toBe(true);
    expect(follows(configure, remove)).toBe(true);
    expect(handle.parentElement).toBe(icon.parentElement);
    expect(label).toHaveClass("MuiTypography-noWrap");
    // The whole icon + label group drags.
    expect(handle.parentElement).toHaveClass(DRAG_HANDLE_CLASS);
    expect(screen.getByTestId("kpi-actions")).toContainElement(configure);
    // A faint shadow around the tile, drawn by the frame's box the tile fills
    // (one drawn on the card would be clipped by the body's overflow).
    const frame = value.closest<HTMLElement>("[data-widget-id]")!;
    expect(getComputedStyle(frame).boxShadow.replace(/\s/g, "")).toBe(CARD_SHADOW.soft.replace(/\s/g, ""));
    expect(getComputedStyle(value.closest(".MuiCard-root")!).boxShadow).toBe("");
    await user.click(configure);
    await user.click(remove);
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("puts the buttons at the end of a tile with no trend", async () => {
    mockApi.on("get", "/reports/dashboard", { ...DASHBOARD, trends: undefined });
    renderFramed([kpi({ metric: "total_cards" })], true, { onRemove: () => {} });
    expect(await screen.findByText("120")).toBeInTheDocument();
    const label = screen.getByText(tc("dashboard.totalCards"));
    const remove = screen.getByRole("button", { name: tc("dashboard.widgets.remove") });
    expect(follows(label, remove)).toBe(true);
    expect(screen.queryByRole("button", { name: tc("dashboard.widgets.configure") })).toBeNull();
  });

  it("draws the same tile with no controls and no shadow outside customize mode", async () => {
    renderFramed([kpi({ metric: "total_cards" })], false, { onConfigure: () => {}, onRemove: () => {} });
    const value = await screen.findByText("120");
    expect(value).toHaveClass("MuiTypography-h4");
    expect(value.closest(".MuiCardContent-root")).toHaveStyle({ padding: "16px" });
    expect(screen.queryByTestId("widget-drag-handle")).toBeNull();
    expect(screen.queryByTestId("kpi-actions")).toBeNull();
    expect(document.querySelector(`.${DRAG_HANDLE_CLASS}`)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(getComputedStyle(value.closest(".MuiCard-root")!).boxShadow).toBe("");
  });

  it("colours a rise in broken cards as bad", async () => {
    renderKpis([kpi({ metric: "broken_count" })]);
    const pct = await screen.findByText("+50.0%");
    expect(pct).toHaveStyle({ color: "rgb(211, 47, 47)" });
  });

  it("shows no trend before the first snapshot", async () => {
    mockApi.on("get", "/reports/dashboard", { ...DASHBOARD, trends: undefined });
    renderKpis([kpi({ metric: "total_cards" })]);
    expect(await screen.findByText("120")).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).toBeNull();
    expect(screen.queryByText(tc("dashboard.trend.vsDays", { count: 14 }))).toBeNull();
  });

  it("uses the admin's own label", async () => {
    renderKpis([kpi({ metric: "total_cards" }, "Everything")]);
    expect(await screen.findByText("Everything")).toBeInTheDocument();
  });

  it("reports a failed source", async () => {
    mockApi.fail("get", "/reports/dashboard", 500);
    renderKpis([kpi({ metric: "total_cards" })]);
    expect(await screen.findByText(tc("errors.generic"))).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("workspace presets", () => {
  it("show the counters as metric cards", async () => {
    renderKpis([
      kpi({ metric: "favorites" }, null, "a"),
      kpi({ metric: "stakeholder_cards" }, null, "b"),
      kpi({ metric: "open_todos" }, null, "c"),
      kpi({ metric: "pending_surveys" }, null, "d"),
    ]);
    expect(await screen.findByText("9")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.workspace.metric.favorites"))).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.workspace.metric.pendingSurveys"))).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/reports/my-workspace")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/reports/dashboard")).toHaveLength(0);
  });

  it("are dashboard KPI tiles, with the customize controls in their own top row", async () => {
    renderFramed([kpi({ metric: "stakeholder_cards" })], true, { onRemove: () => {} });
    const value = await screen.findByText("9");
    expect(value).toHaveClass("MuiTypography-h4");
    const card = value.closest(".MuiCard-root")!;
    expect(card).not.toBeNull();
    expect(card).toContainElement(screen.getByText(tc("dashboard.workspace.metric.stakeholderCards")));
    expect(card).toContainElement(screen.getByTestId("widget-drag-handle"));
    expect(card).toContainElement(screen.getByRole("button", { name: tc("dashboard.widgets.remove") }));
    expect(follows(screen.getByTestId("widget-drag-handle"), symbol("groups"))).toBe(true);
    expect(screen.queryByTestId("kpi-subtitle")).toBeNull();
  });
});

describe("admin presets", () => {
  it("show the admin strip with its subtitles", async () => {
    renderKpis([
      kpi({ metric: "active_users" }, null, "a"),
      kpi({ metric: "cards_without_stakeholders" }, null, "b"),
      kpi({ metric: "overdue_todos" }, null, "c"),
      kpi({ metric: "stuck_approvals" }, null, "d"),
    ]);
    expect(await screen.findByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.admin.metric.activeUsersSubtitle"))).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.admin.metric.unassignedTodos", { count: 1 }))).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.admin.metric.brokenApprovals", { count: 4 }))).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/reports/data-quality")).toHaveLength(0);
  });

  it("are dashboard KPI tiles, the subtitle a caption under the number", async () => {
    renderFramed([kpi({ metric: "active_users" })], true, { onRemove: () => {} });
    const value = await screen.findByText("3 / 10");
    expect(value).toHaveClass("MuiTypography-h4");
    const subtitle = screen.getByTestId("kpi-subtitle");
    expect(subtitle).toHaveTextContent(tc("dashboard.admin.metric.activeUsersSubtitle"));
    expect(subtitle).toHaveClass("MuiTypography-caption");
    expect(follows(value, subtitle)).toBe(true);
    const card = value.closest(".MuiCard-root")!;
    expect(card).toContainElement(subtitle);
    expect(card).toContainElement(screen.getByTestId("widget-drag-handle"));
    expect(follows(screen.getByTestId("widget-drag-handle"), symbol("trending_up"))).toBe(true);
  });

  it("drops a subtitle with nothing to say", async () => {
    mockApi.on("get", "/reports/admin-dashboard", {
      ...ADMIN,
      kpis: { ...ADMIN.kpis, unassigned_todo_count: 0, broken_total: 0 },
    });
    renderKpis([kpi({ metric: "overdue_todos" }, null, "c"), kpi({ metric: "stuck_approvals" }, null, "d")]);
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.queryByText(tc("dashboard.admin.metric.unassignedTodos", { count: 0 }))).toBeNull();
    expect(screen.queryByText(tc("dashboard.admin.metric.brokenApprovals", { count: 0 }))).toBeNull();
    expect(screen.queryByTestId("kpi-subtitle")).toBeNull();
  });

  it("opens the quality report from the overall quality tile", async () => {
    const { user } = renderKpis([kpi({ metric: "overall_quality" })]);
    const value = await screen.findByText("81%");
    await user.click(value);
    expect(await screen.findByText("quality report")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/reports/admin-dashboard")).toHaveLength(0);
  });

  it("shows the quality tile's link hint as its subtitle, and points at the tile", async () => {
    renderKpis([kpi({ metric: "overall_quality" })]);
    const value = await screen.findByText("81%");
    expect(screen.getByTestId("kpi-subtitle")).toHaveTextContent(tc("dashboard.admin.metric.overallQualityLink"));
    expect(value.closest(".MuiCard-root")).toHaveStyle({ cursor: "pointer" });
  });

  it("does not open the quality report while arranging: a drag released on it or a button click would", async () => {
    const onConfigure = vi.fn();
    const { user } = renderFramed([kpi({ metric: "overall_quality" })], true, { onConfigure });
    const value = await screen.findByText("81%");
    await user.click(value);
    await user.click(screen.getByTestId("widget-drag-handle"));
    await user.click(screen.getByRole("button", { name: tc("dashboard.widgets.configure") }));
    expect(onConfigure).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("quality report")).toBeNull();
    expect(value.closest(".MuiCard-root")).not.toHaveStyle({ cursor: "pointer" });
  });
});

describe("query KPI", () => {
  it("reads the generic endpoint and shows its trend window", async () => {
    mockApi.on("get", "/dashboards/kpi?card_type=Application&lifecycle_phase=active", {
      value: 42,
      trend: { previous: 40, delta_abs: 2, delta_pct: 5, comparison_days: 7, snapshot_date: "2026-10-21" },
    });
    renderKpis([
      kpi({ query: { card_type: "Application", lifecycle_phase: "active" }, good_direction: "down" }, "Active apps"),
    ]);
    expect(await screen.findByText("42")).toBeInTheDocument();
    expect(screen.getByText("Active apps")).toBeInTheDocument();
    expect(screen.getByText("(+2)")).toBeInTheDocument();
    expect(screen.getByText("+5.0%")).toHaveStyle({ color: "rgb(211, 47, 47)" });
    expect(screen.getByText(tc("dashboard.trend.vsDays", { count: 7 }))).toBeInTheDocument();
    // A query KPI needs no shared source.
    expect(mockApi.callsOf("get", "/reports/dashboard")).toHaveLength(0);
  });

  it("formats a percentage without a point change, and shows no trend for a restricted reader", async () => {
    mockApi.on("get", "/dashboards/kpi?metric=avg&metric_field=coverage", { value: 63.25, trend: null });
    renderKpis([kpi({ query: { metric: "avg", metric_field: "coverage" }, format: "percent" })]);
    expect(await screen.findByText("63.3%")).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.widgets.kpi"))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/vs last/)).toBeNull());
  });

  it("asks to be configured without a metric or query", () => {
    renderKpis([kpi({})]);
    expect(screen.getByText(tc("dashboard.widgets.notConfigured"))).toBeInTheDocument();
  });
});

describe("query KPI — sparkline, secondary figure, fiscal year", () => {
  const Q = "card_type=Application&flags=orphaned";

  it("never asks for the history without the sparkline", async () => {
    mockApi.on("get", `/dashboards/kpi?${Q}`, { value: 12, trend: null });
    renderKpis([kpi({ query: { card_type: "Application", flags: "orphaned" } })]);
    expect(await screen.findByText("12")).toBeInTheDocument();
    expect(mockApi.calls.filter((c) => c.path.startsWith("/dashboards/kpi-history"))).toHaveLength(0);
    expect(screen.queryByTestId("kpi-sparkline")).toBeNull();
  });

  it("draws 30 days of history under the number once there are two points", async () => {
    mockApi.on("get", `/dashboards/kpi?${Q}`, { value: 12, trend: null });
    mockApi.on("get", `/dashboards/kpi-history?${Q}&days=30`, {
      points: [
        { date: "2026-10-01", value: 9 },
        { date: "2026-10-02", value: 12 },
      ],
    });
    renderKpis([kpi({ query: { card_type: "Application", flags: "orphaned" }, sparkline: true })]);
    expect(await screen.findByTestId("kpi-sparkline")).toBeInTheDocument();
    expect(mockApi.callsOf("get", `/dashboards/kpi-history?${Q}&days=30`)).toHaveLength(1);
    const option = echart.options.at(-1);
    expect(option.series[0].data).toEqual([9, 12]);
    expect(option.xAxis.show).toBe(false);
  });

  it("hides the sparkline with fewer than two points", async () => {
    mockApi.on("get", `/dashboards/kpi?${Q}`, { value: 12, trend: null });
    mockApi.on("get", `/dashboards/kpi-history?${Q}&days=30`, { points: [{ date: "2026-10-02", value: 12 }] });
    renderKpis([kpi({ query: { card_type: "Application", flags: "orphaned" }, sparkline: true })]);
    expect(await screen.findByText("12")).toBeInTheDocument();
    await waitFor(() => expect(mockApi.callsOf("get", `/dashboards/kpi-history?${Q}&days=30`)).toHaveLength(1));
    expect(screen.queryByTestId("kpi-sparkline")).toBeNull();
    expect(screen.queryByTestId("echart")).toBeNull();
  });

  it("shows the share of the unfiltered count, or the count itself", async () => {
    mockApi.on("get", `/dashboards/kpi?${Q}`, { value: 41, trend: null, base: 340 });
    const { unmount } = renderKpis([
      kpi({ query: { card_type: "Application", flags: "orphaned" }, secondary: "share_of_total" }),
    ]);
    expect(await screen.findByText(tc("dashboard.kpi.shareOfBase", { pct: 12, base: 340 }))).toBeInTheDocument();
    unmount();
    renderKpis([kpi({ query: { card_type: "Application", flags: "orphaned" }, secondary: "base_count" })]);
    expect(await screen.findByText(tc("dashboard.kpi.ofBase", { base: 340 }))).toBeInTheDocument();
  });

  it("shows no secondary figure without a base", async () => {
    mockApi.on("get", `/dashboards/kpi?${Q}`, { value: 41, trend: null });
    renderKpis([kpi({ query: { card_type: "Application", flags: "orphaned" }, secondary: "share_of_total" })]);
    expect(await screen.findByText("41")).toBeInTheDocument();
    expect(screen.queryByTestId("kpi-caption")).toBeNull();
  });

  it("names the fiscal year a cost is counted for", async () => {
    mockApi.on("get", "/dashboards/kpi?card_type=Application&metric=sum&metric_field=costTotalAnnual", {
      value: 1000,
      trend: null,
      fiscal_year: 2026,
      fiscal_year_start: 10,
    });
    renderKpis([kpi({ query: { card_type: "Application", metric: "sum", metric_field: "costTotalAnnual" } })]);
    expect(
      await screen.findByText(tc("dashboard.config.fiscalYear", { year: tc("fiscalYear.span", { from: 2025, to: 2026 }) })),
    ).toBeInTheDocument();
  });

  it("reads a share as a percentage", async () => {
    mockApi.on("get", "/dashboards/kpi?approval_status=APPROVED&metric=share", { value: 37.5, trend: null });
    renderKpis([kpi({ query: { metric: "share", approval_status: "APPROVED" }, format: "number" })]);
    expect(await screen.findByText("37.5%")).toBeInTheDocument();
  });

  it("says what the server refused", async () => {
    mockApi.fail("get", "/dashboards/kpi?flags=bogus", 400, "unknown_flag");
    renderKpis([kpi({ query: { flags: "bogus" } })]);
    expect(await screen.findByText(tc("dashboard.config.problem.unknownFlag"))).toBeInTheDocument();
  });

  it("secondaryCaption", () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}:${JSON.stringify(o)}`;
    expect(secondaryCaption(undefined, 1, 2, t)).toBeNull();
    expect(secondaryCaption("base_count", 1, undefined, t)).toBeNull();
    expect(secondaryCaption("share_of_total", 1, 0, t)).toBe('dashboard.kpi.shareOfBase:{"pct":0,"base":0}');
    expect(secondaryCaption("share_of_total", 1, 3, t)).toBe('dashboard.kpi.shareOfBase:{"pct":33,"base":3}');
  });
});

describe("module KPI", () => {
  it("reads its number off the shared report, with no trend", async () => {
    mockApi.on("get", "/risks/metrics", {
      total: 10,
      by_status: { closed: 2, accepted: 1 },
      by_level: {},
      by_category: {},
      overdue: 4,
    });
    renderKpis([
      kpi({ source: "risks_metrics", series: "open" }, null, "a"),
      kpi({ source: "risks_metrics", series: "overdue" }, null, "b"),
    ]);
    expect(await screen.findByText("7")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.source.series.risks_metrics.open"))).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/risks/metrics")).toHaveLength(1);
    expect(screen.queryByText(/vs last/)).toBeNull();
    expect(mockApi.calls.filter((c) => c.path.startsWith("/dashboards/"))).toHaveLength(0);
  });

  it("formats a compliance score as a percentage", async () => {
    mockApi.on("get", "/compliance/overview", { compliance_scores: { gdpr: 80, nis2: 65 } });
    renderKpis([kpi({ source: "compliance_overview", series: "score_avg", format: "percent" })]);
    expect(await screen.findByText("72.5%")).toBeInTheDocument();
  });

  it("reports a failed report", async () => {
    mockApi.fail("get", "/reports/bpm/dashboard", 500);
    renderKpis([kpi({ source: "bpm_dashboard", series: "without_diagram" })]);
    expect(await screen.findByText("—")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("formatKpiValue", () => {
    expect(formatKpiValue(3)).toBe("3");
    expect(formatKpiValue(3.14, "number")).toBe("3.1");
    expect(formatKpiValue(50, "percent")).toBe("50%");
    expect(formatKpiValue(null)).toBe("—");
    expect(formatKpiValue(undefined)).toBe("—");
    expect(formatKpiValue(Number.NaN)).toBe("—");
  });

  it("qualityColor uses the three quality bands", () => {
    expect(qualityColor(75)).toBe(DASHBOARD_KPI_COLORS.qualityGood);
    expect(qualityColor(74)).toBe(DASHBOARD_KPI_COLORS.qualityFair);
    expect(qualityColor(50)).toBe(DASHBOARD_KPI_COLORS.qualityFair);
    expect(qualityColor(49)).toBe(DASHBOARD_KPI_COLORS.qualityPoor);
  });
});
