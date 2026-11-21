import { afterEach, describe, expect, it, vi } from "vitest";
import { PRINT_COLORS, brand } from "@/theme/tokens";
import { PRINT_CONTENT_COLOURS, documentContentCss } from "./documentContentCss";
import {
  DOCUMENT_PRINT_CSS,
  buildPrintHtml,
  documentContent,
  documentHeader,
  escapeHtml,
  PRINT_IMAGE_WAIT_MS,
  absoluteDocumentImages,
  htmlIsEmpty,
  metaTable,
  openPrintWindow,
  pendingImages,
  printDocument,
  printDocumentContentCss,
  printDocumentHeaderCss,
  printDocumentImageCss,
  printTableWidths,
  section,
  signatureBlock,
  tableHtml,
  textBlock,
  waitForImages,
  writePrintDocument,
} from "./printDocument";
import { TABLE_3X3, TABLE_ONE_RESIZED, TABLE_RESIZED } from "@/test/fixtures/tableMarkup";

const PIC_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const PIC = `/api/v1/document-images/adr/${PIC_ID}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("DOCUMENT_PRINT_CSS", () => {
  it("inks the document with the shared print palette", () => {
    expect(PRINT_COLORS).toMatchObject({
      text: "#333333",
      muted: "#888888",
      panel: "#f5f5f5",
      control: "#cccccc",
    });
    expect(DOCUMENT_PRINT_CSS).toContain(`.doc-print h2 { font-size: 16pt; color: ${PRINT_COLORS.text};`);
    expect(DOCUMENT_PRINT_CSS).toContain(
      `.doc-print th, .doc-print td { border: 1px solid ${PRINT_COLORS.control};`,
    );
    expect(DOCUMENT_PRINT_CSS).toContain(`.doc-print th { background: ${PRINT_COLORS.panel};`);
    expect(DOCUMENT_PRINT_CSS).toContain(
      `.doc-signatures .sig-card { padding: 12px; border: 1px solid ${PRINT_COLORS.control};`,
    );
    expect(DOCUMENT_PRINT_CSS).toContain(
      `.doc-signatures .sig-card.pending { border-color: ${PRINT_COLORS.control};`,
    );
    expect(DOCUMENT_PRINT_CSS).toContain(
      `font-size: 8pt; color: ${PRINT_COLORS.muted}; border-top: 1px solid ${PRINT_COLORS.control};`,
    );
    expect(DOCUMENT_PRINT_CSS).not.toMatch(/\$\{|undefined/);
  });

  it("inks the headings, the body and the signature block from tokens", () => {
    const P = PRINT_COLORS;
    for (const fragment of [
      `body.doc-print { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; color: ${P.ink};`,
      `.doc-print h1 { font-size: 22pt; color: ${P.heading}; border-bottom: 2px solid ${brand.primary};`,
      `.doc-print h3 { font-size: 13pt; color: ${P.subheading};`,
      `.doc-signatures { margin-top: 36px; border-top: 2px solid ${P.ruleLight};`,
      `.sig-badge.signed { background: ${P.successTint}; color: ${P.success}; }`,
      `.sig-badge.fully-signed { background: ${P.success}; color: ${P.paper}; }`,
      `.sig-card.approved { border-color: ${P.successLight}; background: ${P.successPale}; }`,
      `.sig-card.pending { border-color: ${P.control}; background: ${P.panelLight}; }`,
      `.sig-status.approved { color: ${P.success}; }`,
      `.sig-status.pending { color: ${P.warning}; }`,
      `.sig-detail { font-size: 9pt; color: ${P.inkSecondary}; }`,
      `.sig-card.approved { border-color: ${P.successLight}; background: ${P.successPale} !important;`,
    ]) {
      expect(DOCUMENT_PRINT_CSS).toContain(fragment);
    }
  });

  it("holds no colour that is not a token", () => {
    const tokens = new Set<string>([...Object.values(PRINT_COLORS), brand.primary]);
    const used = DOCUMENT_PRINT_CSS.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !tokens.has(c))).toEqual([]);
    // Every print token the stylesheet was given is drawn somewhere: none is dead.
    const documentTokens = [
      "text", "muted", "panel", "control", "paper", "heading", "ink", "subheading", "inkSecondary",
      "ruleLight", "panelLight", "success", "successLight", "successPale", "successTint", "warning",
    ] as const;
    for (const key of documentTokens) expect(used, key).toContain(PRINT_COLORS[key]);
  });
});

describe("stored content and the title block in print", () => {
  it("styles stored content only inside the .doc-content wrapper, with print tokens, rows kept whole", () => {
    expect(printDocumentContentCss(".doc-print")).toBe(
      documentContentCss(".doc-print .doc-content", PRINT_CONTENT_COLOURS, {
        pictures: false,
        print: true,
        scroll: true,
      }),
    );
    const css = printDocumentContentCss(".r");
    expect(css).toContain(`.r .doc-content a { color: ${brand.primary};`);
    expect(css).toContain(`.r .doc-content th, .r .doc-content td { border-width: 1px; border-style: solid; border-color: ${PRINT_COLORS.control};`);
    expect(css).toContain(".r .doc-content tr { break-inside: avoid;");
    // A wide table scrolls on screen (the SoAW preview); print gets no scrolling box.
    expect(css).toContain("@media screen { .r .doc-content { overflow-x: auto; } }");
    expect(css.match(/overflow-x/g)).toHaveLength(1);
    // Pictures stay with printDocumentImageCss, under the whole root.
    expect(css).not.toContain("img");
    expect(DOCUMENT_PRINT_CSS).toContain(printDocumentContentCss(".doc-print"));
  });

  it("keeps the generated tables' rules as they were", () => {
    expect(DOCUMENT_PRINT_CSS).toContain(
      ".doc-print table { width: 100%; border-collapse: collapse; margin: 12px 0; }",
    );
    expect(DOCUMENT_PRINT_CSS).toContain(
      `.doc-print th, .doc-print td { border: 1px solid ${PRINT_COLORS.control}; padding: 6px 10px; text-align: left; font-size: 10pt; vertical-align: top; }`,
    );
  });

  it("draws the title block from classes, as the inline styles did", () => {
    expect(printDocumentHeaderCss(".r")).toBe(
      ".r h1.doc-title { text-align: center; border: none; }\n" +
        `.r p.doc-subtitle { text-align: center; font-size: 14pt; color: ${PRINT_COLORS.inkSecondary}; }`,
    );
    expect(DOCUMENT_PRINT_CSS).toContain(printDocumentHeaderCss(".doc-print"));
  });

  it("documentContent wraps a stored fragment, and gives nothing for a blank one", () => {
    expect(documentContent("<p>x</p>")).toBe('<div class="doc-content"><p>x</p></div>');
    expect(documentContent("")).toBe("");
    expect(documentContent("  ")).toBe("");
    expect(documentContent(null)).toBe("");
    expect(documentContent(undefined)).toBe("");
  });
});

describe("printDocument fragment builders", () => {
  it("escapeHtml escapes the five reserved characters", () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;",
    );
  });

  it("htmlIsEmpty treats blank markup as empty", () => {
    expect(htmlIsEmpty(null)).toBe(true);
    expect(htmlIsEmpty("<p>  </p>")).toBe(true);
    expect(htmlIsEmpty("<p>x</p>")).toBe(false);
    // A section holding only a picture is not empty; an external one is.
    expect(htmlIsEmpty(`<img src="${PIC}">`)).toBe(false);
    expect(htmlIsEmpty('<img src="https://cdn.example.com/a.png">')).toBe(true);
  });

  it("metaTable skips empty values and renders nothing when every value is empty", () => {
    expect(metaTable([["A", ""], ["B", null], ["C", undefined]])).toBe("");
    const html = metaTable([["Owner", "Ada <Lovelace>"], ["Empty", "  "]]);
    expect(html).toContain('<td class="meta-label">Owner</td>');
    expect(html).toContain("Ada &lt;Lovelace&gt;");
    expect(html).not.toContain("Empty");
  });

  it("tableHtml renders nothing without rows and escapes cells", () => {
    expect(tableHtml(["A"], [])).toBe("");
    const html = tableHtml(["Name"], [["<b>x</b>"]]);
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("section and textBlock drop blank content", () => {
    expect(section("T", "")).toBe("");
    expect(section("T", "<p>x</p>")).toBe("<h2>T</h2><p>x</p>");
    expect(textBlock("  ")).toBe("");
    expect(textBlock("a\nb")).toBe('<p class="pre">a\nb</p>');
  });

  it("documentHeader is the SoAW title block: centred type heading without rule, centred name", () => {
    const html = documentHeader("Architecture Decision Record", "ADR-0001 — Adopt <bus>");
    expect(html).toBe(
      '<h1 class="doc-title">Architecture Decision Record</h1>' +
        '<p class="doc-subtitle">ADR-0001 — Adopt &lt;bus&gt;</p>',
    );
    expect(html).not.toContain("style=");
  });

  it("signatureBlock renders the SoAW block: heading, one card per signatory, badge only when all signed", () => {
    const labels = {
      title: "Signatures",
      fullySigned: "Fully Signed",
      approved: "Approved",
      pending: "Pending",
      signed: (d: string) => `Signed: ${d}`,
    };
    const ada = { user_id: "1", display_name: "Ada", email: "ada@x", status: "signed" as const, signed_at: "2026-06-01T10:00:00Z" };
    const bob = { user_id: "2", display_name: "Bob", status: "pending" as const, signed_at: null };
    const mixed = signatureBlock([ada, bob], labels, (iso) => `@${iso}`);
    expect(mixed).toMatch(/^<div class="doc-signatures"><h2>Signatures<\/h2><div class="sig-grid">/);
    expect(mixed).toContain("sig-card approved");
    expect(mixed).toContain("sig-card pending");
    expect(mixed).toContain("Signed: @2026-06-01T10:00:00Z");
    expect(mixed).toContain("ada@x");
    expect(mixed).not.toContain("fully-signed");
    const all = signatureBlock([ada], labels, (iso) => iso);
    expect(all).toContain('<h2>Signatures <span class="sig-badge fully-signed">Fully Signed</span></h2>');
    expect(signatureBlock([], labels, (s) => s)).toBe("");
  });
});

describe("buildPrintHtml", () => {
  // The strings `RichTextEditor.test.tsx` pins as the editor's `getHTML()`
  // (every inline style ends in `;`).
  const printedBody = (bodyHtml: string) => {
    const html = buildPrintHtml({ title: "t", bodyHtml });
    return html.slice(html.indexOf('<body class="doc-print">') + 24, html.lastIndexOf("</body>"));
  };

  it("fits the editor's resized table to the page in proportion", () => {
    expect(printedBody(TABLE_RESIZED)).toBe(
      TABLE_RESIZED.replace('style="width: 350px;"', 'style="width: 350px; max-width: 100%"')
        .replace('<col style="width: 150px;">', '<col style="width: 42.86%">')
        .replace('<col style="width: 200px;">', '<col style="width: 57.14%">')
        .replace(/ colwidth="\d+"/g, ""),
    );
  });

  it("leaves the editor's fresh table as the sanitiser returns it", () => {
    expect(printedBody(TABLE_3X3)).toBe(TABLE_3X3);
    expect(printedBody(TABLE_ONE_RESIZED)).toBe(TABLE_ONE_RESIZED.replace(/ colwidth="\d+"/g, ""));
  });

  it("wraps the body in a full document with title, stylesheet, class and footer", () => {
    const html = buildPrintHtml({
      title: `R-1 <script>`,
      bodyHtml: `<h1>Hi</h1><table class="x"><tr><td>c</td></tr></table>`,
      footerParts: ["Printed: today", "", "Approved by: Ada"],
    });
    expect(html).toMatch(/^<!DOCTYPE html><html lang="en" dir="ltr">/);
    expect(html).toContain("<title>R-1 &lt;script&gt;</title>");
    expect(html).toContain("@page { size: A4 portrait");
    expect(html).toContain('<body class="doc-print">');
    expect(html).toContain('<h1>Hi</h1><table class="x"><tbody><tr><td>c</td></tr></tbody></table>');
    expect(html).toContain('<div class="doc-print-footer">Printed: today  &middot;  Approved by: Ada</div>');
  });

  it("sanitises the body so stored rich text cannot carry a script into the pop-up", () => {
    const html = buildPrintHtml({
      title: "t",
      bodyHtml: `<p onclick="x()">ok</p><script>alert(1)</script><img src=x onerror=alert(1)>`,
    });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("onclick");
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain('<div class="doc-print-footer">');
  });

  it("removes an inline style a generated print body might carry", () => {
    const html = buildPrintHtml({
      title: "t",
      bodyHtml: `<table class="x" style="width:100%"><tr><td style="color: red">c</td></tr></table><p style="margin: 0">p</p>`,
    });
    expect(html).toContain('<table class="x"><tbody><tr><td>c</td></tr></tbody></table><p>p</p>');
    expect(html.split("<body")[1]).not.toContain("style=");
  });

  it("honours a custom body class and stylesheet (the SoAW path)", () => {
    const html = buildPrintHtml({ title: "t", bodyHtml: "<p>x</p>", bodyClass: "soaw-preview", css: ".k{}" });
    expect(html).toContain('<body class="soaw-preview">');
    expect(html).toContain("<style>.k{}</style>");
  });
});

describe("pop-up window handling", () => {
  function fakeWindow() {
    return {
      document: { write: vi.fn(), close: vi.fn() },
      print: vi.fn(),
      close: vi.fn(),
    } as unknown as Window;
  }

  it("openPrintWindow alerts and returns null when the pop-up is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    expect(openPrintWindow()).toBeNull();
    expect(alertSpy).toHaveBeenCalledWith("Please allow pop-ups to export PDF.");
  });

  it("writePrintDocument writes once, closes the stream and prints after the delay", () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    writePrintDocument(win, { title: "t", bodyHtml: "<p>x</p>" });
    expect(win.document.write).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(win.document.write).mock.calls[0][0])).toContain("<p>x</p>");
    expect(win.document.close).toHaveBeenCalledTimes(1);
    expect(win.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it("printDocument opens a blank window and fills it", () => {
    vi.useFakeTimers();
    const win = fakeWindow();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(win);
    printDocument({ title: "t", bodyHtml: "<p>y</p>", printDelayMs: 10 });
    expect(openSpy).toHaveBeenCalledWith("", "_blank");
    expect(win.document.write).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(win.print).toHaveBeenCalledTimes(1);
  });
});

describe("document pictures in print", () => {
  it("styles pictures under the print root from the shared rules, and never splits one", () => {
    expect(printDocumentImageCss(".doc-print")).toBe(
      [
        ".doc-print img { max-width: 100%; height: auto; }",
        '.doc-print img[data-align="center"] { display: block; margin-inline: auto; }',
        '.doc-print img[data-align="right"] { display: block; margin-inline-start: auto; }',
        ".doc-print img { break-inside: avoid; page-break-inside: avoid; }",
      ].join("\n"),
    );
    expect(DOCUMENT_PRINT_CSS).toContain(printDocumentImageCss(".doc-print"));
  });

  it("absoluteDocumentImages prefixes every picture's src with the origin, and nothing else", () => {
    const html = `<p>see src="/api/v1/document-images/ here</p><img src="${PIC}" width="10"><img src="${PIC}">`;
    expect(absoluteDocumentImages(html, "https://ea.example.com")).toBe(
      `<p>see src="/api/v1/document-images/ here</p>` +
        `<img src="https://ea.example.com${PIC}" width="10"><img src="https://ea.example.com${PIC}">`,
    );
  });

  it("absoluteDocumentImages escapes the origin and leaves the HTML alone without a usable one", () => {
    expect(absoluteDocumentImages(`<img src="${PIC}">`, 'https://a"b')).toBe(
      `<img src="https://a&quot;b${PIC}">`,
    );
    expect(absoluteDocumentImages(`<img src="${PIC}">`, "")).toBe(`<img src="${PIC}">`);
    expect(absoluteDocumentImages(`<img src="${PIC}">`, "null")).toBe(`<img src="${PIC}">`);
  });

  it("buildPrintHtml keeps a stored picture, absolute, and drops an external one", () => {
    const html = buildPrintHtml({
      title: "t",
      bodyHtml: `<h2>Context</h2><img src="${PIC}" width="300" data-align="center"><img src="https://cdn.example.com/a.png">`,
    });
    expect(html).toContain(
      `<img src="${window.location.origin}${PIC}" width="300" data-align="center">`,
    );
    expect(html).not.toContain("cdn.example.com");
    expect(html).not.toContain("loading=");
  });
});

describe("waiting for pictures before printing", () => {
  function picture(complete: boolean): HTMLImageElement {
    const img = document.createElement("img");
    Object.defineProperty(img, "complete", { value: complete });
    return img;
  }

  function windowWith(images: HTMLImageElement[]) {
    return {
      document: { write: vi.fn(), close: vi.fn(), images },
      print: vi.fn(),
    } as unknown as Window;
  }

  it("pendingImages lists only pictures not yet loaded or failed", () => {
    const a = picture(false);
    const b = picture(true);
    const c = picture(false);
    expect(pendingImages({ images: [a, b, c] } as unknown as Document)).toEqual([a, c]);
  });

  it("waitForImages resolves at once with nothing to wait for", async () => {
    await expect(waitForImages([])).resolves.toBeUndefined();
  });

  it("waitForImages resolves when every picture has loaded or failed, each counted once", async () => {
    vi.useFakeTimers();
    const a = picture(false);
    const b = picture(false);
    let done = false;
    void waitForImages([a, b]).then(() => {
      done = true;
    });
    a.dispatchEvent(new Event("load"));
    a.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    b.dispatchEvent(new Event("error"));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  it("waitForImages gives up after the cap", async () => {
    vi.useFakeTimers();
    let done = false;
    void waitForImages([picture(false)], 500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(499);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("caps the default wait at about ten seconds", async () => {
    expect(PRINT_IMAGE_WAIT_MS).toBe(10_000);
    vi.useFakeTimers();
    let done = false;
    void waitForImages([picture(false)]).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("writePrintDocument prints only after the pictures, then after the delay", async () => {
    vi.useFakeTimers();
    const img = picture(false);
    const win = windowWith([img, picture(true)]);
    writePrintDocument(win, { title: "t", bodyHtml: `<img src="${PIC}">`, printDelayMs: 50 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(win.print).not.toHaveBeenCalled();
    img.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(49);
    expect(win.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it("writePrintDocument still prints when a picture never answers", async () => {
    vi.useFakeTimers();
    const win = windowWith([picture(false)]);
    writePrintDocument(win, { title: "t", bodyHtml: "<p>x</p>" });
    await vi.advanceTimersByTimeAsync(PRINT_IMAGE_WAIT_MS + 399);
    expect(win.print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(win.print).toHaveBeenCalledTimes(1);
  });

  it("writePrintDocument with every picture loaded keeps the plain delay", () => {
    vi.useFakeTimers();
    const win = windowWith([picture(true)]);
    writePrintDocument(win, { title: "t", bodyHtml: "<p>x</p>", printDelayMs: 20 });
    vi.advanceTimersByTime(19);
    expect(win.print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(win.print).toHaveBeenCalledTimes(1);
  });
});

describe("resized tables in print", () => {
  const resized = (widths: number[], extra = "") =>
    `<table style="width: ${widths.reduce((a, b) => a + b, 0)}px"${extra}><colgroup>${widths
      .map((w) => `<col style="width: ${w}px">`)
      .join("")}</colgroup><tbody><tr>${widths
      .map((w) => `<td colspan="1" rowspan="1"><p>${w}</p></td>`)
      .join("")}</tr></tbody></table>`;
  const colWidths = (html: string) =>
    Array.from(html.matchAll(/<col style="width: ([\d.]+)%">/g), (m) => Number(m[1]));

  it("rewrites a resized table's columns to their shares of the whole, keeping its width within the page", () => {
    expect(printTableWidths(resized([150, 300, 150]))).toBe(
      '<table style="width: 600px; max-width: 100%"><colgroup><col style="width: 25%"><col style="width: 50%"><col style="width: 25%"></colgroup>' +
        '<tbody><tr><td colspan="1" rowspan="1"><p>150</p></td><td colspan="1" rowspan="1"><p>300</p></td>' +
        '<td colspan="1" rowspan="1"><p>150</p></td></tr></tbody></table>',
    );
  });

  it("keeps the proportions to two decimals, summing to 100 within rounding", () => {
    expect(colWidths(printTableWidths(resized([100, 200])))).toEqual([33.33, 66.67]);
    const thirds = colWidths(printTableWidths(resized([77, 77, 77])));
    expect(thirds).toEqual([33.33, 33.33, 33.33]);
    const odd = colWidths(printTableWidths(resized([123.5, 47, 310, 90])));
    expect(odd).toHaveLength(4);
    expect(Math.abs(odd.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(0.02);
    expect(odd[0]).toBe(Math.round((123.5 / 570.5) * 10000) / 100);
  });

  it("keeps a narrow table at its stored width, and a wide one in the same form", () => {
    expect(printTableWidths(resized([100, 200]))).toMatch(/^<table style="width: 300px; max-width: 100%">/);
    const wide = printTableWidths(resized([700, 500, 300]));
    expect(wide).toMatch(/^<table style="width: 1500px; max-width: 100%">/);
    expect(colWidths(wide)).toEqual([46.67, 33.33, 20]);
    expect(colWidths(wide).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it("replaces whatever width the table carried with the sum of its columns", () => {
    const out = printTableWidths(
      '<table style="min-width: 50px"><colgroup><col style="width: 40px"><col style="width: 60px;"></colgroup><tr><td>a</td><td>b</td></tr></table>',
    );
    expect(out).toContain('<table style="width: 100px; max-width: 100%">');
    expect(colWidths(out)).toEqual([40, 60]);
    expect(printTableWidths(resized([10.125, 20.25]))).toContain('style="width: 30.38px; max-width: 100%"');
  });

  it("leaves a table alone unless every column carries a pixel width", () => {
    for (const html of [
      '<table style="min-width: 50px"><colgroup><col style="width: 150px"><col style="min-width: 25px"></colgroup><tbody><tr><td>a</td><td>b</td></tr></tbody></table>',
      "<table><colgroup></colgroup><tbody><tr><td>a</td></tr></tbody></table>",
      "<table><tbody><tr><td>a</td></tr></tbody></table>",
      '<table><colgroup><col style="width: 0px"></colgroup><tbody><tr><td>a</td></tr></tbody></table>',
      '<table><colgroup><col style="width: 10%"></colgroup><tbody><tr><td>a</td></tr></tbody></table>',
      '<table><colgroup><col style="color: red; width: 10px"></colgroup><tbody><tr><td>a</td></tr></tbody></table>',
    ]) {
      expect(printTableWidths(html)).toBe(html);
    }
  });

  it("rewrites a nested resized table too, and only the tables that need it", () => {
    const html = `<div>${resized([10, 30])}<table><tbody><tr><td>${resized([1, 3])}</td></tr></tbody></table></div>`;
    const out = printTableWidths(html);
    expect(colWidths(out)).toEqual([25, 75, 25, 75]);
    expect(out).toContain('<table><tbody><tr><td><table style="width: 4px; max-width: 100%">');
    expect(out.match(/max-width: 100%/g)).toHaveLength(2);
  });

  it("returns HTML without a table exactly as it came", () => {
    const html = `<p>a &amp; b<br>c</p><img src="${PIC}" width="10"><p>width: 150px</p>`;
    expect(printTableWidths(html)).toBe(html);
    expect(printTableWidths("")).toBe("");
  });

  it("buildPrintHtml prints a resized table at page width and keeps a picture's absolute src", () => {
    const html = buildPrintHtml({
      title: "t",
      bodyHtml: documentContent(`${resized([100, 300])}<img src="${PIC}" width="300">`),
    });
    expect(html).toContain(
      '<table style="width: 400px; max-width: 100%"><colgroup><col style="width: 25%"><col style="width: 75%"></colgroup>',
    );
    expect(html).toContain(`<img src="${window.location.origin}${PIC}" width="300">`);
    expect(html.split("<body")[1].match(/\d+px/g)).toEqual(["400px"]);
  });
});
