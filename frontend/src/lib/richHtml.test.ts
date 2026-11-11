import DOMPurify from "dompurify";
import { describe, expect, it, vi } from "vitest";

import * as linkify from "./linkify";
import { sanitizeRichHtml } from "./richHtml";

function anchors(html: string): HTMLAnchorElement[] {
  const div = document.createElement("div");
  div.innerHTML = html;
  return Array.from(div.querySelectorAll("a"));
}

describe("sanitizeRichHtml", () => {
  it("builds its private sanitiser once, so the hook is added once", async () => {
    vi.resetModules();
    const actual = await vi.importActual<typeof import("dompurify")>("dompurify");
    const create = vi.fn((w: Window) => actual.default(w));
    vi.doMock("dompurify", () => ({ default: create }));
    // The module already loaded, not a fresh evaluation: a test that runs
    // linkify's module body would make its constants look test-covered.
    vi.doMock("./linkify", () => linkify);
    try {
      const { sanitizeRichHtml: fresh } = await import("./richHtml");
      fresh("<p>one</p>");
      fresh("<p>two</p>");
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("dompurify");
      vi.doUnmock("./linkify");
      vi.resetModules();
    }
  });

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

  it("trims an href before deciding whether it may stay", () => {
    const [a] = anchors(sanitizeRichHtml('<a href=" https://x.io">x</a>'));
    expect(a.getAttribute("href")?.trim()).toBe("https://x.io");
    expect(a.getAttribute("target")).toBe("_blank");
  });

  it("drops a stored rel along with a disallowed href", () => {
    const [a] = anchors(sanitizeRichHtml('<a href="javascript:alert(1)" rel="opener">x</a>'));
    expect(a.hasAttribute("href")).toBe(false);
    expect(a.hasAttribute("rel")).toBe(false);
  });

  it("leaves elements other than anchors alone", () => {
    const html = '<map name="m"><area href="https://x.io" target="_self" alt="a"></map>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it("links a text node that is nothing but a URL", () => {
    const [a] = anchors(sanitizeRichHtml("<p>https://x.io</p>"));
    expect(a.getAttribute("href")).toBe("https://x.io");
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

describe("sanitizeRichHtml mention spans", () => {
  const ID = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";

  it("makes a card mention a focusable link and keeps its data attributes", () => {
    expect(
      sanitizeRichHtml(`<p><span data-type="mention" data-kind="card" data-id="${ID}">@SAP</span></p>`),
    ).toBe(
      `<p><span data-type="mention" data-kind="card" data-id="${ID}" role="link" tabindex="0">@SAP</span></p>`,
    );
  });

  it("makes a decision mention a focusable link", () => {
    expect(
      sanitizeRichHtml(`<span data-type="mention" data-kind="decision" data-id="${ID}">ADR-1 T</span>`),
    ).toBe(
      `<span data-type="mention" data-kind="decision" data-id="${ID}" role="link" tabindex="0">ADR-1 T</span>`,
    );
  });

  it("gives a person, a restricted and a missing mention no link role, even a forged one", () => {
    const user = `<span data-type="mention" data-kind="user" data-id="${ID}" role="link" tabindex="0">@Ann</span>`;
    const restricted =
      '<span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34" role="link">Restricted card</span>';
    const missing = `<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true" tabindex="0">Deleted card</span>`;
    const forgedRestricted = `<span data-type="mention" data-kind="card" data-id="${ID}" data-restricted="true">x</span>`;
    expect(sanitizeRichHtml(user)).toBe(
      `<span data-type="mention" data-kind="user" data-id="${ID}">@Ann</span>`,
    );
    expect(sanitizeRichHtml(restricted)).toBe(
      '<span data-type="mention" data-kind="card" data-restricted="true" data-token="ab12cd34">Restricted card</span>',
    );
    expect(sanitizeRichHtml(missing)).toBe(
      `<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true">Deleted card</span>`,
    );
    expect(sanitizeRichHtml(forgedRestricted)).toBe(
      `<span data-type="mention" data-kind="card" data-id="${ID}" data-restricted="true">x</span>`,
    );
  });

  it("treats only a span as a mention, whatever another element claims", () => {
    expect(sanitizeRichHtml(`<p data-type="mention" data-kind="card" data-id="${ID}">x</p>`)).toBe(
      `<p data-type="mention" data-kind="card" data-id="${ID}">x</p>`,
    );
    expect(
      sanitizeRichHtml(
        `<a data-type="mention" data-kind="card" data-id="${ID}" href="https://example.com/a">x</a>`,
      ),
    ).toBe(
      `<a data-type="mention" data-kind="card" data-id="${ID}" href="https://example.com/a" target="_blank" rel="noopener noreferrer">x</a>`,
    );
  });

  it("does not touch the role of other spans, nor a mention with no kind", () => {
    expect(sanitizeRichHtml('<span role="note">n</span>')).toBe('<span role="note">n</span>');
    expect(sanitizeRichHtml(`<span data-type="mention" data-id="${ID}" role="link">x</span>`)).toBe(
      `<span data-type="mention" data-id="${ID}">x</span>`,
    );
  });
});
