import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import RequirePermission, { hasPermission } from "./RequirePermission";
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
