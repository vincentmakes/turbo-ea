import { describe, expect, it } from "vitest";

import { hasLink, isLinkableHref, splitLinks } from "./linkify";

const link = (value: string) => ({ type: "link", value, href: value });
const text = (value: string) => ({ type: "text", value });

describe("splitLinks", () => {
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
    expect(isLinkableHref("/cards/1")).toBe(false);
    expect(isLinkableHref("")).toBe(false);
  });
});
