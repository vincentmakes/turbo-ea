import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

vi.mock("@/hooks/useResolveLabel", () => ({
  useResolveLabel: () => (label: string) => label,
}));

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
