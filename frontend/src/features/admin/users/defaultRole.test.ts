import { describe, expect, it } from "vitest";

import { defaultRoleKey, FALLBACK_ROLE_KEY } from "./defaultRole";

const role = (key: string, is_default = false, is_archived = false) => ({
  key,
  is_default,
  is_archived,
});

describe("defaultRoleKey", () => {
  it("returns the role flagged as default", () => {
    expect(defaultRoleKey([role("member"), role("architect", true), role("viewer")])).toBe(
      "architect",
    );
  });

  it("falls back to member when no role is flagged", () => {
    expect(FALLBACK_ROLE_KEY).toBe("member");
    expect(defaultRoleKey([role("admin"), role("viewer")])).toBe("member");
    expect(defaultRoleKey([])).toBe("member");
  });

  it("ignores an archived default role", () => {
    expect(defaultRoleKey([role("legacy", true, true), role("viewer")])).toBe("member");
    expect(defaultRoleKey([role("legacy", true, true), role("architect", true)])).toBe(
      "architect",
    );
  });

  it("does not pick an active role that is not the default", () => {
    expect(defaultRoleKey([role("viewer", false, false), role("legacy", false, true)])).toBe(
      "member",
    );
  });
});
