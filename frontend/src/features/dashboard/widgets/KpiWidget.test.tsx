import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardData, DashboardWidget } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import { DASHBOARD_KPI_COLORS } from "@/theme/tokens";
import { DashboardSourcesProvider } from "../DashboardSources";
import KpiWidget from "./KpiWidget";
import WidgetFrame from "./WidgetFrame";
import { formatKpiValue, qualityColor } from "./kpiPresets";

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

function renderKpis(widgets: DashboardWidget[], route = "/") {
  return renderWithProviders(
    <DashboardSourcesProvider widgets={widgets}>
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

beforeEach(() => {
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

  it("draws a compact tile inside a frame in customize mode, keeping the window caption", async () => {
    const widget = kpi({ metric: "total_cards" });
    renderWithProviders(
      <DashboardSourcesProvider widgets={[widget]}>
        <WidgetFrame widget={widget} editing>
          <KpiWidget widget={widget} />
        </WidgetFrame>
      </DashboardSourcesProvider>,
    );
    const value = await screen.findByText("120");
    expect(value).toHaveClass("MuiTypography-h5");
    expect(value.closest("[data-compact]")).not.toBeNull();
    expect(screen.getByText(tc("dashboard.trend.vsDays", { count: 14 }))).toBeInTheDocument();
  });

  it("draws the full-size tile outside customize mode", async () => {
    renderKpis([kpi({ metric: "total_cards" })]);
    const value = await screen.findByText("120");
    expect(value).toHaveClass("MuiTypography-h4");
    expect(value.closest("[data-compact]")).toBeNull();
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

  it("drops a subtitle with nothing to say", async () => {
    mockApi.on("get", "/reports/admin-dashboard", {
      ...ADMIN,
      kpis: { ...ADMIN.kpis, unassigned_todo_count: 0, broken_total: 0 },
    });
    renderKpis([kpi({ metric: "overdue_todos" }, null, "c"), kpi({ metric: "stuck_approvals" }, null, "d")]);
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.queryByText(tc("dashboard.admin.metric.unassignedTodos", { count: 0 }))).toBeNull();
    expect(screen.queryByText(tc("dashboard.admin.metric.brokenApprovals", { count: 0 }))).toBeNull();
  });

  it("opens the quality report from the overall quality tile", async () => {
    const { user } = renderKpis([kpi({ metric: "overall_quality" })]);
    const value = await screen.findByText("81%");
    await user.click(value);
    expect(await screen.findByText("quality report")).toBeInTheDocument();
    expect(mockApi.callsOf("get", "/reports/admin-dashboard")).toHaveLength(0);
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
