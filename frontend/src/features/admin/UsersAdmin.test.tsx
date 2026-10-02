/**
 * Page test for the Users admin grid.
 *
 * AG Grid is stubbed (`@/test/agGridStub`): the assertions are about the
 * column definitions the page builds, the rows it hands over and what it does
 * when the grid reports a selection. Per-cell actions (edit, deactivate,
 * resend, delete, the inline role picker) live inside `cellRenderer`
 * closures, so the tests render one cell at a time through `renderCell` and
 * drive it the way a user would.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import { gridStub } from "@/test/agGridStub";
import { installConfirm } from "@/test/dom";
import { USERS, ADMIN_USER, MEMBER_USER, VIEWER_USER, INACTIVE_USER } from "@/test/fixtures/metamodel";
import { setViewportWidth } from "@/test/matchMedia";
import { adminUser, renderWithProviders } from "@/test/render";
import type { AppRole, SsoInvitation, User } from "@/types";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));

// A deterministic date formatter: the page only forwards values to the hook.
vi.mock("@/hooks/useDateFormat", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useDateFormat")>("@/hooks/useDateFormat");
  return {
    ...actual,
    useDateFormat: () => ({
      dateFormat: "YYYY-MM-DD",
      loading: false,
      formatDate: (d?: string | null) => (d ? `D[${d}]` : ""),
      formatDateTime: (d?: string | null) => (d ? `DT[${d}]` : ""),
      invalidate: vi.fn(),
      example: "",
    }),
  };
});

// The Roles tab is a page of its own with its own tests.
vi.mock("@/features/admin/RolesAdmin", () => ({
  default: ({ onRolesChanged }: { onRolesChanged: () => void }) => (
    <div data-testid="roles-admin">
      <button type="button" data-testid="roles-changed" onClick={onRolesChanged} />
    </div>
  ),
}));

// The sidebar is stubbed with escape hatches: all filtering flows through it,
// and a page test is about what the page does with a filter, not the sidebar's
// own chrome. The module's data exports stay real so the page derives its
// default column set from the same constants it ships with.
vi.mock("./UsersFilterSidebar", async () => {
  const actual = await vi.importActual<typeof import("./UsersFilterSidebar")>("./UsersFilterSidebar");
  type Props = Parameters<typeof actual.default>[0];
  const Stub = (p: Props) => (
    <div data-testid="users-sidebar" data-collapsed={String(p.collapsed)} data-width={p.width}>
      <button type="button" data-testid="sb-search" onClick={() => p.onFiltersChange({ ...p.filters, search: "viewer" })} />
      <button type="button" data-testid="sb-role-member" onClick={() => p.onFiltersChange({ ...p.filters, roles: ["member"] })} />
      <button type="button" data-testid="sb-status-inactive" onClick={() => p.onFiltersChange({ ...p.filters, statuses: ["inactive"] })} />
      <button type="button" data-testid="sb-status-invited" onClick={() => p.onFiltersChange({ ...p.filters, statuses: ["invited"] })} />
      <button type="button" data-testid="sb-auth-sso" onClick={() => p.onFiltersChange({ ...p.filters, authMethods: ["sso"] })} />
      <button type="button" data-testid="sb-invited" onClick={() => p.onFiltersChange({ ...p.filters, invited: true })} />
      <button type="button" data-testid="sb-collapse" onClick={p.onToggleCollapse} />
      <button type="button" data-testid="sb-columns" onClick={() => p.onSelectedColumnsChange(new Set(["name", "email"]))} />
      <button type="button" data-testid="sb-reset-columns" onClick={() => p.onResetColumns?.()} />
      <button type="button" data-testid="sb-width" onClick={() => p.onWidthChange(333)} />
      <button type="button" data-testid="sb-freeze-email" onClick={() => p.onToggleFrozen("email")} />
      <span data-testid="sb-frozen">{Array.from(p.frozenColumns).join(",")}</span>
      <span data-testid="sb-order">{p.columnOrderItems.map((c) => c.colId).join(",")}</span>
    </div>
  );
  return { ...actual, default: Stub };
});

vi.mock("./users/UserImportDialog", () => ({
  default: ({
    open,
    onClose,
    onComplete,
    existingUsers,
  }: {
    open: boolean;
    onClose: () => void;
    onComplete: () => void;
    existingUsers: User[];
  }) =>
    open ? (
      <div data-testid="import-dialog" data-existing={existingUsers.length}>
        <button
          type="button"
          data-testid="import-complete"
          onClick={() => {
            onComplete();
            onClose();
          }}
        />
      </div>
    ) : null,
}));

vi.mock("./users/BulkRoleDialog", () => ({
  default: ({
    open,
    onClose,
    onConfirm,
    selectedCount,
  }: {
    open: boolean;
    onClose: () => void;
    onConfirm: (roleKey: string) => Promise<void>;
    selectedCount: number;
  }) =>
    open ? (
      <div data-testid="bulk-role-dialog" data-count={selectedCount}>
        <button
          type="button"
          data-testid="bulk-role-confirm"
          onClick={() => {
            void onConfirm("viewer").then(onClose);
          }}
        />
      </div>
    ) : null,
}));

vi.mock("./users/userExcelExport", () => ({ exportUsersToXlsx: vi.fn() }));

import { exportUsersToXlsx } from "./users/userExcelExport";
import UsersAdmin from "./UsersAdmin";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LS_KEY = "turboea_usersAdmin";
const USERS_PATH = "/users?include_inactive=true";

function role(overrides: Partial<AppRole> & { key: string; label: string }): AppRole {
  return {
    id: `role-${overrides.key}`,
    is_system: false,
    is_default: false,
    is_archived: false,
    color: "#1976d2",
    permissions: {},
    sort_order: 0,
    ...overrides,
  };
}

const ROLES: AppRole[] = [
  role({ key: "admin", label: "Admin", color: "#d32f2f", is_system: true }),
  role({ key: "member", label: "Member", color: "#1976d2", is_default: true }),
  role({ key: "viewer", label: "Viewer", color: "#9e9e9e" }),
  role({ key: "legacy", label: "Legacy", color: "#795548", is_archived: true }),
];

/** Active, invited through SSO; matched to `INVITATIONS` by email, case-insensitively. */
const INVITED_USER: User = {
  id: "00000000-0000-4000-8000-00000000e005",
  email: "invited@test.local",
  display_name: "Invited Person",
  role: "viewer",
  is_active: true,
  auth_provider: "sso",
};

