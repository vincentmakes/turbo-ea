import { describe, expect, it } from "vitest";

import { hasLink, isLinkableHref, isStorableHref, normaliseLinkHref, splitLinks } from "./linkify";

const link = (value: string) => ({ type: "link", value, href: value });
const text = (value: string) => ({ type: "text", value });

describe("splitLinks", () => {
  it("gives empty text its one text token too", () => {
    // The scan alone would build no token at all; callers rely on exactly one.
    expect(splitLinks("")).toEqual([{ type: "text", value: "" }]);
  });

  it("returns one identity text token when there is nothing to link", () => {
    const input = "Plain prose, e.g. with punctuation. No addresses here.";
    expect(splitLinks(input)).toEqual([text(input)]);
  });

  it("links an http(s) address and keeps the surrounding text", () => {
    expect(splitLinks("see https://a.io/x for details")).toEqual([
      text("see "),
      link("https://a.io/x"),
      text(" for details"),
    ]);
    expect(splitLinks("http://a.io")).toEqual([link("http://a.io")]);
  });

  it("gives sentence punctuation back to the text", () => {
    expect(splitLinks("Read https://a.io/x.")).toEqual([
      text("Read "),
      link("https://a.io/x"),
      text("."),
    ]);
    expect(splitLinks("https://a.io/x, then https://b.io;")).toEqual([
      link("https://a.io/x"),
      text(", then "),
      link("https://b.io"),
      text(";"),
    ]);
    expect(splitLinks("Really? https://a.io/x?!")).toEqual([
      text("Really? "),
      link("https://a.io/x"),
      text("?!"),
    ]);
  });

  it("drops an unbalanced closing bracket but keeps a balanced one", () => {
    expect(splitLinks("(https://a.io/x)")).toEqual([text("("), link("https://a.io/x"), text(")")]);
    expect(splitLinks("[https://a.io/x]")).toEqual([text("["), link("https://a.io/x"), text("]")]);
    expect(splitLinks("https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual([
      link("https://en.wikipedia.org/wiki/Foo_(bar)"),
    ]);
    expect(splitLinks("(https://en.wikipedia.org/wiki/Foo_(bar))")).toEqual([
      text("("),
      link("https://en.wikipedia.org/wiki/Foo_(bar)"),
      text(")"),
    ]);
  });

  it("trims a bracket only when it is last and unbalanced", () => {
    expect(splitLinks("https://a.io/a)b")).toEqual([link("https://a.io/a)b")]);
    expect(splitLinks("https://a.io/a]b")).toEqual([link("https://a.io/a]b")]);
    expect(splitLinks("https://a.io/[x]")).toEqual([link("https://a.io/[x]")]);
    expect(splitLinks("https://a.io/x:")).toEqual([link("https://a.io/x"), text(":")]);
  });

  it("leaves a scheme with nothing after it as text", () => {
    for (const s of ["See https://.", "See http://.", "Try http://!"]) {
      expect(splitLinks(s)).toEqual([text(s)]);
    }
    // Ending in a scheme is not the same as being one.
    expect(splitLinks("https://a.io/?u=http://")).toEqual([link("https://a.io/?u=http://")]);
  });

  it("preserves the scheme's case in the href", () => {
    expect(splitLinks("HTTPS://A.IO/Path")).toEqual([link("HTTPS://A.IO/Path")]);
  });

  it("keeps newlines in the text tokens", () => {
    expect(splitLinks("first https://a.io\nsecond https://b.io\n")).toEqual([
      text("first "),
      link("https://a.io"),
      text("\nsecond "),
      link("https://b.io"),
      text("\n"),
    ]);
  });

  it("terminates on quotes and angle brackets", () => {
    expect(splitLinks('"https://a.io/x"')).toEqual([text('"'), link("https://a.io/x"), text('"')]);
    expect(splitLinks("<https://a.io/x>")).toEqual([text("<"), link("https://a.io/x"), text(">")]);
  });

  it("handles a very long URL without a cap", () => {
    const long = `https://a.io/${"x".repeat(2000)}`;
    expect(splitLinks(long)).toEqual([link(long)]);
  });

  it("never links other schemes, bare domains, e-mails or glued text", () => {
    for (const s of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "mailto:ops@a.io",
      "ops@a.io",
      "www.a.io",
      "foohttps://a.io",
      "https://",
      "http:// nothing",
    ]) {
      expect(splitLinks(s).every((t) => t.type === "text")).toBe(true);
      expect(splitLinks(s).map((t) => t.value).join("")).toBe(s);
    }
  });

  it("leaves HTML as literal text next to a link", () => {
    expect(splitLinks("<script>alert(1)</script> https://a.io")).toEqual([
      text("<script>alert(1)</script> "),
      link("https://a.io"),
    ]);
  });

  it("round-trips: concatenating token values gives the input back", () => {
    const input = "a https://x.io/(p). b (https://y.io/q), c https://\nz";
    expect(
      splitLinks(input)
        .map((t) => t.value)
        .join(""),
    ).toBe(input);
  });
});

