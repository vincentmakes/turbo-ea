import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";

import { sanitizeRichHtml } from "./richHtml";

function anchors(html: string): HTMLAnchorElement[] {
  const div = document.createElement("div");
  div.innerHTML = html;
  return Array.from(div.querySelectorAll("a"));
}

describe("sanitizeRichHtml", () => {
  it("returns an empty string for nothing", () => {
    expect(sanitizeRichHtml("")).toBe("");
    expect(sanitizeRichHtml(null)).toBe("");
    expect(sanitizeRichHtml(undefined)).toBe("");
  });

  it("makes a stored anchor open in a new tab", () => {
    const [a] = anchors(sanitizeRichHtml('<p><a href="https://x.io">x</a></p>'));
    expect(a.getAttribute("href")).toBe("https://x.io");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("overrides a stored target and rel", () => {
    const [a] = anchors(
      sanitizeRichHtml('<a href="https://x.io" target="_self" rel="opener">x</a>'),
    );
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("keeps a mailto anchor", () => {
    const [a] = anchors(sanitizeRichHtml('<a href="mailto:ops@x.io">mail</a>'));
    expect(a.getAttribute("href")).toBe("mailto:ops@x.io");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("strips the href from an anchor with a disallowed scheme or a relative path", () => {
    for (const href of ["javascript:alert(1)", "/cards/1", "ftp://x.io", ""]) {
      const [a] = anchors(sanitizeRichHtml(`<a href="${href}" target="_blank">x</a>`));
      expect(a).toBeDefined();
      expect(a.hasAttribute("href")).toBe(false);
      expect(a.hasAttribute("target")).toBe(false);
    }
  });

  it("links a bare URL in a text node and hands punctuation back", () => {
    const out = sanitizeRichHtml("<p>see https://x.io/doc. Then</p>");
    const [a] = anchors(out);
    expect(a.getAttribute("href")).toBe("https://x.io/doc");
    expect(a.textContent).toBe("https://x.io/doc");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(out).toContain("</a>. Then");
  });

  it("does not wrap a URL that is already inside an anchor", () => {
    const out = sanitizeRichHtml('<p><a href="https://x.io">https://x.io</a></p>');
    expect(anchors(out)).toHaveLength(1);
  });

  it("links inside nested markup, across several text nodes", () => {
    const out = sanitizeRichHtml(
      "<ul><li>one https://a.io</li><li><strong>two</strong> https://b.io</li></ul>",
    );
    expect(anchors(out).map((a) => a.getAttribute("href"))).toEqual([
      "https://a.io",
      "https://b.io",
    ]);
  });

  it("still strips scripts and event handlers", () => {
    const out = sanitizeRichHtml(
      '<p>x https://a.io<script>alert(1)</script><img src=x onerror="alert(1)"></p>',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(anchors(out)).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = sanitizeRichHtml("<p>go https://x.io now</p>");
    expect(sanitizeRichHtml(once)).toBe(once);
  });

  it("leaves the global DOMPurify instance without the anchor hook", () => {
    sanitizeRichHtml('<a href="https://x.io">x</a>');
    const [a] = anchors(DOMPurify.sanitize('<a href="https://x.io" target="_blank">x</a>'));
    // Default DOMPurify drops `target`; if the hook had leaked it would be
    // re-added here.
    expect(a.hasAttribute("target")).toBe(false);
  });
});
