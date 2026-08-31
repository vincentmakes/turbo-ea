import { describe, it, expect } from "vitest";
import {
  isSelfRow,
  isOwnRoleLocked,
  isOwnDeactivateLocked,
  excludeSelfFromBulkRoleChange,
  excludeSelfFromBulkDeactivate,
} from "./userSelfGuards";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

const row = (id: string, role: string, is_active = true) => ({ id, role, is_active });

describe("isSelfRow", () => {
  it("matches only the signed-in user's own row", () => {
    expect(isSelfRow(ME, ME)).toBe(true);
    expect(isSelfRow(ME, OTHER)).toBe(false);
  });

  it("is false when the current user is unknown", () => {
    // A logged-out / still-loading auth context must not accidentally lock
    // every row by matching undefined against undefined.
    expect(isSelfRow(undefined, ME)).toBe(false);
  });
});

describe("isOwnRoleLocked", () => {
  it("locks your own row when you are an admin", () => {
    expect(isOwnRoleLocked(ME, row(ME, "admin"))).toBe(true);
  });

  it("leaves your own row editable when you are not an admin", () => {
    // Only demotion *from* admin is the lockout risk this guards.
    expect(isOwnRoleLocked(ME, row(ME, "member"))).toBe(false);
  });

  it("never locks another admin's row", () => {
    expect(isOwnRoleLocked(ME, row(OTHER, "admin"))).toBe(false);
  });
});

describe("isOwnDeactivateLocked", () => {
  it("locks your own active row regardless of role", () => {
    expect(isOwnDeactivateLocked(ME, row(ME, "member", true))).toBe(true);
    expect(isOwnDeactivateLocked(ME, row(ME, "admin", true))).toBe(true);
  });

  it("does not lock an already-inactive own row", () => {
    // Reactivating yourself is not a lockout, and is unreachable anyway.
    expect(isOwnDeactivateLocked(ME, row(ME, "admin", false))).toBe(false);
  });

  it("never locks another user's row", () => {
    expect(isOwnDeactivateLocked(ME, row(OTHER, "admin", true))).toBe(false);
  });
});

describe("excludeSelfFromBulkRoleChange", () => {
  const rows = [row(ME, "admin"), row(OTHER, "member")];

  it("drops your own row when the change would demote you", () => {
    const res = excludeSelfFromBulkRoleChange(ME, [ME, OTHER], rows, "viewer");
    expect(res).toEqual({ ids: [OTHER], skippedSelf: true });
  });

  it("keeps the rest of the selection rather than refusing the batch", () => {
    const res = excludeSelfFromBulkRoleChange(ME, [ME, OTHER], rows, "viewer");
    expect(res.ids).toContain(OTHER);
  });

  it("keeps your own row when the target role is admin", () => {
    const res = excludeSelfFromBulkRoleChange(ME, [ME, OTHER], rows, "admin");
    expect(res).toEqual({ ids: [ME, OTHER], skippedSelf: false });
  });

  it("keeps your own row when you are not an admin", () => {
    const nonAdmin = [row(ME, "member"), row(OTHER, "member")];
    const res = excludeSelfFromBulkRoleChange(ME, [ME, OTHER], nonAdmin, "viewer");
    expect(res).toEqual({ ids: [ME, OTHER], skippedSelf: false });
  });

  it("is a no-op when your own row is not selected", () => {
    const res = excludeSelfFromBulkRoleChange(ME, [OTHER], rows, "viewer");
    expect(res).toEqual({ ids: [OTHER], skippedSelf: false });
  });
});

describe("excludeSelfFromBulkDeactivate", () => {
  it("drops your own row from the selection", () => {
    expect(excludeSelfFromBulkDeactivate(ME, [ME, OTHER])).toEqual({
      ids: [OTHER],
      skippedSelf: true,
    });
  });

  it("is a no-op when your own row is not selected", () => {
    expect(excludeSelfFromBulkDeactivate(ME, [OTHER])).toEqual({
      ids: [OTHER],
      skippedSelf: false,
    });
  });

  it("is a no-op when the current user is unknown", () => {
    expect(excludeSelfFromBulkDeactivate(undefined, [ME, OTHER])).toEqual({
      ids: [ME, OTHER],
      skippedSelf: false,
    });
  });
});
