import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router";
import i18n from "@/i18n";
import type { Dashboard as DashboardModel, DashboardWidget, User } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- stubs capture their props as plain data */

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("@/hooks/useBpmEnabled", () => import("@/test/hooks").then((m) => m.useBpmEnabledModule()));
vi.mock("@/hooks/usePpmEnabled", () => import("@/test/hooks").then((m) => m.usePpmEnabledModule()));
vi.mock("@/hooks/useGrcEnabled", () => import("@/test/hooks").then((m) => m.useGrcEnabledModule()));
// The Add-widget drawer resolves its metamodel-aware presets while open.
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

const grid = vi.hoisted(() => ({ props: null as any }));
vi.mock("./DashboardGrid", () => ({
  default: (props: any) => {
    grid.props = props;
    return (
      <div data-testid="grid" data-editing={String(props.editing)}>
        {props.widgets.map((w: DashboardWidget) => (
          <span key={w.id}>{`widget:${w.id}`}</span>
        ))}
      </div>
    );
  },
}));
vi.mock("./DashboardSources", () => ({
  DashboardSourcesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
const menu = vi.hoisted(() => ({ props: null as any }));
vi.mock("./customize/DashboardsMenu", () => ({
  default: (props: any) => {
    menu.props = props;
    return <div data-testid="dashboards-menu">{props.label}</div>;
  },
}));
vi.mock("./customize/WidgetConfigDialog", () => ({
  default: (p: any) =>
    p.open && p.widget ? (
      <div data-testid="config-dialog" data-mode={p.mode} data-widget={p.widget.id}>
        <button onClick={() => p.onSave({ ...p.widget, title: "Configured" })}>stub-save</button>
        <button onClick={p.onClose}>stub-close</button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { hookState } from "@/test/hooks";
import { makeUser, renderWithProviders } from "@/test/render";
import Dashboard from "./Dashboard";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

function w(id: string, type: DashboardWidget["type"], config: Record<string, unknown> = {}, y = 0): DashboardWidget {
  return { id, type, title: null, config, layout: { x: 0, y, w: 6, h: 6 } };
}

function dash(key: string, widgets: DashboardWidget[], extra: Partial<DashboardModel> = {}): DashboardModel {
  return {
    id: `id-${key}`,
    key,
    name: key[0].toUpperCase() + key.slice(1),
    translations: {},
    description: null,
    icon: null,
    built_in: true,
    is_hidden: false,
    sort_order: 0,
    widgets,
    can_manage: false,
    ...extra,
  };
}

const OVERVIEW = dash("overview", [w("kpi-total", "kpi", { metric: "total_cards" }), w("chart-type", "chart", { query: { group_by: "type" }, chart: "bar" })], {
  translations: { fr: "Vue d'ensemble" },
});
const WORKSPACE = dash("workspace", [w("todos", "my_todos"), w("roles", "my_roles", {}, 6)], { sort_order: 1 });
const ADMIN = dash("admin", [w("contributors", "top_contributors")], { sort_order: 2 });
const TEAM = dash("team", [w("team-todos", "my_todos")], { built_in: false, is_hidden: true, sort_order: 3 });
const EMPTY = dash("empty", [], { built_in: false, sort_order: 4 });

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderDashboard(
  user: User,
  { route = "/", dashboards = [OVERVIEW, WORKSPACE, ADMIN] }: { route?: string; dashboards?: DashboardModel[] } = {},
) {
  mockApi.on("get", "/dashboards", dashboards);
  const refreshUser = vi.fn(async () => {});
  const result = renderWithProviders(
    <>
      <Dashboard />
      <LocationProbe />
    </>,
    { route, user, refreshUser },
  );
  return { ...result, refreshUser };
}

const member = (permissions: Record<string, boolean>, extra: Partial<User> = {}) =>
  makeUser({ id: "member-1", role: "member", permissions, ...extra });
const manager = (extra: Record<string, boolean> = {}) =>
  member({ "admin.dashboards": true, "reports.ea_dashboard": true, "admin.users": true, ...extra });

const tabNames = () =>
  screen.getAllByRole("tab").map((tab) => tab.querySelector(".dashboard-tab-label")?.textContent);
/** A button by its text; the Material Symbol ligature of its icon is part of its accessible name. */
const button = (key: string) => screen.getByRole("button", { name: new RegExp(`${tc(key)}$`) });
const queryButton = (key: string) => screen.queryByRole("button", { name: new RegExp(`${tc(key)}$`) });
const location = () => screen.getByTestId("location").textContent;

beforeEach(() => {
  mockApi.reset();
  hookState.reset();
  grid.props = null;
  menu.props = null;
});

describe("Dashboard tabs", () => {
  it("shows one tab per dashboard in API order, opens on the first and writes it to the URL", async () => {
    renderDashboard(member({ "reports.ea_dashboard": true, "admin.users": true }));
    await waitFor(() => expect(tabNames()).toEqual(["Overview", "Workspace", "Admin"]));
    expect(screen.getByText("widget:kpi-total")).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe("?tab=overview"));
  });

  it("names a dashboard in the reader's language", async () => {
    await act(() => i18n.changeLanguage("fr"));
    try {
      renderDashboard(member({ "reports.ea_dashboard": true }));
      await waitFor(() => expect(tabNames()[0]).toBe("Vue d'ensemble"));
      expect(tabNames()[1]).toBe("Workspace");
    } finally {
      await act(() => i18n.changeLanguage("en"));
    }
  });

  it("hides a tab with no widget the viewer may see, and opens on the next one", async () => {
    renderDashboard(member({}));
    await waitFor(() => expect(tabNames()).toEqual(["Workspace"]));
    expect(screen.getByText("widget:todos")).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe("?tab=workspace"));
  });

  it("passes the grid only the widgets the viewer may see", async () => {
    const mixed = dash("mixed", [w("todos", "my_todos"), w("contributors", "top_contributors")]);
    renderDashboard(member({}), { dashboards: [mixed] });
    await screen.findByText("widget:todos");
    expect(grid.props.widgets.map((x: DashboardWidget) => x.id)).toEqual(["todos"]);
    expect(screen.queryByText("widget:contributors")).not.toBeInTheDocument();
  });

  it("falls back from a ?tab= the viewer may not see without rewriting the link", async () => {
    renderDashboard(member({ "reports.ea_dashboard": true }), { route: "/?tab=admin" });
    await screen.findByText("widget:kpi-total");
    expect(screen.queryByText("widget:contributors")).not.toBeInTheDocument();
    expect(location()).toBe("?tab=admin");
  });

  it("opens on the pinned dashboard, unless ?tab= says otherwise", async () => {
    const user = member({ "reports.ea_dashboard": true }, { ui_preferences: { dashboard_default_tab: "workspace" } });
    const { unmount } = renderDashboard(user);
    await screen.findByText("widget:todos");
    await waitFor(() => expect(location()).toBe("?tab=workspace"));
    unmount();
    renderDashboard(user, { route: "/?tab=overview" });
    expect(await screen.findByText("widget:kpi-total")).toBeInTheDocument();
  });

  it("ignores a stale pin (a dashboard that is gone)", async () => {
    renderDashboard(member({ "reports.ea_dashboard": true }, { ui_preferences: { dashboard_default_tab: "deleted" } }));
    await screen.findByText("widget:kpi-total");
    await waitFor(() => expect(location()).toBe("?tab=overview"));
  });

  it("switches dashboards from the tabs", async () => {
    const { user } = renderDashboard(member({ "reports.ea_dashboard": true }));
    await screen.findByText("widget:kpi-total");
    await user.click(screen.getByRole("tab", { name: /Workspace/ }));
    expect(await screen.findByText("widget:todos")).toBeInTheDocument();
    expect(location()).toBe("?tab=workspace");
  });

  it("pins a dashboard as the default", async () => {
    mockApi.on("patch", "/users/me/ui-preferences", {});
    const { user, refreshUser } = renderDashboard(member({ "reports.ea_dashboard": true }));
    await screen.findByText("widget:kpi-total");
    // The first tab is the implicit default; the others offer "Pin".
    const pins = screen.getAllByLabelText(tc("dashboard.pinAsDefault"));
    expect(pins).toHaveLength(1);
    await user.click(pins[0]);
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/users/me/ui-preferences")).toEqual([
        { method: "patch", path: "/users/me/ui-preferences", body: { dashboard_default_tab: "workspace" } },
      ]),
    );
    expect(refreshUser).toHaveBeenCalled();
  });

  it("unpins the default dashboard", async () => {
    mockApi.on("patch", "/users/me/ui-preferences", {});
    const { user } = renderDashboard(
      member({ "reports.ea_dashboard": true }, { ui_preferences: { dashboard_default_tab: "workspace" } }),
    );
    await screen.findByText("widget:todos");
    await user.click(screen.getByLabelText(tc("dashboard.unpinDefault")));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", "/users/me/ui-preferences")[0].body).toEqual({ dashboard_default_tab: null }),
    );
  });

  it("says so when the dashboards cannot be loaded", async () => {
    mockApi.fail("get", "/dashboards", 500);
    renderWithProviders(<Dashboard />, { user: member({}) });
    expect(await screen.findByText(tc("dashboard.loadFailed"))).toBeInTheDocument();
  });
});

describe("module widgets", () => {
  const RISKS = dash("risks", [
    w("open-risks", "kpi", { source: "risks_metrics", series: "open" }),
    w("bpm-maturity", "chart", { source: "bpm_dashboard", series: "by_maturity", chart: "column" }, 6),
  ]);
  const viewer = () => member({ "risks.view": true, "reports.bpm_dashboard": true });

  it("shows a module's widgets only while its module is on", async () => {
    hookState.bpm = { bpmEnabled: false, bpmLoaded: true };
    renderDashboard(viewer(), { dashboards: [RISKS] });
    expect(await screen.findByText("widget:open-risks")).toBeInTheDocument();
    expect(screen.queryByText("widget:bpm-maturity")).toBeNull();
  });

  it("treats a module flag that has not loaded yet as off, so nothing flashes", async () => {
    hookState.grc = { grcEnabled: true, grcLoaded: false };
    hookState.bpm = { bpmEnabled: true, bpmLoaded: false };
    renderDashboard(viewer(), { dashboards: [RISKS, WORKSPACE] });
    await waitFor(() => expect(tabNames()).toEqual(["Workspace"]));
  });
});

describe("Dashboard management", () => {
  it("offers neither Customize nor the menu to a non-manager", async () => {
    renderDashboard(member({ "reports.ea_dashboard": true, "admin.users": true }));
    await screen.findByText("widget:kpi-total");
    expect(queryButton("dashboard.customize.customize")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboards-menu")).not.toBeInTheDocument();
  });

  it("shows a manager every dashboard, hidden and empty ones included, and the menu", async () => {
    renderDashboard(manager(), { dashboards: [OVERVIEW, WORKSPACE, ADMIN, TEAM, EMPTY] });
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(5));
    const hiddenTab = screen.getByRole("tab", { name: /Team/ });
    expect(within(hiddenTab).getByText(tc("dashboard.menu.hiddenChip"))).toBeInTheDocument();
    expect(within(screen.getByRole("tab", { name: /Overview/ })).queryByText(tc("dashboard.menu.hiddenChip"))).toBeNull();
    expect(button("dashboard.customize.customize")).toBeInTheDocument();
    expect(screen.getByTestId("dashboards-menu")).toHaveTextContent("Overview");
    expect(menu.props.dashboard).toEqual(OVERVIEW);
    expect(menu.props.dashboards.map((d: DashboardModel) => d.key)).toEqual(["overview", "workspace", "admin", "team", "empty"]);
  });

  it("tells a manager how to fill an empty dashboard", async () => {
    renderDashboard(manager(), { route: "/?tab=empty", dashboards: [OVERVIEW, EMPTY] });
    expect(await screen.findByText(tc("dashboard.customize.empty"))).toBeInTheDocument();
    expect(screen.getByText(tc("dashboard.customize.emptyHint"))).toBeInTheDocument();
    expect(screen.queryByTestId("grid")).not.toBeInTheDocument();
  });

  it("saves a rearranged layout with one PATCH and leaves customize mode", async () => {
    mockApi.on("patch", "/dashboards/id-workspace", (_p: string, body: any) => ({ ...WORKSPACE, ...body }));
    const { user } = renderDashboard(manager(), { route: "/?tab=workspace" });
    await screen.findByText("widget:todos");
    await user.click(button("dashboard.customize.customize"));

    expect(screen.getByTestId("grid")).toHaveAttribute("data-editing", "true");
    expect(screen.getByText(tc("dashboard.customize.editingHint"))).toBeInTheDocument();
    expect(screen.queryByTestId("dashboards-menu")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Overview/ })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /Workspace/ })).toBeEnabled();
    const save = screen.getByRole("button", { name: tc("actions.save") });
    expect(save).toBeDisabled();
    expect(screen.getByRole("button", { name: tc("actions.done") })).toBeInTheDocument();

    const moved = [{ ...WORKSPACE.widgets[0], layout: { x: 6, y: 0, w: 6, h: 6 } }, WORKSPACE.widgets[1]];
    act(() => grid.props.onLayoutChange(moved));
    expect(screen.getByText(tc("dashboard.customize.unsavedChanges"))).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(screen.getByTestId("grid")).toHaveAttribute("data-editing", "false"));
    expect(mockApi.callsOf("patch", "/dashboards/id-workspace")).toEqual([
      { method: "patch", path: "/dashboards/id-workspace", body: { widgets: moved } },
    ]);
    // The page refetched the list after saving.
    await waitFor(() => expect(mockApi.callsOf("get", "/dashboards")).toHaveLength(2));
  });

  it("keeps the widgets the manager cannot see when saving", async () => {
    mockApi.on("patch", "/dashboards/id-mixed", (_p: string, body: any) => body);
    const mixed = dash("mixed", [w("todos", "my_todos"), w("contributors", "top_contributors"), w("roles", "my_roles")]);
    const { user } = renderDashboard(member({ "admin.dashboards": true }), { dashboards: [mixed] });
    await screen.findByText("widget:todos");
    await user.click(button("dashboard.customize.customize"));
    expect(grid.props.widgets.map((x: DashboardWidget) => x.id)).toEqual(["todos", "roles"]);
    act(() => grid.props.onRemove(mixed.widgets[0]));
    expect(grid.props.widgets.map((x: DashboardWidget) => x.id)).toEqual(["roles"]);
    act(() => grid.props.onLayoutChange([{ ...mixed.widgets[2], layout: { x: 3, y: 0, w: 6, h: 6 } }]));
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/dashboards/id-mixed")).toHaveLength(1));
    expect(mockApi.callsOf("patch", "/dashboards/id-mixed")[0].body).toEqual({
      widgets: [mixed.widgets[1], { ...mixed.widgets[2], layout: { x: 3, y: 0, w: 6, h: 6 } }],
    });
  });

  it("discards changes", async () => {
    const { user } = renderDashboard(manager(), { route: "/?tab=workspace" });
    await screen.findByText("widget:todos");
    await user.click(button("dashboard.customize.customize"));
    act(() => grid.props.onRemove(WORKSPACE.widgets[0]));
    expect(screen.queryByText("widget:todos")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: tc("dashboard.customize.discard") }));
    expect(screen.getByText("widget:todos")).toBeInTheDocument();
    expect(screen.getByTestId("grid")).toHaveAttribute("data-editing", "false");
    expect(mockApi.callsOf("patch")).toEqual([]);
  });

  it("reports a failed save and stays in customize mode", async () => {
    mockApi.fail("patch", "/dashboards/id-workspace", 422, "invalid");
    const { user } = renderDashboard(manager(), { route: "/?tab=workspace" });
    await screen.findByText("widget:todos");
    await user.click(button("dashboard.customize.customize"));
    act(() => grid.props.onRemove(WORKSPACE.widgets[1]));
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    expect(await screen.findByText("PATCH /dashboards/id-workspace failed")).toBeInTheDocument();
    expect(screen.getByTestId("grid")).toHaveAttribute("data-editing", "true");
  });

  it("adds a widget from the catalogue at the bottom of the dashboard", async () => {
    mockApi.on("patch", "/dashboards/id-workspace", (_p: string, body: any) => ({ ...WORKSPACE, ...body }));
    const { user } = renderDashboard(manager(), { route: "/?tab=workspace" });
    await screen.findByText("widget:todos");
    await user.click(button("dashboard.customize.customize"));
    await user.click(button("dashboard.customize.addWidget"));
    // Already on the dashboard: greyed.
    expect(screen.getByTestId("catalogue-my_todos")).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByTestId("catalogue-my_favorites"));
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/dashboards/id-workspace")).toHaveLength(1));
    const saved = (mockApi.callsOf("patch", "/dashboards/id-workspace")[0].body as any).widgets;
    expect(saved).toHaveLength(3);
    expect(saved[2]).toEqual({
      id: expect.stringMatching(/^myfavorites-/),
      type: "my_favorites",
      title: null,
      config: {},
      layout: { x: 0, y: 12, w: 6, h: 6 },
    });
  });

  it("configures a generic chart before adding it", async () => {
    const { user } = renderDashboard(manager(), { route: "/?tab=workspace" });
    await screen.findByText("widget:todos");
    await user.click(button("dashboard.customize.customize"));
    await user.click(button("dashboard.customize.addWidget"));
    await user.click(screen.getByTestId("catalogue-chart"));
    const dialog = screen.getByTestId("config-dialog");
    expect(dialog).toHaveAttribute("data-mode", "create");
    // Nothing is added until the dialog saves.
    expect(grid.props.widgets).toHaveLength(2);
    await user.click(within(dialog).getByText("stub-save"));
    expect(screen.queryByTestId("config-dialog")).not.toBeInTheDocument();
    expect(grid.props.widgets).toHaveLength(3);
    expect(grid.props.widgets[2]).toMatchObject({
      type: "chart",
      title: "Configured",
      config: { query: { group_by: "type" }, chart: "bar", drill: true },
    });
  });

  it("drops a configured-but-cancelled new widget", async () => {
    const { user } = renderDashboard(manager(), { route: "/?tab=workspace" });
    await screen.findByText("widget:todos");
    await user.click(button("dashboard.customize.customize"));
    await user.click(button("dashboard.customize.addWidget"));
    await user.click(screen.getByTestId("catalogue-kpi"));
    await user.click(screen.getByText("stub-close"));
    expect(grid.props.widgets).toHaveLength(2);
  });

  it("reconfigures an existing widget in place", async () => {
    const { user } = renderDashboard(manager());
    await screen.findByText("widget:kpi-total");
    await user.click(button("dashboard.customize.customize"));
    act(() => grid.props.onConfigure(OVERVIEW.widgets[1]));
    const dialog = screen.getByTestId("config-dialog");
    expect(dialog).toHaveAttribute("data-mode", "edit");
    expect(dialog).toHaveAttribute("data-widget", "chart-type");
    await user.click(within(dialog).getByText("stub-save"));
    expect(grid.props.widgets.map((x: DashboardWidget) => [x.id, x.title])).toEqual([
      ["kpi-total", null],
      ["chart-type", "Configured"],
    ]);
  });

  describe("undo and redo", () => {
    const undoButton = () => screen.getByTestId("dashboard-undo");
    const redoButton = () => screen.getByTestId("dashboard-redo");
    const saveButton = () => screen.getByRole("button", { name: tc("actions.save") });
    const unsaved = () => screen.queryByText(tc("dashboard.customize.unsavedChanges"));

    async function customizeWorkspace() {
      const rendered = renderDashboard(manager(), { route: "/?tab=workspace" });
      await screen.findByText("widget:todos");
      await rendered.user.click(button("dashboard.customize.customize"));
      return rendered;
    }

    it("has nothing to undo or redo on entering customize mode, nor after the grid echoes its layout", async () => {
      await customizeWorkspace();
      expect(undoButton()).toBeDisabled();
      expect(redoButton()).toBeDisabled();
      expect(undoButton()).toHaveAccessibleName(tc("actions.undo"));
      expect(redoButton()).toHaveAccessibleName(tc("actions.redo"));
      act(() => grid.props.onLayoutChange(structuredClone(WORKSPACE.widgets)));
      expect(undoButton()).toBeDisabled();
      expect(saveButton()).toBeDisabled();
    });

    it("undoes a removal back to the saved state, and redoes it", async () => {
      const { user } = await customizeWorkspace();
      act(() => grid.props.onRemove(WORKSPACE.widgets[0]));
      expect(screen.queryByText("widget:todos")).not.toBeInTheDocument();
      expect(saveButton()).toBeEnabled();

      await user.click(undoButton());
      expect(screen.getByText("widget:todos")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
      expect(unsaved()).not.toBeInTheDocument();
      expect(undoButton()).toBeDisabled();
      expect(redoButton()).toBeEnabled();

      await user.click(redoButton());
      expect(screen.queryByText("widget:todos")).not.toBeInTheDocument();
      expect(screen.getByText("widget:roles")).toBeInTheDocument();
      expect(saveButton()).toBeEnabled();
      expect(unsaved()).toBeInTheDocument();
      expect(redoButton()).toBeDisabled();
      expect(undoButton()).toBeEnabled();
    });

    it("saves the state undo returned to", async () => {
      mockApi.on("patch", "/dashboards/id-workspace", (_p: string, body: any) => ({ ...WORKSPACE, ...body }));
      const { user } = await customizeWorkspace();
      const moved = [{ ...WORKSPACE.widgets[0], layout: { x: 6, y: 0, w: 6, h: 6 } }, WORKSPACE.widgets[1]];
      act(() => grid.props.onLayoutChange(moved));
      act(() => grid.props.onRemove(WORKSPACE.widgets[1]));
      await user.click(undoButton());
      await user.click(saveButton());
      await waitFor(() => expect(mockApi.callsOf("patch", "/dashboards/id-workspace")).toHaveLength(1));
      expect(mockApi.callsOf("patch", "/dashboards/id-workspace")[0].body).toEqual({ widgets: moved });
    });

    it("undoes with Ctrl+Z and redoes with Ctrl+Shift+Z or Ctrl+Y", async () => {
      const { user } = await customizeWorkspace();
      act(() => grid.props.onRemove(WORKSPACE.widgets[0]));

      await user.keyboard("{Control>}z{/Control}");
      expect(screen.getByText("widget:todos")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();

      await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
      expect(screen.queryByText("widget:todos")).not.toBeInTheDocument();

      await user.keyboard("{Control>}z{/Control}");
      expect(screen.getByText("widget:todos")).toBeInTheDocument();
      await user.keyboard("{Control>}y{/Control}");
      expect(screen.queryByText("widget:todos")).not.toBeInTheDocument();
    });

    it("leaves the draft alone when Ctrl+Z is pressed in a text field", async () => {
      const { user } = await customizeWorkspace();
      act(() => grid.props.onRemove(WORKSPACE.widgets[0]));
      const field = document.createElement("input");
      document.body.appendChild(field);
      try {
        field.focus();
        await user.keyboard("{Control>}z{/Control}");
        expect(screen.queryByText("widget:todos")).not.toBeInTheDocument();
        expect(saveButton()).toBeEnabled();
      } finally {
        field.remove();
      }
    });

    it("leaves the draft alone while the widget settings dialog is open", async () => {
      const { user } = await customizeWorkspace();
      act(() => grid.props.onRemove(WORKSPACE.widgets[0]));
      act(() => grid.props.onConfigure(WORKSPACE.widgets[1]));
      expect(screen.getByTestId("config-dialog")).toBeInTheDocument();
      await user.keyboard("{Control>}z{/Control}");
      expect(screen.queryByText("widget:todos")).not.toBeInTheDocument();
    });

    it("ignores the shortcuts outside customize mode", async () => {
      const { user } = renderDashboard(manager(), { route: "/?tab=workspace" });
      await screen.findByText("widget:todos");
      await user.keyboard("{Control>}z{/Control}");
      expect(screen.queryByTestId("dashboard-undo")).not.toBeInTheDocument();
      expect(screen.getByTestId("grid")).toHaveAttribute("data-editing", "false");
    });

    it("starts a fresh history after Discard", async () => {
      const { user } = await customizeWorkspace();
      act(() => grid.props.onRemove(WORKSPACE.widgets[0]));
      await user.click(undoButton());
      act(() => grid.props.onRemove(WORKSPACE.widgets[1]));
      await user.click(screen.getByRole("button", { name: tc("dashboard.customize.discard") }));
      expect(screen.queryByTestId("dashboard-undo")).not.toBeInTheDocument();

      await user.click(button("dashboard.customize.customize"));
      expect(undoButton()).toBeDisabled();
      expect(redoButton()).toBeDisabled();
      expect(screen.getByText("widget:todos")).toBeInTheDocument();
      expect(screen.getByText("widget:roles")).toBeInTheDocument();
    });
  });

  it("opens a newly created dashboard in customize mode", async () => {
    const created = dash("q3-review", [], { id: "id-new", built_in: false, sort_order: 5 });
    renderDashboard(manager());
    await screen.findByText("widget:kpi-total");
    mockApi.on("get", "/dashboards", [OVERVIEW, WORKSPACE, ADMIN, created]);
    act(() => menu.props.onChanged({ select: "q3-review", edit: true }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(4));
    expect(location()).toBe("?tab=q3-review");
    await waitFor(() => expect(button("dashboard.customize.addWidget")).toBeInTheDocument());
  });

  it("returns to the default dashboard after one is deleted", async () => {
    const { user } = renderDashboard(manager(), { dashboards: [OVERVIEW, WORKSPACE, EMPTY] });
    await screen.findByText("widget:kpi-total");
    await user.click(screen.getByRole("tab", { name: /Empty/ }));
    expect(location()).toBe("?tab=empty");
    mockApi.on("get", "/dashboards", [OVERVIEW, WORKSPACE]);
    act(() => menu.props.onChanged({ removed: true }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    await waitFor(() => expect(location()).toBe("?tab=overview"));
  });
});
