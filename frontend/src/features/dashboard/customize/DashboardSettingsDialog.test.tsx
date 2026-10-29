import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import i18n from "@/i18n";
import type { AppRole, Dashboard } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

import { mockApi } from "@/test/apiMock";
import { renderWithProviders } from "@/test/render";
import DashboardSettingsDialog from "./DashboardSettingsDialog";

const tc = (k: string, o?: Record<string, unknown>) => i18n.t(`common:${k}`, o) as string;

function role(key: string, label: string, extra: Partial<AppRole> = {}): AppRole {
  return {
    id: `r-${key}`,
    key,
    label,
    is_system: false,
    is_default: false,
    is_archived: false,
    color: "#336699",
    permissions: undefined as unknown as Record<string, boolean>,
    sort_order: 0,
    ...extra,
  };
}

const ROLES: AppRole[] = [
  role("admin", "Admin"),
  role("superuser", "Superuser", { permissions: { "*": true } }),
  role("member", "Member", { color: "#2e7d32" }),
  role("viewer", "Viewer"),
  role("legacy", "Legacy", { is_archived: true }),
];

const TEAM: Dashboard = {
  id: "id-team",
  key: "team",
  name: "Team",
  translations: {},
  description: "Our board",
  icon: "groups",
  built_in: false,
  is_hidden: false,
  sort_order: 3,
  widgets: [],
  allowed_roles: ["member", "legacy"],
  can_manage: true,
};

function renderDialog(dashboard: Dashboard | null = null) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const result = renderWithProviders(
    <DashboardSettingsDialog open dashboard={dashboard} onClose={onClose} onSaved={onSaved} />,
  );
  return { ...result, onSaved, onClose };
}

const nameInput = () => screen.getByTestId("dashboard-name");
const chip = (key: string) => screen.getByTestId(`role-chip-${key}`);

beforeEach(() => {
  mockApi.reset();
  mockApi.on("get", "/roles?include_archived=true", ROLES);
});

