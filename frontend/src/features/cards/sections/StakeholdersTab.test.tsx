import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks — declared via vi.hoisted so the mock factories can reference them
// before the module under test imports the mocked modules.
// ---------------------------------------------------------------------------

const { authRef } = vi.hoisted(() => ({
  authRef: {
    user: null as {
      id: string;
      email: string;
      permissions?: Record<string, boolean>;
    } | null,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: authRef.user }),
}));

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import i18n from "@/i18n";
import { api } from "@/api/client";
import StakeholdersTab from "./StakeholdersTab";
import type { Card } from "@/types";

const card: Card = {
  id: "card-1",
  type: "Application",
  name: "Test App",
} as unknown as Card;

const ROLES = [
  { key: "responsible", label: "Responsible", allowed_types: null, color: "#ff0000" },
  // No colour: what the API sends for a role with no definition row (the
  // legacy card_types.stakeholder_roles mirror, or the hardcoded defaults).
  { key: "observer", label: "Observer", allowed_types: null },
  {
    key: "contractOwner",
    label: "Contract Owner",
    allowed_types: null,
    description: "Signs and renews the vendor contract.",
    translations: {
      label: { de: "Vertragsverantwortlicher" },
      description: { de: "Unterschreibt den Vertrag." },
    },
  },
];

const USERS = [
  {
    id: "u1",
    email: "alice@nexatech.com",
    display_name: "Alice Wonder",
    is_active: true,
    role: "member",
  },
  {
    id: "u2",
    email: "bob@nexatech.com",
    display_name: "Bob Builder",
    is_active: true,
    role: "member",
  },
];

