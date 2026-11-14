/**
 * `reportExport.ts` — the three exits of a report: the DOM read into sheets
 * (`extractSheetsFromDOM`), the sheets written as an XLSX workbook
 * (`exportReportToXlsx`) and the chart captured into a PPTX deck
 * (`exportReportToPptx`).
 *
 * The spreadsheet writer, the deck generator and `html-to-image` are
 * mocked at the module boundary; everything the exporter *computes* — cell
 * types and formats, sheet names, the filename stamp, the slide geometry,
 * where a tall chart is cut — runs for real against the jsdom DOM, with the
 * layout measurements pinned through `@/test/dom`.
 *
 * Numeric parsing has three blind spots that are documented here as
 * CURRENT behaviour, not desired behaviour (see the `blind spots` test);
 * they are reported, not fixed.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import * as XLSX from "xlsx";
import { toPng } from "html-to-image";
import i18n from "@/i18n";
import { installCanvas, installImage, stubRectsBySelector, type RectLike } from "@/test/dom";

interface FakeSlide {
  addText: Mock;
  addImage: Mock;
  background?: { color: string };
}

interface FakePptx {
  layout: string;
  title: string;
  slides: FakeSlide[];
  writeFile: Mock;
}

/** Every `new PptxGenJS()` the exporter makes, in order. */
const pptxInstances = vi.hoisted(() => [] as FakePptx[]);

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

vi.mock("html-to-image", () => ({ toPng: vi.fn() }));

vi.mock("pptxgenjs", () => {
  class PptxGenJSMock implements FakePptx {
    layout = "";
    title = "";
    slides: FakeSlide[] = [];
    writeFile = vi.fn(async () => "");
    constructor() {
      pptxInstances.push(this);
    }
    addSlide(): FakeSlide {
      const slide: FakeSlide = { addText: vi.fn(), addImage: vi.fn() };
      this.slides.push(slide);
      return slide;
    }
  }
  return { default: PptxGenJSMock };
});

import {
  captureFilter,
  capturePixelRatio,
  exportReportToPptx,
  exportReportToXlsx,
  extractSheetsFromDOM,
  headerAt,
  keepWithNext,
  localeNumberSeparators,
  parseDisplayedNumber,
  planSectionPages,
  sectionCuts,
  slidePalette,
  textDirection,
  type TableHeadBox,
} from "./reportExport";
import type { ExportSheet, ReportExportData } from "./reportExport";

/** Local time, 2 Oct 2026 14:07:09 — the stamp is `YYYY-MM-DD_HHMM` in local time. */
const NOW = new Date(2026, 9, 2, 14, 7, 9);
const STAMP = "2026-10-02_1407";

/** The "Generated <date>" line, exactly as the exporter builds it. */
const generatedLabel = (): string =>
  i18n.t("reports:export.titleSlide", {
    defaultValue: "Generated {{date}}",
    date: new Date().toLocaleString(i18n.language),
  });

const pageIndicator = (current: number, total: number): string =>
  i18n.t("reports:export.pageIndicator", {
    defaultValue: "{{current}} / {{total}}",
    current,
    total,
  });

// Slide geometry the exporter derives from LAYOUT_WIDE (13.333 × 7.5 in) and a 0.5 in margin.
const MARGIN = 0.5;
const CHART_W = 13.333 - 2 * MARGIN;
const CHART_TOP = MARGIN + 1.3;
const CHART_H = 7.5 - CHART_TOP - MARGIN;
const CONT_TOP = MARGIN + 0.7;
const CONT_H = 7.5 - CONT_TOP - MARGIN;

const near = (n: number) => expect.closeTo(n, 3);

const CHART_PNG = "data:image/png;base64,CHART";
const SLICE_PNG = "data:image/png;base64,SLICE";

const restores: (() => void)[] = [];

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/**
 * A chart node attached to the document with a pinned bounding box, plus the
 * boxes of its `[data-export-row]` descendants in document order.
 */
function mountChart(html: string, nodeRect: RectLike, rowRects: RectLike[] = []): HTMLElement {
  const root = mount(`<div data-chart>${html}</div>`);
  restores.push(
    stubRectsBySelector({ "[data-chart]": [nodeRect], "[data-export-row]": rowRects }),
  );
  return root.querySelector("[data-chart]") as HTMLElement;
}

const rowsHtml = (count: number): string => "<div data-export-row></div>".repeat(count);

/** `drawImage(img, sx, sy, sw, sh, …)` → `[sx, sy, sw, sh]` for every slice drawn. */
const drawnSlices = (drawImage: Mock): unknown[][] =>
  drawImage.mock.calls.map((call) => call.slice(1, 5));

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore();
  document.body.innerHTML = "";
  pptxInstances.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("extractSheetsFromDOM", () => {
  it("returns no sheets for a missing node", () => {
    expect(extractSheetsFromDOM(null)).toEqual([]);
  });

  it("reads one sheet per table: header cells become columns, body rows become records", () => {
    const root = mount(`
      <table>
        <thead><tr><th>  Name  </th><th>Owner
          team</th><th></th></tr></thead>
        <tbody>
          <tr><td> Alpha </td><td>Core
            platform</td><td>x</td></tr>
          <tr><th>a group heading row has no cells</th></tr>
          <tr><td>Beta</td><td>Ops</td><td></td></tr>
        </tbody>
      </table>`);

    const sheets = extractSheetsFromDOM(root);

    expect(sheets).toHaveLength(1);
    expect(sheets[0].columns).toEqual([
      { key: "c0", label: "Name", type: "text" },
      { key: "c1", label: "Owner team", type: "text" },
      { key: "c2", label: "Column 3", type: "text" },
    ]);
    expect(sheets[0].rows).toEqual([
      { c0: "Alpha", c1: "Core platform", c2: "x" },
      { c0: "Beta", c1: "Ops", c2: "" },
    ]);
  });

  it("skips a table without header cells or without body rows, but still counts it for the fallback name", () => {
    const root = mount(`
      <table><tbody><tr><td>no thead</td></tr></tbody></table>
      <table><thead><tr><th>Empty</th></tr></thead><tbody></tbody></table>
      <table><thead><tr><th>Kept</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>`);

    const sheets = extractSheetsFromDOM(root);

    expect(sheets).toHaveLength(1);
    expect(sheets[0].name).toBe("Sheet 3");
    expect(sheets[0].columns).toEqual([{ key: "c0", label: "Kept", type: "text" }]);
    expect(sheets[0].rows).toEqual([{ c0: "v" }]);
  });

  it("types a right-aligned column as number, whether by attribute or by computed style", () => {
    const root = mount(`
      <table>
        <thead><tr>
          <th align="right">Attr</th>
          <th style="text-align: right">Style</th>
          <th style="text-align: left">Left</th>
          <th>Plain</th>
        </tr></thead>
        <tbody><tr><td>1</td><td>2</td><td>3</td><td>4</td></tr></tbody>
      </table>`);

    const [sheet] = extractSheetsFromDOM(root);

    expect(sheet.columns.map((c) => c.type)).toEqual(["number", "number", "text", "text"]);
    expect(sheet.rows[0]).toEqual({ c0: 1, c1: 2, c2: "3", c3: "4" });
  });

  // `extractSheetsFromDOM` reads cell numbers back with the runtime's own
  // locale (whatever `Intl.NumberFormat(undefined)` resolves to on the
  // machine running the suite — not necessarily en-US), so a fixture has to
  // use that same locale's separators rather than a hardcoded "1,234.50".
  const RUNTIME_SEP = localeNumberSeparators();
  const grouped1234_50 = `1${RUNTIME_SEP.group}234${RUNTIME_SEP.decimal}50`;

  it("parses the display formats a number column carries and keeps what is not a number as text", () => {
    const cells = [grouped1234_50, "12 %", "-", "", "€ 99", "2024-01-05", "1-2"];
    const root = mount(`<table>
      <thead><tr>${cells.map((_, i) => `<th align="right">N${i}</th>`).join("")}</tr></thead>
      <tbody><tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr></tbody>
    </table>`);

    const [sheet] = extractSheetsFromDOM(root);

    expect(sheet.rows[0]).toEqual({
      c0: 1234.5,
      c1: 12,
      c2: "-",
      c3: "",
      c4: 99,
      c5: "2024-01-05",
      c6: "1-2",
    });
  });

  it("keeps digit-less text as text and reads an accounting negative as negative", () => {
    // "n/a" used to export as 0 and "(500)" as +500.
    const cells = ["n/a", "abc", grouped1234_50, "(500)", "—"];
    const root = mount(`<table>
      <thead><tr>${cells.map((_, i) => `<th align="right">N${i}</th>`).join("")}</tr></thead>
      <tbody><tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr></tbody>
    </table>`);

    const [sheet] = extractSheetsFromDOM(root);

    expect(sheet.rows[0]).toEqual({ c0: "n/a", c1: "abc", c2: 1234.5, c3: -500, c4: "—" });
  });

  it("parseDisplayedNumber reads a number with the separators its locale wrote it with", () => {
    const de = localeNumberSeparators("de-DE");
    const fr = localeNumberSeparators("fr-FR");
    expect(localeNumberSeparators("en-US")).toEqual({ group: ",", decimal: "." });
    expect(de).toEqual({ group: ".", decimal: "," });
    expect(fr.decimal).toBe(",");
    expect(parseDisplayedNumber("1.234,50", de)).toBe(1234.5);
    expect(parseDisplayedNumber("(1.234,50)", de)).toBe(-1234.5);
    expect(parseDisplayedNumber("12 %", de)).toBe(12);
    // The DOM collapses the narrow no-break space French groups with into a plain space.
    expect(parseDisplayedNumber("1 234,50", fr)).toBe(1234.5);
    expect(parseDisplayedNumber("€ 99", { group: ",", decimal: "." })).toBe(99);
    expect(parseDisplayedNumber("-7.5", { group: ",", decimal: "." })).toBe(-7.5);
    expect(parseDisplayedNumber("2024-01-05", { group: ",", decimal: "." })).toBeNull();
    expect(parseDisplayedNumber("1-2", { group: ",", decimal: "." })).toBeNull();
    expect(parseDisplayedNumber("", { group: ",", decimal: "." })).toBeNull();
    expect(parseDisplayedNumber("n/a", { group: ",", decimal: "." })).toBeNull();
  });

  it("names a sheet after the nearest preceding heading or export-section marker, walking up through ancestors", () => {
    const table = (id: string) =>
      `<table id="${id}"><thead><tr><th>H</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>`;
    const root = mount(`
      <h2>  Direct   heading  </h2>
      ${table("a")}
      <div><p>intro</p><h3>Nested heading</h3></div>
      ${table("b")}
      <section>
        <span data-export-section>Section marker</span>
        <div><div>${table("c")}</div></div>
      </section>
      <p>no heading here</p>
      ${table("d")}`);

    const names = extractSheetsFromDOM(root).map((s) => s.name);

    expect(names).toEqual(["Direct heading", "Nested heading", "Section marker", "Sheet 4"]);
  });

  it("never looks past the node it was given for a heading", () => {
    const root = mount(`
      <h1>Outside the export root</h1>
      <div id="node">
        <table><thead><tr><th>H</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>
      </div>`);

    const sheets = extractSheetsFromDOM(root.querySelector("#node") as HTMLElement);

    expect(sheets.map((s) => s.name)).toEqual(["Sheet 1"]);
  });

  it("caps a heading-derived name at Excel's 31 characters", () => {
    const heading = "Applications grouped by business capability";
    const root = mount(`
      <h4>${heading}</h4>
      <table><thead><tr><th>H</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>`);

    const [sheet] = extractSheetsFromDOM(root);

    expect(sheet.name).toBe(heading.slice(0, 31));
    expect(sheet.name).toHaveLength(31);
  });
});

