import { describe, expect, it } from "vitest";

import { isLocked } from "./userLockout";

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);

describe("isLocked", () => {
  it("is true only while locked_until lies in the future", () => {
    expect(isLocked({ locked_until: new Date(NOW + 60_000).toISOString() }, NOW)).toBe(true);
    expect(isLocked({ locked_until: new Date(NOW - 60_000).toISOString() }, NOW)).toBe(false);
    expect(isLocked({ locked_until: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it("is false with no timestamp or an unreadable one", () => {
    expect(isLocked({}, NOW)).toBe(false);
    expect(isLocked({ locked_until: null }, NOW)).toBe(false);
    expect(isLocked({ locked_until: "not a date" }, NOW)).toBe(false);
  });

  it("defaults to the current time", () => {
    expect(isLocked({ locked_until: new Date(Date.now() + 3_600_000).toISOString() })).toBe(true);
    expect(isLocked({ locked_until: "2000-01-01T00:00:00Z" })).toBe(false);
  });
});