function primeApi() {
  const get = api.get as unknown as ReturnType<typeof vi.fn>;
  get.mockImplementation((path: string) => {
    if (path.startsWith("/cards/") && path.endsWith("/stakeholders")) {
      return Promise.resolve([]);
    }
    if (path.startsWith("/stakeholder-roles")) {
      return Promise.resolve(ROLES);
    }
    if (path === "/users") {
      return Promise.resolve(USERS);
    }
    return Promise.resolve([]);
  });
  (api.post as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (api.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  primeApi();
});

async function openPicker() {
  // Click "Add Stakeholder", then pick the role so the user picker enables.
  await userEvent.click(screen.getByRole("button", { name: /add stakeholder/i }));
  const roleInput = screen.getByLabelText(/^role$/i);
  await userEvent.click(roleInput);
  await userEvent.click(await screen.findByRole("option", { name: /^responsible$/i }));
}

describe("StakeholdersTab", () => {
  it("filters users by email substring", async () => {
    authRef.user = {
      id: "me",
      email: "me@test.com",
      permissions: { "users.invite": true },
    };
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/users"));

    await openPicker();
    const userInput = screen.getByLabelText(/^user$/i);
    await userEvent.click(userInput);
    await userEvent.type(userInput, "bob@");

    // Bob matches by email, Alice does not.
    expect(await screen.findByText(/bob@nexatech\.com/i)).toBeInTheDocument();
    expect(screen.queryByText(/alice@nexatech\.com/i)).not.toBeInTheDocument();
  });

  it("shows the Invite sentinel for an email that doesn't match any user", async () => {
    authRef.user = {
      id: "me",
      email: "me@test.com",
      permissions: { "users.invite": true },
    };
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/users"));

    await openPicker();
    const userInput = screen.getByLabelText(/^user$/i);
    await userEvent.click(userInput);
    await userEvent.type(userInput, "stranger@example.com");

    expect(
      await screen.findByText(/add\s+«stranger@example\.com»\s+as a new user/i)
    ).toBeInTheDocument();
  });

  it("always shows a generic 'Add a new user' row when no email is typed", async () => {
    // Discoverability: a user with users.invite should see the affordance
    // regardless of what they type — including before they type anything.
    authRef.user = {
      id: "me",
      email: "me@test.com",
      permissions: { "users.invite": true },
    };
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/users"));

    await openPicker();
    const userInput = screen.getByLabelText(/^user$/i);
    await userEvent.click(userInput);

    expect(await screen.findByText(/add a new user/i)).toBeInTheDocument();
  });

  it("hides the Invite sentinel when the user lacks users.invite", async () => {
    authRef.user = {
      id: "me",
      email: "me@test.com",
      permissions: {},
    };
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/users"));

    await openPicker();
    const userInput = screen.getByLabelText(/^user$/i);
    await userEvent.click(userInput);
    await userEvent.type(userInput, "stranger@example.com");

    // Wait for the noOptionsText / dropdown to settle, then assert absence.
    await waitFor(() => {
      expect(
        screen.queryByText(/add\s+«stranger@example\.com»\s+as a new user/i)
      ).not.toBeInTheDocument();
    });
  });

  it("clicking the Add-new-user row opens an inline form prefilled with the typed email", async () => {
    authRef.user = {
      id: "me",
      email: "me@test.com",
      permissions: { "users.invite": true },
    };
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/users"));

    await openPicker();
    const userInput = screen.getByLabelText(/^user$/i);
    await userEvent.click(userInput);
    await userEvent.type(userInput, "newhire@nexatech.com");

    const inviteRow = await screen.findByText(/add\s+«newhire@nexatech\.com»\s+as a new user/i);
    await userEvent.click(inviteRow);

    // Inline add-user form appears with the typed email prefilled and the
    // display-name field empty.
    expect(await screen.findByText(/add new user/i)).toBeInTheDocument();
    const emailField = screen.getByLabelText(/^email$/i) as HTMLInputElement;
    expect(emailField.value).toBe("newhire@nexatech.com");
    const displayNameField = screen.getByLabelText(/display name/i) as HTMLInputElement;
    expect(displayNameField.value).toBe("");
  });

  it("Add user POSTs /users then /cards/{id}/stakeholders", async () => {
    authRef.user = {
      id: "me",
      email: "me@test.com",
      permissions: { "users.invite": true },
    };
    (api.post as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (path: string) => {
        if (path === "/users") {
          return Promise.resolve({
            id: "u3",
            email: "newhire@nexatech.com",
            email_sent: false,
          });
        }
        return Promise.resolve({});
      }
    );

    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/users"));

    await openPicker();
    const userInput = screen.getByLabelText(/^user$/i);
    await userEvent.click(userInput);
    await userEvent.type(userInput, "newhire@nexatech.com");
    await userEvent.click(
      await screen.findByText(/add\s+«newhire@nexatech\.com»\s+as a new user/i)
    );
    await userEvent.type(screen.getByLabelText(/display name/i), "New Hire");
    await userEvent.click(screen.getByRole("button", { name: /add user/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/users", {
        email: "newhire@nexatech.com",
        display_name: "New Hire",
        role: "member",
        send_email: false,
      });
    });
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith("/cards/card-1/stakeholders", {
        user_id: "u3",
        role: "responsible",
      });
    });
  });

  it("marks each role group with the role's colour", async () => {
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);

    // The endpoint carries the colour; this tab was the one place that read it
    // and rendered nothing, so a role's colour never showed up on a card.
    const swatch = await screen.findByTestId("stakeholder-role-color-responsible");
    expect(swatch).toHaveStyle({ backgroundColor: "#ff0000" });
  });

  it("omits the accent when a role has no colour", async () => {
    // The API sends null for a role with no definition row rather than
    // inventing a colour, so the dot is skipped — same as the survey builder.
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);

    // Wait for the roles to land before asserting on an absence.
    await screen.findByTestId("stakeholder-role-color-responsible");
    expect(screen.queryByTestId("stakeholder-role-color-observer")).toBeNull();
  });
});