describe("exportReportToXlsx", () => {
  const writeFile = () => vi.mocked(XLSX.writeFile);
  const lastWorkbook = (): XLSX.WorkBook => {
    const calls = writeFile().mock.calls;
    return calls[calls.length - 1][0] as XLSX.WorkBook;
  };
  const lastFilename = (): string => {
    const calls = writeFile().mock.calls;
    return calls[calls.length - 1][1] as string;
  };
  const simpleSheet = (name: string): ExportSheet => ({
    name,
    columns: [{ key: "v", label: "V" }],
    rows: [{ v: 1 }],
  });

  it("writes every sheet in order with a header row and typed, formatted cells", async () => {
    const data: ReportExportData = {
      title: "Portfolio",
      sheets: [
        {
          name: "Apps",
          columns: [
            { key: "name", label: "Name" },
            { key: "cost", label: "Cost", type: "currency" },
            { key: "count", label: "Count", type: "number" },
            { key: "since", label: "Since", type: "date" },
            { key: "tags", label: "Tags", type: "text" },
            { key: "live", label: "Live" },
          ],
          rows: [
            {
              name: "Alpha",
              cost: 1234.5,
              count: "7",
              since: new Date(2026, 0, 5),
              tags: ["a", "b"],
              live: true,
            },
            { name: null, cost: "n/a", count: undefined, since: "2025-12-31", tags: "", live: false },
          ],
        },
        { name: "Totals", columns: [{ key: "v", label: "V", type: "number" }], rows: [{ v: 3 }] },
      ],
    };

    await exportReportToXlsx(data);

    expect(writeFile()).toHaveBeenCalledTimes(1);
    const wb = lastWorkbook();
    expect(wb.SheetNames).toEqual(["Apps", "Totals"]);
    const ws = wb.Sheets.Apps;
    expect(["A1", "B1", "C1", "D1", "E1", "F1"].map((ref) => ws[ref].v)).toEqual([
      "Name",
      "Cost",
      "Count",
      "Since",
      "Tags",
      "Live",
    ]);
    expect(ws.A2).toMatchObject({ t: "s", v: "Alpha" });
    expect(ws.B2).toMatchObject({ t: "n", v: 1234.5, z: "#,##0.00" });
    expect(ws.C2).toMatchObject({ t: "n", v: 7, z: "0.##" });
    expect(ws.D2).toMatchObject({ t: "s", v: "2026-01-05" });
    expect(ws.E2).toMatchObject({ t: "s", v: "a, b" });
    expect(ws.F2).toMatchObject({ t: "b", v: true });
    // null / undefined / "" all land as an empty string; a non-numeric value in a
    // numeric column stays text and takes no number format.
    expect(ws.A3).toMatchObject({ t: "s", v: "" });
    expect(ws.B3).toMatchObject({ t: "s", v: "n/a" });
    expect(ws.B3.z).toBeUndefined();
    expect(ws.C3).toMatchObject({ t: "s", v: "" });
    expect(ws.D3).toMatchObject({ t: "s", v: "2025-12-31" });
    expect(ws.E3).toMatchObject({ t: "s", v: "" });
    expect(ws.F3).toMatchObject({ t: "b", v: false });
    expect(wb.Sheets.Totals.A2).toMatchObject({ t: "n", v: 3, z: "0.##" });
  });

  it("sizes each column to its longest value plus padding, capped at 60 characters", async () => {
    await exportReportToXlsx({
      title: "Widths",
      sheets: [
        {
          name: "W",
          columns: [
            { key: "short", label: "Short label" },
            { key: "long", label: "L" },
            { key: "num", label: "N", type: "number" },
            { key: "empty", label: "Em" },
          ],
          rows: [{ short: "ab", long: "x".repeat(100), num: 12345, empty: null }],
        },
      ],
    });

    expect(lastWorkbook().Sheets.W["!cols"]).toEqual([
      { wch: 13 },
      { wch: 60 },
      { wch: 7 },
      { wch: 4 },
    ]);
  });

  it("sanitizes sheet names and suffixes duplicates, making room for the suffix inside 31 characters", async () => {
    // Two tables under one heading of 31 characters or more used to hang the
    // export: the suffixed name was sliced back to the same 31 characters, so
    // a free name was never found.
    await exportReportToXlsx({
      title: "Names",
      sheets: [
        simpleSheet("Data"),
        simpleSheet("Data"),
        simpleSheet("Data"),
        simpleSheet("A/B:C*D?[E]"),
        simpleSheet(""),
        simpleSheet("x".repeat(40)),
        simpleSheet("x".repeat(40)),
        simpleSheet("x".repeat(31)),
      ],
    });

    expect(lastWorkbook().SheetNames).toEqual([
      "Data",
      "Data 2",
      "Data 3",
      "A B C D  E",
      "Sheet",
      "x".repeat(31),
      `${"x".repeat(29)} 2`,
      `${"x".repeat(29)} 3`,
    ]);
  });

  it("falls back to a summary sheet carrying the title and the active filters when there is no table", async () => {
    await exportReportToXlsx({
      title: "Chart only",
      sheets: [],
      filterSummary: [
        { label: "Type", value: "Application" },
        { label: "Owner", value: "" },
        { label: "Lifecycle", value: "Active" },
      ],
    });

    const wb = lastWorkbook();
    const summaryName = i18n.t("reports:export.summarySheet", { defaultValue: "Summary" });
    expect(wb.SheetNames).toEqual([summaryName]);
    const ws = wb.Sheets[summaryName];
    expect(ws.A1.v).toBe(i18n.t("common:labels.name", { defaultValue: "Name" }));
    expect(ws.B1.v).toBe(i18n.t("common:labels.value", { defaultValue: "Value" }));
    expect(ws.A2.v).toBe(generatedLabel());
    expect(ws.B2.v).toBe("Chart only");
    // A filter with an empty value is left out.
    expect([ws.A3.v, ws.B3.v]).toEqual(["Type", "Application"]);
    expect([ws.A4.v, ws.B4.v]).toEqual(["Lifecycle", "Active"]);
    expect(ws.A5).toBeUndefined();
    expect(ws["!ref"]).toBe("A1:B4");
  });

  it("writes the summary sheet with only the generation line when no filter is active", async () => {
    await exportReportToXlsx({ title: "Bare", sheets: [] });

    const ws = lastWorkbook().Sheets[i18n.t("reports:export.summarySheet", { defaultValue: "Summary" })];
    expect(ws["!ref"]).toBe("A1:B2");
    expect(ws.B2.v).toBe("Bare");
  });

  it("names the file after the sanitized title and the local timestamp", async () => {
    await exportReportToXlsx({ title: "Cost report: 2026/Q3?", sheets: [] });
    expect(lastFilename()).toBe(`Cost_report__2026_Q3__${STAMP}.xlsx`);

    await exportReportToXlsx({ title: "", sheets: [] });
    expect(lastFilename()).toBe(`report_${STAMP}.xlsx`);

    await exportReportToXlsx({ title: "t".repeat(70), sheets: [] });
    expect(lastFilename()).toBe(`${"t".repeat(60)}_${STAMP}.xlsx`);
  });
});