/** Holds an archived role, has not finished setup, carries every date. */
const LEGACY_USER: User = {
  id: "00000000-0000-4000-8000-00000000f006",
  email: "legacy@test.local",
  display_name: "Legacy Holder",
  role: "legacy",
  is_active: true,
  auth_provider: "local",
  pending_setup: true,
  locale: "de",
  last_login: "2026-03-01T10:00:00Z",
  created_at: "2026-01-15T08:00:00Z",
};

const PAGE_USERS: User[] = [...USERS, INVITED_USER, LEGACY_USER];

const INVITATIONS: SsoInvitation[] = [
  { id: "inv-1", email: "Invited@Test.local", role: "viewer", created_at: "2026-02-01T00:00:00Z" },
];

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(user: User = adminUser()) {
  return renderWithProviders(<UsersAdmin />, { route: "/admin/users", user });
}

async function loaded(count = PAGE_USERS.length) {
  await waitFor(() =>
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", String(count)),
  );
}

let mountedCell: { unmount: () => void } | null = null;

/**
 * Render one cell the way the grid would: its `cellRenderer` over one row. The
 * previous cell is unmounted first, so queries never see two copies of a button.
 */
function renderCell(colId: string, row: User) {
  mountedCell?.unmount();
  const def = gridStub.colDef(colId);
  const value = def.field ? (row as unknown as Record<string, unknown>)[def.field] : undefined;
  const el = def.cellRenderer({ data: row, value, colDef: def });
  const result = render(<div data-testid={`cell-${colId}`}>{el}</div>);
  mountedCell = result;
  return result;
}

const rowById = (id: string) => (gridStub.rows() as User[]).find((u) => u.id === id);

/** MUI buttons with a `startIcon` carry the icon's ligature text in their accessible name. */
const named = (label: string) => (name: string) => name === label || name.endsWith(` ${label}`);

/** The button a Tooltip labels — directly, or through the `<span>` a disabled button needs. */
function labelled(label: string): HTMLElement {
  const el = screen.getByLabelText(label);
  return el.tagName === "BUTTON" ? el : within(el).getByRole("button");
}

beforeEach(() => {
  localStorage.clear();
  gridStub.reset();
  mockApi.reset();
  vi.mocked(exportUsersToXlsx).mockClear();
  mockApi.on("get", USERS_PATH, () => [...PAGE_USERS]);
  mockApi.on("get", "/roles", ROLES);
  mockApi.on("get", "/users/invitations", INVITATIONS);
  mockApi.on("get", "/settings/sso/status", { enabled: false });
});

