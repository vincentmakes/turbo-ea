import { describe, it, expect } from "vitest";
import { validateUserImport } from "./userExcelImport";
import type { AppRole, User } from "@/types";

const ROLES: AppRole[] = [
  {
    id: "r1",
    key: "admin",
    label: "Admin",
    is_system: true,
    is_default: false,
    is_archived: false,
    color: "#000",
    permissions: { "*": true },
    sort_order: 0,
  },
  {
    id: "r2",
    key: "member",
    label: "Member",
    is_system: true,
    is_default: true,
    is_archived: false,
    color: "#000",
    permissions: {},
    sort_order: 1,
  },
  {
    id: "r3",
    key: "viewer",
    label: "Viewer",
    is_system: true,
    is_default: false,
    is_archived: false,
    color: "#000",
    permissions: {},
    sort_order: 2,
  },
  {
    id: "r4",
    key: "archived_role",
    label: "Archived",
    is_system: false,
    is_default: false,
    is_archived: true,
    color: "#000",
    permissions: {},
    sort_order: 3,
  },
];

function user(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    email: "alice@example.com",
    display_name: "Alice",
    role: "viewer",
    is_active: true,
    auth_provider: "local",
    ...overrides,
  };
}

describe("validateUserImport", () => {
  it("creates rows for new emails", () => {
    const rpt = validateUserImport(
      [{ email: "bob@example.com", display_name: "Bob", role: "member" }],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(0);
    expect(rpt.creates).toHaveLength(1);
    expect(rpt.creates[0].email).toBe("bob@example.com");
    expect(rpt.creates[0].role).toBe("member");
    expect(rpt.updates).toHaveLength(0);
  });

  it("defaults role to viewer when missing", () => {
    const rpt = validateUserImport(
      [{ email: "bob@example.com", display_name: "Bob" }],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(0);
    expect(rpt.creates[0].role).toBe("viewer");
  });

  it("flags missing email as an error", () => {
    const rpt = validateUserImport([{ email: "", display_name: "Bob" }], [], ROLES);
    expect(rpt.errors).toHaveLength(1);
    expect(rpt.errors[0].column).toBe("email");
    expect(rpt.creates).toHaveLength(0);
  });

  it("flags invalid email format", () => {
    const rpt = validateUserImport(
      [{ email: "not-an-email", display_name: "Bob" }],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(1);
    expect(rpt.errors[0].message).toMatch(/valid email/);
  });

  it("flags missing display_name", () => {
    const rpt = validateUserImport([{ email: "bob@example.com", display_name: "" }], [], ROLES);
    expect(rpt.errors).toHaveLength(1);
    expect(rpt.errors[0].column).toBe("display_name");
  });

  it("flags unknown role as error", () => {
    const rpt = validateUserImport(
      [{ email: "bob@example.com", display_name: "Bob", role: "wizard" }],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(1);
    expect(rpt.errors[0].column).toBe("role");
  });

  it("rejects archived role keys", () => {
    const rpt = validateUserImport(
      [{ email: "bob@example.com", display_name: "Bob", role: "archived_role" }],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(1);
  });

  it("flags duplicate emails within the sheet", () => {
    const rpt = validateUserImport(
      [
        { email: "bob@example.com", display_name: "Bob" },
        { email: "BOB@example.com", display_name: "Bob 2" },
      ],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(1);
    expect(rpt.errors[0].message).toMatch(/more than once/);
  });

  it("detects updates when email already exists with changed fields", () => {
    const rpt = validateUserImport(
      [{ email: "alice@example.com", display_name: "Alicia", role: "member" }],
      [user()],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(0);
    expect(rpt.creates).toHaveLength(0);
    expect(rpt.updates).toHaveLength(1);
    expect(rpt.updates[0].changes).toBeDefined();
    expect(rpt.updates[0].changes?.display_name).toEqual({ old: "Alice", new: "Alicia" });
    expect(rpt.updates[0].changes?.role).toEqual({ old: "viewer", new: "member" });
  });

  it("warns and skips when an existing user has no changes", () => {
    const rpt = validateUserImport(
      [{ email: "alice@example.com", display_name: "Alice", role: "viewer" }],
      [user()],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(0);
    expect(rpt.updates).toHaveLength(0);
    expect(rpt.warnings).toHaveLength(1);
    expect(rpt.skipped).toBe(1);
  });

  it("detects is_active changes via truthy strings", () => {
    const rpt = validateUserImport(
      [
        {
          email: "alice@example.com",
          display_name: "Alice",
          role: "viewer",
          is_active: "false",
        },
      ],
      [user()],
      ROLES,
    );
    expect(rpt.updates).toHaveLength(1);
    expect(rpt.updates[0].changes?.is_active).toEqual({ old: true, new: false });
  });

  it("skips fully-blank rows silently", () => {
    const rpt = validateUserImport(
      [
        { email: "", display_name: "", role: "" },
        { email: "bob@example.com", display_name: "Bob" },
      ],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(0);
    expect(rpt.skipped).toBe(1);
    expect(rpt.creates).toHaveLength(1);
  });

  it("forwards auth_provider from the sheet for new users", () => {
    const rpt = validateUserImport(
      [
        {
          email: "carol@example.com",
          display_name: "Carol",
          role: "member",
          password: "StrongPass1",
          auth_provider: "local",
        },
        {
          email: "dave@example.com",
          display_name: "Dave",
          role: "member",
          auth_provider: "sso",
        },
      ],
      [],
      ROLES,
    );
    expect(rpt.errors).toHaveLength(0);
    expect(rpt.creates).toHaveLength(2);
    expect(rpt.creates[0].auth_provider).toBe("local");
    expect(rpt.creates[1].auth_provider).toBe("sso");
  });

  it("rejects unknown auth_provider values", () => {
    const rpt = validateUserImport(
      [
        {
          email: "eve@example.com",
          display_name: "Eve",
          role: "viewer",
          auth_provider: "ldap",
        },
      ],
      [],
      ROLES,
    );
    expect(rpt.errors.some((e) => e.column === "auth_provider")).toBe(true);
    expect(rpt.creates).toHaveLength(0);
  });

  it("rejects auth_provider=local with no password on a new user", () => {
    const rpt = validateUserImport(
      [
        {
          email: "frank@example.com",
          display_name: "Frank",
          role: "viewer",
          auth_provider: "local",
        },
      ],
      [],
      ROLES,
    );
    expect(rpt.errors.some((e) => e.column === "password")).toBe(true);
    expect(rpt.creates).toHaveLength(0);
  });
});
