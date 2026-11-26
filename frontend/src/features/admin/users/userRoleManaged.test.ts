import { describe, it, expect } from "vitest";
import {
  isRoleManagedExternally,
  isRoleLockedInEdit,
  excludeManagedFromBulkRoleChange,
} from "./userRoleManaged";

const row = (id: string, role: string, managed?: boolean) => ({
  id,
  role,
  role_managed_externally: managed,
});

describe("isRoleManagedExternally", () => {
  it("is true only when the API flags the account", () => {
    expect(isRoleManagedExternally({ role_managed_externally: true })).toBe(true);
    expect(isRoleManagedExternally({ role_managed_externally: false })).toBe(false);
    // An older backend sends no flag: nothing is locked.
    expect(isRoleManagedExternally({})).toBe(false);
  });
});

describe("isRoleLockedInEdit", () => {
  it("locks a managed account while the form keeps SSO sign-in", () => {
    expect(isRoleLockedInEdit({ role_managed_externally: true }, "sso")).toBe(true);
  });

  it("lifts the lock when the form switches the account to local sign-in", () => {
    expect(isRoleLockedInEdit({ role_managed_externally: true }, "local")).toBe(false);
  });

  it("never locks an unmanaged account or an absent row", () => {
    expect(isRoleLockedInEdit({ role_managed_externally: false }, "sso")).toBe(false);
    expect(isRoleLockedInEdit(null, "sso")).toBe(false);
  });
});

describe("excludeManagedFromBulkRoleChange", () => {
  const rows = [row("a", "member", true), row("b", "member"), row("c", "viewer", true), row("d", "admin", false)];

  it("drops the managed accounts whose role would change and counts them", () => {
    expect(excludeManagedFromBulkRoleChange(["a", "b", "c", "d"], rows, "admin")).toEqual({
      ids: ["b", "d"],
      skippedManaged: 2,
    });
  });

  it("keeps a managed account that already holds the target role", () => {
    expect(excludeManagedFromBulkRoleChange(["a", "b", "c"], rows, "viewer")).toEqual({
      ids: ["b", "c"],
      skippedManaged: 1,
    });
  });

  it("only counts the selected rows", () => {
    expect(excludeManagedFromBulkRoleChange(["b", "d"], rows, "admin")).toEqual({
      ids: ["b", "d"],
      skippedManaged: 0,
    });
  });
});
