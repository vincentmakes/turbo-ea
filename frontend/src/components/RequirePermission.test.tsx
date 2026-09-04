import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RequirePermission, {
  hasPermission,
  hasTypePermission,
  canCreateAnyCardType,
} from "./RequirePermission";
import { AuthProvider } from "@/hooks/AuthContext";
import type { User } from "@/types";

function makeUser(permissions: Record<string, boolean> | undefined): User {
  return {
    id: "u1",
    email: "u@example.com",
    display_name: "U",
    role: "member",
    is_active: true,
    permissions,
  };
}

function wrap(ui: React.ReactNode, user: User | null) {
  return render(
    <MemoryRouter>
      <AuthProvider user={user} refreshUser={async () => {}}>
        {ui}
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("hasPermission", () => {
  it("denies when perms missing", () => {
    expect(hasPermission(undefined, "admin.users")).toBe(false);
  });

  it("denies when perm absent or false", () => {
    expect(hasPermission({}, "admin.users")).toBe(false);
    expect(hasPermission({ "admin.users": false }, "admin.users")).toBe(false);
  });

  it("grants on explicit true", () => {
    expect(hasPermission({ "admin.users": true }, "admin.users")).toBe(true);
  });

  it("grants on wildcard *", () => {
    expect(hasPermission({ "*": true }, "admin.users")).toBe(true);
  });

  it("keeps a bare array as OR — extension manifests depend on it", () => {
    // Regression guard: extension-declared permissions are lists whose
    // documented meaning is "any one of these". Tightening this to AND would
    // silently lock users out of every installed extension's pages.
    expect(hasPermission({ "adr.view": true }, ["adr.view", "adr.manage"])).toBe(true);
    expect(hasPermission({ "adr.manage": true }, ["adr.view", "adr.manage"])).toBe(true);
  });

  it("grants when any permission in the OR-list matches", () => {
    expect(
      hasPermission({ "eol.manage": true }, ["admin.settings", "eol.manage"]),
    ).toBe(true);
  });

  it("denies when none of an OR-list match", () => {
    expect(
      hasPermission({ "inventory.view": true }, ["admin.settings", "eol.manage"]),
    ).toBe(false);
  });
});

describe("RequirePermission", () => {
  it("renders children when the permission is granted", () => {
    wrap(
      <RequirePermission permission="admin.users">
        <div>secret content</div>
      </RequirePermission>,
      makeUser({ "admin.users": true }),
    );
    expect(screen.getByText("secret content")).toBeInTheDocument();
    expect(screen.queryByText("Access denied")).not.toBeInTheDocument();
  });

  it("renders children when the user has wildcard '*'", () => {
    wrap(
      <RequirePermission permission="admin.users">
        <div>secret content</div>
      </RequirePermission>,
      makeUser({ "*": true }),
    );
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });

  it("renders the access-denied placeholder when permission is missing", () => {
    wrap(
      <RequirePermission permission="admin.users">
        <div>secret content</div>
      </RequirePermission>,
      makeUser({ "admin.users": false, "inventory.view": true }),
    );
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("renders the placeholder when permissions object is undefined (fail-closed)", () => {
    wrap(
      <RequirePermission permission="admin.users">
        <div>secret content</div>
      </RequirePermission>,
      makeUser(undefined),
    );
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });
});


// ---------------------------------------------------------------------------
// hasTypePermission — per-card-type overrides (discussion #1068)
// ---------------------------------------------------------------------------

describe("hasTypePermission", () => {
  const denied = {
    permissions: { "inventory.create": true },
    type_permissions: { Organization: { "inventory.create": false } },
  };
  const granted = {
    permissions: { "inventory.create": false },
    type_permissions: { Initiative: { "inventory.create": true } },
  };

  it("denies a type that overrides a global grant away", () => {
    expect(hasTypePermission(denied, "inventory.create", "Organization")).toBe(false);
  });

  it("leaves other types on the global grant", () => {
    expect(hasTypePermission(denied, "inventory.create", "Application")).toBe(true);
  });

  it("grants a type that overrides above the role", () => {
    expect(hasTypePermission(granted, "inventory.create", "Initiative")).toBe(true);
  });

  it("still denies the types that were not granted", () => {
    expect(hasTypePermission(granted, "inventory.create", "Application")).toBe(false);
  });

  it("never overrides the admin wildcard", () => {
    const admin = {
      permissions: { "*": true },
      type_permissions: { Organization: { "inventory.create": false } },
    };
    expect(hasTypePermission(admin, "inventory.create", "Organization")).toBe(true);
  });

  it("falls back to the global permission with no type key", () => {
    expect(hasTypePermission(denied, "inventory.create", null)).toBe(true);
  });

  it("is fail-closed without a user", () => {
    expect(hasTypePermission(null, "inventory.create", "Application")).toBe(false);
  });

  it("ignores an override for a different permission", () => {
    const user = {
      permissions: { "inventory.create": true },
      type_permissions: { Organization: { "inventory.edit": false } },
    };
    expect(hasTypePermission(user, "inventory.create", "Organization")).toBe(true);
  });
});

describe("canCreateAnyCardType", () => {
  const types = [
    { key: "Application" },
    { key: "Organization" },
    { key: "Secret", is_hidden: true },
  ];

  it("is true while the metamodel has not loaded, so the button never flickers", () => {
    expect(canCreateAnyCardType({ permissions: { "inventory.create": true } }, [])).toBe(true);
  });

  it("is false when every visible type denies the role", () => {
    const user = {
      permissions: { "inventory.create": true },
      type_permissions: {
        Application: { "inventory.create": false },
        Organization: { "inventory.create": false },
      },
    };
    expect(canCreateAnyCardType(user, types)).toBe(false);
  });

  it("is true when one visible type still allows it", () => {
    const user = {
      permissions: { "inventory.create": true },
      type_permissions: { Application: { "inventory.create": false } },
    };
    expect(canCreateAnyCardType(user, types)).toBe(true);
  });

  it("is true for a role granted by a type override alone, with no list", () => {
    const user = {
      permissions: { "inventory.create": false },
      type_permissions: { Initiative: { "inventory.create": true } },
    };
    expect(canCreateAnyCardType(user, [])).toBe(true);
  });

  it("is false for a role with neither the grant nor an override", () => {
    expect(canCreateAnyCardType({ permissions: { "inventory.view": true } }, types)).toBe(false);
  });

  it("is true for admin", () => {
    expect(canCreateAnyCardType({ permissions: { "*": true } }, types)).toBe(true);
  });
});
