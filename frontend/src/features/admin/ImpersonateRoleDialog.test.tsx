import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ImpersonateRoleDialog from "./ImpersonateRoleDialog";
import { AuthProvider } from "@/hooks/AuthContext";
import { api, auth, setToken } from "@/api/client";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  auth: { impersonate: vi.fn() },
  setToken: vi.fn(),
}));

function wrap(ui: React.ReactNode) {
  return render(
    <MemoryRouter>
      <AuthProvider
        user={{
          id: "u-admin",
          email: "a@x",
          display_name: "A",
          role: "admin",
          is_active: true,
          permissions: { "*": true },
        }}
        refreshUser={async () => {}}
      >
        {ui}
      </AuthProvider>
    </MemoryRouter>,
  );
}

const MOCK_ROLES = [
  { id: "1", key: "admin", label: "Admin", color: "#000", is_system: true, is_default: false, is_archived: false, permissions: {}, sort_order: 1 },
  { id: "2", key: "member", label: "Member", color: "#000", is_system: false, is_default: true, is_archived: false, permissions: {}, sort_order: 2 },
  { id: "3", key: "viewer", label: "Viewer", color: "#000", is_system: false, is_default: false, is_archived: false, permissions: {}, sort_order: 3 },
  { id: "4", key: "old", label: "Archived role", color: "#000", is_system: false, is_default: false, is_archived: true, permissions: {}, sort_order: 4 },
];

describe("ImpersonateRoleDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_ROLES);
  });

  it("does not fetch roles when closed", () => {
    wrap(<ImpersonateRoleDialog open={false} onClose={() => {}} onSuccess={() => {}} />);
    expect(api.get).not.toHaveBeenCalled();
  });

  it("fetches roles on open and excludes admin + archived", async () => {
    wrap(<ImpersonateRoleDialog open onClose={() => {}} onSuccess={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/roles"));
    // Open the Select to make its options visible in the DOM.
    fireEvent.mouseDown(screen.getByRole("combobox"));
    await screen.findByRole("option", { name: "Member" });
    expect(screen.queryByRole("option", { name: "Admin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Archived role" })).not.toBeInTheDocument();
  });

  it("confirm calls auth.impersonate and onSuccess", async () => {
    (auth.impersonate as ReturnType<typeof vi.fn>).mockResolvedValue({
      access_token: "new-jwt",
    });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    wrap(<ImpersonateRoleDialog open onClose={onClose} onSuccess={onSuccess} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Viewer" }));
    fireEvent.click(screen.getByRole("button", { name: /Start viewing/i }));

    await waitFor(() => expect(auth.impersonate).toHaveBeenCalledWith("viewer"));
    expect(setToken).toHaveBeenCalledWith("new-jwt");
    expect(onSuccess).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("renders an error when impersonate API fails", async () => {
    (auth.impersonate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Forbidden"));
    wrap(<ImpersonateRoleDialog open onClose={() => {}} onSuccess={() => {}} />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "Member" }));
    fireEvent.click(screen.getByRole("button", { name: /Start viewing/i }));

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
  });
});
