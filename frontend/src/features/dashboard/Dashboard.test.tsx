import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { User } from "@/types";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock("./OverviewTab", () => ({ default: () => <div data-testid="overview-tab" /> }));
vi.mock("./workspace/WorkspaceTab", () => ({
  default: () => <div data-testid="workspace-tab" />,
}));
vi.mock("./admin/AdminTab", () => ({ default: () => <div data-testid="admin-tab" /> }));

import { api } from "@/api/client";
import { AuthProvider } from "@/hooks/AuthContext";
import Dashboard from "./Dashboard";

function renderWith(user: Partial<User>, route = "/") {
  const refreshUser = vi.fn().mockResolvedValue(undefined);
  const fullUser: User = {
    id: "u1",
    email: "u@test",
    display_name: "U",
    role: "member",
    is_active: true,
    ...user,
    // These cases are about tab routing and pinning, not about who may read
    // the EA dashboard — so every fixture holds `reports.ea_dashboard` unless
    // it deliberately overrides it. The Overview tab is hidden without it; see
    // the "EA dashboard permission" block at the bottom.
    permissions: { "reports.ea_dashboard": true, ...user.permissions },
  };
  return {
    refreshUser,
    ...render(
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider user={fullUser} refreshUser={refreshUser}>
          <Dashboard />
        </AuthProvider>
      </MemoryRouter>,
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Dashboard tab routing", () => {
  it("falls back to Overview when no preference is set and no ?tab=", () => {
    renderWith({});
    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-tab")).not.toBeInTheDocument();
  });

  it("uses the user's pinned default tab when no ?tab= is supplied", () => {
    renderWith({ ui_preferences: { dashboard_default_tab: "workspace" } });
    expect(screen.getByTestId("workspace-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-tab")).not.toBeInTheDocument();
  });

  it("respects an explicit ?tab=overview even when workspace is pinned", () => {
    renderWith(
      { ui_preferences: { dashboard_default_tab: "workspace" } },
      "/?tab=overview",
    );
    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
  });

  it("hides the Admin tab from non-admins", () => {
    renderWith({ permissions: {} });
    expect(screen.queryByRole("tab", { name: /Admin/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("admin-tab")).not.toBeInTheDocument();
  });

  it("falls back to overview when a non-admin requests ?tab=admin", () => {
    renderWith({ permissions: {} }, "/?tab=admin");
    expect(screen.getByTestId("overview-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-tab")).not.toBeInTheDocument();
  });

  it("renders the Admin tab when the user has admin.users permission", () => {
    renderWith({ permissions: { "admin.users": true } }, "/?tab=admin");
    expect(screen.getByTestId("admin-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-tab")).not.toBeInTheDocument();
  });

  it("renders the Admin tab for wildcard admins (permissions['*'] = true)", () => {
    renderWith({ permissions: { "*": true } }, "/?tab=admin");
    expect(screen.getByTestId("admin-tab")).toBeInTheDocument();
  });

  it("clicking the pin icon sends the right ui-preferences payload", async () => {
    vi.mocked(api.patch).mockResolvedValue({});
    const { refreshUser } = renderWith({});

    // Two pin buttons (one per tab). The Overview tab is currently default,
    // so clicking its pin should toggle it OFF (send null).
    const pinButtons = screen.getAllByLabelText(/Unpin default tab|Pin as default tab/);
    expect(pinButtons.length).toBeGreaterThanOrEqual(2);

    // Click the workspace tab's pin button (the second one — it should be "Pin as default")
    const workspacePin = screen.getByLabelText("Pin as default tab");
    await userEvent.click(workspacePin);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/users/me/ui-preferences", {
        dashboard_default_tab: "workspace",
      });
    });
    expect(refreshUser).toHaveBeenCalled();
  });

  it("admins can pin the Admin tab as default (regression for #606)", async () => {
    vi.mocked(api.patch).mockResolvedValue({});
    const { refreshUser } = renderWith(
      { permissions: { "admin.users": true } },
      "/?tab=admin",
    );

    // Three tabs render in order: overview (pinned by default) / workspace / admin.
    // The two non-pinned ones share the "Pin as default tab" label; the admin
    // pin is the last one in DOM order.
    const pinButtons = screen.getAllByLabelText("Pin as default tab");
    expect(pinButtons.length).toBe(2);
    await userEvent.click(pinButtons[pinButtons.length - 1]);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith("/users/me/ui-preferences", {
        dashboard_default_tab: "admin",
      });
    });
    expect(refreshUser).toHaveBeenCalled();
  });
});

describe("Dashboard — EA dashboard permission", () => {
  it("drops Overview and opens on My Workspace for a role that cannot read it", () => {
    renderWith({ permissions: { "reports.ea_dashboard": false } });

    expect(screen.getByTestId("workspace-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Overview/i })).not.toBeInTheDocument();
  });

  it("ignores a stale ?tab=overview rather than rendering an empty tab", () => {
    renderWith({ permissions: { "reports.ea_dashboard": false } }, "/?tab=overview");

    expect(screen.getByTestId("workspace-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("overview-tab")).not.toBeInTheDocument();
  });

  it("ignores a stale pinned Overview preference too", () => {
    renderWith({
      permissions: { "reports.ea_dashboard": false },
      ui_preferences: { dashboard_default_tab: "overview" },
    });

    expect(screen.getByTestId("workspace-tab")).toBeInTheDocument();
  });

  it("still gives an admin without it the Workspace and Admin tabs", () => {
    renderWith(
      { permissions: { "reports.ea_dashboard": false, "admin.users": true } },
      "/?tab=admin",
    );

    expect(screen.getByTestId("admin-tab")).toBeInTheDocument();
    expect(screen.getAllByRole("tab").length).toBe(2);
  });
});
