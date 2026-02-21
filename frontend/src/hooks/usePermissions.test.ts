import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mock the api module
vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
  },
}));

import { api } from "@/api/client";
import { usePermissions } from "./usePermissions";
import type { User } from "@/types";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// can() — app-level permission checks
// ---------------------------------------------------------------------------

describe("usePermissions — can()", () => {
  it("returns false with no user", () => {
    const { result } = renderHook(() => usePermissions(null));
    expect(result.current.can("inventory.view")).toBe(false);
  });

  it("returns true for admin with wildcard permission", () => {
    const admin: User = {
      id: "1",
      email: "admin@test.com",
      display_name: "Admin",
      role: "admin",
      is_active: true,
      permissions: { "*": true },
    };
    const { result } = renderHook(() => usePermissions(admin));
    expect(result.current.can("inventory.view")).toBe(true);
    expect(result.current.can("admin.metamodel")).toBe(true);
    expect(result.current.can("anything.at.all")).toBe(true);
  });

  it("checks specific permission key", () => {
    const member: User = {
      id: "2",
      email: "member@test.com",
      display_name: "Member",
      role: "member",
      is_active: true,
      permissions: {
        "inventory.view": true,
        "inventory.create": true,
        "inventory.edit": true,
      },
    };
    const { result } = renderHook(() => usePermissions(member));
    expect(result.current.can("inventory.view")).toBe(true);
    expect(result.current.can("inventory.create")).toBe(true);
    expect(result.current.can("admin.metamodel")).toBe(false);
  });

  it("returns false for missing permission", () => {
    const viewer: User = {
      id: "3",
      email: "viewer@test.com",
      display_name: "Viewer",
      role: "viewer",
      is_active: true,
      permissions: { "inventory.view": true },
    };
    const { result } = renderHook(() => usePermissions(viewer));
    expect(result.current.can("inventory.edit")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAdmin
// ---------------------------------------------------------------------------

describe("usePermissions — isAdmin", () => {
  it("is true when user has wildcard permission", () => {
    const admin: User = {
      id: "1",
      email: "admin@test.com",
      display_name: "Admin",
      role: "admin",
      is_active: true,
      permissions: { "*": true },
    };
    const { result } = renderHook(() => usePermissions(admin));
    expect(result.current.isAdmin).toBe(true);
  });

  it("is false for non-admin user", () => {
    const member: User = {
      id: "2",
      email: "member@test.com",
      display_name: "Member",
      role: "member",
      is_active: true,
      permissions: { "inventory.view": true },
    };
    const { result } = renderHook(() => usePermissions(member));
    expect(result.current.isAdmin).toBe(false);
  });

  it("is false when user is null", () => {
    const { result } = renderHook(() => usePermissions(null));
    expect(result.current.isAdmin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loadCardPermissions + canOnCard
// ---------------------------------------------------------------------------

describe("usePermissions — card-level permissions", () => {
  it("loads card permissions and enables canOnCard", async () => {
    const member: User = {
      id: "2",
      email: "member@test.com",
      display_name: "Member",
      role: "member",
      is_active: true,
      permissions: { "inventory.view": true },
    };
    vi.mocked(api.get).mockResolvedValueOnce({
      app_level: {},
      stakeholder_roles: [],
      card_level: {},
      effective: { can_view: true, can_edit: true, can_archive: false },
    });

    const { result } = renderHook(() => usePermissions(member));

    await act(async () => {
      await result.current.loadCardPermissions("card-1");
    });

    expect(api.get).toHaveBeenCalledWith("/cards/card-1/my-permissions");
    expect(result.current.canOnCard("card-1", "can_view")).toBe(true);
    expect(result.current.canOnCard("card-1", "can_edit")).toBe(true);
    expect(result.current.canOnCard("card-1", "can_archive")).toBe(false);
  });

  it("canOnCard returns true for admin without loading", () => {
    const admin: User = {
      id: "1",
      email: "admin@test.com",
      display_name: "Admin",
      role: "admin",
      is_active: true,
      permissions: { "*": true },
    };
    const { result } = renderHook(() => usePermissions(admin));
    expect(result.current.canOnCard("any-card", "can_edit")).toBe(true);
  });

  it("canOnCard returns false when card permissions not loaded", () => {
    const member: User = {
      id: "2",
      email: "member@test.com",
      display_name: "Member",
      role: "member",
      is_active: true,
      permissions: { "inventory.view": true },
    };
    const { result } = renderHook(() => usePermissions(member));
    expect(result.current.canOnCard("unknown-card", "can_edit")).toBe(false);
  });

  it("invalidateCardPermissions clears cached card permissions", async () => {
    const member: User = {
      id: "2",
      email: "member@test.com",
      display_name: "Member",
      role: "member",
      is_active: true,
      permissions: {},
    };
    vi.mocked(api.get).mockResolvedValueOnce({
      app_level: {},
      stakeholder_roles: [],
      card_level: {},
      effective: { can_view: true },
    });

    const { result } = renderHook(() => usePermissions(member));

    await act(async () => {
      await result.current.loadCardPermissions("card-1");
    });
    expect(result.current.canOnCard("card-1", "can_view")).toBe(true);

    act(() => {
      result.current.invalidateCardPermissions("card-1");
    });
    expect(result.current.canOnCard("card-1", "can_view")).toBe(false);
  });
});
