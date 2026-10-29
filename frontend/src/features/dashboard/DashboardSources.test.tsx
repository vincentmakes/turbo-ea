import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import type { DashboardWidget, WidgetType } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders, userWith } from "@/test/render";
import { DashboardSourcesProvider, useDashboardSource } from "./DashboardSources";

function w(type: WidgetType, config: Record<string, unknown> = {}): DashboardWidget {
  return { id: `${type}-${JSON.stringify(config)}`, type, title: null, config, layout: { x: 0, y: 0, w: 3, h: 2 } };
}

function Probe() {
  const dashboard = useDashboardSource("reports.dashboard");
  const workspace = useDashboardSource("my_workspace");
  const admin = useDashboardSource("admin_dashboard");
  const quality = useDashboardSource("data_quality");
  return (
    <div data-testid="probe">
      {JSON.stringify({
        dashboard: dashboard.data ?? null,
        workspace: workspace.data ?? null,
        admin: admin.data ?? null,
        quality: quality.data ?? null,
        error: dashboard.error ? dashboard.error.message : null,
      })}
    </div>
  );
}

const probe = () => JSON.parse(screen.getByTestId("probe").textContent ?? "{}");

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/reports/dashboard", { total_cards: 1 });
  mockApi.on("get", "/reports/my-workspace", { favorite_count: 2 });
  mockApi.on("get", "/reports/admin-dashboard", { kpis: {} });
  mockApi.on("get", "/reports/data-quality", { overall_data_quality: 50 });
});

describe("DashboardSourcesProvider", () => {
  it("fetches each needed source once, and nothing else", async () => {
    renderWithProviders(
      <DashboardSourcesProvider
        widgets={[w("kpi", { metric: "total_cards" }), w("kpi", { metric: "broken_count" }), w("recent_activity"), w("my_created")]}
      >
        <Probe />
      </DashboardSourcesProvider>,
    );
    await waitFor(() => expect(probe().workspace).toEqual({ favorite_count: 2 }));
    expect(probe().dashboard).toEqual({ total_cards: 1 });
    expect(probe().admin).toBeNull();
    expect(probe().quality).toBeNull();
    expect(mockApi.callsOf("get", "/reports/dashboard")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/reports/my-workspace")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/reports/admin-dashboard")).toHaveLength(0);
    expect(mockApi.callsOf("get", "/reports/data-quality")).toHaveLength(0);
  });

  it("never fetches a source only a widget the viewer may not see needs", async () => {
    renderWithProviders(
      <DashboardSourcesProvider
        widgets={[w("idle_users"), w("kpi", { metric: "overall_quality" }), w("kpi", { metric: "total_cards" }), w("my_created")]}
      >
        <Probe />
      </DashboardSourcesProvider>,
      { user: userWith() },
    );
    await waitFor(() => expect(probe().workspace).toEqual({ favorite_count: 2 }));
    expect(mockApi.callsOf("get", "/reports/admin-dashboard")).toHaveLength(0);
    expect(mockApi.callsOf("get", "/reports/data-quality")).toHaveLength(0);
    expect(mockApi.callsOf("get", "/reports/dashboard")).toHaveLength(0);
  });

  it("fetches the admin sources for an admin", async () => {
    renderWithProviders(
      <DashboardSourcesProvider widgets={[w("idle_users"), w("kpi", { metric: "overall_quality" })]}>
        <Probe />
      </DashboardSourcesProvider>,
    );
    await waitFor(() => expect(probe().quality).toEqual({ overall_data_quality: 50 }));
    expect(probe().admin).toEqual({ kpis: {} });
  });

  it("exposes a source's error", async () => {
    mockApi.fail("get", "/reports/dashboard", 500);
    renderWithProviders(
      <DashboardSourcesProvider widgets={[w("browse_by_type")]}>
        <Probe />
      </DashboardSourcesProvider>,
    );
    await waitFor(() => expect(probe().error).toEqual(expect.any(String)));
    expect(probe().dashboard).toBeNull();
  });
});