describe("exportReportToPptx", () => {
  const pptx = (): FakePptx => {
    expect(pptxInstances).toHaveLength(1);
    return pptxInstances[0];
  };

  it("builds a title slide only when there is no chart, and writes the stamped file", async () => {
    await exportReportToPptx({ title: "Landscape", sheets: [], subtitle: "All applications" });

    const deck = pptx();
    expect(deck.layout).toBe("LAYOUT_WIDE");
    expect(deck.title).toBe("Landscape");
    expect(deck.slides).toHaveLength(1);
    const [slide] = deck.slides;
    expect(slide.background).toEqual({ color: "FFFFFF" });
    expect(slide.addText).toHaveBeenCalledTimes(2);
    expect(slide.addText).toHaveBeenNthCalledWith(
      1,
      "Landscape",
      expect.objectContaining({ fontSize: 28, bold: true, color: "0F7EB5", x: MARGIN, y: MARGIN }),
    );
    expect(slide.addText).toHaveBeenNthCalledWith(
      2,
      `${generatedLabel()}    All applications`,
      expect.objectContaining({ fontSize: 12, color: "607D8B" }),
    );
    expect(slide.addImage).not.toHaveBeenCalled();
    expect(toPng).not.toHaveBeenCalled();
    expect(deck.writeFile).toHaveBeenCalledWith({ fileName: `Landscape_${STAMP}.pptx` });
  });

  it("puts the active filters in the subtitle, ahead of a static subtitle", async () => {
    await exportReportToPptx({
      title: "T",
      sheets: [],
      subtitle: "not shown",
      filterSummary: [
        { label: "Type", value: "Application" },
        { label: "Lifecycle", value: "Active" },
      ],
    });

    expect(pptx().slides[0].addText).toHaveBeenNthCalledWith(
      2,
      `${generatedLabel()}    Type: Application  •  Lifecycle: Active`,
      expect.anything(),
    );
  });

  it("uses the static subtitle when the filter list is empty, and the generation line alone when there is neither", async () => {
    await exportReportToPptx({ title: "A", sheets: [], subtitle: "Sub", filterSummary: [] });
    expect(pptxInstances[0].slides[0].addText).toHaveBeenNthCalledWith(
      2,
      `${generatedLabel()}    Sub`,
      expect.anything(),
    );

    await exportReportToPptx({ title: "B", sheets: [] });
    expect(pptxInstances[1].slides[0].addText).toHaveBeenNthCalledWith(
      2,
      generatedLabel(),
      expect.anything(),
    );
  });

  it("renders a chart with no row selector on the title slide alone, letterboxed to the chart area", async () => {
    // A tall, narrow source: height-bound fit, centred horizontally.
    const node = mountChart("<svg></svg>", { width: 400, height: 1000 });
    vi.mocked(toPng).mockResolvedValue(CHART_PNG);

    await exportReportToPptx({ title: "Treemap", sheets: [], chartNode: node });

    expect(toPng).toHaveBeenCalledTimes(1);
    const [capturedNode, options] = vi.mocked(toPng).mock.calls[0];
    expect(capturedNode).toBe(node);
    expect(options).toMatchObject({
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      width: 400,
      height: 1000,
      style: { position: "static", left: "0", top: "0", margin: "0" },
    });
    // Web fonts stay embedded: a capture that skipped them lost the Material
    // Symbols glyphs and fell back to a local sans wherever Inter is not
    // installed (the font stylesheets are readable thanks to `crossorigin`
    // on their <link>s, see index.html).
    expect(options).not.toHaveProperty("skipFonts");
    // Material Symbols spans are left out of the capture; everything else is kept.
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    expect(options?.filter?.(icon)).toBe(false);
    expect(options?.filter?.(document.createElement("div"))).toBe(true);
    expect(options?.filter?.(document.createTextNode("x") as unknown as HTMLElement)).toBe(true);

    const deck = pptx();
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].addImage).toHaveBeenCalledTimes(1);
    const drawW = CHART_H * (400 / 1000);
    expect(deck.slides[0].addImage).toHaveBeenCalledWith({
      data: CHART_PNG,
      x: near(MARGIN + (CHART_W - drawW) / 2),
      y: near(CHART_TOP),
      w: near(drawW),
      h: near(CHART_H),
    });
  });

  it("falls back to a placeholder when the capture fails, restoring the overflow styles it changed", async () => {
    const node = mountChart(
      `<div id="scroller" style="overflow-x: auto"><div id="inner"></div></div><div id="plain"></div>`,
      { width: 800, height: 300 },
    );
    const scroller = node.querySelector("#scroller") as HTMLElement;
    const inner = node.querySelector("#inner") as HTMLElement;
    inner.style.overflowY = "hidden";
    const duringCapture: string[] = [];
    vi.mocked(toPng).mockImplementation(async () => {
      duringCapture.push(
        scroller.style.overflowX,
        scroller.style.overflowY,
        inner.style.overflowX,
        inner.style.overflowY,
      );
      throw new Error("tainted canvas");
    });

    await exportReportToPptx({ title: "Gantt", sheets: [], chartNode: node });

    // Clipping was lifted on both axes of every clipping descendant while capturing…
    expect(duringCapture).toEqual(["visible", "visible", "visible", "visible"]);
    // …and put back exactly as it was afterwards.
    expect(scroller.style.overflowX).toBe("auto");
    expect(scroller.style.overflowY).toBe("");
    expect(inner.style.overflowX).toBe("");
    expect(inner.style.overflowY).toBe("hidden");

    const deck = pptx();
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].addImage).not.toHaveBeenCalled();
    expect(deck.slides[0].addText).toHaveBeenNthCalledWith(
      3,
      i18n.t("reports:export.chartUnavailable", { defaultValue: "Chart preview unavailable." }),
      expect.objectContaining({
        x: MARGIN,
        y: near(CHART_TOP),
        w: near(CHART_W),
        h: near(CHART_H),
        align: "center",
        valign: "middle",
        italic: true,
      }),
    );
    expect(deck.writeFile).toHaveBeenCalledWith({ fileName: `Gantt_${STAMP}.pptx` });
  });

  describe("pagination", () => {
    // Source width 1000 → one page holds 1000 × (CHART_H / CHART_W) ≈ 421.6 source px,
    // and a page shorter than a quarter of that (≈ 105.4 px) is rejected.
    const WIDTH = 1000;
    const PAGE_MAX = WIDTH * (CHART_H / CHART_W);
    let canvas: ReturnType<typeof installCanvas>;

    beforeEach(() => {
      canvas = installCanvas(SLICE_PNG);
      restores.push(canvas);
      vi.mocked(toPng).mockResolvedValue(CHART_PNG);
    });

    /** The capture is a 2× PNG: a chart of `height` source px decodes at twice that. */
    const installCapturedPng = (height: number) =>
      restores.push(installImage({ width: 2 * WIDTH, height: 2 * height }));

    const exportPaginated = (node: HTMLElement, title = "Capabilities") =>
      exportReportToPptx({
        title,
        sheets: [],
        chartNode: node,
        paginateRowSelector: "[data-export-row]",
      });

    it("sanity-checks the page budget the cases below are built on", () => {
      expect(PAGE_MAX).toBeGreaterThan(400);
      expect(PAGE_MAX).toBeLessThan(450);
      expect(PAGE_MAX * 0.25).toBeGreaterThan(100);
      expect(PAGE_MAX * 0.25).toBeLessThan(150);
    });

    it("cuts a tall chart at row boundaries relative to the chart's own top and adds continuation slides", async () => {
      // Ten 100-px rows stacked under a chart whose top sits at y=40; a
      // collapsed (zero-height) row in the middle contributes no boundary.
      const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({
        y: 40 + i * 100,
        width: WIDTH,
        height: 100,
      }));
      rows.splice(5, 0, { y: 40 + 500, width: WIDTH, height: 0 });
      const node = mountChart(
        `<div id="scroller" style="overflow-y: scroll">${rowsHtml(rows.length)}</div>`,
        { y: 40, width: WIDTH, height: 1000 },
        rows,
      );
      installCapturedPng(1000);
      const scroller = node.querySelector("#scroller") as HTMLElement;
      let overflowDuringCapture = "";
      vi.mocked(toPng).mockImplementation(async () => {
        overflowDuringCapture = scroller.style.overflowY;
        return CHART_PNG;
      });

      await exportPaginated(node);

      expect(overflowDuringCapture).toBe("visible");
      expect(scroller.style.overflowY).toBe("scroll");

      // Four rows fit a page (400 ≤ 421.6; 500 does not): pages of 400, 400 and 200 source px,
      // sliced from the 2× PNG at 2× offsets.
      expect(drawnSlices(canvas.context.drawImage)).toEqual([
        [0, 0, 2000, 800],
        [0, 800, 2000, 800],
        [0, 1600, 2000, 400],
      ]);
      expect(canvas.context.fillRect).toHaveBeenNthCalledWith(3, 0, 0, 2000, 400);

      const deck = pptx();
      expect(deck.slides).toHaveLength(3);
      const [first, second, third] = deck.slides;
      // Page 1 on the title slide: width-bound fit (1000 × 400 is wider than the chart area).
      expect(first.addImage).toHaveBeenCalledWith({
        data: SLICE_PNG,
        x: near(MARGIN),
        y: near(CHART_TOP + (CHART_H - CHART_W / 2.5) / 2),
        w: near(CHART_W),
        h: near(CHART_W / 2.5),
      });
      // Continuation slides carry a smaller header and a taller chart area.
      expect(second.background).toEqual({ color: "FFFFFF" });
      expect(second.addText).toHaveBeenCalledTimes(1);
      expect(second.addText).toHaveBeenCalledWith(
        `Capabilities — ${pageIndicator(2, 3)}`,
        expect.objectContaining({ fontSize: 18, bold: true, color: "0F7EB5", h: 0.5 }),
      );
      expect(second.addImage).toHaveBeenCalledWith({
        data: SLICE_PNG,
        x: near(MARGIN),
        y: near(CONT_TOP + (CONT_H - CHART_W / 2.5) / 2),
        w: near(CHART_W),
        h: near(CHART_W / 2.5),
      });
      expect(third.addText).toHaveBeenCalledWith(
        `Capabilities — ${pageIndicator(3, 3)}`,
        expect.anything(),
      );
      expect(third.addImage).toHaveBeenCalledWith({
        data: SLICE_PNG,
        x: near(MARGIN),
        y: near(CONT_TOP + (CONT_H - CHART_W / 5) / 2),
        w: near(CHART_W),
        h: near(CHART_W / 5),
      });
      expect(deck.writeFile).toHaveBeenCalledWith({ fileName: `Capabilities_${STAMP}.pptx` });
    });

    it("puts a row taller than a page on a slide of its own instead of a near-empty page above it", async () => {
      // 150 (fits, and is above the quarter-page minimum) + 600 (oversized) + 100 + 100.
      const rows: RectLike[] = [
        { y: 0, width: WIDTH, height: 150 },
        { y: 150, width: WIDTH, height: 600 },
        { y: 750, width: WIDTH, height: 100 },
        { y: 850, width: WIDTH, height: 100 },
      ];
      const node = mountChart(rowsHtml(rows.length), { width: WIDTH, height: 950 }, rows);
      installCapturedPng(950);

      await exportPaginated(node);

      expect(drawnSlices(canvas.context.drawImage)).toEqual([
        [0, 0, 2000, 300],
        [0, 300, 2000, 1200],
        [0, 1500, 2000, 400],
      ]);
      const deck = pptx();
      expect(deck.slides).toHaveLength(3);
      // The oversized page is scaled down to the continuation area's height.
      expect(deck.slides[1].addImage).toHaveBeenCalledWith({
        data: SLICE_PNG,
        x: near(MARGIN + (CHART_W - CONT_H * (WIDTH / 600)) / 2),
        y: near(CONT_TOP),
        w: near(CONT_H * (WIDTH / 600)),
        h: near(CONT_H),
      });
    });

    it("merges a tiny trailing slice into the previous page rather than emitting a near-empty slide", async () => {
      // Eight 100-px rows, then a 50-px row: the last cut (at 800) would leave
      // a 50-px page, under the quarter-page minimum, so it is dropped.
      const rows: RectLike[] = Array.from({ length: 8 }, (_, i) => ({
        y: i * 100,
        width: WIDTH,
        height: 100,
      }));
      rows.push({ y: 800, width: WIDTH, height: 50 });
      const node = mountChart(rowsHtml(rows.length), { width: WIDTH, height: 850 }, rows);
      installCapturedPng(850);

      await exportPaginated(node);

      expect(drawnSlices(canvas.context.drawImage)).toEqual([
        [0, 0, 2000, 800],
        [0, 800, 2000, 900],
      ]);
      expect(pptx().slides).toHaveLength(2);
      expect(pptx().slides[1].addText).toHaveBeenCalledWith(
        `Capabilities — ${pageIndicator(2, 2)}`,
        expect.anything(),
      );
    });

    it("keeps a tall chart on one slide when the selector matches nothing, rather than cutting blind", async () => {
      const node = mountChart("<svg></svg>", { width: WIDTH, height: 1000 });

      await exportPaginated(node);

      expect(canvas.context.drawImage).not.toHaveBeenCalled();
      const deck = pptx();
      expect(deck.slides).toHaveLength(1);
      // A square source inside the wide chart area: height-bound fit, centred.
      expect(deck.slides[0].addImage).toHaveBeenCalledWith({
        data: CHART_PNG,
        x: near(MARGIN + (CHART_W - CHART_H) / 2),
        y: near(CHART_TOP),
        w: near(CHART_H),
        h: near(CHART_H),
      });
    });

    it("keeps a chart that already fits on one slide uncut, with no image decoding", async () => {
      const rows: RectLike[] = [
        { y: 0, width: WIDTH, height: 200 },
        { y: 200, width: WIDTH, height: 200 },
      ];
      const node = mountChart(rowsHtml(rows.length), { width: WIDTH, height: 400 }, rows);

      await exportPaginated(node);

      expect(canvas.context.drawImage).not.toHaveBeenCalled();
      expect(pptx().slides).toHaveLength(1);
      expect(pptx().slides[0].addImage).toHaveBeenCalledWith(
        expect.objectContaining({ data: CHART_PNG }),
      );
    });

    it("refuses a cut that a card in another column straddles", async () => {
      // Column A has two 300-px rows; column B has one 400-px card spanning
      // y=100..500. Every row edge but the chart's top and bottom crosses a
      // card, so the only legal cut is the end of the chart: one page.
      const rows: RectLike[] = [
        { y: 0, width: 500, height: 300 },
        { y: 300, width: 500, height: 300 },
        { x: 500, y: 100, width: 500, height: 400 },
      ];
      const node = mountChart(rowsHtml(rows.length), { width: WIDTH, height: 600 }, rows);
      installCapturedPng(600);

      await exportPaginated(node);

      // Had y=300 been accepted, four boundaries would have produced two pages.
      expect(drawnSlices(canvas.context.drawImage)).toEqual([[0, 0, 2000, 1200]]);
      expect(pptx().slides).toHaveLength(1);
      expect(pptx().slides[0].addImage).toHaveBeenCalledWith(
        expect.objectContaining({ data: SLICE_PNG }),
      );
    });

    it("rejects the export when the captured PNG cannot be decoded for slicing", async () => {
      restores.push(installImage({ fail: true }));
      const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({
        y: i * 100,
        width: WIDTH,
        height: 100,
      }));
      const node = mountChart(rowsHtml(rows.length), { width: WIDTH, height: 1000 }, rows);

      await expect(exportPaginated(node)).rejects.toThrow("image failed");

      expect(pptx().writeFile).not.toHaveBeenCalled();
    });

    it("falls back to one slide when there is no 2D canvas context to slice with", async () => {
      // `paginateChartImage` comes back with no pages when `getContext("2d")`
      // is null; that used to crash the export reading `pages[0]`.
      const getContext = vi
        .spyOn(HTMLCanvasElement.prototype, "getContext")
        .mockReturnValue(null);
      restores.push(() => getContext.mockRestore());
      installCapturedPng(1000);
      const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({
        y: i * 100,
        width: WIDTH,
        height: 100,
      }));
      const node = mountChart(rowsHtml(rows.length), { width: WIDTH, height: 1000 }, rows);

      await expect(exportPaginated(node)).resolves.toBeUndefined();
      expect(pptxInstances).toHaveLength(1);
      expect(pptxInstances[0].slides).toHaveLength(1);
      expect(pptxInstances[0].slides[0].addImage).toHaveBeenCalledTimes(1);
    });
  });
});