describe("DashboardSettingsDialog — create", () => {
  it("needs a name before it creates anything", async () => {
    const { user, onSaved } = renderDialog();
    expect(screen.getByText(tc("dashboard.settings.createTitle"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: tc("actions.create") }));
    expect(screen.getByText(tc("dashboard.settings.nameRequired"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tc("actions.create") })).toBeDisabled();
    await user.type(nameInput(), "   ");
    expect(screen.getByRole("button", { name: tc("actions.create") })).toBeDisabled();
    expect(mockApi.callsOf("post")).toEqual([]);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("rejects an overlong name", async () => {
    const { user } = renderDialog();
    await user.click(nameInput());
    await user.paste("x".repeat(201));
    await user.tab();
    expect(screen.getByText(tc("dashboard.settings.nameTooLong"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: tc("actions.create") })).toBeDisabled();
  });

  it("creates a dashboard for everyone with the trimmed fields", async () => {
    const created = { ...TEAM, id: "id-q3", key: "q3-board", allowed_roles: [] };
    mockApi.on("post", "/dashboards", created);
    const { user, onSaved } = renderDialog();
    expect(screen.getByTestId("access-everyone")).toHaveTextContent(tc("dashboard.settings.everyoneHint"));
    await user.type(nameInput(), "  Q3 board  ");
    await user.type(screen.getByLabelText(tc("dashboard.settings.description")), "  ");
    await user.click(screen.getByRole("button", { name: tc("actions.create") }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
    expect(mockApi.callsOf("post")).toEqual([
      {
        method: "post",
        path: "/dashboards",
        body: { name: "Q3 board", description: null, icon: "dashboard", allowed_roles: [] },
      },
    ]);
  });

  it("offers every active role, and restricts to the ones picked", async () => {
    mockApi.on("post", "/dashboards", TEAM);
    const { user } = renderDialog();
    await user.type(nameInput(), "Viewers");
    await user.click(screen.getByLabelText(tc("dashboard.settings.access")));
    const listbox = await screen.findByRole("listbox");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Admin",
      "Superuser",
      "Member",
      "Viewer",
    ]);
    await user.click(within(listbox).getByText("Viewer"));
    // Once restricted, the full-access roles show as always included.
    expect(chip("admin")).toHaveTextContent(tc("dashboard.settings.alwaysIncluded", { label: "Admin" }));
    expect(chip("superuser")).toHaveClass("Mui-disabled");
    expect(screen.queryByTestId("access-everyone")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: tc("actions.create") }));
    await waitFor(() => expect(mockApi.callsOf("post")).toHaveLength(1));
    expect((mockApi.callsOf("post")[0].body as { allowed_roles: string[] }).allowed_roles).toEqual(["viewer"]);
  });

  it("shows the server's reason when saving fails", async () => {
    mockApi.fail("post", "/dashboards", 400, "unknown_role");
    const { user, onSaved } = renderDialog();
    await user.type(nameInput(), "Broken");
    await user.click(screen.getByRole("button", { name: tc("actions.create") }));
    expect(await screen.findByText("POST /dashboards failed")).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("DashboardSettingsDialog — edit", () => {
  it("shows the stored values, wildcard roles as fixed chips and an archived role as inert", async () => {
    renderDialog(TEAM);
    expect(screen.getByText(tc("dashboard.settings.editTitle"))).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Team");
    expect(screen.getByLabelText(tc("dashboard.settings.description"))).toHaveValue("Our board");
    await waitFor(() => expect(chip("member")).toHaveTextContent("Member"));
    expect(chip("legacy")).toHaveTextContent(tc("dashboard.settings.archivedRole", { label: "Legacy" }));
    expect(chip("legacy")).toHaveClass("MuiChip-outlined");
    expect(chip("member")).toHaveClass("MuiChip-filled");
    expect(chip("admin")).toHaveClass("Mui-disabled");
    expect(within(chip("admin")).queryByTestId("CancelIcon")).not.toBeInTheDocument();
    expect(within(chip("member")).getByTestId("CancelIcon")).toBeInTheDocument();
  });

  it("saves every field with one PATCH, never sending a wildcard role", async () => {
    mockApi.on("patch", "/dashboards/id-team", TEAM);
    const { user, onSaved } = renderDialog(TEAM);
    // Wait for the role's label, not just the chip: before the roles arrive
    // the chip is the inert fallback, replaced on load — a click that lands
    // across that replacement removes nothing.
    await waitFor(() => expect(chip("member")).toHaveTextContent("Member"));
    await user.click(within(chip("member")).getByTestId("CancelIcon"));
    await user.clear(nameInput());
    await user.type(nameInput(), "Team room");
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(TEAM));
    expect(mockApi.callsOf("patch")).toEqual([
      {
        method: "patch",
        path: "/dashboards/id-team",
        body: { name: "Team room", description: "Our board", icon: "groups", allowed_roles: ["legacy"] },
      },
    ]);
  });

  it("shows a listed wildcard role as an ordinary chip, saves it, and names the widgets' permissions", async () => {
    const admin: Dashboard = {
      ...TEAM,
      id: "id-admin",
      key: "admin",
      name: "Admin",
      built_in: true,
      allowed_roles: ["admin"],
      widgets: [
        { id: "a", type: "top_contributors", title: null, config: {}, layout: { x: 0, y: 0, w: 6, h: 6 } },
        { id: "b", type: "idle_users", title: null, config: {}, layout: { x: 6, y: 0, w: 6, h: 6 } },
        { id: "c", type: "my_todos", title: null, config: {}, layout: { x: 0, y: 6, w: 6, h: 6 } },
      ],
    };
    mockApi.on("patch", "/dashboards/id-admin", admin);
    const { user } = renderDialog(admin);
    await waitFor(() => expect(chip("admin")).toHaveTextContent("Admin"));
    expect(chip("admin")).not.toHaveClass("Mui-disabled");
    expect(within(chip("admin")).getByTestId("CancelIcon")).toBeInTheDocument();
    // The other wildcard role was not picked, so it is the locked one.
    expect(chip("superuser")).toHaveTextContent(tc("dashboard.settings.alwaysIncluded", { label: "Superuser" }));
    expect(chip("superuser")).toHaveClass("Mui-disabled");
    const hint = screen.getByTestId("access-permissions");
    expect(hint).toHaveTextContent(`${tc("dashboard.settings.widgetPermissions")} admin.users.`);
    expect(hint.querySelectorAll("code")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect((mockApi.callsOf("patch")[0].body as { allowed_roles: string[] }).allowed_roles).toEqual(["admin"]);
  });

  it("names no permission for a dashboard whose widgets need none", async () => {
    renderDialog({ ...TEAM, widgets: [{ id: "c", type: "my_todos", title: null, config: {}, layout: { x: 0, y: 0, w: 6, h: 6 } }] });
    await waitFor(() => expect(chip("member")).toBeInTheDocument());
    expect(screen.queryByTestId("access-permissions")).not.toBeInTheDocument();
  });

  it("keeps a stored key that no role answers to, and a stored wildcard role", async () => {
    mockApi.on("patch", "/dashboards/id-team", TEAM);
    const { user } = renderDialog({ ...TEAM, allowed_roles: ["gone", "admin"] });
    await waitFor(() => expect(chip("gone")).toHaveTextContent(tc("dashboard.settings.archivedRole", { label: "gone" })));
    await user.click(screen.getByRole("button", { name: tc("actions.save") }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(1));
    expect((mockApi.callsOf("patch")[0].body as { allowed_roles: string[] }).allowed_roles).toEqual(["gone", "admin"]);
  });

  it("cancels without saving", async () => {
    const { user, onClose } = renderDialog(TEAM);
    await user.click(screen.getByRole("button", { name: tc("actions.cancel") }));
    expect(onClose).toHaveBeenCalled();
    expect(mockApi.callsOf("patch")).toEqual([]);
  });
});
