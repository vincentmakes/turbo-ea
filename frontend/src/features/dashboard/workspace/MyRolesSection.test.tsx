import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: vi.fn(),
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

import i18n from "@/i18n";
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

describe("MyRolesSection — role names and descriptions", () => {
  const ROLE_RESPONSE = {
    items: [{ id: "card-c", name: "Contracted App", type: "Application", status: "ACTIVE" }],
    roles_by_card_id: {
      "card-c": [
        {
          key: "contractOwner",
          label: "Contract Owner",
          color: "#1976d2",
          description: "Signs and renews the vendor contract.",
          // The role def's JSONB, keyed by property, then locale.
          translations: {
            label: { de: "Vertragsverantwortlicher" },
            description: { de: "Unterschreibt den Vertrag." },
          },
        },
      ],
    },
  };

  beforeEach(() => {
    vi.mocked(useAuthContext).mockReturnValue(viewerUser());
    vi.mocked(api.get).mockResolvedValue(ROLE_RESPONSE);
  });

  it("shows an info icon with the role's description", async () => {
    renderSection();
    expect(await screen.findByText("Contract Owner")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Signs and renews the vendor contract." }),
    ).toBeInTheDocument();
  });

  it("renders the role name and description in the user's language", async () => {
    await i18n.changeLanguage("de");
    try {
      renderSection();
      expect(await screen.findByText("Vertragsverantwortlicher")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Unterschreibt den Vertrag." })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("shows no icon for a role without a description", async () => {
    vi.mocked(api.get).mockResolvedValue(SELF_RESPONSE);
    renderSection();
    expect(await screen.findByText("NexaCore ERP")).toBeInTheDocument();
    expect(screen.queryByTestId("help-tip")).not.toBeInTheDocument();
  });
});