// ─── Section mode ───────────────────────────────────────────────────────────

describe("section mode — the pure helpers", () => {
  const table = (over: Partial<TableHeadBox> = {}): TableHeadBox => ({
    top: 100,
    bottom: 140,
    left: 0,
    right: 1000,
    bodyBottom: 600,
    boxTop: 99,
    ...over,
  });

  it("keeps a heading with the first row whose top is at or below its bottom", () => {
    const rows = [
      { top: 0, bottom: 100 },
      { top: 300, bottom: 380 },
      { top: 140, bottom: 260 },
    ];
    expect(keepWithNext(rows, [{ top: 100, bottom: 140 }])).toEqual([{ top: 100, bottom: 260 }]);
    // Half a pixel of overlap still counts as "after".
    expect(keepWithNext(rows, [{ top: 100, bottom: 140.4 }])).toEqual([{ top: 100, bottom: 260 }]);
    // A heading with nothing after it is kept whole on its own.
    expect(keepWithNext(rows, [{ top: 400, bottom: 430 }])).toEqual([{ top: 400, bottom: 430 }]);
    // A heading that is itself a row ends no earlier than itself.
    expect(keepWithNext([{ top: 0, bottom: 50 }], [{ top: 0, bottom: 50 }])).toEqual([
      { top: 0, bottom: 50 },
    ]);
  });

  it("repeats a header only for a page that starts inside the table's body", () => {
    const tb = table();
    expect(headerAt(140, [tb])).toBeNull(); // right under the header row
    expect(headerAt(140.5, [tb])).toBeNull();
    expect(headerAt(141, [tb])).toBe(tb);
    expect(headerAt(600, [tb])).toBeNull(); // at the body's end
    expect(headerAt(599.6, [tb])).toBeNull();
    expect(headerAt(599.4, [tb])).toBe(tb);
    expect(headerAt(50, [tb])).toBeNull(); // above the table
    expect(headerAt(700, [tb])).toBeNull(); // past it
    // Inside two tables, the inner (later-starting) one's header wins.
    const inner = table({ top: 200, bottom: 230, bodyBottom: 500 });
    expect(headerAt(300, [tb, inner])).toBe(inner);
    expect(headerAt(300, [inner, tb])).toBe(inner);
  });

  it("holds a table's header, from the top of its box, to its first row", () => {
    const rows = [
      { top: 0, bottom: 90 },
      { top: 140, bottom: 240 },
      { top: 240, bottom: 340 },
    ];
    // Without the table, 90 and 140 would both be cuts; with it neither 140
    // nor the header's own top (100) is, only the box top (99) above it.
    expect(sectionCuts(rows, [], [])).toEqual([0, 90, 140, 240, 340]);
    expect(sectionCuts(rows, [], [table()])).toEqual([0, 90, 99, 240, 340]);
    // A marked heading is held the same way; no rows means no cuts at all.
    expect(sectionCuts(rows, [{ top: 90, bottom: 140 }], [])).toEqual([0, 90, 240, 340]);
    expect(sectionCuts([], [{ top: 0, bottom: 10 }], [table()])).toEqual([]);
  });

  it("plans one page for a section that fits, and the whole of it", () => {
    expect(planSectionPages(400, [0, 200, 400], 400, [])).toEqual([
      { from: 0, to: 400, header: null },
    ]);
    // One pixel over still fits; no safe cut keeps a tall section whole.
    expect(planSectionPages(401, [0, 401], 400, [])).toEqual([{ from: 0, to: 401, header: null }]);
    expect(planSectionPages(1000, [], 400, [])).toEqual([{ from: 0, to: 1000, header: null }]);
  });

  it("cuts greedily, gives an oversized block its own page and merges a tiny tail", () => {
    // 150 + 600 (oversized) + 100 + 100, the single-picture path's case.
    expect(planSectionPages(950, [0, 150, 750, 850, 950], 421.6, [])).toEqual([
      { from: 0, to: 150, header: null },
      { from: 150, to: 750, header: null },
      { from: 750, to: 950, header: null },
    ]);
    // Eight 100-px rows and a 50-px one: the 50-px page joins the one before.
    const b = [0, 100, 200, 300, 400, 500, 600, 700, 800, 850];
    expect(planSectionPages(850, b, 421.6, [])).toEqual([
      { from: 0, to: 400, header: null },
      { from: 400, to: 850, header: null },
    ]);
  });

  it("takes the repeated header's height off the budget of a page that starts in a table", () => {
    // A 40-px header, then 110-px rows; a page holds 470 px.
    const tb = table({ top: 0, bottom: 40, bodyBottom: 1140, boxTop: 0 });
    const b = [0, 150, 260, 370, 480, 590, 700, 810, 920, 1030, 1140];
    const pages = planSectionPages(1140, b, 470, [tb]);
    // Page 2 starts at 370 under the header: 810 - 370 = 440 fits 470 but not
    // 470 - 40, so it ends at 700. The 110-px tail merges into page 3.
    expect(pages).toEqual([
      { from: 0, to: 370, header: null },
      { from: 370, to: 700, header: tb },
      { from: 700, to: 1140, header: tb },
    ]);
    // Without the table the same rows run on to 810.
    expect(planSectionPages(1140, b, 470, [])[1]).toEqual({ from: 370, to: 810, header: null });
  });

  it("caps the pixel ratio at the device's canvas area, never above 2", () => {
    expect(capturePixelRatio(1200, 800, false)).toBe(2);
    expect(capturePixelRatio(1200, 800, true)).toBe(2);
    // 1000 × 8000 at 2× is 32M px: over iOS's 16M, inside the desktop's 64M.
    expect(capturePixelRatio(1000, 8000, false)).toBe(2);
    expect(capturePixelRatio(1000, 8000, true)).toBeCloseTo(Math.sqrt(16_000_000 / 8_000_000), 6);
    expect(capturePixelRatio(1000, 40000, false)).toBeCloseTo(Math.sqrt(64_000_000 / 40_000_000), 6);
    // Exactly at the limit stays at 2.
    expect(capturePixelRatio(1000, 4000, true)).toBe(2);
    expect(capturePixelRatio(0, 0, true)).toBe(2);
  });
});

