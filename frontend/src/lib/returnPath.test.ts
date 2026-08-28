import { beforeEach, describe, expect, it } from "vitest";

import {
  SSO_RETURN_PATH_KEY,
  clearReturnPath,
  consumeReturnPath,
  sanitizeReturnPath,
  stashReturnPath,
} from "./returnPath";

describe("sanitizeReturnPath", () => {
  it.each([
    ["/ppm", "/ppm"],
    ["/ppm/abc-123", "/ppm/abc-123"],
    ["/inventory?type=Application&subtype=x", "/inventory?type=Application&subtype=x"],
    ["/diagrams/1#node-4", "/diagrams/1#node-4"],
    ["/grc?tab=risk", "/grc?tab=risk"],
  ])("accepts %s", (input, expected) => {
    expect(sanitizeReturnPath(input)).toBe(expected);
  });

  it.each([
    ["//evil.com", "protocol-relative"],
    ["/\\evil.com", "backslash normalises to a second slash"],
    ["\\\\evil.com", "UNC-style"],
    ["http://evil.com/x", "absolute http"],
    ["https://evil.com", "absolute https"],
    ["javascript:alert(1)", "javascript scheme"],
    ["mailto:a@b.com", "mailto scheme"],
    ["ppm", "no leading slash"],
    ["", "empty"],
    ["/x\r\nSet-Cookie: a=b", "CRLF injection"],
    ["/x\u0000y", "NUL"],
  ])("rejects %s (%s)", (input) => {
    expect(sanitizeReturnPath(input)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(sanitizeReturnPath(null)).toBeNull();
    expect(sanitizeReturnPath(undefined)).toBeNull();
  });

  it("rejects an absurdly long path", () => {
    expect(sanitizeReturnPath("/" + "a".repeat(3000))).toBeNull();
  });

  it("collapses traversal segments and stays same-origin", () => {
    expect(sanitizeReturnPath("/a/../../b")).toBe("/b");
  });

  it.each([
    ["/", "the dashboard is where we would send them anyway"],
    ["/auth/callback", "would loop the sign-in flow"],
    ["/auth/set-password", "would loop the sign-in flow"],
    ["/portal/acme", "published portals run their own SSO gate"],
    ["/embed/diagram/xyz", "published diagrams run their own SSO gate"],
  ])("treats %s as no deep link (%s)", (input) => {
    expect(sanitizeReturnPath(input)).toBeNull();
  });
});

describe("stash / consume", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("stores a sanitised path", () => {
    stashReturnPath("/ppm?tab=gantt");
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBe("/ppm?tab=gantt");
  });

  it("removes any previous value when the new one is not usable", () => {
    sessionStorage.setItem(SSO_RETURN_PATH_KEY, "/ppm");
    stashReturnPath("/");
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBeNull();
  });

  it("removes any previous value when the new one is hostile", () => {
    sessionStorage.setItem(SSO_RETURN_PATH_KEY, "/ppm");
    stashReturnPath("//evil.com");
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBeNull();
  });

  it("is single-use", () => {
    stashReturnPath("/ppm");
    expect(consumeReturnPath()).toBe("/ppm");
    expect(consumeReturnPath()).toBeNull();
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBeNull();
  });

  it("re-sanitises on read, so a value from an older build cannot slip through", () => {
    sessionStorage.setItem(SSO_RETURN_PATH_KEY, "//evil.com");
    expect(consumeReturnPath()).toBeNull();
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBeNull();
  });

  it("clears on demand", () => {
    stashReturnPath("/ppm");
    clearReturnPath();
    expect(sessionStorage.getItem(SSO_RETURN_PATH_KEY)).toBeNull();
  });
});
