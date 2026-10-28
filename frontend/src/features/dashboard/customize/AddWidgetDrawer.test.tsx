import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import i18n from "@/i18n";
import type { DashboardWidget, User } from "@/types";
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