describe("exportReportToPptx — section mode", () => {
  // Section slides use the continuation geometry: a 1000-px wide section
  // holds 1000 × (CONT_H / CHART_W) ≈ 470.3 source px a slide.
  const WIDTH = 1000;
  const PAGE_MAX = WIDTH * (CONT_H / CHART_W);
  let canvas: ReturnType<typeof installCanvas>;

  beforeEach(() => {
    canvas = installCanvas(SLICE_PNG);
    restores.push(canvas);
    vi.mocked(toPng).mockResolvedValue(CHART_PNG);
  });

  const pptx = (): FakePptx => {
    expect(pptxInstances).toHaveLength(1);
    return pptxInstances[0];
  };

  /** Mount sections side by side in the document, each with its own pinned box. */
  function mountSections(htmls: string[], rects: Record<string, RectLike[]>, heights: number[]) {
    const root = mount(htmls.map((h, i) => `<div data-sec="${i}">${h}</div>`).join(""));
    restores.push(
      stubRectsBySelector({
        "[data-sec]": heights.map((height) => ({ width: WIDTH, height })),
        ...rects,
      }),
    );
    return Array.from(root.querySelectorAll<HTMLElement>("[data-sec]"));
  }

  const headingOf = (slide: FakeSlide) => slide.addText.mock.calls[0][0];
  const ROWS = "[data-export-row]";

  it("opens with a title slide carrying no picture, then a slide per section headed by its name", async () => {
    const [a, b] = mountSections(["<p>A</p>", "<p>B</p>"], {}, [200, 300]);

    await exportReportToPptx({
      title: "ERP Migration",
      sheets: [],
      filterSummary: [{ label: "Status", value: "On Track" }],
      chartNode: a,
      sections: [
        { title: "Overview", node: a, paginateRowSelector: ROWS },
        { title: "Risks", node: b },
      ],
    });

    const deck = pptx();
    expect(deck.slides).toHaveLength(3);
    const [title, first, second] = deck.slides;
    expect(title.addImage).not.toHaveBeenCalled();
    expect(title.addText).toHaveBeenCalledTimes(2);
    // The title block (0.7 + 0.45 in) is centred on the slide.
    const titleTop = (7.5 - 1.15) / 2;
    expect(title.background).toEqual({ color: "FFFFFF" });
    expect(title.addText).toHaveBeenNthCalledWith(
      1,
      "ERP Migration",
      expect.objectContaining({ fontSize: 28, bold: true, color: "0F7EB5", x: MARGIN, y: near(titleTop), h: 0.7 }),
    );
    expect(title.addText).toHaveBeenNthCalledWith(
      2,
      `${generatedLabel()}    Status: On Track`,
      expect.objectContaining({ fontSize: 12, color: "607D8B", y: near(titleTop + 0.7), h: 0.45 }),
    );
    // Each section, captured once at its own size, never the chart node twice.
    expect(vi.mocked(toPng).mock.calls.map((c) => c[0])).toEqual([a, b]);
    expect(vi.mocked(toPng).mock.calls[1][1]).toMatchObject({
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      width: WIDTH,
      height: 300,
    });
    for (const [slide, name, height] of [
      [first, "Overview", 200],
      [second, "Risks", 300],
    ] as const) {
      expect(slide.background).toEqual({ color: "FFFFFF" });
      expect(slide.addText).toHaveBeenCalledTimes(1);
      expect(slide.addText).toHaveBeenCalledWith(
        name,
        expect.objectContaining({ x: MARGIN, y: MARGIN, h: 0.5, fontSize: 18, bold: true, color: "0F7EB5" }),
      );
      // Width-bound in the continuation box, right under the heading.
      const h = CHART_W * (height / WIDTH);
      expect(slide.addImage).toHaveBeenCalledWith({
        data: CHART_PNG,
        x: near(MARGIN),
        y: near(CONT_TOP),
        w: near(CHART_W),
        h: near(h),
      });
    }
    // A section that fits is never decoded or sliced.
    expect(canvas.context.drawImage).not.toHaveBeenCalled();
    expect(deck.writeFile).toHaveBeenCalledWith({ fileName: `ERP_Migration_${STAMP}.pptx` });
  });

  it("numbers the slides of a section only when it spans several", async () => {
    // Section 0 fits; section 1 is ten 100-px rows: pages of 400, 400 and 200.
    const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({ y: i * 100, width: WIDTH, height: 100 }));
    const [a, b] = mountSections(
      ["<p>small</p>", "<div data-export-row></div>".repeat(10)],
      { [ROWS]: rows },
      [300, 1000],
    );
    restores.push(installImage({ width: 2 * WIDTH, height: 2000 }));

    await exportReportToPptx({
      title: "T",
      sheets: [],
      sections: [
        { title: "Small", node: a, paginateRowSelector: ROWS },
        { title: "Tall", node: b, paginateRowSelector: ROWS },
      ],
    });

    const deck = pptx();
    expect(deck.slides.slice(1).map(headingOf)).toEqual([
      "Small",
      `Tall — ${pageIndicator(1, 3)}`,
      `Tall — ${pageIndicator(2, 3)}`,
      `Tall — ${pageIndicator(3, 3)}`,
    ]);
    expect(drawnSlices(canvas.context.drawImage)).toEqual([
      [0, 0, 2000, 800],
      [0, 800, 2000, 800],
      [0, 1600, 2000, 400],
    ]);
  });

  it("never ends a slide on a sub-heading: the cut moves above it", async () => {
    // Four 100-px rows, a 40-px heading at 400, then two rows. Cutting at
    // 440 would fit (≤ 470.3) but leave the heading last on the slide.
    const rows: RectLike[] = [0, 100, 200, 300, 440, 540].map((y) => ({ y, width: WIDTH, height: 100 }));
    const html = `${"<div data-export-row></div>".repeat(4)}<h3 data-export-heading>Earlier</h3>${"<div data-export-row></div>".repeat(2)}`;
    const [node] = mountSections(
      [html],
      { [ROWS]: rows, "[data-export-heading]": [{ y: 400, width: WIDTH, height: 40 }] },
      [640],
    );
    restores.push(installImage({ width: 2 * WIDTH, height: 1280 }));
    expect(PAGE_MAX).toBeGreaterThan(440);
    expect(PAGE_MAX).toBeLessThan(540);

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node, paginateRowSelector: ROWS }] });

    expect(drawnSlices(canvas.context.drawImage)).toEqual([
      [0, 0, 2000, 800],
      [0, 800, 2000, 480],
    ]);
    expect(pptx().slides).toHaveLength(3);
  });

  it("repeats a continued table's header row above the continuation and counts it in the page", async () => {
    // A table in an outlined container at y=0: a 40-px header, ten 110-px rows.
    const body = Array.from({ length: 10 }, (_, i) => ({ y: 40 + i * 110, width: WIDTH, height: 110 }));
    const html = `<div class="wrap"><table><thead><tr><th>H</th></tr></thead><tbody>${"<tr data-export-row><td>r</td></tr>".repeat(10)}</tbody></table></div>`;
    const [node] = mountSections(
      [html],
      {
        [ROWS]: body,
        ".wrap": [{ x: 0, y: 0, width: WIDTH, height: 1140 }],
        "table": [{ x: 1, y: 1, width: WIDTH - 2, height: 1139 }],
        "thead": [{ x: 1, y: 1, width: WIDTH - 2, height: 39 }],
      },
      [1140],
    );
    restores.push(installImage({ width: 2 * WIDTH, height: 2280 }));

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "Costs", node, paginateRowSelector: ROWS }] });

    // Page 1: 0-370. Page 2 starts in the body: the header strip (y 1..40,
    // across the hugging container, x 0..1000) drawn at the top, then 370-700
    // below it (810 would fit 470 px, not 470 - 39). Page 3: strip + 700-1140.
    expect(drawnSlices(canvas.context.drawImage)).toEqual([
      [0, 0, 2000, 740],
      [0, 2, 2000, 78],
      [0, 740, 2000, 660],
      [0, 2, 2000, 78],
      [0, 1400, 2000, 880],
    ]);
    const draws = canvas.context.drawImage.mock.calls;
    expect(draws[1].slice(5)).toEqual([0, 0, 2000, 78]); // the strip at the very top
    expect(draws[2].slice(5)).toEqual([0, 78, 2000, 660]); // the slice under it
    expect(draws[0].slice(5)).toEqual([0, 0, 2000, 740]);
    const deck = pptx();
    expect(deck.slides.slice(1).map(headingOf)).toEqual([
      `Costs — ${pageIndicator(1, 3)}`,
      `Costs — ${pageIndicator(2, 3)}`,
      `Costs — ${pageIndicator(3, 3)}`,
    ]);
    // The continuation's picture is the slice plus the strip: 330 + 39 source px.
    const h2 = CHART_W * ((330 + 39) / WIDTH);
    expect(deck.slides[2].addImage).toHaveBeenCalledWith(
      expect.objectContaining({ h: near(h2), y: near(CONT_TOP) }),
    );
  });

  it("takes the strip's width from the table alone when its container is wider", async () => {
    const body = Array.from({ length: 10 }, (_, i) => ({ y: 40 + i * 110, width: 600, height: 110 }));
    const html = `<div class="wrap"><table><thead><tr><th>H</th></tr></thead><tbody>${"<tr data-export-row><td>r</td></tr>".repeat(10)}</tbody></table></div>`;
    const [node] = mountSections(
      [html],
      {
        [ROWS]: body,
        ".wrap": [{ x: 0, y: 0, width: WIDTH, height: 1140 }],
        "table": [{ x: 200, y: 0, width: 600, height: 1140 }],
        "thead": [{ x: 200, y: 0, width: 600, height: 40 }],
      },
      [1140],
    );
    restores.push(installImage({ width: 2 * WIDTH, height: 2280 }));

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node, paginateRowSelector: ROWS }] });

    const draws = canvas.context.drawImage.mock.calls;
    expect(draws[1].slice(1)).toEqual([400, 0, 1200, 80, 400, 0, 1200, 80]);
  });

  it("opens scroll containers for the capture and leaves overflow: hidden clipping alone", async () => {
    const [node] = mountSections(
      [`<div id="scroller" style="overflow-x: auto"></div><div id="clip" style="overflow-x: hidden; overflow-y: hidden"></div><div id="ys" style="overflow-y: scroll"></div>`],
      {},
      [200],
    );
    const el = (id: string) => node.querySelector(`#${id}`) as HTMLElement;
    let during: string[] = [];
    vi.mocked(toPng).mockImplementation(async () => {
      during = [
        ...["scroller", "ys"].flatMap((id) => [el(id).style.overflowX, el(id).style.overflowY]),
        el("clip").style.overflowX,
        el("clip").style.overflowY,
      ];
      return CHART_PNG;
    });

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node }] });

    // The scroll containers are opened on both axes; the clipping box is untouched.
    expect(during).toEqual(["visible", "visible", "visible", "visible", "hidden", "hidden"]);
    expect(el("scroller").style.overflowX).toBe("auto");
    expect(el("scroller").style.overflowY).toBe("");
    expect(el("clip").style.overflowX).toBe("hidden");
    expect(el("ys").style.overflowY).toBe("scroll");
    expect(el("ys").style.overflowX).toBe("");
  });

  it("lowers the pixel ratio for a long section on an iPhone", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    restores.push(() => ua.mockRestore());
    const [node] = mountSections(["<p>long</p>"], {}, [8000]);

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node }] });

    const ratio = vi.mocked(toPng).mock.calls[0][1]?.pixelRatio ?? 0;
    expect(ratio).toBeCloseTo(Math.sqrt(16_000_000 / (WIDTH * 8000)), 6);
    expect(ratio).toBeLessThan(2);
  });

  it("says a section's picture is unavailable and still exports the others", async () => {
    const [a, b, c] = mountSections(["<p>a</p>", "<p>b</p>", "<p>c</p>"], {}, [200, 200, 200]);
    vi.mocked(toPng)
      .mockResolvedValueOnce(CHART_PNG)
      .mockRejectedValueOnce(new Error("tainted"))
      .mockResolvedValueOnce(CHART_PNG);

    await exportReportToPptx({
      title: "T",
      sheets: [],
      sections: [
        { title: "A", node: a },
        { title: "B", node: b },
        { title: "C", node: c },
      ],
    });

    const deck = pptx();
    expect(deck.slides).toHaveLength(4);
    expect(deck.slides.slice(1).map(headingOf)).toEqual(["A", "B", "C"]);
    const failed = deck.slides[2];
    expect(failed.addImage).not.toHaveBeenCalled();
    expect(failed.addText).toHaveBeenNthCalledWith(
      2,
      i18n.t("reports:export.chartUnavailable", { defaultValue: "Chart preview unavailable." }),
      expect.objectContaining({
        x: MARGIN,
        y: near(CONT_TOP),
        w: near(CHART_W),
        h: near(CONT_H),
        italic: true,
        align: "center",
        valign: "middle",
      }),
    );
    expect(deck.slides[1].addImage).toHaveBeenCalledTimes(1);
    expect(deck.slides[3].addImage).toHaveBeenCalledTimes(1);
    expect(deck.writeFile).toHaveBeenCalledTimes(1);
  });

  it("treats a section whose picture cannot be decoded for cutting as unavailable", async () => {
    const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({ y: i * 100, width: WIDTH, height: 100 }));
    const [node] = mountSections(["<div data-export-row></div>".repeat(10)], { [ROWS]: rows }, [1000]);
    restores.push(installImage({ fail: true }));

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node, paginateRowSelector: ROWS }] });

    const deck = pptx();
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[1].addImage).not.toHaveBeenCalled();
    expect(deck.slides[1].addText).toHaveBeenCalledTimes(2);
    expect(deck.writeFile).toHaveBeenCalledTimes(1);
  });

  it("falls back to the whole picture when there is no canvas to cut with", async () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    restores.push(() => getContext.mockRestore());
    const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({ y: i * 100, width: WIDTH, height: 100 }));
    const [node] = mountSections(["<div data-export-row></div>".repeat(10)], { [ROWS]: rows }, [1000]);
    restores.push(installImage({ width: 2 * WIDTH, height: 2000 }));

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node, paginateRowSelector: ROWS }] });

    const deck = pptx();
    expect(deck.slides).toHaveLength(2);
    expect(headingOf(deck.slides[1])).toBe("S");
    expect(deck.slides[1].addImage).toHaveBeenCalledWith(expect.objectContaining({ data: CHART_PNG }));
  });

  it("sets the slides' text right to left in Arabic, and only in section mode", async () => {
    expect(textDirection("ar")).toEqual({ align: "right", rtlMode: true });
    expect(textDirection("en")).toEqual({});
    const [a, b] = mountSections(["<p>a</p>", "<p>b</p>"], {}, [200, 200]);
    vi.mocked(toPng).mockResolvedValueOnce(CHART_PNG).mockRejectedValueOnce(new Error("x"));
    const previous = i18n.language;
    await i18n.changeLanguage("ar");
    try {
      await exportReportToPptx({
        title: "T",
        sheets: [],
        sections: [
          { title: "A", node: a },
          { title: "B", node: b },
        ],
      });
      await exportReportToPptx({ title: "Old", sheets: [] });
    } finally {
      await i18n.changeLanguage(previous);
    }
    const [deck, old] = pptxInstances;
    const rtl = { align: "right", rtlMode: true };
    for (const call of deck.slides[0].addText.mock.calls) expect(call[1]).toMatchObject(rtl);
    expect(deck.slides[1].addText.mock.calls[0][1]).toMatchObject(rtl);
    expect(deck.slides[2].addText.mock.calls[0][1]).toMatchObject(rtl);
    expect(deck.slides[2].addText.mock.calls[1][1]).toMatchObject({ align: "center", rtlMode: true });
    for (const call of old.slides[0].addText.mock.calls) {
      expect(call[1]).not.toHaveProperty("rtlMode");
      expect(call[1]).not.toHaveProperty("align");
    }
  });

  it("leaves the text direction alone in a left-to-right language", async () => {
    const [a] = mountSections(["<p>a</p>"], {}, [200]);
    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "A", node: a }] });
    for (const slide of pptx().slides) {
      expect(slide.addText.mock.calls[0][1]).not.toHaveProperty("rtlMode");
      expect(slide.addText.mock.calls[0][1]).not.toHaveProperty("align");
    }
  });

  it("draws each picture, and the canvas it is cut on, on the given background", async () => {
    const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({ y: i * 100, width: WIDTH, height: 100 }));
    const [node] = mountSections(["<div data-export-row></div>".repeat(10)], { [ROWS]: rows }, [1000]);
    restores.push(installImage({ width: 2 * WIDTH, height: 2000 }));

    await exportReportToPptx({
      title: "T",
      sheets: [],
      background: "#1e1e1e",
      sections: [{ title: "S", node, paginateRowSelector: ROWS }],
    });

    expect(vi.mocked(toPng).mock.calls[0][1]).toMatchObject({ backgroundColor: "#1e1e1e" });
    expect((canvas.context as unknown as { fillStyle: string }).fillStyle).toBe("#1e1e1e");
    expect(canvas.context.fillRect).toHaveBeenCalledTimes(3);
  });

  it("chooses the slides' colours from the background", () => {
    const light = { background: "FFFFFF", heading: "0F7EB5", muted: "607D8B" };
    expect(slidePalette()).toEqual(light);
    expect(slidePalette("#fff")).toEqual(light);
    expect(slidePalette("#FFFFFF")).toEqual(light);
    expect(slidePalette("rgb(255, 255, 255)")).toEqual(light);
    expect(slidePalette("#fafbfc")).toEqual({ ...light, background: "FAFBFC" });
    // A dark surface: the light brand blue and a light grey read on it.
    expect(slidePalette("#1e1e1e")).toEqual({ background: "1E1E1E", heading: "90CAF9", muted: "CCCCCC" });
    expect(slidePalette("#121")).toEqual({ background: "112211", heading: "90CAF9", muted: "CCCCCC" });
    // Mid-grey sits on the light side of the 0.5 luminance line, or not.
    expect(slidePalette("#bcbcbc").heading).toBe("0F7EB5");
    expect(slidePalette("#b9b9b9").heading).toBe("90CAF9");
    expect(slidePalette("#1e1e1ef").background).toBe("FFFFFF");
  });

  it("puts every slide of a dark-surface deck on that surface, with light text", async () => {
    const [a, b] = mountSections(["<p>a</p>", "<p>b</p>"], {}, [200, 200]);
    vi.mocked(toPng).mockResolvedValueOnce(CHART_PNG).mockRejectedValueOnce(new Error("x"));

    await exportReportToPptx({
      title: "T",
      sheets: [],
      background: "#1e1e1e",
      sections: [
        { title: "A", node: a },
        { title: "B", node: b },
      ],
    });

    const deck = pptx();
    for (const slide of deck.slides) expect(slide.background).toEqual({ color: "1E1E1E" });
    const [title, ok, failed] = deck.slides;
    expect(title.addText.mock.calls[0][1]).toMatchObject({ color: "90CAF9" });
    expect(title.addText.mock.calls[1][1]).toMatchObject({ color: "CCCCCC" });
    expect(ok.addText.mock.calls[0][1]).toMatchObject({ color: "90CAF9" });
    expect(failed.addText.mock.calls[0][1]).toMatchObject({ color: "90CAF9" });
    expect(failed.addText.mock.calls[1][1]).toMatchObject({ color: "CCCCCC" });
  });

  it("puts a short picture right under the heading, centred across, not down", async () => {
    // A tall narrow section: height-bound; a wide short one: width-bound.
    const [narrow, wide] = mountSections(["<p>n</p>", "<p>w</p>"], {}, [2000, 100]);
    // The narrow one is 400 px wide (the later stub wins for its selector).
    restores.push(stubRectsBySelector({ "[data-sec]": [{ width: 400, height: 2000 }, { width: WIDTH, height: 100 }] }));

    await exportReportToPptx({
      title: "T",
      sheets: [],
      sections: [
        { title: "N", node: narrow },
        { title: "W", node: wide },
      ],
    });

    const deck = pptx();
    const drawW = CONT_H * (400 / 2000);
    expect(deck.slides[1].addImage).toHaveBeenCalledWith({
      data: CHART_PNG,
      x: near(MARGIN + (CHART_W - drawW) / 2),
      y: near(CONT_TOP),
      w: near(drawW),
      h: near(CONT_H),
    });
    expect(deck.slides[2].addImage).toHaveBeenCalledWith({
      data: CHART_PNG,
      x: near(MARGIN),
      y: near(CONT_TOP),
      w: near(CHART_W),
      h: near(CHART_W / 10),
    });
  });

  it("keeps the single-picture deck's title at the top margin and on white", async () => {
    await exportReportToPptx({ title: "Old", sheets: [], background: "#1e1e1e" });
    const [slide] = pptx().slides;
    expect(slide.background).toEqual({ color: "FFFFFF" });
    expect(slide.addText.mock.calls[0][1]).toMatchObject({ y: MARGIN, color: "0F7EB5" });
    expect(slide.addText.mock.calls[1][1]).toMatchObject({ y: MARGIN + 0.7, color: "607D8B" });
  });

  it("builds the single-picture deck when the section list is empty", async () => {
    const node = mountChart("<svg></svg>", { width: 400, height: 1000 });

    await exportReportToPptx({ title: "Treemap", sheets: [], chartNode: node, sections: [] });

    const deck = pptx();
    expect(deck.slides).toHaveLength(1);
    expect(vi.mocked(toPng).mock.calls[0][0]).toBe(node);
    const drawW = CHART_H * (400 / 1000);
    expect(deck.slides[0].addImage).toHaveBeenCalledWith({
      data: CHART_PNG,
      x: near(MARGIN + (CHART_W - drawW) / 2),
      y: near(CHART_TOP),
      w: near(drawW),
      h: near(CHART_H),
    });
  });
});

