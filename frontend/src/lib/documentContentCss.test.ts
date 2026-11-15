import { describe, expect, it } from "vitest";
import { PRINT_COLORS, brand } from "@/theme/tokens";
import {
  DOCUMENT_CONTENT_CLASS,
  DOCUMENT_CONTENT_SX,
  DOCUMENT_IMAGE_CSS,
  DOCUMENT_IMAGE_SX,
  MONO_FONT_STACK,
  PRINT_CONTENT_COLOURS,
  SCREEN_CONTENT_COLOURS,
  documentContentCss,
  documentContentScrollCss,
  documentImageCss,
} from "./documentContentCss";
import * as markup from "./documentImageMarkup";

const PICTURES = [
  "img { max-width: 100%; height: auto; }",
  'img[data-align="center"] { display: block; margin-inline: auto; }',
  'img[data-align="right"] { display: block; margin-inline-start: auto; }',
];

/** Every rule line of a stylesheet, without its selector's scope. */
const lines = (css: string) => css.split("\n");

describe("colours", () => {
  it("screen surfaces use theme palette keys, so dark mode follows the theme", () => {
    expect(SCREEN_CONTENT_COLOURS).toEqual({
      link: "primary.main",
      rule: "divider",
      fill: "action.hover",
      subheading: "text.secondary",
    });
  });

  it("print and the SoAW preview use the print tokens", () => {
    expect(PRINT_CONTENT_COLOURS).toEqual({
      link: brand.primary,
      rule: PRINT_COLORS.control,
      fill: PRINT_COLORS.panel,
      subheading: PRINT_COLORS.subheading,
    });
  });
});

describe("documentContentCss", () => {
  const css = documentContentCss(".doc-print .doc-content", PRINT_CONTENT_COLOURS);

  it("is the wrapper class print and preview bodies put around stored fragments", () => {
    expect(DOCUMENT_CONTENT_CLASS).toBe("doc-content");
  });

  it("scopes every selector, each part of a selector list included", () => {
    for (const line of lines(css)) {
      const selector = line.slice(0, line.indexOf(" {"));
      for (const part of selector.split(", ")) expect(part.startsWith(".doc-print .doc-content ")).toBe(true);
    }
    expect(css).toContain(".doc-print .doc-content th, .doc-print .doc-content td { ");
    expect(css).toContain(".doc-print .doc-content td > *, .doc-print .doc-content th > * { margin: 0; }");
    expect(css).toContain(
      ".doc-print .doc-content td > * + *, .doc-print .doc-content th > * + * { margin-top: 4px; }",
    );
  });

  it("writes every rule, coloured from the surface's colours", () => {
    const S = ".x";
    const c = documentContentCss(S, PRINT_CONTENT_COLOURS);
    expect(lines(c)).toEqual([
      `${S} a { color: ${brand.primary}; word-break: break-word; }`,
      `${S} code { font-family: ${MONO_FONT_STACK}; font-size: 0.9em; background-color: ${PRINT_COLORS.panel}; padding: 0.1em 0.3em; border-radius: 3px; }`,
      `${S} pre { display: block; white-space: pre-wrap; font-family: ${MONO_FONT_STACK}; font-size: 0.9em; background-color: ${PRINT_COLORS.panel}; padding: 8px 12px; border-radius: 4px; margin: 8px 0; }`,
      `${S} pre code { font-size: inherit; background-color: transparent; padding: 0; border-radius: 0; }`,
      `${S} h4 { font-size: 1.05em; font-weight: 600; color: ${PRINT_COLORS.subheading}; margin: 16px 0 8px; }`,
      `${S} table { border-collapse: collapse; width: 100%; table-layout: fixed; margin: 12px 0; }`,
      `${S} th, ${S} td { border-width: 1px; border-style: solid; border-color: ${PRINT_COLORS.control}; padding: 6px 10px; vertical-align: top; text-align: start; font-size: inherit; overflow-wrap: break-word; }`,
      `${S} th { background-color: ${PRINT_COLORS.panel}; font-weight: 600; }`,
      `${S} td > *, ${S} th > * { margin: 0; }`,
      `${S} td > * + *, ${S} th > * + * { margin-top: 4px; }`,
      ...PICTURES.map((p) => `${S} ${p}`),
    ]);
  });

  it("takes any surface's colours", () => {
    const c = documentContentCss(".y", { link: "L", rule: "R", fill: "F", subheading: "H" });
    expect(c).toContain(".y a { color: L;");
    expect(c).toContain("border-color: R;");
    expect(c).toContain(".y th { background-color: F;");
    expect(c).toContain(".y code { font-family: ");
    expect(c).toMatch(/\.y code \{[^}]*background-color: F;/);
    expect(c).toContain("color: H;");
  });

  it("leaves the pictures out on request", () => {
    const c = documentContentCss(".x", PRINT_CONTENT_COLOURS, { pictures: false });
    expect(c).not.toContain("img");
    expect(c).toContain(".x table {");
  });

  it("adds the print-only rules: rows and pictures never split across pages", () => {
    const c = documentContentCss(".x", PRINT_CONTENT_COLOURS, { print: true });
    expect(c).toContain(".x tr { break-inside: avoid; page-break-inside: avoid; }");
    expect(c).toContain(".x img { break-inside: avoid; page-break-inside: avoid; }");
    const noPictures = documentContentCss(".x", PRINT_CONTENT_COLOURS, { print: true, pictures: false });
    expect(noPictures).toContain(".x tr { break-inside: avoid;");
    expect(noPictures).not.toContain("img");
    expect(css).not.toContain("break-inside");
  });

  it("lets the scope scroll sideways on screen only, when asked", () => {
    expect(documentContentScrollCss(".r .doc-content")).toBe("@media screen { .r .doc-content { overflow-x: auto; } }");
    const plain = documentContentCss(".x", PRINT_CONTENT_COLOURS, { print: true });
    expect(plain).not.toContain("overflow-x");
    expect(documentContentCss(".x", PRINT_CONTENT_COLOURS, { print: true, scroll: true })).toBe(
      `${plain}\n@media screen { .x { overflow-x: auto; } }`,
    );
  });

  it("holds no colour that is not a print token", () => {
    const all = documentContentCss(".x", PRINT_CONTENT_COLOURS, { print: true });
    const used = all.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    const tokens = new Set<string>([...Object.values(PRINT_COLORS), brand.primary]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !tokens.has(c))).toEqual([]);
    expect(all).not.toMatch(/rgb|undefined|\$\{/);
  });
});

