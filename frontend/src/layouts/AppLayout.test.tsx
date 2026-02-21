import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AppLayout from "./AppLayout";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: vi.fn(),
}));

vi.mock("@/hooks/useBpmEnabled", () => ({
  useBpmEnabled: vi.fn(),
}));

vi.mock("@/hooks/useEventStream", () => ({
  useEventStream: vi.fn(),
}));

// Stub notification components that make their own API calls
vi.mock("@/components/NotificationBell", () => ({
  default: () => <div data-testid="notification-bell" />,
}));
vi.mock("@/components/NotificationPreferencesDialog", () => ({
  default: () => null,
}));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useBpmEnabled } from "@/hooks/useBpmEnabled";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(useMetamodel).mockReturnValue({
    types: [],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  });

  vi.mocked(useBpmEnabled).mockReturnValue({ bpmEnabled: true, loading: false });

  // Badge counts API
  vi.mocked(api.get).mockResolvedValue({ open_todos: 0, pending_surveys: 0 });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const adminUser = {
  id: "u1",
  display_name: "Admin User",
  email: "admin@turboea.local",
  role: "admin",
  permissions: { "*": true } as Record<string, boolean>,
};

const viewerUser = {
  id: "u2",
  display_name: "Viewer User",
  email: "viewer@turboea.local",
  role: "viewer",
  permissions: {
    "inventory.view": true,
    "reports.ea_dashboard": true,
    "diagrams.view": true,
  } as Record<string, boolean>,
};

const onLogout = vi.fn();

function renderLayout(
  user = adminUser,
  initialPath = "/",
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppLayout user={user} onLogout={onLogout}>
        <div data-testid="page-content">Page Content</div>
      </AppLayout>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AppLayout", () => {
  it("renders children content", () => {
    renderLayout();
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
  });

  it("renders the brand logo", () => {
    renderLayout();
    expect(screen.getByAltText("Turbo EA")).toBeInTheDocument();
  });

  it("renders core navigation items for admin", () => {
    renderLayout();

    expect(screen.getByRole("button", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inventory/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bpm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /diagrams/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /todos/i })).toBeInTheDocument();
  });

  it("hides BPM nav item when BPM is disabled", () => {
    vi.mocked(useBpmEnabled).mockReturnValue({ bpmEnabled: false, loading: false });
    renderLayout();

    expect(screen.queryByRole("button", { name: /^bpm$/i })).not.toBeInTheDocument();
  });

  it("hides nav items based on permissions", () => {
    // Viewer has no soaw.view permission, so Delivery should be hidden
    renderLayout(viewerUser);

    expect(screen.queryByRole("button", { name: /delivery/i })).not.toBeInTheDocument();
  });

  it("shows Create button for users with inventory.create permission", () => {
    renderLayout();
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
  });

  it("hides Create button for users without inventory.create permission", () => {
    renderLayout(viewerUser);
    expect(screen.queryByRole("button", { name: /^create$/i })).not.toBeInTheDocument();
  });

  it("shows user menu with name, email, and version", async () => {
    const user = userEvent.setup();
    renderLayout();

    // The user menu button is the last IconButton in the toolbar
    const allButtons = screen.getAllByRole("button");
    await user.click(allButtons[allButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("Admin User")).toBeInTheDocument();
      expect(screen.getByText("admin@turboea.local")).toBeInTheDocument();
      expect(screen.getByText("v0.0.0-test")).toBeInTheDocument();
    });
  });

  it("calls onLogout when Logout menu item is clicked", async () => {
    const user = userEvent.setup();
    renderLayout();

    // Open user menu
    const allButtons = screen.getAllByRole("button");
    await user.click(allButtons[allButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("Logout")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Logout"));
    expect(onLogout).toHaveBeenCalled();
  });

  it("shows admin items in user menu for admin users", async () => {
    const user = userEvent.setup();
    renderLayout();

    const allButtons = screen.getAllByRole("button");
    await user.click(allButtons[allButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("Metamodel")).toBeInTheDocument();
      expect(screen.getByText("Users & Roles")).toBeInTheDocument();
      expect(screen.getByText("Settings")).toBeInTheDocument();
    });
  });

  it("hides admin items in user menu for non-admin users", async () => {
    const user = userEvent.setup();
    renderLayout(viewerUser);

    const allButtons = screen.getAllByRole("button");
    await user.click(allButtons[allButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByText("Logout")).toBeInTheDocument();
    });

    expect(screen.queryByText("Metamodel")).not.toBeInTheDocument();
    expect(screen.queryByText("Users & Roles")).not.toBeInTheDocument();
  });

  it("fetches badge counts on mount", async () => {
    renderLayout();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/notifications/badge-counts");
    });
  });

  it("renders notification bell", () => {
    renderLayout();
    expect(screen.getByTestId("notification-bell")).toBeInTheDocument();
  });

  it("renders search input", () => {
    renderLayout();
    expect(screen.getByPlaceholderText("Search cards...")).toBeInTheDocument();
  });
});