// ─── Chart canvases ─────────────────────────────────────────────────────────

describe("exportReportToPptx — chart canvases drawn onto the capture", () => {
  let canvas: ReturnType<typeof installCanvas>;

  beforeEach(() => {
    canvas = installCanvas(SLICE_PNG);
    restores.push(canvas);
    vi.mocked(toPng).mockResolvedValue(CHART_PNG);
  });

  /**
   * A chart node at (10, 20), 500 × 300, holding: two stacked zrender layers
   * at (110, 70) 200 × 100, a hidden print copy, a zero-size canvas, a
   * `display: none` one, an invisible one and one with no backing store.
   */
  function mountCharted(): { node: HTMLElement; layers: HTMLCanvasElement[] } {
    const root = mount(`<div data-chart>
      <div class="echart-container">
        <canvas id="l1"></canvas><canvas id="l2"></canvas>
        <canvas id="copy" class="echart-print-copy" style="display: none"></canvas>
      </div>
      <canvas id="empty"></canvas>
      <canvas id="off" style="display: none"></canvas>
      <canvas id="ghost" style="visibility: hidden"></canvas>
      <canvas id="blank" width="0" height="150"></canvas><canvas id="flat" width="300" height="0"></canvas>
    </div>`);
    restores.push(
      stubRectsBySelector({
        "[data-chart]": [{ x: 10, y: 20, width: 500, height: 300 }],
        "#l1, #l2, #copy, #off, #ghost, #blank, #flat": [{ x: 110, y: 70, width: 200, height: 100 }],
      }),
    );
    const node = root.querySelector("[data-chart]") as HTMLElement;
    return { node, layers: [node.querySelector("#l1"), node.querySelector("#l2")] as HTMLCanvasElement[] };
  }

  it("leaves canvases and icon glyphs out of the clone, and keeps everything else", () => {
    expect(captureFilter(document.createElement("canvas"))).toBe(false);
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined";
    expect(captureFilter(icon)).toBe(false);
    expect(captureFilter(document.createElement("div"))).toBe(true);
    expect(captureFilter(document.createElement("img"))).toBe(true);
    expect(captureFilter(document.createTextNode("x"))).toBe(true);
    // The capture hands html-to-image exactly this filter.
    const node = mountChart("<svg></svg>", { width: 400, height: 300 });
    return exportReportToPptx({ title: "T", sheets: [], chartNode: node }).then(() => {
      expect(vi.mocked(toPng).mock.calls[0][1]?.filter).toBe(captureFilter);
    });
  });

  it("draws each visible canvas once, in order, at its rectangle scaled to the picture", async () => {
    const { node, layers } = mountCharted();
    Object.defineProperty(node, "scrollTop", { value: 30, configurable: true });
    Object.defineProperty(node, "scrollLeft", { value: 4, configurable: true });
    // A 2× capture of the 500 × 300 node.
    restores.push(installImage({ width: 1000, height: 600 }));

    await exportReportToPptx({ title: "Cost", sheets: [], chartNode: node });

    const draws = canvas.context.drawImage.mock.calls;
    expect(draws).toHaveLength(3);
    // The captured picture first, at the origin…
    expect(draws[0].slice(1)).toEqual([0, 0]);
    expect(draws[0][0]).not.toBeInstanceOf(HTMLCanvasElement);
    // …then each layer at ((110 - 10 + 4) × 2, (70 - 20 + 30) × 2), 200 × 100 at 2×.
    expect(draws[1]).toEqual([layers[0], 208, 160, 400, 200]);
    expect(draws[2]).toEqual([layers[1], 208, 160, 400, 200]);
    // The composited picture is the one on the slide.
    expect(pptxInstances[0].slides[0].addImage).toHaveBeenCalledWith(
      expect.objectContaining({ data: SLICE_PNG }),
    );
  });

  it("scales by the picture's real size when the capture came back smaller", async () => {
    const { node, layers } = mountCharted();
    restores.push(installImage({ width: 750, height: 450 }));

    await exportReportToPptx({ title: "Cost", sheets: [], chartNode: node });

    expect(canvas.context.drawImage.mock.calls[1]).toEqual([layers[0], 150, 75, 300, 150]);
  });

  it("passes a picture with no canvas through untouched", async () => {
    const node = mountChart("<div>no chart</div>", { width: 400, height: 300 });
    restores.push(installImage({ width: 800, height: 600 }));
    const getContext = HTMLCanvasElement.prototype.getContext as unknown as Mock;

    await exportReportToPptx({ title: "T", sheets: [], chartNode: node });

    expect(getContext).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalled();
    expect(pptxInstances[0].slides[0].addImage).toHaveBeenCalledWith(
      expect.objectContaining({ data: CHART_PNG }),
    );
  });

  it("keeps the picture as captured when there is no 2D context to composite on", async () => {
    const { node } = mountCharted();
    restores.push(installImage({ width: 1000, height: 600 }));
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    restores.push(() => getContext.mockRestore());

    await exportReportToPptx({ title: "T", sheets: [], chartNode: node });

    expect(pptxInstances[0].slides[0].addImage).toHaveBeenCalledWith(
      expect.objectContaining({ data: CHART_PNG }),
    );
  });

  it("keeps the picture as captured when it cannot be decoded for compositing", async () => {
    const { node } = mountCharted();
    restores.push(installImage({ fail: true }));

    await exportReportToPptx({ title: "T", sheets: [], chartNode: node });

    expect(canvas.context.drawImage).not.toHaveBeenCalled();
    expect(pptxInstances[0].slides[0].addImage).toHaveBeenCalledWith(
      expect.objectContaining({ data: CHART_PNG }),
    );
  });

  it("composites in section mode too, before the section is cut", async () => {
    const { node, layers } = mountCharted();
    restores.push(installImage({ width: 1000, height: 600 }));

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "Costs", node }] });

    expect(vi.mocked(toPng).mock.calls[0][1]?.filter).toBe(captureFilter);
    const draws = canvas.context.drawImage.mock.calls;
    expect(draws.map((d) => d[0]).slice(1)).toEqual(layers);
    expect(draws[1].slice(1)).toEqual([200, 100, 400, 200]);
    expect(pptxInstances[0].slides[1].addImage).toHaveBeenCalledWith(
      expect.objectContaining({ data: SLICE_PNG }),
    );
  });
});

