import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { Dashboard } from "@/types";

/* eslint-disable @typescript-eslint/no-explicit-any -- the settings stub captures its props */

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("./DashboardSettingsDialog", () => ({
  default: (p: any) =>
    p.open ? (
      <div data-testid="settings-dialog" data-mode={p.dashboard ? "edit" : "create"}>
        <button onClick={() => p.onSaved({ ...(p.dashboard ?? {}), id: "id-new", key: "saved-key" })}>stub-save</button>
      </div>
    ) : null,
}));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import DashboardsMenu from "./DashboardsMenu";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

function dash(key: string, extra: Partial<Dashboard> = {}): Dashboard {
  return {
    id: `id-${key}`,
    key,
    name: key,
    translations: {},
    description: null,
    icon: null,
    built_in: false,
    is_hidden: false,
    sort_order: 0,
    widgets: [],
    allowed_roles: [],
    can_manage: true,
    ...extra,
  };
}

const OVERVIEW = dash("overview", { built_in: true, sort_order: 0 });
const TEAM = dash("team", { sort_order: 1 });
const OPS = dash("ops", { sort_order: 4, is_hidden: true });
const ALL = [OVERVIEW, TEAM, OPS];

function renderMenu(dashboard: Dashboard | null, label = dashboard?.name ?? "") {
  const onChanged = vi.fn();
  const result = renderWithProviders(
    <DashboardsMenu dashboard={dashboard} dashboards={ALL} label={label} onChanged={onChanged} />,
  );
  return { ...result, onChanged };
}

async function open(user: ReturnType<typeof renderMenu>["user"]) {
  await user.click(screen.getByRole("button", { name: tc("dashboard.menu.manage") }));
}

const item = (key: string) => screen.getByTestId(`dashboard-menu-${key}`);

beforeEach(() => {
  mockApi.reset();
});