describe("hasLink / isLinkableHref", () => {
  it("reports whether prose carries a link", () => {
    expect(hasLink("nothing")).toBe(false);
    expect(hasLink("x https://a.io")).toBe(true);
    expect(hasLink("https://")).toBe(false);
  });

  it("accepts http, https and mailto hrefs and nothing else", () => {
    expect(isLinkableHref("https://a.io")).toBe(true);
    expect(isLinkableHref("HTTP://a.io")).toBe(true);
    expect(isLinkableHref("mailto:ops@a.io")).toBe(true);
    expect(isLinkableHref(" https://a.io")).toBe(true);
    expect(isLinkableHref("javascript:alert(1)")).toBe(false);
    // The scheme must start the href, not merely appear in it.
    expect(isLinkableHref("javascript:alert('https://a.io')")).toBe(false);
    expect(isLinkableHref("x-mailto:ops@a.io")).toBe(false);
    expect(isLinkableHref("/cards/1")).toBe(false);
    expect(isLinkableHref("")).toBe(false);
  });
});

describe("isStorableHref", () => {
  it("keeps http, https and mailto addresses, in any case", () => {
    for (const href of ["http://a.io", "https://a.io/x?y=1#z", "HTTPS://A.IO", "mailto:ann@a.io", "MailTo:ann@a.io"]) {
      expect(isStorableHref(href), href).toBe(true);
    }
  });

  it("refuses every other scheme, a relative address and a leading space", () => {
    for (const href of [
      "javascript:alert(1)",
      "ftp://a.io",
      "tel:+41123",
      "data:text/html,x",
      "example.com",
      "/path",
      "#top",
      "//a.io",
      "https:a.io",
      " https://a.io",
      "",
    ]) {
      expect(isStorableHref(href), href).toBe(false);
    }
  });

  it("refuses a space or a control character anywhere, as the server does", () => {
    expect(isStorableHref("https://a.io/a b")).toBe(false);
    expect(isStorableHref("https://a.io/\t")).toBe(false);
    expect(isStorableHref("https://a.io/\n")).toBe(false);
    expect(isStorableHref("https://a.io/\u0000")).toBe(false);
    expect(isStorableHref("https://a.io/\u001f")).toBe(false);
    expect(isStorableHref("https://a.io/\u007f")).toBe(false);
    expect(isStorableHref("https://a.io/ ")).toBe(false);
    // The edges of the refused range are refused, their neighbours kept.
    expect(isStorableHref("https://a.io/!")).toBe(true);
    expect(isStorableHref("https://a.io/~")).toBe(true);
    expect(isStorableHref("https://a.io/\u0080")).toBe(true);
  });

  it("refuses what is not a string", () => {
    expect(isStorableHref(null)).toBe(false);
    expect(isStorableHref(undefined)).toBe(false);
    expect(isStorableHref(42)).toBe(false);
  });

  it("refuses a non-string whose string form is a storable address", () => {
    expect(isStorableHref(["https://x.io"])).toBe(false);
    expect(isStorableHref({ toString: () => "https://x.io" })).toBe(false);
  });

  it("looks for the scheme at the start only", () => {
    expect(isStorableHref("ftp://x.io/?next=https://y.io")).toBe(false);
    expect(isStorableHref("xhttps://x.io")).toBe(false);
    expect(isStorableHref("x:mailto:ann@a.io")).toBe(false);
  });
});

