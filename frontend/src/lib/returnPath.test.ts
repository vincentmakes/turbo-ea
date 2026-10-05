import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("sanitizeReturnPath — each guard on its own", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses a protocol-relative path even when it names this very host", () => {
    // Without the "//" guard, URL would resolve this to our own origin and pass.
    expect(sanitizeReturnPath(`//${window.location.host}/ppm`)).toBeNull();
  });

  it("refuses a backslash anywhere, not only after the leading slash", () => {
    // URL would normalise it to "/a/b", same-origin, so only the guard stops it.
    expect(sanitizeReturnPath("/a\\b")).toBeNull();
  });

  it.each([
    ["/a\u001fb", "the last C0 control"],
    ["/a\u007fb", "DEL"],
    ["/a\tb", "tab"],
  ])("refuses %j (%s)", (input) => {
    expect(sanitizeReturnPath(input)).toBeNull();
  });

  it("keeps a printable character just outside the control range", () => {
    expect(sanitizeReturnPath("/a b")).toBe("/a%20b");
    expect(sanitizeReturnPath("/a~b")).toBe("/a~b");
  });

  it("accepts exactly the maximum length and refuses one more", () => {
    const longest = "/" + "a".repeat(2047);
    expect(sanitizeReturnPath(longest)).toBe(longest);
    expect(sanitizeReturnPath(longest + "a")).toBeNull();
  });

  it("refuses whatever URL resolves to another origin", () => {
    class ForeignUrl {
      origin = "https://evil.example";
      pathname = "/ppm";
      search = "";
      hash = "";
    }
    vi.stubGlobal("URL", ForeignUrl);
    expect(sanitizeReturnPath("/ppm")).toBeNull();
  });

  it("refuses what URL cannot parse", () => {
    vi.stubGlobal(
      "URL",
      class {
        constructor() {
          throw new TypeError("Invalid URL");
        }
      },
    );
    expect(sanitizeReturnPath("/ppm")).toBeNull();
  });

  it("keeps the query and hash of the root path", () => {
    expect(sanitizeReturnPath("/?tab=x")).toBe("/?tab=x");
    expect(sanitizeReturnPath("/#top")).toBe("/#top");
  });

  it.each(["/authority", "/auth", "/portals", "/portal", "/embedded", "/embed"])(
    "only whole /auth/, /portal/ and /embed/ prefixes are excluded: %s",
    (input) => {
      expect(sanitizeReturnPath(input)).toBe(input);
    },
  );
});

describe("stash / consume when sessionStorage throws", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  const boom = () => {
    throw new DOMException("denied", "SecurityError");
  };

  it("stash swallows a failing write and a failing remove", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    expect(() => stashReturnPath("/ppm")).not.toThrow();
    expect(() => stashReturnPath("/")).not.toThrow();
  });

  it("consume reads nothing when the read fails", () => {
    sessionStorage.setItem(SSO_RETURN_PATH_KEY, "/ppm");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    expect(consumeReturnPath()).toBeNull();
  });

  it("consume reads nothing when the remove fails, so it can never be replayed", () => {
    sessionStorage.setItem(SSO_RETURN_PATH_KEY, "/ppm");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    expect(consumeReturnPath()).toBeNull();
  });

  it("clear swallows a failing remove", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    expect(() => clearReturnPath()).not.toThrow();
  });
});