// ─── Hardening: the edges the cases above do not reach ──────────────────────

describe("section mode — the planner's edges", () => {
  const table = (over: Partial<TableHeadBox> = {}): TableHeadBox => ({
    top: 100,
    bottom: 140,
    left: 0,
    right: 1000,
    bodyBottom: 600,
    boxTop: 99,
    ...over,
  });

  it("keeps a heading with a row starting exactly half a pixel above its bottom, and with the first of two rows level with each other", () => {
    expect(keepWithNext([{ top: 9.5, bottom: 20 }], [{ top: 0, bottom: 10 }])).toEqual([{ top: 0, bottom: 20 }]);
    const level = [
      { top: 20, bottom: 30 },
      { top: 20, bottom: 50 },
    ];
    expect(keepWithNext(level, [{ top: 0, bottom: 10 }])).toEqual([{ top: 0, bottom: 30 }]);
  });

  it("treats exactly half a pixel above a table's body end as past it, and keeps the first of two tables level with each other", () => {
    expect(headerAt(599.5, [table()])).toBeNull();
    const first = table();
    const second = table();
    expect(headerAt(300, [first, second])).toBe(first);
  });

  it("keeps a section exactly one pixel over a page on one page", () => {
    expect(planSectionPages(101, [50, 100.5], 100, [])).toEqual([{ from: 0, to: 101, header: null }]);
  });

  it("fills a page up to exactly its budget before cutting", () => {
    expect(planSectionPages(160, [60, 100, 150], 100, [])).toEqual([
      { from: 0, to: 100, header: null },
      { from: 100, to: 160, header: null },
    ]);
  });

  it("accepts a page of exactly a quarter of the budget, and refuses a shorter one on a later page", () => {
    expect(planSectionPages(200, [25, 130, 200], 100, [])).toEqual([
      { from: 0, to: 25, header: null },
      { from: 25, to: 130, header: null },
      { from: 130, to: 200, header: null },
    ]);
    // Page 2 starts at 100: the 10 px up to 110 is too short a page, so the
    // oversized block from 100 to 300 gets the page instead.
    expect(planSectionPages(400, [90, 100, 110, 300, 400], 100, [])).toEqual([
      { from: 0, to: 100, header: null },
      { from: 100, to: 300, header: null },
      { from: 300, to: 400, header: null },
    ]);
  });

  it("keeps a last page of exactly a quarter of the budget", () => {
    expect(planSectionPages(125, [50, 100, 125], 100, [])).toEqual([
      { from: 0, to: 100, header: null },
      { from: 100, to: 125, header: null },
    ]);
  });

  it("merges a slice under a pixel high into the page after it", () => {
    // A page budget of 2 px: the 0.6-px slices at the top and after 1.5 are
    // no pages of their own.
    expect(planSectionPages(10, [0.6, 2.7, 4.5, 6.5, 8.5, 10], 2, [])).toEqual([
      { from: 0, to: 2.7, header: null },
      { from: 2.7, to: 4.5, header: null },
      { from: 4.5, to: 6.5, header: null },
      { from: 6.5, to: 8.5, header: null },
      { from: 8.5, to: 10, header: null },
    ]);
    expect(planSectionPages(8, [1.5, 2.1, 4, 6, 8], 2, [])).toEqual([
      { from: 0, to: 1.5, header: null },
      { from: 1.5, to: 4, header: null },
      { from: 4, to: 6, header: null },
      { from: 6, to: 8, header: null },
    ]);
    // A slice of exactly one pixel is a page.
    expect(planSectionPages(3, [1, 2, 3], 0, [])).toEqual([
      { from: 0, to: 1, header: null },
      { from: 1, to: 2, header: null },
      { from: 2, to: 3, header: null },
    ]);
  });

  it("gives each block its own page when the page holds nothing, or when a repeated header alone fills it", () => {
    // A zero-width section's budget is 0: every block is a page, and planning ends.
    expect(planSectionPages(3, [1, 2, 3], 0, [])).toHaveLength(3);
    // A 150-px header over a 100-px page: each row past the header is a page under it.
    const tall = table({ top: 100, bottom: 250, bodyBottom: 1000, boxTop: 100 });
    const pages = planSectionPages(1000, [100, 250, 300, 400, 500, 600, 700, 800, 900, 1000], 100, [tall]);
    expect(pages.map((p) => [p.from, p.to, p.header === tall])).toEqual([
      [0, 100, false],
      [100, 250, false],
      [250, 300, false],
      [300, 400, true],
      [400, 500, true],
      [500, 600, true],
      [600, 700, true],
      [700, 800, true],
      [800, 900, true],
      [900, 1000, true],
    ]);
  });

  it("never repeats a header above the first page, even for a table whose header sits above the section", () => {
    const above = table({ top: -20, bottom: -5, bodyBottom: 250, boxTop: -20 });
    expect(planSectionPages(300, [100, 200, 300], 100, [above])).toEqual([
      { from: 0, to: 100, header: null },
      { from: 100, to: 200, header: above },
      { from: 200, to: 300, header: above },
    ]);
  });

  it("keeps the full pixel ratio for a size with no area", () => {
    expect(capturePixelRatio(-10, 100, true)).toBe(2);
  });
});

describe("slide palette — reading the background", () => {
  const light = { background: "FFFFFF", heading: "0F7EB5", muted: "607D8B" };

  it("takes a hex colour only as the whole value, surrounding blanks aside", () => {
    expect(slidePalette("x#000000")).toEqual(light);
    expect(slidePalette("  #121212 ")).toEqual({ background: "121212", heading: "90CAF9", muted: "CCCCCC" });
  });

  it("weighs a channel near black on its linear segment", () => {
    // 0x0A is on the linear part of the sRGB curve: luminance ≈ 0.003, dark.
    expect(slidePalette("#0a0a0a").background).toBe("0A0A0A");
    expect(slidePalette("#0a0a0a").heading).toBe("90CAF9");
    // Just under the 0.5 line (0.49988) only because a zero channel counts as 0.
    expect(slidePalette("#00d2c2").heading).toBe("90CAF9");
  });
});

