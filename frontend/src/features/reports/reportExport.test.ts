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
  exportReportToPptx,
  exportReportToXlsx,
  extractSheetsFromDOM,
  localeNumberSeparators,
  parseDisplayedNumber,
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

  it("parses the display formats a number column carries and keeps what is not a number as text", () => {
    const cells = ["1,234.50", "12 %", "-", "", "€ 99", "2024-01-05", "1-2"];
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
    const cells = ["n/a", "abc", "1,234.50", "(500)", "—"];
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