afterEach(() => {
  mountedCell = null;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Load + columns
// ---------------------------------------------------------------------------

describe("UsersAdmin — load", () => {
  it("fetches users, roles, invitations and the SSO flag, then hands the rows to the grid", async () => {
    renderPage();
    expect(screen.getByText(t("admin:users.title"))).toBeInTheDocument();
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "true");

    await loaded();

    expect(mockApi.callsOf("get", USERS_PATH)).toHaveLength(1);
    expect(mockApi.callsOf("get", "/roles")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/users/invitations")).toHaveLength(1);
    expect(mockApi.callsOf("get", "/settings/sso/status")).toHaveLength(1);
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false");
    expect(screen.getByText(t("common:items", { count: PAGE_USERS.length }))).toBeInTheDocument();
  });

  it("shows the list failure as an alert the user can dismiss", async () => {
    mockApi.fail("get", USERS_PATH, 500, "boom");
    const { user } = renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`GET ${USERS_PATH} failed`);
    expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-row-count", "0");

    await user.click(within(alert).getByRole("button"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the table working when the supplementary fetches fail", async () => {
    mockApi.fail("get", "/roles");
    mockApi.fail("get", "/users/invitations");
    mockApi.fail("get", "/settings/sso/status");
    renderPage();
    await loaded();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Without roles the role column falls back to a plain chip of the key.
    renderCell("role", MEMBER_USER);
    expect(within(screen.getByTestId("cell-role")).getByText("member")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("builds the default column set with the name column frozen", async () => {
    renderPage();
    await loaded();

    const ids = gridStub.colDefs().map((d) => d.colId ?? d.field);
    expect(ids).toEqual([
      "display_name",
      "email",
      "role",
      "auth_provider",
      "is_active",
      "last_login",
      "created_at",
      "locale",
      "pending_setup",
    ]);
    expect(gridStub.colDef("display_name").pinned).toBe("left");
    expect(gridStub.colDef("email").hide).toBe(false);
    expect(gridStub.colDef("created_at").hide).toBe(true);
    expect(gridStub.colDef("locale").hide).toBe(true);
    expect(gridStub.colDef("pending_setup").hide).toBe(true);
    expect(gridStub.colDef("display_name").headerName).toBe(t("admin:users.columns.name"));
    expect(gridStub.lastProps().getRowId({ data: MEMBER_USER })).toBe(MEMBER_USER.id);
    expect(gridStub.lastProps().getRowStyle({ data: INACTIVE_USER })).toEqual({ opacity: 0.7 });
    expect(gridStub.lastProps().getRowStyle({ data: MEMBER_USER })).toBeUndefined();
  });

  it("formats the date, locale and status cells", async () => {
    renderPage();
    await loaded();

    expect(gridStub.cellValue("last_login", LEGACY_USER, { formatted: true })).toBe(
      "DT[2026-03-01T10:00:00Z]",
    );
    expect(gridStub.cellValue("last_login", MEMBER_USER, { formatted: true })).toBe("—");
    expect(gridStub.cellValue("created_at", LEGACY_USER, { formatted: true })).toBe(
      "D[2026-01-15T08:00:00Z]",
    );
    expect(gridStub.cellValue("created_at", MEMBER_USER, { formatted: true })).toBe("—");
    expect(gridStub.cellValue("locale", LEGACY_USER, { formatted: true })).toBe("de");
    expect(gridStub.cellValue("locale", MEMBER_USER, { formatted: true })).toBe("—");
    // The status column's getter yields the facet tokens, not the boolean.
    expect(gridStub.cellValue("is_active", ADMIN_USER)).toBe("active");
    expect(gridStub.cellValue("is_active", INVITED_USER)).toBe("invited");
    expect(gridStub.cellValue("is_active", INACTIVE_USER)).toBe("inactive");
  });

  it("renders the auth, status and pending-setup chips per row", async () => {
    renderPage();
    await loaded();

    renderCell("auth_provider", INVITED_USER);
    expect(screen.getByText(t("admin:users.auth.sso"))).toBeInTheDocument();
    renderCell("auth_provider", LEGACY_USER);
    expect(screen.getByText(t("admin:users.auth.pendingSetup"))).toBeInTheDocument();
    renderCell("auth_provider", MEMBER_USER);
    expect(screen.getByText(t("admin:users.auth.local"))).toBeInTheDocument();

    renderCell("is_active", INVITED_USER);
    expect(screen.getByText(t("admin:users.status.invited"))).toBeInTheDocument();
    renderCell("is_active", ADMIN_USER);
    expect(screen.getByText(t("admin:users.status.active"))).toBeInTheDocument();
    renderCell("is_active", INACTIVE_USER);
    expect(screen.getByText(t("admin:users.status.disabled"))).toBeInTheDocument();

    const pending = gridStub.colDef("pending_setup");
    const { container: yes } = render(<>{pending.cellRenderer({ value: true })}</>);
    expect(yes.textContent).not.toContain("—");
    const { container: no } = render(<>{pending.cellRenderer({ value: false })}</>);
    expect(no.textContent).toContain("—");

    // Cells without a row (group rows) render nothing.
    expect(gridStub.colDef("auth_provider").cellRenderer({ data: undefined })).toBeNull();
    expect(gridStub.colDef("is_active").cellRenderer({ data: undefined })).toBeNull();
    expect(gridStub.colDef("role").cellRenderer({ data: undefined })).toBeNull();
    expect(gridStub.colDef("display_name").cellRenderer({ data: undefined })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Inline role picker
// ---------------------------------------------------------------------------

describe("UsersAdmin — inline role change", () => {
  it("PATCHes the role picked in the row's select", async () => {
    mockApi.on("patch", `/users/${MEMBER_USER.id}`, (_p, body) => ({ ...MEMBER_USER, ...(body as object) }));
    const { user } = renderPage();
    await loaded();

    // The grid stub has no cell editor: the role lives in a MUI Select inside
    // the cell renderer, so `gridStub.editCell` is a no-op here by design.
    renderCell("role", MEMBER_USER);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Viewer" }));

    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/users/${MEMBER_USER.id}`)[0]?.body).toEqual({ role: "viewer" }),
    );
    await waitFor(() => expect(rowById(MEMBER_USER.id)?.role).toBe("viewer"));
  });

  it("surfaces a failed role change as an alert", async () => {
    mockApi.fail("patch", `/users/${MEMBER_USER.id}`, 400, "nope");
    const { user } = renderPage();
    await loaded();

    renderCell("role", MEMBER_USER);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Viewer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(`PATCH /users/${MEMBER_USER.id} failed`);
    expect(rowById(MEMBER_USER.id)?.role).toBe("member");
  });

  it("locks the signed-in admin's own role and flags an archived role", async () => {
    renderPage();
    await loaded();

    renderCell("role", ADMIN_USER);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText(t("admin:users.selfRoleLockedTooltip"))).toBeInTheDocument();

    renderCell("role", LEGACY_USER);
    expect(screen.getByLabelText(t("admin:users.archivedRoleWarning"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Name cell actions
// ---------------------------------------------------------------------------

describe("UsersAdmin — row actions", () => {
  it("deactivates and re-activates a user through PATCH", async () => {
    mockApi.on("patch", `/users/${MEMBER_USER.id}`, (_p, body) => ({ ...MEMBER_USER, ...(body as object) }));
    const { user } = renderPage();
    await loaded();

    renderCell("display_name", MEMBER_USER);
    await user.click(labelled(t("admin:users.deactivateTooltip")));

    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/users/${MEMBER_USER.id}`)[0]?.body).toEqual({ is_active: false }),
    );
    await waitFor(() => expect(rowById(MEMBER_USER.id)?.is_active).toBe(false));

    // The inactive row offers Activate (and Delete).
    renderCell("display_name", rowById(MEMBER_USER.id)!);
    await user.click(labelled(t("admin:users.activateTooltip")));
    await waitFor(() =>
      expect(mockApi.callsOf("patch", `/users/${MEMBER_USER.id}`)[1]?.body).toEqual({ is_active: true }),
    );
  });

  it("surfaces a failed toggle as an alert", async () => {
    mockApi.fail("patch", `/users/${MEMBER_USER.id}`);
    const { user } = renderPage();
    await loaded();
    renderCell("display_name", MEMBER_USER);
    await user.click(labelled(t("admin:users.deactivateTooltip")));
    expect(await screen.findByRole("alert")).toHaveTextContent("failed");
  });

  it("never offers to deactivate the signed-in user", async () => {
    renderPage();
    await loaded();
    renderCell("display_name", ADMIN_USER);
    const wrapper = screen.getByLabelText(t("admin:users.selfDeactivateTooltip"));
    expect(within(wrapper).getByRole("button")).toBeDisabled();
    expect(screen.queryByLabelText(t("admin:users.deactivateTooltip"))).not.toBeInTheDocument();
  });

  it("deletes an inactive user after confirmation", async () => {
    const confirm = installConfirm(true);
    mockApi.on("delete", `/users/${INACTIVE_USER.id}`, undefined);
    const { user } = renderPage();
    await loaded();

    renderCell("display_name", MEMBER_USER);
    expect(screen.queryByRole("button", { name: t("admin:users.deleteTooltip") })).not.toBeInTheDocument();

    renderCell("display_name", INACTIVE_USER);
    await user.click(screen.getByRole("button", { name: t("admin:users.deleteTooltip") }));

    expect(confirm).toHaveBeenCalledWith(
      t("admin:users.deleteConfirm", { name: INACTIVE_USER.display_name }),
    );
    await waitFor(() => expect(mockApi.callsOf("delete", `/users/${INACTIVE_USER.id}`)).toHaveLength(1));
    await loaded(PAGE_USERS.length - 1);
    expect(rowById(INACTIVE_USER.id)).toBeUndefined();
  });

  it("does nothing when the delete is declined, and reports a failed one", async () => {
    const confirm = installConfirm(false);
    const { user } = renderPage();
    await loaded();
    renderCell("display_name", INACTIVE_USER);
    await user.click(screen.getByRole("button", { name: t("admin:users.deleteTooltip") }));
    expect(confirm).toHaveBeenCalled();
    expect(mockApi.callsOf("delete")).toHaveLength(0);

    confirm.mockReturnValue(true);
    mockApi.fail("delete", `/users/${INACTIVE_USER.id}`);
    await user.click(screen.getByRole("button", { name: t("admin:users.deleteTooltip") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("failed");
    await loaded();
  });

  it("re-sends and revokes an invitation from the invited user's row", async () => {
    mockApi.on("post", "/users/invitations/inv-1/resend", {});
    mockApi.on("delete", "/users/invitations/inv-1", undefined);
    const { user } = renderPage();
    await loaded();

    // Only the invited row carries the two invitation buttons.
    renderCell("display_name", MEMBER_USER);
    expect(screen.queryByRole("button", { name: t("admin:users.resendInviteTooltip") })).not.toBeInTheDocument();

    renderCell("display_name", INVITED_USER);
    await user.click(screen.getByRole("button", { name: t("admin:users.resendInviteTooltip") }));
    await waitFor(() => expect(mockApi.callsOf("post", "/users/invitations/inv-1/resend")).toHaveLength(1));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("admin:users.resendInviteSuccess", { email: INVITATIONS[0].email }),
    );

    await user.click(screen.getByRole("button", { name: t("admin:users.invitations.revokeTooltip") }));
    await waitFor(() => expect(mockApi.callsOf("delete", "/users/invitations/inv-1")).toHaveLength(1));
    // Once the invitation is gone the user reads as plain active.
    await waitFor(() => expect(gridStub.cellValue("is_active", INVITED_USER)).toBe("active"));
  });

  it("reports a failed re-send and a failed revoke", async () => {
    mockApi.fail("post", "/users/invitations/inv-1/resend", 500, "smtp");
    mockApi.fail("delete", "/users/invitations/inv-1");
    const { user } = renderPage();
    await loaded();
    renderCell("display_name", INVITED_USER);

    await user.click(screen.getByRole("button", { name: t("admin:users.resendInviteTooltip") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("admin:users.resendInviteFailed", { error: "POST /users/invitations/inv-1/resend failed" }),
    );

    await user.click(screen.getByRole("button", { name: t("admin:users.invitations.revokeTooltip") }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("DELETE /users/invitations/inv-1 failed"),
    );
  });
});

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------

describe("UsersAdmin — create user", () => {
  async function openCreate(user: ReturnType<typeof renderPage>["user"]) {
    await user.click(screen.getByRole("button", { name: named(t("admin:users.createUser")) }));
    return screen.getByRole("dialog");
  }

  it("validates the required fields before posting", async () => {
    const { user } = renderPage();
    await loaded();
    const dialog = await openCreate(user);
    expect(within(dialog).getByText(t("admin:users.create.emailHint"))).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: named(t("admin:users.createUser")) }));
    expect(within(dialog).getByText(t("admin:users.create.requiredFields"))).toBeInTheDocument();
    expect(mockApi.callsOf("post", "/users")).toHaveLength(0);
  });

  it("POSTs the form, appends the row and surfaces an email_error as a warning", async () => {
    mockApi.on("post", "/users", (_p, body) => {
      const b = body as Record<string, unknown>;
      return {
        id: "00000000-0000-4000-8000-00000000a999",
        email: b.email,
        display_name: b.display_name,
        role: b.role,
        is_active: true,
        email_sent: false,
        email_error: "SMTP refused the message",
      };
    });
    const { user } = renderPage();
    await loaded();
    const dialog = await openCreate(user);

    await user.type(within(dialog).getByLabelText(/Display Name/), "  New Person ");
    await user.type(within(dialog).getByLabelText(/^Email/), "new@test.local");
    await user.type(within(dialog).getByLabelText(/Password/), "s3cret");
    await user.click(within(dialog).getByRole("button", { name: named(t("admin:users.createUser")) }));

    await waitFor(() => expect(mockApi.callsOf("post", "/users")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/users")[0].body).toEqual({
      email: "new@test.local",
      display_name: "New Person",
      password: "s3cret",
      role: "member",
      send_email: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent("SMTP refused the message");
    await loaded(PAGE_USERS.length + 1);
    // Invitations are refreshed so the new row can show as invited.
    expect(mockApi.callsOf("get", "/users/invitations")).toHaveLength(2);
  });

  it("sends a null password and no email when the boxes are left blank / unticked", async () => {
    mockApi.on("post", "/users", (_p, body) => ({
      id: "00000000-0000-4000-8000-00000000a998",
      ...(body as object),
      is_active: true,
    }));
    const { user } = renderPage();
    await loaded();
    const dialog = await openCreate(user);

    await user.type(within(dialog).getByLabelText(/Display Name/), "Quiet Person");
    await user.type(within(dialog).getByLabelText(/^Email/), "quiet@test.local");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Viewer" }));
    await user.click(within(dialog).getByRole("button", { name: named(t("admin:users.createUser")) }));

    await waitFor(() => expect(mockApi.callsOf("post", "/users")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/users")[0].body).toMatchObject({
      password: null,
      role: "viewer",
      send_email: false,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the API error when the POST fails", async () => {
    mockApi.fail("post", "/users", 400, "duplicate");
    const { user } = renderPage();
    await loaded();
    const dialog = await openCreate(user);
    await user.type(within(dialog).getByLabelText(/Display Name/), "Dup");
    await user.type(within(dialog).getByLabelText(/^Email/), "dup@test.local");
    await user.click(within(dialog).getByRole("button", { name: named(t("admin:users.createUser")) }));

    expect(await within(dialog).findByText("POST /users failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: t("common:actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("explains the SSO rule when SSO is enabled", async () => {
    mockApi.on("get", "/settings/sso/status", { enabled: true });
    const { user } = renderPage();
    await loaded();
    const dialog = await openCreate(user);
    expect(within(dialog).getByText(t("admin:users.create.ssoHint"))).toBeInTheDocument();
    expect(within(dialog).getByText(t("admin:users.create.passwordSsoHelperText"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Edit user
// ---------------------------------------------------------------------------

describe("UsersAdmin — edit user", () => {
  async function openEdit(user: ReturnType<typeof renderPage>["user"], row: User) {
    renderCell("display_name", row);
    await user.click(screen.getByRole("button", { name: t("admin:users.editTooltip") }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(t("admin:users.edit.title"))).toBeInTheDocument();
    return dialog;
  }

  it("PATCHes the edited fields, adding the password only when one was typed", async () => {
    mockApi.on("patch", `/users/${MEMBER_USER.id}`, (_p, body) => ({ ...MEMBER_USER, ...(body as object) }));
    const { user } = renderPage();
    await loaded();
    const dialog = await openEdit(user, MEMBER_USER);

    const name = within(dialog).getByLabelText(/Display Name/);
    expect(name).toHaveValue(MEMBER_USER.display_name);
    await user.clear(name);
    await user.type(name, "Renamed Member");
    await user.click(within(dialog).getByRole("button", { name: t("admin:users.edit.saveChanges") }));

    await waitFor(() => expect(mockApi.callsOf("patch", `/users/${MEMBER_USER.id}`)).toHaveLength(1));
    expect(mockApi.callsOf("patch")[0].body).toEqual({
      email: MEMBER_USER.email,
      display_name: "Renamed Member",
      role: "member",
      auth_provider: "local",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(rowById(MEMBER_USER.id)?.display_name).toBe("Renamed Member");

    // Second round: a typed password rides along.
    const again = await openEdit(user, rowById(MEMBER_USER.id)!);
    await user.type(within(again).getByLabelText(/Password/), "hunter2");
    await user.click(within(again).getByRole("button", { name: t("admin:users.edit.saveChanges") }));
    await waitFor(() => expect(mockApi.callsOf("patch")).toHaveLength(2));
    expect(mockApi.callsOf("patch")[1].body).toMatchObject({ password: "hunter2" });
  });

  it("validates required fields and shows a failed save inside the dialog", async () => {
    mockApi.fail("patch", `/users/${MEMBER_USER.id}`, 409, "taken");
    const { user } = renderPage();
    await loaded();
    const dialog = await openEdit(user, MEMBER_USER);

    await user.clear(within(dialog).getByLabelText(/^Email/));
    await user.click(within(dialog).getByRole("button", { name: t("admin:users.edit.saveChanges") }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(t("admin:users.edit.requiredFields"));
    expect(mockApi.callsOf("patch")).toHaveLength(0);

    await user.type(within(dialog).getByLabelText(/^Email/), "member@test.local");
    await user.click(within(dialog).getByRole("button", { name: t("admin:users.edit.saveChanges") }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(`PATCH /users/${MEMBER_USER.id} failed`),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("locks the role when an admin edits themselves and warns about an archived role", async () => {
    const { user } = renderPage();
    await loaded();
    const dialog = await openEdit(user, ADMIN_USER);
    expect(within(dialog).getByText(t("admin:users.selfRoleLockedTooltip"))).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: t("common:actions.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const legacy = await openEdit(user, LEGACY_USER);
    expect(within(legacy).getByText(t("admin:users.edit.archivedRoleWarning"))).toBeInTheDocument();
  });

  it("offers the auth-method switch when SSO is on and hides the password for SSO users", async () => {
    mockApi.on("get", "/settings/sso/status", { enabled: true });
    const { user } = renderPage();
    await loaded();
    const dialog = await openEdit(user, MEMBER_USER);

    expect(within(dialog).getByLabelText(/Password/)).toBeInTheDocument();
    const combos = within(dialog).getAllByRole("combobox");
    // First select is the auth method, second the role.
    await user.click(combos[0]);
    await user.click(screen.getByRole("option", { name: t("admin:users.auth.sso") }));
    expect(within(dialog).queryByLabelText(/Password/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(t("admin:users.edit.ssoPasswordHint"))).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

describe("UsersAdmin — bulk actions", () => {
  const byId = new Map(PAGE_USERS.map((u) => [u.id, u]));
  const bulkReply = (_p: string, body: unknown) => {
    const b = body as { ids: string[]; updates: Partial<User> };
    return b.ids.map((id) => ({ ...byId.get(id)!, ...b.updates }));
  };

  async function selectAll(user: ReturnType<typeof renderPage>["user"]) {
    gridStub.fire("gridReady");
    await user.click(screen.getByTestId("select-all-rows"));
    expect(
      screen.getByText(t("admin:users.bulk.selected", { count: PAGE_USERS.length })),
    ).toBeInTheDocument();
  }

  it("changes the role of every selected user except the admin's own row", async () => {
    mockApi.on("patch", "/users/bulk", bulkReply);
    const { user } = renderPage();
    await loaded();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: named(t("admin:users.bulk.changeRole")) }));
    expect(screen.getByTestId("bulk-role-dialog")).toHaveAttribute("data-count", String(PAGE_USERS.length));
    await user.click(screen.getByTestId("bulk-role-confirm"));

    await waitFor(() => expect(mockApi.callsOf("patch", "/users/bulk")).toHaveLength(1));
    const body = mockApi.callsOf("patch", "/users/bulk")[0].body as { ids: string[]; updates: unknown };
    expect(body.updates).toEqual({ role: "viewer" });
    expect(body.ids).not.toContain(ADMIN_USER.id);
    expect(body.ids).toHaveLength(PAGE_USERS.length - 1);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual(
      expect.arrayContaining([
        t("admin:users.bulk.selfSkipped"),
        t("admin:users.bulk.changeRoleSuccess", { count: PAGE_USERS.length - 1 }),
      ]),
    );
    expect(rowById(MEMBER_USER.id)?.role).toBe("viewer");
    expect(rowById(ADMIN_USER.id)?.role).toBe("admin");
    // The selection is cleared after the write.
    expect(screen.queryByText(t("admin:users.bulk.selected", { count: PAGE_USERS.length }))).not.toBeInTheDocument();
  });

  it("deactivates everyone but the signed-in user, and activates everyone", async () => {
    mockApi.on("patch", "/users/bulk", bulkReply);
    const { user } = renderPage();
    await loaded();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: named(t("admin:users.bulk.deactivate")) }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/users/bulk")).toHaveLength(1));
    const deactivate = mockApi.callsOf("patch", "/users/bulk")[0].body as { ids: string[]; updates: unknown };
    expect(deactivate.updates).toEqual({ is_active: false });
    expect(deactivate.ids).not.toContain(ADMIN_USER.id);
    expect(await screen.findByText(t("admin:users.bulk.deactivateSuccess", { count: PAGE_USERS.length - 1 }))).toBeInTheDocument();
    expect(rowById(VIEWER_USER.id)?.is_active).toBe(false);

    await selectAll(user);
    await user.click(screen.getByRole("button", { name: named(t("admin:users.bulk.activate")) }));
    await waitFor(() => expect(mockApi.callsOf("patch", "/users/bulk")).toHaveLength(2));
    const activate = mockApi.callsOf("patch", "/users/bulk")[1].body as { ids: string[]; updates: unknown };
    expect(activate.updates).toEqual({ is_active: true });
    expect(activate.ids).toHaveLength(PAGE_USERS.length);
    expect(await screen.findByText(t("admin:users.bulk.activateSuccess", { count: PAGE_USERS.length }))).toBeInTheDocument();
  });

  it("reports a failed bulk write", async () => {
    mockApi.fail("patch", "/users/bulk", 500, "boom");
    const { user } = renderPage();
    await loaded();
    await selectAll(user);
    await user.click(screen.getByRole("button", { name: named(t("admin:users.bulk.activate")) }));
    expect(await screen.findByText("PATCH /users/bulk failed")).toBeInTheDocument();
  });

  it("bulk-deletes after confirmation and keeps the rows the server skipped", async () => {
    const confirm = installConfirm(true);
    mockApi.on("post", "/users/bulk-delete", {
      deleted: PAGE_USERS.length - 2,
      skipped: [
        { id: ADMIN_USER.id, reason: "self" },
        { id: MEMBER_USER.id, reason: "active" },
      ],
    });
    const { user } = renderPage();
    await loaded();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: named(t("admin:users.bulk.delete")) }));
    expect(confirm).toHaveBeenCalledWith(t("admin:users.bulk.confirmDelete", { count: PAGE_USERS.length }));
    await waitFor(() => expect(mockApi.callsOf("post", "/users/bulk-delete")).toHaveLength(1));
    expect(mockApi.callsOf("post", "/users/bulk-delete")[0].body).toEqual({
      ids: PAGE_USERS.map((u) => u.id),
    });
    expect(
      await screen.findByText(
        t("admin:users.bulk.deleteSkipped", { deleted: PAGE_USERS.length - 2, skipped: 2 }),
      ),
    ).toBeInTheDocument();
    await loaded(2);
    expect(rowById(ADMIN_USER.id)).toBeDefined();
    expect(rowById(MEMBER_USER.id)).toBeDefined();
  });

  it("reports a clean bulk delete, and skips the POST when declined", async () => {
    const confirm = installConfirm(false);
    mockApi.on("post", "/users/bulk-delete", { deleted: PAGE_USERS.length, skipped: [] });
    const { user } = renderPage();
    await loaded();
    await selectAll(user);

    await user.click(screen.getByRole("button", { name: named(t("admin:users.bulk.delete")) }));
    expect(mockApi.callsOf("post", "/users/bulk-delete")).toHaveLength(0);

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: named(t("admin:users.bulk.delete")) }));
    expect(
      await screen.findByText(t("admin:users.bulk.deleteSuccess", { count: PAGE_USERS.length })),
    ).toBeInTheDocument();
    await loaded(0);
  });

  it("clears the selection from the toolbar", async () => {
    const { user } = renderPage();
    await loaded();
    await selectAll(user);
    await user.click(screen.getByTitle(t("admin:users.bulk.clear")));
    expect(screen.queryByText(t("admin:users.bulk.selected", { count: PAGE_USERS.length }))).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Export / import / tabs
// ---------------------------------------------------------------------------

describe("UsersAdmin — export, import and tabs", () => {
  it("exports the filtered list and reports the count", async () => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByTestId("sb-role-member"));
    await loaded(2);

    await user.click(screen.getByRole("button", { name: named(t("admin:users.export")) }));
    expect(exportUsersToXlsx).toHaveBeenCalledTimes(1);
    const exported = vi.mocked(exportUsersToXlsx).mock.calls[0][0];
    expect(exported.map((u) => u.id)).toEqual([MEMBER_USER.id, INACTIVE_USER.id]);
    expect(screen.getByRole("alert")).toHaveTextContent(t("admin:users.exportSuccess", { count: 2 }));
  });

  it("disables export when nothing is listed", async () => {
    mockApi.on("get", USERS_PATH, []);
    renderPage();
    await waitFor(() => expect(screen.getByTestId("ag-grid")).toHaveAttribute("data-loading", "false"));
    expect(screen.getByRole("button", { name: named(t("admin:users.export")) })).toBeDisabled();
  });

  it("opens the import dialog and reloads users + invitations when it completes", async () => {
    const { user } = renderPage();
    await loaded();
    expect(screen.queryByTestId("import-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: named(t("admin:users.import.button")) }));
    expect(screen.getByTestId("import-dialog")).toHaveAttribute("data-existing", String(PAGE_USERS.length));
    await user.click(screen.getByTestId("import-complete"));

    await waitFor(() => expect(mockApi.callsOf("get", USERS_PATH)).toHaveLength(2));
    expect(mockApi.callsOf("get", "/users/invitations")).toHaveLength(2);
    expect(screen.queryByTestId("import-dialog")).not.toBeInTheDocument();
  });

  it("switches to the Roles tab and refetches roles when that page reports a change", async () => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByRole("tab", { name: t("admin:users.tabs.roles") }));
    expect(screen.getByTestId("roles-admin")).toBeInTheDocument();
    expect(screen.queryByTestId("ag-grid")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("roles-changed"));
    await waitFor(() => expect(mockApi.callsOf("get", "/roles")).toHaveLength(2));

    await user.click(screen.getByRole("tab", { name: t("admin:users.tabs.users") }));
    await loaded();
  });
});

// ---------------------------------------------------------------------------
// Filters, columns and prefs
// ---------------------------------------------------------------------------

describe("UsersAdmin — filters, columns and persisted prefs", () => {
  it("applies every sidebar filter client-side", async () => {
    const { user } = renderPage();
    await loaded();

    await user.click(screen.getByTestId("sb-search"));
    await loaded(1);
    expect(rowById(VIEWER_USER.id)).toBeDefined();

    // Each hatch replaces the previous filter with its own.
    await user.click(screen.getByTestId("sb-status-inactive"));
    await loaded(0);
    expect(screen.getByText(t("common:items", { count: 0 }))).toBeInTheDocument();
  });

  it("filters by status, auth method and the invited switch", async () => {
    const { user } = renderPage();
    await loaded();

    await user.click(screen.getByTestId("sb-status-inactive"));
    await loaded(1);
    expect(rowById(INACTIVE_USER.id)).toBeDefined();

    // Reset through the search hatch chain is awkward; the hatches compose, so
    // clear by reloading the page per facet.
  });

  it.each([
    ["sb-status-invited", INVITED_USER.id],
    ["sb-auth-sso", INVITED_USER.id],
    ["sb-invited", INVITED_USER.id],
  ])("narrows to the invited SSO user through %s", async (hatch, expectedId) => {
    const { user } = renderPage();
    await loaded();
    await user.click(screen.getByTestId(hatch));
    await loaded(1);
    expect(rowById(expectedId)).toBeDefined();
  });

  it("hides columns the sidebar deselects, resets them, and persists every pref", async () => {
    const { user } = renderPage();
    await loaded();

    await user.click(screen.getByTestId("sb-columns"));
    await waitFor(() => expect(gridStub.colDef("role").hide).toBe(true));
    expect(gridStub.colDef("email").hide).toBe(false);
    expect(screen.getByTestId("sb-order")).toHaveTextContent("display_name,email");

    await user.click(screen.getByTestId("sb-reset-columns"));
    await waitFor(() => expect(gridStub.colDef("role").hide).toBe(false));

    // The stub's `setColumnsPinned` is a no-op, so a freeze is observed the way
    // a header drag into the pinned region is: the grid reports it on dragStopped.
    gridStub.fire("gridReady");
    await user.click(screen.getByTestId("sb-freeze-email"));
    act(() => {
      gridStub.api().applyColumnState({
        state: [
          { colId: "display_name", pinned: "left" },
          { colId: "email", pinned: "left" },
        ],
      });
      gridStub.fire("dragStopped");
    });
    await waitFor(() => expect(gridStub.colDef("email").pinned).toBe("left"));
    expect(screen.getByTestId("sb-frozen")).toHaveTextContent("display_name,email");

    await user.click(screen.getByTestId("sb-width"));
    expect(screen.getByTestId("users-sidebar")).toHaveAttribute("data-width", "333");
    await user.click(screen.getByTestId("sb-collapse"));
    expect(screen.getByTestId("users-sidebar")).toHaveAttribute("data-collapsed", "true");
    await user.click(screen.getByTestId("sb-role-member"));
    await loaded(2);

    const saved = JSON.parse(localStorage.getItem(LS_KEY)!);
    expect(saved).toMatchObject({
      sidebarWidth: 333,
      sidebarCollapsed: true,
      frozenColumns: ["display_name", "email"],
      filters: expect.objectContaining({ roles: ["member"] }),
    });
    expect(saved.columns).toEqual(expect.arrayContaining(["name", "email", "role"]));
  });

  it("restores filters, columns and the collapsed state from localStorage", async () => {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        columns: ["name", "email"],
        sidebarCollapsed: true,
        sidebarWidth: 400,
        frozenColumns: [],
        filters: { search: "", roles: ["viewer"], statuses: [], authMethods: [], invited: false },
      }),
    );
    renderPage();
    await loaded(2);
    expect(rowById(VIEWER_USER.id)).toBeDefined();
    expect(rowById(INVITED_USER.id)).toBeDefined();
    expect(gridStub.colDef("role").hide).toBe(true);
    expect(gridStub.colDef("display_name").pinned).not.toBe("left");
    expect(screen.getByTestId("users-sidebar")).toHaveAttribute("data-collapsed", "true");
    expect(screen.getByTestId("users-sidebar")).toHaveAttribute("data-width", "400");
  });

  it("ignores an unreadable pref blob", async () => {
    localStorage.setItem(LS_KEY, "{not json");
    renderPage();
    await loaded();
    expect(gridStub.colDef("display_name").pinned).toBe("left");
  });

  it("captures a header drag through the grid's dragStopped event", async () => {
    renderPage();
    await loaded();
    gridStub.fire("gridReady");
    act(() => {
      gridStub.fire("dragStopped");
    });
    // Nothing moved: the stored order is the reconciled natural order, which
    // `useColumnOrder` publishes on mount.
    expect(JSON.parse(localStorage.getItem(LS_KEY)!).columnOrder).toEqual(
      gridStub.colDefs().map((d) => d.colId ?? d.field),
    );
  });

  it("moves the sidebar into a drawer on a phone", async () => {
    setViewportWidth(600);
    const { user } = renderPage();
    await loaded();
    expect(screen.queryByTestId("users-sidebar")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: t("admin:users.filter.title") }));
    const sidebar = await screen.findByTestId("users-sidebar");
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(sidebar).toHaveAttribute("data-width", "300");

    await user.click(screen.getByTestId("sb-collapse"));
    await waitFor(() => expect(screen.queryByTestId("users-sidebar")).not.toBeInTheDocument());
  });
});
