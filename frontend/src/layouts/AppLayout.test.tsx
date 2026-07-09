import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import AppLayout from "./AppLayout";
import { AuthProvider } from "@/hooks/AuthContext";
import {
  registerExtension,
  resetExtensionHost,
  UI_SDK_VERSION,
  type ExtensionNavGroup,
} from "@/lib/extensionHost";

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
vi.mock("@/components/SearchDialog", () => ({
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
      <AuthProvider user={user} refreshUser={async () => {}}>
        <AppLayout user={user} onLogout={onLogout}>
          <div data-testid="page-content">Page Content</div>
        </AppLayout>
      </AuthProvider>
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
    expect(screen.getByAltText(/turbo ea/i)).toBeInTheDocument();
  });

  it("renders core navigation items for admin", () => {
    renderLayout();

    // Nav items render as <a> (RouterLink) so Ctrl+Click opens a new tab —
    // ARIA role is `link`, not `button`. Reports is still a dropdown trigger
    // so it stays a button.
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /inventory/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /bpm/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /diagrams/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /todos/i })).toBeInTheDocument();
  });

  it("hides BPM nav item when BPM is disabled", () => {
    vi.mocked(useBpmEnabled).mockReturnValue({ bpmEnabled: false, loading: false });
    renderLayout();

    expect(screen.queryByRole("link", { name: /^bpm$/i })).not.toBeInTheDocument();
  });

  it("hides nav items based on permissions", () => {
    // Viewer has no soaw.view permission, so Delivery should be hidden
    renderLayout(viewerUser);

    expect(screen.queryByRole("link", { name: /delivery/i })).not.toBeInTheDocument();
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

  it("renders search icon button", () => {
    renderLayout();
    expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
  });
});

describe("AppLayout — extension nav placement", () => {
  beforeEach(() => resetExtensionHost());
  afterEach(() => resetExtensionHost());

  it("places a reports-group extension route under the Reports menu, not top-level", async () => {
    registerExtension("digital-autonomy", {
      key: "digital-autonomy",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "quadrant",
          path: "/ext/digital-autonomy/quadrant",
          label: "Autonomy Report",
          icon: "scatter_plot",
          navGroup: "reports",
          component: () => null,
        },
      ],
    });
    const user = userEvent.setup();
    renderLayout();

    // Not a top-level nav item.
    expect(screen.queryByRole("link", { name: /Autonomy Report/i })).not.toBeInTheDocument();

    // Appears inside the Reports dropdown, linking to its /ext path.
    await user.click(screen.getByRole("button", { name: /reports/i }));
    const item = await screen.findByRole("menuitem", { name: /Autonomy Report/i });
    expect(item).toHaveAttribute("href", "/ext/digital-autonomy/quadrant");
  });

  it("keeps a route without navGroup as a top-level nav item", () => {
    registerExtension("legacy-ext", {
      key: "legacy-ext",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "page",
          path: "/ext/legacy-ext/page",
          label: "Legacy Page",
          icon: "star",
          component: () => null,
        },
      ],
    });
    renderLayout();
    expect(screen.getByRole("link", { name: /Legacy Page/i })).toBeInTheDocument();
  });

  it("ignores a route whose navGroup is not whitelisted (no crash, no injection)", async () => {
    registerExtension("bad-ext", {
      key: "bad-ext",
      sdkVersion: UI_SDK_VERSION,
      routes: [
        {
          id: "x",
          path: "/ext/bad-ext/x",
          label: "Nowhere Report",
          icon: "warning",
          navGroup: "adminPanels" as ExtensionNavGroup,
          component: () => null,
        },
      ],
    });
    const user = userEvent.setup();
    renderLayout();

    // Not a top-level item…
    expect(screen.queryByRole("link", { name: /Nowhere Report/i })).not.toBeInTheDocument();
    // …and not injected into Reports either.
    await user.click(screen.getByRole("button", { name: /reports/i }));
    expect(screen.queryByRole("menuitem", { name: /Nowhere Report/i })).not.toBeInTheDocument();
  });
});