describe("DOCUMENT_CONTENT_SX", () => {
  it("lets the element holding the HTML scroll sideways, so a wide table scrolls instead of spilling", () => {
    expect(DOCUMENT_CONTENT_SX.overflowX).toBe("auto");
    const root = Object.entries(DOCUMENT_CONTENT_SX).filter(([key]) => !key.startsWith("& "));
    expect(root).toEqual([["overflowX", "auto"]]);
  });

  it("carries every rule with palette keys and longhand borders", () => {
    expect(DOCUMENT_CONTENT_SX["& a"]).toEqual({ color: "primary.main", wordBreak: "break-word" });
    expect(DOCUMENT_CONTENT_SX["& code"]).toMatchObject({
      fontFamily: MONO_FONT_STACK,
      backgroundColor: "action.hover",
      borderRadius: "3px",
    });
    expect(DOCUMENT_CONTENT_SX["& pre"]).toMatchObject({ whiteSpace: "pre-wrap", backgroundColor: "action.hover" });
    expect(DOCUMENT_CONTENT_SX["& pre code"]).toMatchObject({ backgroundColor: "transparent", padding: "0" });
    expect(DOCUMENT_CONTENT_SX["& h4"]).toMatchObject({ color: "text.secondary", fontWeight: "600" });
    expect(DOCUMENT_CONTENT_SX["& table"]).toEqual({
      borderCollapse: "collapse",
      width: "100%",
      tableLayout: "fixed",
      margin: "12px 0",
    });
    expect(DOCUMENT_CONTENT_SX["& th, & td"]).toMatchObject({
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "divider",
      verticalAlign: "top",
      textAlign: "start",
    });
    expect(DOCUMENT_CONTENT_SX["& th"]).toEqual({ backgroundColor: "action.hover", fontWeight: "600" });
    expect(DOCUMENT_CONTENT_SX["& td > *, & th > *"]).toEqual({ margin: "0" });
    expect(DOCUMENT_CONTENT_SX["& td > * + *, & th > * + *"]).toEqual({ marginTop: "4px" });
  });

  it("includes the picture rules unchanged and nothing print-only", () => {
    for (const [key, value] of Object.entries(DOCUMENT_IMAGE_SX)) {
      expect(DOCUMENT_CONTENT_SX[key as `& ${string}`]).toEqual(value);
    }
    expect(Object.keys(DOCUMENT_CONTENT_SX)).not.toContain("& tr");
    expect(JSON.stringify(DOCUMENT_CONTENT_SX)).not.toMatch(/#[0-9a-f]{3,8}\b|rgb|break-inside|breakInside/i);
  });
});

describe("picture rules", () => {
  it("are unchanged, and documentImageMarkup still exports them", () => {
    expect(DOCUMENT_IMAGE_CSS).toBe(PICTURES.join("\n"));
    expect(documentImageCss(".doc")).toBe(PICTURES.map((p) => `.doc ${p}`).join("\n"));
    expect(DOCUMENT_IMAGE_SX).toEqual({
      "& img": { maxWidth: "100%", height: "auto" },
      '& img[data-align="center"]': { display: "block", marginInline: "auto" },
      '& img[data-align="right"]': { display: "block", marginInlineStart: "auto" },
    });
    expect(markup.DOCUMENT_IMAGE_CSS).toBe(DOCUMENT_IMAGE_CSS);
    expect(markup.DOCUMENT_IMAGE_SX).toBe(DOCUMENT_IMAGE_SX);
    expect(markup.documentImageCss).toBe(documentImageCss);
  });
});

describe("selectors Emotion would warn about", () => {
  // Emotion logs `:first-child` / `:nth-child` in an `sx` selector as unsafe
  // under server-side rendering, as a console error on every render.
  const UNSAFE = /:first-child|:nth-child|:nth-last-child/;

  it("uses no :first-child or :nth-child in the sx", () => {
    for (const key of Object.keys(DOCUMENT_CONTENT_SX)) expect(key).not.toMatch(UNSAFE);
    for (const key of Object.keys(DOCUMENT_IMAGE_SX)) expect(key).not.toMatch(UNSAFE);
  });

  it("uses none in any stylesheet either", () => {
    const sheets = [
      documentContentCss(".x", PRINT_CONTENT_COLOURS),
      documentContentCss(".x", PRINT_CONTENT_COLOURS, { print: true, scroll: true }),
      documentContentCss(".x", PRINT_CONTENT_COLOURS, { pictures: false }),
      documentImageCss(".x"),
    ];
    for (const sheet of sheets) expect(sheet).not.toMatch(UNSAFE);
  });
});