describe("normaliseLinkHref", () => {
  it.each([
    ["https://a.io", "https://a.io"],
    ["http://a.io/x?y=1#z", "http://a.io/x?y=1#z"],
    ["HTTPS://A.IO", "HTTPS://A.IO"],
    ["  https://a.io  ", "https://a.io"],
    ["mailto:ann@a.io", "mailto:ann@a.io"],
    ["MAILTO:ann@a.io", "MAILTO:ann@a.io"],
    ["mailto:ann@a.io?subject=Hi", "mailto:ann@a.io?subject=Hi"],
  ])("keeps %j as %j", (input, expected) => {
    expect(normaliseLinkHref(input)).toBe(expected);
  });

  it.each([
    ["ann@example.com", "mailto:ann@example.com"],
    ["x@y.z", "mailto:x@y.z"],
    ["first.last+tag@mail.example.co.uk", "mailto:first.last+tag@mail.example.co.uk"],
  ])("makes the bare address %j a mailto: link", (input, expected) => {
    expect(normaliseLinkHref(input)).toBe(expected);
  });

  it.each([
    ["example.com", "https://example.com"],
    ["example.com/path", "https://example.com/path"],
    ["example.com?q=1", "https://example.com?q=1"],
    ["example.com#part", "https://example.com#part"],
    ["www.x.io", "https://www.x.io"],
    ["sub.domain-1.example.org/a/b", "https://sub.domain-1.example.org/a/b"],
    ["example.com:8080", "https://example.com:8080"],
    ["example.com:8080/x", "https://example.com:8080/x"],
    ["localhost", "https://localhost"],
    ["localhost:3000", "https://localhost:3000"],
    ["LOCALHOST:3000/app", "https://LOCALHOST:3000/app"],
    ["192.168.0.1", "https://192.168.0.1"],
    ["10.0.0.1:8443/x", "https://10.0.0.1:8443/x"],
    ["münchen.de", "https://münchen.de"],
    ["example.xn--p1ai", "https://example.xn--p1ai"],
    ["example.com/a:b", "https://example.com/a:b"],
    ["example.com:8", "https://example.com:8"],
    ["example.com:8/x", "https://example.com:8/x"],
    ["localhost:8/x", "https://localhost:8/x"],
  ])("gives the host %j https://", (input, expected) => {
    expect(normaliseLinkHref(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,x",
    "ftp://a.io",
    "tel:+41123",
    "file:///etc/passwd",
    "vbscript:x",
    "https://",
    "http://",
    "https:///x",
    "https:///http://x.io",
    "https:a.io",
    "mailto:",
    "hello",
    "example",
    "example.",
    "example.123",
    "/path",
    "#anchor",
    "?q=1",
    "./x",
    "../x",
    "//example.com",
    "https://a.io/a b",
    "a.io b",
    "https://a.io/\u0000",
    "https://a.io/\u007f",
    "https://x.io/\u0001a",
    "https://x.io/\u007fa",
    "mailto:ann@a.io\u0001",
    "a.io/\u0001",
    "https://a.io/\u00a0x",
    "ann@",
    "@a.io",
    "ann@localhost",
    "ann@a.io/x",
    "a@b@c.io",
    "user:pass@a.io",
    "a.io:port",
    "a.io:123456",
  ])("refuses %j", (input) => {
    expect(normaliseLinkHref(input)).toBeNull();
  });

  it("always returns something isStorableHref keeps", () => {
    for (const input of ["a.io", "ann@a.io", "https://a.io", "mailto:x@y.io", "localhost:1"]) {
      const href = normaliseLinkHref(input);
      expect(href).not.toBeNull();
      expect(isStorableHref(href)).toBe(true);
    }
  });
});