describe("exportReportToPptx — hardening", () => {
  const WIDTH = 1000;
  const ROWS = "[data-export-row]";
  let canvas: ReturnType<typeof installCanvas>;

  beforeEach(() => {
    canvas = installCanvas(SLICE_PNG);
    restores.push(canvas);
    vi.mocked(toPng).mockResolvedValue(CHART_PNG);
  });

  const deck = (): FakePptx => {
    expect(pptxInstances).toHaveLength(1);
    return pptxInstances[0];
  };
  const getContextSpy = () => HTMLCanvasElement.prototype.getContext as unknown as Mock;
  const toDataUrlSpy = () => HTMLCanvasElement.prototype.toDataURL as unknown as Mock;

  function mountSection(html: string, rects: Record<string, RectLike[]>, nodeRect: RectLike): HTMLElement {
    const root = mount(`<div data-sec>${html}</div>`);
    restores.push(stubRectsBySelector({ "[data-sec]": [nodeRect], ...rects }));
    return root.querySelector("[data-sec]") as HTMLElement;
  }

  /** Every rect moved by (dx, dy): the section does not sit at the viewport's origin. */
  const at = (dx: number, dy: number, r: RectLike): RectLike => ({ ...r, x: (r.x ?? 0) + dx, y: (r.y ?? 0) + dy });

  it("does not draw a canvas that has no width or no height on screen", async () => {
    const root = mount(`<div data-chart>
      <canvas id="shown"></canvas><canvas id="thin"></canvas><canvas id="short"></canvas>
    </div>`);
    restores.push(
      stubRectsBySelector({
        "[data-chart]": [{ width: 500, height: 300 }],
        "#shown": [{ width: 200, height: 100 }],
        "#thin": [{ width: 0, height: 100 }],
        "#short": [{ width: 200, height: 0 }],
      }),
    );
    restores.push(installImage({ width: 1000, height: 600 }));
    const node = root.querySelector("[data-chart]") as HTMLElement;

    await exportReportToPptx({ title: "T", sheets: [], chartNode: node });

    const drawn = canvas.context.drawImage.mock.calls.map((c) => c[0]);
    expect(drawn).toHaveLength(2);
    expect(drawn[1]).toBe(node.querySelector("#shown"));
    // Composited on a 2D canvas and handed back as a PNG.
    expect(getContextSpy().mock.calls).toEqual([["2d"]]);
    expect(toDataUrlSpy().mock.calls).toEqual([["image/png"]]);
  });

  it("lifts every kind of clipping for the single picture, and leaves an unclipped element's style alone", async () => {
    const node = mountChart(
      `<div id="auto" style="overflow-x: auto"></div><div id="scroll" style="overflow-y: scroll"></div><div id="hidden" style="overflow-x: hidden; overflow-y: hidden"></div><div id="plain"></div>`,
      { width: 800, height: 300 },
    );
    const el = (id: string) => node.querySelector(`#${id}`) as HTMLElement;
    let during: string[] = [];
    vi.mocked(toPng).mockImplementation(async () => {
      during = ["auto", "scroll", "hidden", "plain"].map((id) => `${el(id).style.overflowX}/${el(id).style.overflowY}`);
      return CHART_PNG;
    });

    await exportReportToPptx({ title: "T", sheets: [], chartNode: node });

    expect(during).toEqual(["visible/visible", "visible/visible", "visible/visible", "/"]);
  });

  it("leaves an unclipped element's style alone in section mode too", async () => {
    const node = mountSection(
      `<div id="auto" style="overflow-x: auto"></div><div id="scroll" style="overflow-y: scroll"></div><div id="plain"></div>`,
      {},
      { width: WIDTH, height: 200 },
    );
    const el = (id: string) => node.querySelector(`#${id}`) as HTMLElement;
    let during: string[] = [];
    vi.mocked(toPng).mockImplementation(async () => {
      during = ["auto", "scroll", "plain"].map((id) => `${el(id).style.overflowX}/${el(id).style.overflowY}`);
      return CHART_PNG;
    });

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node }] });

    expect(during).toEqual(["visible/visible", "visible/visible", "/"]);
  });

  /**
   * A section at (100, 200) on the page: three 120-px rows, then a table in a
   * container 4 px wider than it whose box starts 10 px above its header row
   * (a 40-px header, five 110-px rows), then three 150-px rows. Positions are
   * relative to the section: rows 0–360, box 360, header 370–410, body to 960,
   * rows to 1410.
   */
  function mountOffsetTable(theadHeight = 40): HTMLElement {
    const html = `${"<div data-export-row></div>".repeat(3)}<div class="wrap"><table><thead><tr><th>H</th></tr></thead><tbody>${"<tr data-export-row><td>r</td></tr>".repeat(5)}</tbody></table></div>${"<div data-export-row></div>".repeat(3)}`;
    const rows: RectLike[] = [
      ...[0, 120, 240].map((y) => ({ y, width: WIDTH, height: 120 })),
      ...Array.from({ length: 5 }, (_, i) => ({ x: 2, y: 410 + i * 110, width: 996, height: 110 })),
      ...[960, 1110, 1260].map((y) => ({ y, width: WIDTH, height: 150 })),
    ];
    return mountSection(
      html,
      {
        [ROWS]: rows.map((r) => at(100, 200, r)),
        ".wrap": [at(100, 200, { x: 0, y: 360, width: WIDTH, height: 600 })],
        "table": [at(100, 200, { x: 2, y: 370, width: 996, height: 590 })],
        "thead": [at(100, 200, { x: 2, y: 370, width: 996, height: theadHeight })],
      },
      at(100, 200, { width: WIDTH, height: 1410 }),
    );
  }

  it("measures a table's header from the section's own top-left, cutting above the table's box and repeating the header only inside its body", async () => {
    const node = mountOffsetTable();
    restores.push(installImage({ width: 2 * WIDTH, height: 2 * 1410 }));

    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node, paginateRowSelector: ROWS }] });

    // Page 1: the rows above, cut at the table box's top (360), not at its
    // header (370). Page 2: the box from 360 to 740. Page 3 starts in the body,
    // under the header strip (370–410 across the container, x 0–1000), and
    // runs to 1110. Page 4 starts past the body's end (960): no strip.
    const draws = canvas.context.drawImage.mock.calls.map((c) => c.slice(1));
    expect(draws).toEqual([
      [0, 0, 2000, 720, 0, 0, 2000, 720],
      [0, 720, 2000, 760, 0, 0, 2000, 760],
      [0, 740, 2000, 80, 0, 0, 2000, 80],
      [0, 1480, 2000, 740, 0, 80, 2000, 740],
      [0, 2220, 2000, 600, 0, 0, 2000, 600],
    ]);
    // Each page's canvas is as tall as its slice plus its strip.
    expect(canvas.context.fillRect.mock.calls).toEqual([
      [0, 0, 2000, 720],
      [0, 0, 2000, 760],
      [0, 0, 2000, 820],
      [0, 0, 2000, 600],
    ]);
    expect(getContextSpy().mock.calls).toEqual([["2d"], ["2d"], ["2d"], ["2d"]]);
    expect(toDataUrlSpy().mock.calls).toEqual(Array(4).fill(["image/png"]));
    expect(deck().slides).toHaveLength(5);
  });

  it("takes a header row at least a pixel high, and ignores a thinner one or a table without one", async () => {
    const one = mountOffsetTable(1);
    restores.push(installImage({ width: 2 * WIDTH, height: 2 * 1410 }));
    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node: one, paginateRowSelector: ROWS }] });
    // A 1-px header is still repeated: a strip is drawn above a later page.
    expect(canvas.context.drawImage.mock.calls.some((c) => c[6] === 0 && c[4] === 2)).toBe(true);
    document.body.innerHTML = "";
    pptxInstances.length = 0;
    canvas.context.drawImage.mockClear();

    const thin = mountOffsetTable(0.5);
    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node: thin, paginateRowSelector: ROWS }] });
    // No strip: every slice is drawn at the top of its own canvas.
    expect(canvas.context.drawImage.mock.calls.every((c) => c[6] === 0)).toBe(true);
    expect(pptxInstances[0].slides.slice(1).every((s) => s.addImage.mock.calls.length === 1)).toBe(true);
    document.body.innerHTML = "";
    pptxInstances.length = 0;

    const bare = mountSection(
      `<table><tbody>${"<tr data-export-row><td>r</td></tr>".repeat(10)}</tbody></table>`,
      { [ROWS]: Array.from({ length: 10 }, (_, i) => ({ y: i * 100, width: WIDTH, height: 100 })) },
      { width: WIDTH, height: 1000 },
    );
    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node: bare, paginateRowSelector: ROWS }] });
    // A table with no header row is cut like any rows, not lost as unavailable.
    const slides = pptxInstances[0].slides.slice(1);
    expect(slides).toHaveLength(3);
    for (const slide of slides) expect(slide.addImage).toHaveBeenCalledTimes(1);
  });

  it("sets a section's heading in Calibri", async () => {
    const node = mountSection("<p>a</p>", {}, { width: WIDTH, height: 200 });
    await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node }] });
    expect(deck().slides[1].addText.mock.calls[0][1]).toMatchObject({ fontFace: "Calibri" });
  });

  it("says a section is unavailable in the user's language", async () => {
    const node = mountSection("<p>a</p>", {}, { width: WIDTH, height: 200 });
    vi.mocked(toPng).mockRejectedValueOnce(new Error("tainted"));
    const previous = i18n.language;
    await i18n.changeLanguage("de");
    try {
      await exportReportToPptx({ title: "T", sheets: [], sections: [{ title: "S", node }] });
    } finally {
      await i18n.changeLanguage(previous);
    }
    expect(deck().slides[1].addText.mock.calls[1][0]).toBe("Diagrammvorschau nicht verfügbar.");
  });

  it("falls back to its own wording where the language has none", async () => {
    const rows: RectLike[] = Array.from({ length: 10 }, (_, i) => ({ y: i * 100, width: WIDTH, height: 100 }));
    const root = mount(`<div data-sec>${"<div data-export-row></div>".repeat(10)}</div><div data-sec><p>b</p></div>`);
    restores.push(stubRectsBySelector({ "[data-sec]": [{ width: WIDTH, height: 1000 }, { width: WIDTH, height: 200 }], [ROWS]: rows }));
    const [tall, broken] = Array.from(root.querySelectorAll<HTMLElement>("[data-sec]"));
    restores.push(installImage({ width: 2 * WIDTH, height: 2000 }));
    vi.mocked(toPng).mockResolvedValueOnce(CHART_PNG).mockRejectedValueOnce(new Error("tainted"));
    const bundle = i18n.getResourceBundle("en", "reports");
    i18n.removeResourceBundle("en", "reports");
    try {
      await exportReportToPptx({
        title: "T",
        sheets: [],
        sections: [
          { title: "Tall", node: tall, paginateRowSelector: ROWS },
          { title: "Broken", node: broken },
        ],
      });
    } finally {
      i18n.addResourceBundle("en", "reports", bundle, true, true);
    }
    const slides = deck().slides.slice(1);
    expect(slides.map((s) => s.addText.mock.calls[0][0])).toEqual(["Tall — 1 / 3", "Tall — 2 / 3", "Tall — 3 / 3", "Broken"]);
    expect(slides[3].addText.mock.calls[1][0]).toBe("Chart preview unavailable.");
  });
});

describe("reportExport — the module's own constants, loaded fresh", () => {
  // Loaded inside each test, so the module-level values (the heading
  // attribute, the slide geometry, the default palette, the helpers built
  // once at load) are the ones these tests measure.
  async function fresh() {
    vi.resetModules();
    const mod = await import("./reportExport");
    const { toPng: freshToPng } = await import("html-to-image");
    const freshPptx = await import("pptxgenjs");
    void freshPptx;
    return { mod, toPng: vi.mocked(freshToPng) };
  }

  it("names the sub-heading attribute data-export-heading", async () => {
    const { mod } = await fresh();
    expect(mod.EXPORT_HEADING_ATTR).toBe("data-export-heading");
  });

  it("chooses the default palette and the dark one's hex digits", async () => {
    const { mod } = await fresh();
    expect(mod.slidePalette()).toEqual({ background: "FFFFFF", heading: "0F7EB5", muted: "607D8B" });
    expect(mod.slidePalette("#1e1e1e")).toEqual({ background: "1E1E1E", heading: "90CAF9", muted: "CCCCCC" });
  });

  it("takes the repeated header's height off a page's budget", async () => {
    const { mod } = await fresh();
    const tb: TableHeadBox = { top: 0, bottom: 40, left: 0, right: 1000, bodyBottom: 1140, boxTop: 0 };
    const b = [0, 150, 260, 370, 480, 590, 700, 810, 920, 1030, 1140];
    expect(mod.planSectionPages(1140, b, 470, [tb])).toEqual([
      { from: 0, to: 370, header: null },
      { from: 370, to: 700, header: tb },
      { from: 700, to: 1140, header: tb },
    ]);
  });

  it("lays a section slide out under its heading, in the continuation geometry", async () => {
    const { mod, toPng: freshToPng } = await fresh();
    restores.push(installCanvas(SLICE_PNG));
    const root = mount(`<div data-sec><p>a</p></div><div data-sec><p>b</p></div>`);
    restores.push(stubRectsBySelector({ "[data-sec]": [{ width: 1000, height: 200 }] }));
    const [ok, broken] = Array.from(root.querySelectorAll<HTMLElement>("[data-sec]"));
    freshToPng.mockResolvedValueOnce(CHART_PNG).mockRejectedValueOnce(new Error("tainted"));

    await mod.exportReportToPptx({
      title: "T",
      sheets: [],
      sections: [
        { title: "A", node: ok },
        { title: "B", node: broken },
      ],
    });

    const deckOf = pptxInstances[pptxInstances.length - 1];
    const [, a, b] = deckOf.slides;
    expect(a.addText.mock.calls[0][1]).toMatchObject({ x: MARGIN, y: MARGIN, w: near(CHART_W), h: 0.5 });
    expect(a.addImage).toHaveBeenCalledWith({
      data: CHART_PNG,
      x: near(MARGIN),
      y: near(CONT_TOP),
      w: near(CHART_W),
      h: near(CHART_W / 5),
    });
    expect(b.addText.mock.calls[1][1]).toMatchObject({ x: MARGIN, y: near(CONT_TOP), w: near(CHART_W), h: near(CONT_H) });
  });
});