describe("DashboardsMenu", () => {
  it("offers only New dashboard when there is none on screen", async () => {
    const { user } = renderMenu(null);
    await open(user);
    expect(screen.getAllByRole("menuitem").map((m) => m.dataset.testid)).toEqual(["dashboard-menu-new"]);
  });

  it("offers Reset on a built-in and Delete on a custom dashboard", async () => {
    const first = renderMenu(OVERVIEW);
    await open(first.user);
    expect(screen.getAllByRole("menuitem").map((m) => m.dataset.testid)).toEqual([
      "dashboard-menu-new",
      "dashboard-menu-duplicate",
      "dashboard-menu-settings",
      "dashboard-menu-hide",
      "dashboard-menu-move-left",
      "dashboard-menu-move-right",
      "dashboard-menu-reset",
    ]);
    first.unmount();
    const second = renderMenu(TEAM);
    await open(second.user);
    expect(screen.getByTestId("dashboard-menu-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-menu-reset")).not.toBeInTheDocument();
  });

  it("duplicates under a localised 'Copy of' name and opens the copy", async () => {
    mockApi.on("post", "/dashboards/id-overview/duplicate", { ...OVERVIEW, id: "id-copy", key: "copy-of-overview" });
    const { user, onChanged } = renderMenu(OVERVIEW, "Aperçu");
    await open(user);
    await user.click(item("duplicate"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ select: "copy-of-overview" }));
    expect(mockApi.calls).toEqual([
      { method: "post", path: "/dashboards/id-overview/duplicate", body: { name: tc("dashboard.menu.copyOf", { name: "Aperçu" }) } },
    ]);
    expect(tc("dashboard.menu.copyOf", { name: "Aperçu" })).toBe("Copy of Aperçu");
  });

  it("hides a visible dashboard and shows a hidden one", async () => {
    mockApi.on("patch", /^\/dashboards\//, {});
    const first = renderMenu(TEAM);
    await open(first.user);
    expect(screen.queryByTestId("dashboard-menu-show")).not.toBeInTheDocument();
    await first.user.click(item("hide"));
    await waitFor(() => expect(first.onChanged).toHaveBeenCalledWith({}));
    expect(mockApi.calls).toEqual([{ method: "patch", path: "/dashboards/id-team", body: { is_hidden: true } }]);
    first.unmount();

    mockApi.calls = [];
    const second = renderMenu(OPS);
    await open(second.user);
    await second.user.click(item("show"));
    await waitFor(() => expect(second.onChanged).toHaveBeenCalledWith({}));
    expect(mockApi.calls).toEqual([{ method: "patch", path: "/dashboards/id-ops", body: { is_hidden: false } }]);
  });

  it("moves a dashboard left by swapping orders with its neighbour", async () => {
    mockApi.on("patch", /^\/dashboards\//, {});
    const { user, onChanged } = renderMenu(TEAM);
    await open(user);
    await user.click(item("move-left"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ select: "team" }));
    expect(mockApi.calls).toEqual([
      { method: "patch", path: "/dashboards/id-team", body: { sort_order: 0 } },
      { method: "patch", path: "/dashboards/id-overview", body: { sort_order: 1 } },
    ]);
  });

  it("moves a dashboard right", async () => {
    mockApi.on("patch", /^\/dashboards\//, {});
    const { user, onChanged } = renderMenu(TEAM);
    await open(user);
    await user.click(item("move-right"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockApi.calls).toEqual([
      { method: "patch", path: "/dashboards/id-team", body: { sort_order: 4 } },
      { method: "patch", path: "/dashboards/id-ops", body: { sort_order: 1 } },
    ]);
  });

  it("cannot move past either end", async () => {
    const first = renderMenu(OVERVIEW);
    await open(first.user);
    expect(item("move-left")).toHaveAttribute("aria-disabled", "true");
    expect(item("move-right")).not.toHaveAttribute("aria-disabled");
    first.unmount();
    const last = renderMenu(OPS);
    await open(last.user);
    expect(item("move-right")).toHaveAttribute("aria-disabled", "true");
    expect(item("move-left")).not.toHaveAttribute("aria-disabled");
  });

  it("resets a built-in dashboard after confirmation", async () => {
    mockApi.on("post", "/dashboards/id-overview/reset", OVERVIEW);
    const { user, onChanged } = renderMenu(OVERVIEW, "Overview");
    await open(user);
    await user.click(item("reset"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(tc("dashboard.menu.resetConfirm", { name: "Overview" }));
    expect(mockApi.calls).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: tc("actions.reset") }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({}));
    expect(mockApi.calls).toEqual([{ method: "post", path: "/dashboards/id-overview/reset", body: undefined }]);
  });

  it("deletes a custom dashboard after confirmation, naming it", async () => {
    mockApi.on("delete", "/dashboards/id-team", undefined);
    const { user, onChanged } = renderMenu(TEAM, "Team board");
    await open(user);
    await user.click(item("delete"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(tc("dashboard.menu.deleteTitle"));
    expect(dialog).toHaveTextContent(tc("dashboard.menu.deleteConfirm", { name: "Team board" }));
    await user.click(within(dialog).getByRole("button", { name: tc("actions.delete") }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith({ removed: true }));
    expect(mockApi.calls).toEqual([{ method: "delete", path: "/dashboards/id-team", body: undefined }]);
  });

  it("does nothing when a confirmation is cancelled", async () => {
    const { user, onChanged } = renderMenu(TEAM);
    await open(user);
    await user.click(item("delete"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: tc("actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockApi.calls).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports a failed action", async () => {
    mockApi.fail("patch", "/dashboards/id-team", 400, "nope");
    const { user, onChanged } = renderMenu(TEAM);
    await open(user);
    await user.click(item("hide"));
    expect(await screen.findByText("PATCH /dashboards/id-team failed")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("opens a created dashboard in customize mode", async () => {
    const { user, onChanged } = renderMenu(OVERVIEW);
    await open(user);
    await user.click(item("new"));
    expect(screen.getByTestId("settings-dialog")).toHaveAttribute("data-mode", "create");
    await user.click(screen.getByText("stub-save"));
    expect(onChanged).toHaveBeenCalledWith({ select: "saved-key", edit: true });
    expect(screen.queryByTestId("settings-dialog")).not.toBeInTheDocument();
  });

  it("edits the settings of the dashboard on screen", async () => {
    const { user, onChanged } = renderMenu(TEAM);
    await open(user);
    await user.click(item("settings"));
    expect(screen.getByTestId("settings-dialog")).toHaveAttribute("data-mode", "edit");
    await user.click(screen.getByText("stub-save"));
    expect(onChanged).toHaveBeenCalledWith({});
  });
});
