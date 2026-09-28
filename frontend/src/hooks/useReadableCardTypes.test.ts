import { describe, it, expect } from "vitest";
import { readableCardTypes } from "./useReadableCardTypes";
import type { User } from "@/types";

const types = [{ key: "Application" }, { key: "Initiative" }, { key: "Objective" }];

function user(extra: Partial<User>): User {
  return {
    id: "u",
    email: "u@x",
    display_name: "U",
    role: "member",
    is_active: true,
    permissions: { "inventory.view": true },
    ...extra,
  };
}

describe("readableCardTypes", () => {
  it("drops a View-denied type", () => {
    const u = user({ type_permissions: { Initiative: { "inventory.view": false } } });
    expect(readableCardTypes(types, u).map((t) => t.key)).toEqual(["Application", "Objective"]);
  });

  it("offers only allowed types to a role without the global grant (inventory mode)", () => {
    const u = user({
      permissions: {},
      type_permissions: { Objective: { "inventory.view": true } },
    });
    expect(readableCardTypes(types, u).map((t) => t.key)).toEqual(["Objective"]);
    // Module surfaces are gated by their own permission: only denies subtract.
    expect(readableCardTypes(types, u, "module")).toHaveLength(3);
  });

  it("filters nothing without a user (the server decides)", () => {
    expect(readableCardTypes(types, null)).toEqual(types);
  });
});
