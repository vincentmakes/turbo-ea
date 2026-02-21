import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RolesAdmin from "./RolesAdmin";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { api } from "@/api/client";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MOCK_ROLES = [
  {
    key: "admin",
    label: "Admin",
    description: "Full access to all features",
    color: "#1976d2",
    permissions: { "*": true },
    is_system: true,
    is_default: false,
    is_archived: false,
    sort_order: 0,
    user_count: 2,
  },
  {
    key: "member",
    label: "Member",
    description: "Standard member role",
    color: "#388e3c",
    permissions: { "inventory.view": true, "inventory.create": true },
    is_system: true,
    is_default: true,
    is_archived: false,
    sort_order: 1,
    user_count: 5,
  },
  {
    key: "viewer",
    label: "Viewer",
    description: "Read-only access",
    color: "#455a64",
    permissions: { "inventory.view": true },
    is_system: true,
    is_default: false,
    is_archived: false,
    sort_order: 2,
    user_count: 3,
  },
];

const MOCK_SCHEMA = {
  inventory: {
    label: "Inventory",
    permissions: {
      "inventory.view": "View inventory items",
      "inventory.create": "Create new inventory items",
      "inventory.edit": "Edit inventory items",
    },
  },
  admin: {
    label: "Administration",
    permissions: {
      "admin.metamodel": "Manage metamodel",
      "admin.users": "Manage users",
    },
  },
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/roles/permissions-schema")) return Promise.resolve(MOCK_SCHEMA);
    if (path.startsWith("/roles/")) {
      const key = path.replace(/^\/roles\//, "").split("?")[0];
      const role = MOCK_ROLES.find((r) => r.key === key);
      return Promise.resolve(role || MOCK_ROLES[0]);
    }
    if (path.startsWith("/roles")) return Promise.resolve(MOCK_ROLES);
    return Promise.resolve({});
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderRoles() {
  return render(<RolesAdmin />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RolesAdmin", () => {
  it("renders the page title", async () => {
    renderRoles();
    expect(screen.getByText("Role Management")).toBeInTheDocument();
  });

  it("renders Add Role button", async () => {
    renderRoles();
    expect(screen.getByRole("button", { name: /add role/i })).toBeInTheDocument();
  });

  it("renders role list after loading", async () => {
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Admin")).toBeInTheDocument();
      expect(screen.getByText("Member")).toBeInTheDocument();
      expect(screen.getByText("Viewer")).toBeInTheDocument();
    });
  });

  it("shows System chip for system roles", async () => {
    renderRoles();

    await waitFor(() => {
      const systemChips = screen.getAllByText("System");
      expect(systemChips.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows Default chip for default role", async () => {
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Default")).toBeInTheDocument();
    });
  });

  it("shows user count for each role", async () => {
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("2 users")).toBeInTheDocument();
      expect(screen.getByText("5 users")).toBeInTheDocument();
      expect(screen.getByText("3 users")).toBeInTheDocument();
    });
  });

  it("shows placeholder when no role is selected", async () => {
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Select a role to view and edit its permissions")).toBeInTheDocument();
    });
  });

  it("shows role detail when a role is clicked", async () => {
    const user = userEvent.setup();
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Member")).toBeInTheDocument();
    });

    // Click on Member role
    await user.click(screen.getByText("Member"));

    await waitFor(() => {
      // Detail panel should show permission groups and Save Changes button
      expect(screen.getByText("Permissions")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
    });
  });

  it("shows permission groups (accordion) when a role is selected", async () => {
    const user = userEvent.setup();
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Member")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Member"));

    await waitFor(() => {
      expect(screen.getByText("Inventory")).toBeInTheDocument();
      expect(screen.getByText("Administration")).toBeInTheDocument();
    });
  });

  it("shows admin role info alert about full access", async () => {
    const user = userEvent.setup();
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Admin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Admin"));

    await waitFor(() => {
      expect(screen.getByText(/admin role has full access/i)).toBeInTheDocument();
    });
  });

  it("shows Save Changes and Reset buttons for non-admin roles", async () => {
    const user = userEvent.setup();
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Member")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Member"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /reset/i })).toBeInTheDocument();
    });
  });

  it("disables Save Changes for admin role", async () => {
    const user = userEvent.setup();
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Admin")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Admin"));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    });
  });

  it("opens Create Role dialog when Add Role is clicked", async () => {
    const user = userEvent.setup();
    renderRoles();

    await user.click(screen.getByRole("button", { name: /add role/i }));

    await waitFor(() => {
      // Dialog title and button both say "Create Role" — check for the heading
      expect(screen.getByRole("heading", { name: /create role/i })).toBeInTheDocument();
    });
  });

  it("shows Show archived toggle", async () => {
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Show archived")).toBeInTheDocument();
    });
  });

  it("fetches roles and permissions schema on mount", async () => {
    renderRoles();

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith("/roles?include_archived=false");
      expect(api.get).toHaveBeenCalledWith("/roles/permissions-schema");
    });
  });

  it("shows user count info in detail panel", async () => {
    const user = userEvent.setup();
    renderRoles();

    await waitFor(() => {
      expect(screen.getByText("Member")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Member"));

    await waitFor(() => {
      expect(screen.getByText(/5 users assigned to this role/i)).toBeInTheDocument();
    });
  });
});
