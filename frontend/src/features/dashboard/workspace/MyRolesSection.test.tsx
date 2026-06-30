import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/AuthContext", () => ({
  useAuthContext: vi.fn(),
}));

vi.mock("@/hooks/useResolveLabel", () => ({
  useResolveLabel: () => (label: string) => label,
  useResolveMetaLabel: () => (label: string) => label,
  useTypeLabel: () => (e?: { label?: string; key?: string } | null) => e?.label ?? e?.key ?? "",
  useRelationLabel: () => (e?: { label?: string; key?: string } | null) => e?.label ?? e?.key ?? "",
  useFieldLabel: () => (e?: { label?: string; key?: string } | null) => e?.label ?? e?.key ?? "",
  useOptionLabel: () => (e?: { label?: string; key?: string } | null) => e?.label ?? e?.key ?? "",
  useSubtypeLabel: () => (e?: { label?: string; key?: string } | null) => e?.label ?? e?.key ?? "",
}));

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [
      { key: "Application", label: "Application", icon: "apps", color: "#0f7eb5" },
    ],
    relationTypes: [],
    loading: false,
    getType: () => undefined,
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  }),
}));

import { api } from "@/api/client";
import { useAuthContext } from "@/hooks/AuthContext";
import MyRolesSection from "./MyRolesSection";

function adminUser(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: "u-self",
      email: "self@test.com",
      display_name: "Self",
      role: "admin",
      is_active: true,
      permissions: { "*": true },
      ...overrides,
    },
    refreshUser: vi.fn(),
  };
}

function viewerUser() {
  return {
    user: {
      id: "u-self",
      email: "self@test.com",
      display_name: "Self",
      role: "viewer",
      is_active: true,
      permissions: { "inventory.view": true },
    },
    refreshUser: vi.fn(),
  };
}

const SELF_RESPONSE = {
  items: [
    { id: "card-a", name: "NexaCore ERP", type: "Application", status: "ACTIVE" },
  ],
  roles_by_card_id: {
    "card-a": [
      { key: "responsible", label: "Responsible", color: "#1976d2", translations: {} },
    ],
  },
};

const ALICE_RESPONSE = {
  items: [
    { id: "card-z", name: "Alice's Custom App", type: "Application", status: "ACTIVE" },
  ],
  roles_by_card_id: {
    "card-z": [
      { key: "observer", label: "Observer", color: "#9e9e9e", translations: {} },
    ],
  },
};

const USERS = [
  { id: "u-self", display_name: "Self", email: "self@test.com" },
  { id: "u-alice", display_name: "Alice", email: "alice@test.com" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderSection() {
  return render(
    <MemoryRouter>
      <MyRolesSection />
    </MemoryRouter>,
  );
}

describe("MyRolesSection", () => {
  it("renders the caller's role-grouped cards on mount", async () => {
    vi.mocked(useAuthContext).mockReturnValue(adminUser());
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/cards/my-stakeholder") return SELF_RESPONSE;
      throw new Error(`unexpected url ${url}`);
    });

    renderSection();

    await waitFor(() => {
      expect(screen.getByText("NexaCore ERP")).toBeInTheDocument();
    });
    expect(api.get).toHaveBeenCalledWith("/cards/my-stakeholder");
  });

  it("hides the user picker for callers without stakeholders.view", async () => {
    vi.mocked(useAuthContext).mockReturnValue(viewerUser());
    vi.mocked(api.get).mockResolvedValue(SELF_RESPONSE);

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("NexaCore ERP")).toBeInTheDocument();
    });

    // The picker IconButton is gated on `stakeholders.view`; viewer should not see it.
    expect(
      screen.queryByLabelText("View another user's roles"),
    ).not.toBeInTheDocument();
  });

  it("refetches with ?user_id=... when another user is picked", async () => {
    vi.mocked(useAuthContext).mockReturnValue(adminUser());
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/cards/my-stakeholder") return SELF_RESPONSE;
      if (url === "/users") return USERS;
      if (url === "/cards/my-stakeholder?user_id=u-alice") return ALICE_RESPONSE;
      throw new Error(`unexpected url ${url}`);
    });

    renderSection();
    await waitFor(() => {
      expect(screen.getByText("NexaCore ERP")).toBeInTheDocument();
    });

    // Open the picker
    await userEvent.click(screen.getByLabelText("View another user's roles"));
    // Type to filter, pick Alice
    const input = await screen.findByPlaceholderText("View another user's roles");
    await userEvent.type(input, "Alic");
    const aliceOption = await screen.findByText("Alice");
    await userEvent.click(aliceOption);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/cards/my-stakeholder?user_id=u-alice",
      );
    });
    expect(await screen.findByText("Alice's Custom App")).toBeInTheDocument();
    expect(screen.getByText("Roles held by Alice")).toBeInTheDocument();
  });
});
