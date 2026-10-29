import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardWidget, User } from "@/types";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { CARD_TYPES, RELATION_TYPES, makeCardType, makeRelationType } from "@/test/fixtures/metamodel";
import { hookState, withMetamodel } from "@/test/hooks";
import { adminUser, renderWithProviders, userWith } from "@/test/render";
import AddWidgetDrawer from "./AddWidgetDrawer";

const tc = (k: string) => i18n.t(`common:${k}`) as string;

const ON_DASHBOARD: DashboardWidget[] = [
  { id: "a", type: "recent_activity", title: null, config: {}, layout: { x: 0, y: 0, w: 6, h: 6 } },
  { id: "b", type: "kpi", title: null, config: { metric: "total_cards" }, layout: { x: 0, y: 6, w: 3, h: 2 } },
  { id: "c", type: "chart", title: null, config: { title_key: "dashboard.cardsByType" }, layout: { x: 3, y: 6, w: 6, h: 5 } },
];

function renderDrawer(user: User = adminUser(), widgets = ON_DASHBOARD) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const result = renderWithProviders(<AddWidgetDrawer open widgets={widgets} onClose={onClose} onPick={onPick} />, {
    user,
  });
  return { ...result, onPick, onClose };
}

const entry = (id: string) => screen.getByTestId(`catalogue-${id}`);

beforeEach(() => {
  hookState.reset();
  withMetamodel(CARD_TYPES, RELATION_TYPES);
});

describe("AddWidgetDrawer", () => {
  it("groups the catalogue by family, in order", () => {
    renderDrawer();
    const headers = screen.getAllByRole("listitem").filter((li) => li.classList.contains("MuiListSubheader-root"));
    expect(headers.map((h) => h.textContent)).toEqual(
      ["kpi", "chart", "overview", "workspace", "admin"].map((f) => tc(`dashboard.widgets.family.${f}`)),
    );
  });

  it("greys single widgets already on the dashboard", () => {
    renderDrawer();
    for (const id of ["recent_activity", "kpi:total_cards", "chart:cards_by_type"]) {
      expect(entry(id)).toHaveAttribute("aria-disabled", "true");
      expect(entry(id)).toHaveTextContent(tc("dashboard.customize.alreadyAdded"));
    }
    for (const id of ["browse_by_type", "kpi:broken_count", "chart:lifecycle", "kpi", "chart"]) {
      expect(entry(id)).not.toHaveAttribute("aria-disabled");
    }
    expect(entry("chart")).toHaveTextContent(tc("dashboard.customize.needsConfig"));
  });

  it("lists only what the viewer could see", () => {
    renderDrawer(userWith("admin.dashboards"), []);
    expect(entry("my_todos")).toBeInTheDocument();
    expect(entry("kpi:favorites")).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-chart")).not.toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-top_contributors")).not.toBeInTheDocument();
    expect(screen.queryByText(tc("dashboard.widgets.family.admin"))).not.toBeInTheDocument();
    expect(screen.queryByText(tc("dashboard.widgets.family.chart"))).not.toBeInTheDocument();
  });

  it("hands the picked entry to the page", async () => {
    const { user, onPick } = renderDrawer();
    await user.click(entry("my_favorites"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ id: "my_favorites", type: "my_favorites", needsConfig: false });
    await user.click(entry("chart"));
    expect(onPick.mock.calls[1][0]).toMatchObject({ id: "chart", type: "chart", needsConfig: true });
  });

  it("closes", async () => {
    const { user, onClose } = renderDrawer();
    await user.click(screen.getByRole("button", { name: tc("actions.close") }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("AddWidgetDrawer — module tiles", () => {
  it("offers a module's tiles only while the module is on, greyed once added", async () => {
    const tile: DashboardWidget = {
      id: "r",
      type: "kpi",
      title: null,
      config: { source: "risks_metrics", series: "open" },
      layout: { x: 0, y: 8, w: 3, h: 2 },
    };
    const { unmount } = renderDrawer();
    expect(screen.queryByTestId("catalogue-kpi:risks_metrics:open")).toBeNull();
    unmount();
    renderWithProviders(
      <AddWidgetDrawer
        open
        widgets={[tile]}
        modules={{ bpm: false, ppm: false, grc: true }}
        onClose={() => {}}
        onPick={() => {}}
      />,
      { user: adminUser() },
    );
    expect(entry("kpi:risks_metrics:open")).toHaveAttribute("aria-disabled", "true");
    expect(entry("chart:risks_metrics:by_level")).not.toHaveAttribute("aria-disabled");
    expect(entry("chart:risks_metrics:by_level")).toHaveTextContent(tc("dashboard.source.chart.risksByLevel"));
    expect(screen.queryByTestId("catalogue-chart:bpm_dashboard:by_maturity")).toBeNull();
  });
});

describe("AddWidgetDrawer — metamodel presets", () => {
  it("offers the presets the landscape has pieces for, greyed once added", async () => {
    withMetamodel(
      [...CARD_TYPES, makeCardType({ key: "Organization" })],
      [...RELATION_TYPES, makeRelationType({ key: "relOrgToApp", source_type_key: "Organization", target_type_key: "Application" })],
    );
    const stale: DashboardWidget = {
      id: "s",
      type: "chart",
      title: null,
      config: { query: { group_by: "type", flags: "stale" }, chart: "bar", title_key: "dashboard.preset.staleByType" },
      layout: { x: 0, y: 0, w: 6, h: 5 },
    };
    const { user, onPick } = renderDrawer(adminUser(), [stale]);
    expect(entry("chart:organization_to_application")).toHaveTextContent(tc("dashboard.preset.organizationToApplication"));
    expect(entry("chart:stale_by_type")).toHaveAttribute("aria-disabled", "true");
    // No cost-per-application treemap, even for an admin who reads costs.
    expect(screen.queryByTestId("catalogue-chart:cost_per_application")).toBeNull();
    await user.click(entry("chart:end_of_life_calendar"));
    expect(onPick.mock.calls[0][0].config).toMatchObject({
      query: { card_type: "Application", group_by: "phase_month:endOfLife" },
      chart: "column",
    });
  });

  it("leaves out the relation presets without an Organization type", () => {
    renderDrawer(userWith("reports.ea_dashboard", "admin.dashboards"), []);
    expect(entry("chart:end_of_life_calendar")).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-chart:applications_per_organization")).toBeNull();
    expect(screen.queryByTestId("catalogue-chart:organization_to_application")).toBeNull();
  });
});
