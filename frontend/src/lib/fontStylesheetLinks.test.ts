/**
 * The Google Fonts stylesheets in index.html must be loaded with
 * `crossorigin`: without it their CSS rules are opaque to the page, so
 * html-to-image (saved-report thumbnails, report exports) cannot read the
 * @font-face rules, logs a SecurityError per sheet and renders the capture
 * without Inter and without the Material Symbols glyphs on any machine that
 * lacks them locally. Skipping font embedding instead is not an option for
 * the same reason, which `reportExport.test.ts` and
 * `useThumbnailCapture.test.ts` pin.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOOGLE_FONTS_HOST = "fonts.googleapis.com";

/**
 * The `href` of a `<link>` tag, parsed; null when the tag has none. Relative
 * hrefs (the favicon links) resolve against a placeholder origin so they
 * parse and simply never match the Google Fonts host.
 */
function hrefOf(tag: string): URL | null {
  const match = /\bhref="([^"]+)"/.exec(tag);
  return match ? new URL(match[1], "http://placeholder.invalid") : null;
}

describe("index.html font stylesheet links", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  // Matched on the parsed hostname, exactly, never on a substring of the URL.
  const fontLinks = links.filter((l) => hrefOf(l)?.hostname === GOOGLE_FONTS_HOST);
  const families = fontLinks.map((l) => hrefOf(l)?.searchParams.get("family") ?? "");

  it("loads Inter and Material Symbols from Google Fonts", () => {
    expect(families.some((f) => f.startsWith("Inter"))).toBe(true);
    expect(families.some((f) => f.startsWith("Material Symbols Outlined"))).toBe(true);
  });

  it("marks every font stylesheet crossorigin so captures can embed the fonts", () => {
    expect(fontLinks.length).toBeGreaterThan(0);
    for (const link of fontLinks) {
      expect(link).toMatch(/\bcrossorigin="anonymous"/);
      expect(link).toMatch(/\brel="stylesheet"/);
    }
  });
});
