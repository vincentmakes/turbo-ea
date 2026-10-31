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

describe("index.html font stylesheet links", () => {
  const html = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  const fontLinks = links.filter((l) => l.includes("fonts.googleapis.com"));

  it("loads Inter and Material Symbols from Google Fonts", () => {
    expect(fontLinks.some((l) => l.includes("family=Inter"))).toBe(true);
    expect(fontLinks.some((l) => l.includes("family=Material+Symbols+Outlined"))).toBe(true);
  });

  it("marks every font stylesheet crossorigin so captures can embed the fonts", () => {
    expect(fontLinks.length).toBeGreaterThan(0);
    for (const link of fontLinks) {
      expect(link).toMatch(/\bcrossorigin="anonymous"/);
      expect(link).toMatch(/\brel="stylesheet"/);
    }
  });
});