describe("StakeholdersTab — a data-quality jump", () => {
  it("opens the add form on addOn, with the role picker focused", async () => {
    const { rerender } = render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await screen.findByTestId("stakeholder-role-color-responsible");
    expect(screen.queryByTestId("stakeholder-add-form")).not.toBeInTheDocument();

    rerender(<StakeholdersTab card={card} onRefresh={() => {}} addOn={{ nonce: 1 }} />);
    const form = screen.getByTestId("stakeholder-add-form");
    expect(form).toContainElement(screen.getByLabelText(/^role$/i));
    expect(document.activeElement).toBe(screen.getByLabelText(/^role$/i));
  });

  it("ignores addOn without manage rights", async () => {
    render(
      <StakeholdersTab
        card={card}
        onRefresh={() => {}}
        canManageStakeholders={false}
        addOn={{ nonce: 1 }}
      />,
    );
    await screen.findByTestId("stakeholder-role-color-responsible");
    expect(screen.queryByTestId("stakeholder-add-form")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^role$/i)).not.toBeInTheDocument();
  });

  it("does not reopen the form for the same jump when the tab remounts", async () => {
    const jump = { nonce: 2 };
    const first = render(<StakeholdersTab card={card} onRefresh={() => {}} addOn={jump} />);
    expect(screen.getByTestId("stakeholder-add-form")).toBeInTheDocument();
    first.unmount();
    render(<StakeholdersTab card={card} onRefresh={() => {}} addOn={jump} />);
    await screen.findByTestId("stakeholder-role-color-responsible");
    expect(screen.queryByTestId("stakeholder-add-form")).not.toBeInTheDocument();
  });
});

describe("StakeholdersTab — role descriptions", () => {
  beforeEach(() => {
    authRef.user = { id: "me", email: "me@test.com", permissions: {} };
  });

  it("puts an info icon beside a role that has a description, and none otherwise", async () => {
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    const icon = await screen.findByRole("button", { name: "Signs and renews the vendor contract." });
    expect(icon).toBeInTheDocument();
    expect(screen.getAllByTestId("help-tip")).toHaveLength(1);
    expect(screen.getByText("Contract Owner")).toBeInTheDocument();
  });

  it("shows the description under the role in the picker", async () => {
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /add stakeholder/i }));
    await userEvent.click(screen.getByLabelText(/^role$/i));
    const option = await screen.findByRole("option", { name: /contract owner/i });
    expect(option).toHaveTextContent("Signs and renews the vendor contract.");
    expect(screen.getByRole("option", { name: /^observer$/i })).toBeInTheDocument();
  });

  it("renders a URL in a role's description as a link in the picker", async () => {
    const get = api.get as unknown as ReturnType<typeof vi.fn>;
    const base = get.getMockImplementation() as (path: string) => Promise<unknown>;
    get.mockImplementation((path: string) =>
      path.startsWith("/stakeholder-roles")
        ? Promise.resolve([
            {
              key: "contractOwner",
              label: "Contract Owner",
              allowed_types: null,
              description: "See https://example.com/x for the policy.",
            },
          ])
        : base(path),
    );
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /add stakeholder/i }));
    await userEvent.click(screen.getByLabelText(/^role$/i));
    const option = await screen.findByRole("option", { name: /contract owner/i });
    const link = within(option).getByRole("link", { name: "https://example.com/x" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(option).toHaveTextContent("See https://example.com/x for the policy.");
  });

  it("resolves the role's label and description in the user's language", async () => {
    await i18n.changeLanguage("de");
    try {
      render(<StakeholdersTab card={card} onRefresh={() => {}} />);
      expect(await screen.findByText("Vertragsverantwortlicher")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Unterschreibt den Vertrag." })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("names an empty role group in lower case", async () => {
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    expect(await screen.findByText("No responsible assigned")).toBeInTheDocument();
    expect(screen.getByText("No contract owner assigned")).toBeInTheDocument();
  });

  it("shows the picked role's label in the picker and only the label for a role without description", async () => {
    render(<StakeholdersTab card={card} onRefresh={() => {}} />);
    await userEvent.click(await screen.findByRole("button", { name: /add stakeholder/i }));
    const roleInput = screen.getByLabelText(/^role$/i);
    await userEvent.click(roleInput);
    expect(await screen.findByRole("option", { name: /^observer$/i })).toHaveTextContent(
      /^Observer$/,
    );
    await userEvent.click(screen.getByRole("option", { name: /contract owner/i }));
    expect(roleInput).toHaveValue("Contract Owner");
  });
});
