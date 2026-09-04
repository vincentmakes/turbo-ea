/**
 * Tests for the card-type Permissions tab (discussion #1068).
 *
 * The matrix is tri-state per cell: inherit / allow / deny. What matters is
 * that only *overridden* cells are sent — an action left on inherit must stay
 * out of the payload so a later change to the role itself keeps flowing
 * through — and that the admin (wildcard) row can never be edited.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CardTypePermissionsPanel from "./CardTypePermissionsPanel";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/api/client", () => ({ api: apiMock }));

const MATRIX = {
  actions: [
    { key: "inventory.create", description: "Create new cards" },
    { key: "inventory.edit", description: "Edit any card" },
    { key: "inventory.archive", description: "Archive and restore cards" },
    { key: "inventory.delete", description: "Permanently delete cards" },
  ],
  roles: [
    {
      key: "admin",
      label: "Admin",
      color: "#d32f2f",
      is_system: true,
      is_wildcard: true,
      inherited: {
        "inventory.create": true,
        "inventory.edit": true,
        "inventory.archive": true,
        "inventory.delete": true,
      },
      overrides: {},
    },
    {
      key: "member",
      label: "Member",
      color: "#1976d2",
      is_system: false,
      is_wildcard: false,
      inherited: {
        "inventory.create": true,
        "inventory.edit": true,
        "inventory.archive": true,
        "inventory.delete": false,
      },
      overrides: {},
    },
    {
      key: "viewer",
      label: "Viewer",
      color: "#757575",
      is_system: false,
      is_wildcard: false,
      inherited: {
        "inventory.create": false,
        "inventory.edit": false,
        "inventory.archive": false,
        "inventory.delete": false,
      },
      overrides: { "inventory.create": true },
    },
  ],
};

function rowFor(label: string) {
  return screen.getByText(label).closest("tr") as HTMLElement;
}

/** Column order: role, create, edit, archive, delete, reset. */
const COLUMN = { create: 1, edit: 2, archive: 3, delete: 4 } as const;

/** Click one tri-state option in a role row's action cell. */
async function setCell(
  user: ReturnType<typeof userEvent.setup>,
  roleLabel: string,
  action: keyof typeof COLUMN,
  option: "Inherit from role" | "Allow" | "Deny",
) {
  const cell = rowFor(roleLabel).querySelectorAll("td")[COLUMN[action]] as HTMLElement;
  await user.click(within(cell).getByRole("button", { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue(structuredClone(MATRIX));
  apiMock.patch.mockResolvedValue({});
});

describe("CardTypePermissionsPanel", () => {
  it("renders one row per role and one column per action", async () => {
    render(<CardTypePermissionsPanel typeKey="Application" onError={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Member")).toBeInTheDocument());
    expect(apiMock.get).toHaveBeenCalledWith("/metamodel/types/Application/permissions");
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
    // Four actions, each rendered as a header cell.
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("locks the admin row — the wildcard role is never overridable", async () => {
    render(<CardTypePermissionsPanel typeKey="Application" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Admin")).toBeInTheDocument());

    const adminRow = rowFor("Admin");
    expect(within(adminRow).queryAllByRole("button")).toHaveLength(0);
  });

  it("sends only the overridden cell when one action is denied", async () => {
    const user = userEvent.setup();
    render(<CardTypePermissionsPanel typeKey="Application" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Member")).toBeInTheDocument());

    await setCell(user, "Member", "create", "Deny");

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    // The viewer's pre-existing override is preserved; only the member's new
    // deny is added. Actions left on inherit are absent, not written as false.
    expect(apiMock.patch).toHaveBeenCalledWith("/metamodel/types/Application", {
      role_permissions: {
        viewer: { "inventory.create": true },
        member: { "inventory.create": false },
      },
    });
  });

  it("removes the cell again when the action is set back to inherit", async () => {
    const user = userEvent.setup();
    render(<CardTypePermissionsPanel typeKey="Application" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Viewer")).toBeInTheDocument());

    await setCell(user, "Viewer", "create", "Inherit from role");

    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    expect(apiMock.patch).toHaveBeenCalledWith("/metamodel/types/Application", {
      role_permissions: {},
    });
  });

  it("resets a whole role row back to inherited", async () => {
    const user = userEvent.setup();
    render(<CardTypePermissionsPanel typeKey="Application" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Viewer")).toBeInTheDocument());

    const viewerRow = rowFor("Viewer");
    await user.click(
      within(viewerRow).getByRole("button", {
        name: "Reset this role to its inherited permissions",
      }),
    );
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
    expect(apiMock.patch).toHaveBeenCalledWith("/metamodel/types/Application", {
      role_permissions: {},
    });
  });

  it("keeps Save disabled until something actually changes", async () => {
    const user = userEvent.setup();
    render(<CardTypePermissionsPanel typeKey="Application" onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Member")).toBeInTheDocument());

    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();

    await setCell(user, "Member", "edit", "Deny");

    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("reports a failed load through onError", async () => {
    const onError = vi.fn();
    apiMock.get.mockRejectedValueOnce(new Error("boom"));

    render(<CardTypePermissionsPanel typeKey="Application" onError={onError} />);

    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
  });

  it("reports a failed save through onError and keeps the edit", async () => {
    const onError = vi.fn();
    const user = userEvent.setup();
    apiMock.patch.mockRejectedValueOnce(new Error("nope"));

    render(<CardTypePermissionsPanel typeKey="Application" onError={onError} />);
    await waitFor(() => expect(screen.getByText("Member")).toBeInTheDocument());

    await setCell(user, "Member", "create", "Deny");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("nope"));
    // Still dirty, so the user can retry rather than losing the change.
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("calls onSaved so the drawer can refresh the metamodel", async () => {
    const onSaved = vi.fn();
    const user = userEvent.setup();

    render(
      <CardTypePermissionsPanel typeKey="Application" onError={vi.fn()} onSaved={onSaved} />,
    );
    await waitFor(() => expect(screen.getByText("Member")).toBeInTheDocument());

    await setCell(user, "Member", "create", "Deny");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });
});