describe("module sources", () => {
  const ALL = { bpm: true, ppm: true, grc: true };
  const MODULE_PATHS = ["/risks/metrics", "/compliance/overview", "/reports/ppm/dashboard", "/reports/bpm/dashboard"];

  function ModuleProbe() {
    const risks = useDashboardSource("risks_metrics");
    const ppm = useDashboardSource("ppm_dashboard");
    return <div data-testid="module-probe">{JSON.stringify({ risks: risks.data ?? null, ppm: ppm.data ?? null })}</div>;
  }
  const moduleProbe = () => JSON.parse(screen.getByTestId("module-probe").textContent ?? "{}");

  beforeEach(() => {
    mockApi.on("get", "/risks/metrics", { total: 4 });
    mockApi.on("get", "/compliance/overview", { compliance_scores: {} });
    mockApi.on("get", "/reports/ppm/dashboard", { total_initiatives: 2 });
    mockApi.on("get", "/reports/bpm/dashboard", { total_processes: 1 });
  });

  it("fetches a module's report once when a visible widget reads it and the module is on", async () => {
    renderWithProviders(
      <DashboardSourcesProvider
        widgets={[
          w("kpi", { source: "risks_metrics", series: "open" }),
          w("chart", { source: "risks_metrics", series: "by_level", chart: "donut" }),
          w("kpi", { source: "ppm_dashboard", series: "at_risk" }),
        ]}
        modules={ALL}
      >
        <ModuleProbe />
      </DashboardSourcesProvider>,
    );
    await waitFor(() => expect(moduleProbe()).toEqual({ risks: { total: 4 }, ppm: { total_initiatives: 2 } }));
    expect(mockApi.callsOf("get", "/risks/metrics")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/reports/ppm/dashboard")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/compliance/overview")).toHaveLength(0);
    expect(mockApi.callsOf("get", "/reports/bpm/dashboard")).toHaveLength(0);
  });

  it("never fetches a module's report while the module is off — the default", async () => {
    const widgets = [
      w("kpi", { source: "risks_metrics", series: "open" }),
      w("kpi", { source: "ppm_dashboard", series: "at_risk" }),
      w("my_created"),
    ];
    const { unmount } = renderWithProviders(
      <DashboardSourcesProvider widgets={widgets}>
        <Probe />
      </DashboardSourcesProvider>,
    );
    await waitFor(() => expect(probe().workspace).toEqual({ favorite_count: 2 }));
    unmount();
    renderWithProviders(
      <DashboardSourcesProvider widgets={widgets} modules={{ bpm: true, ppm: false, grc: false }}>
        <Probe />
      </DashboardSourcesProvider>,
    );
    await waitFor(() => expect(probe().workspace).toEqual({ favorite_count: 2 }));
    for (const p of MODULE_PATHS) expect(mockApi.callsOf("get", p), p).toHaveLength(0);
  });

  it("never fetches a module's report the viewer may not read", async () => {
    renderWithProviders(
      <DashboardSourcesProvider
        widgets={[w("kpi", { source: "risks_metrics", series: "open" }), w("my_created")]}
        modules={ALL}
      >
        <Probe />
      </DashboardSourcesProvider>,
      { user: userWith() },
    );
    await waitFor(() => expect(probe().workspace).toEqual({ favorite_count: 2 }));
    expect(mockApi.callsOf("get", "/risks/metrics")).toHaveLength(0);
  });
});

describe("useDashboardSource outside a provider", () => {
  it("fetches the source itself", async () => {
    function Lone() {
      const { data } = useDashboardSource("data_quality");
      return <div>{data ? `q=${data.overall_data_quality}` : "…"}</div>;
    }
    renderWithProviders(<Lone />);
    expect(await screen.findByText("q=50")).toBeInTheDocument();
    expect(mockApi.calls).toHaveLength(1);
  });
});
