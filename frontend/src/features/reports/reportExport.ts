import * as XLSX from "xlsx";
import { toPng } from "html-to-image";
import PptxGenJS from "pptxgenjs";
import i18n, { isRtlLocale } from "@/i18n";
import { toIsoDate } from "@/lib/dates";
import { PRINT_COLORS, brand } from "@/theme/tokens";
import { canvasMaxArea, isAppleMobileDevice } from "./ldvExportSizing";

export type ExportColumnType = "text" | "number" | "currency" | "date";

export interface ExportColumn {
  key: string;
  label: string;
  type?: ExportColumnType;
}

export interface ExportSheet {
  name: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
}

export interface ReportExportData {
  title: string;
  subtitle?: string;
  filterSummary?: { label: string; value: string }[];
  sheets: ExportSheet[];
  chartNode?: HTMLElement | null;
  /**
   * CSS selector identifying a single "card" or "row" inside `chartNode`.
   * When set, charts that exceed one slide are paginated across multiple
   * slides, splitting only at the bottom of an element matched by this
   * selector — never mid-card. When **omitted**, the chart is always
   * rendered on a single slide and scaled to fit, preserving its
   * integrity (the right behaviour for visualizations like treemaps,
   * heatmaps and network graphs that can't be cut horizontally).
   */
  paginateRowSelector?: string;
  /**
   * Section mode (opt-in). When set and non-empty, the deck is a title slide
   * with no picture, then each section on its own slide(s), headed by the
   * section's title; `chartNode` and `paginateRowSelector` are not used.
   * When absent or empty, the deck is built exactly as without it.
   */
  sections?: ReportExportSection[];
  /**
   * Section mode only: the colour behind each section's picture, the page's
   * own surface (a dark-theme page's text is light, and would vanish on
   * white). The print paper when omitted.
   */
  background?: string;
}

/** One section of a section-mode deck: what to capture and how to cut it. */
export interface ReportExportSection {
  title: string;
  node: HTMLElement;
  /** As `ReportExportData.paginateRowSelector`, for this section's node. */
  paginateRowSelector?: string;
}

/**
 * In section mode, an element carrying this attribute is a sub-heading: it is
 * kept on a slide with the first row after it, so it never ends a slide
 * (every table's header row is treated the same way).
 */
export const EXPORT_HEADING_ATTR = "data-export-heading";

/**
 * Extract tabular data from any `<table>` elements inside a node so reports
 * don't need bespoke serialization logic. The first preceding heading
 * (h1–h6) is used as the sheet name when available.
 */
export function extractSheetsFromDOM(node: HTMLElement | null): ExportSheet[] {
  if (!node) return [];
  const sheets: ExportSheet[] = [];
  const tables = Array.from(node.querySelectorAll<HTMLTableElement>("table"));

  tables.forEach((tbl, idx) => {
    const headerCells = Array.from(tbl.querySelectorAll<HTMLTableCellElement>("thead th"));
    if (headerCells.length === 0) return;

    const columns: ExportColumn[] = headerCells.map((th, i) => {
      const label = (th.textContent || "").replace(/\s+/g, " ").trim() || `Column ${i + 1}`;
      const align = th.getAttribute("align") || getComputedStyle(th).textAlign;
      return {
        key: `c${i}`,
        label,
        type: align === "right" ? "number" : "text",
      };
    });

    const bodyRows = Array.from(tbl.querySelectorAll<HTMLTableRowElement>("tbody tr"));
    const rows: Record<string, unknown>[] = [];
    for (const tr of bodyRows) {
      const cells = Array.from(tr.querySelectorAll<HTMLTableCellElement>("td"));
      if (cells.length === 0) continue;
      const row: Record<string, unknown> = {};
      cells.forEach((td, i) => {
        const text = (td.textContent || "").replace(/\s+/g, " ").trim();
        if (columns[i]?.type === "number") {
          row[`c${i}`] = parseDisplayedNumber(text) ?? text;
        } else {
          row[`c${i}`] = text;
        }
      });
      rows.push(row);
    }
    if (rows.length === 0) return;

    let name = `Sheet ${idx + 1}`;
    let cur: Element | null = tbl;
    while (cur) {
      const heading = cur.previousElementSibling?.querySelector("h1,h2,h3,h4,h5,h6,[data-export-section]")
        ?? (cur.previousElementSibling?.matches("h1,h2,h3,h4,h5,h6,[data-export-section]") ? cur.previousElementSibling : null);
      if (heading?.textContent) {
        name = heading.textContent.replace(/\s+/g, " ").trim().slice(0, 31);
        break;
      }
      cur = cur.parentElement;
      if (cur === node) break;
    }

    sheets.push({ name, columns, rows });
  });

  return sheets;
}

export interface NumberSeparators {
  group: string;
  decimal: string;
}

/** The separators the runtime locale writes numbers with — what the DOM shows. */
export function localeNumberSeparators(locale?: string): NumberSeparators {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  };
}

const RUNTIME_SEPARATORS = localeNumberSeparators();

/**
 * Read a number back off a rendered cell: `1,234.50` here, `1.234,50` under a
 * German locale, `12 %`, `€ 99`, and an accounting `(500)`. `null` when the
 * text carries no digits (`n/a`, `—`) or is not one number (`2024-01-05`), so
 * the caller keeps the text instead of exporting a zero.
 */
export function parseDisplayedNumber(
  text: string,
  separators: NumberSeparators = RUNTIME_SEPARATORS,
): number | null {
  let s = text.trim();
  const accounting = /^\(.*\)$/.test(s);
  if (accounting) s = s.slice(1, -1);
  // A locale grouping on a (narrow no-break) space reaches the DOM as a plain
  // space after whitespace collapsing, so any space is a group separator then.
  if (/\s/.test(separators.group)) s = s.replace(/\s+/g, "");
  else if (separators.group) s = s.split(separators.group).join("");
  if (separators.decimal !== ".") s = s.split(separators.decimal).join(".");
  const cleaned = s.replace(/[^0-9.-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return accounting ? -Math.abs(n) : n;
}

const sanitizeFilename = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 60) || "report";

const sanitizeSheetName = (s: string): string =>
  s.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Sheet";

const formatCellValue = (value: unknown, type?: ExportColumnType): unknown => {
  if (value === null || value === undefined || value === "") return "";
  if (type === "number" || type === "currency") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === "date") {
    if (value instanceof Date) return toIsoDate(value);
    return String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return value;
};

/**
 * Fallback sheet used when no data tables are detected (e.g. the report is
 * in chart view). Carries the title and active filter summary so the
 * workbook is never empty and the recipient still sees the context.
 */
function buildInfoSheet(data: ReportExportData): ExportSheet {
  const generatedAt = new Date().toLocaleString(i18n.language);
  const rows: Record<string, unknown>[] = [
    {
      label: i18n.t("reports:export.titleSlide", {
        defaultValue: "Generated {{date}}",
        date: generatedAt,
      }),
      value: data.title,
    },
  ];
  for (const f of data.filterSummary ?? []) {
    if (f.value) rows.push({ label: f.label, value: f.value });
  }
  return {
    name: i18n.t("reports:export.summarySheet", { defaultValue: "Summary" }),
    columns: [
      { key: "label", label: i18n.t("common:labels.name", { defaultValue: "Name" }), type: "text" },
      { key: "value", label: i18n.t("common:labels.value", { defaultValue: "Value" }), type: "text" },
    ],
    rows,
  };
}

export async function exportReportToXlsx(data: ReportExportData): Promise<void> {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  const sheets = data.sheets.length > 0 ? data.sheets : [buildInfoSheet(data)];

  for (const sheet of sheets) {
    const headerRow = sheet.columns.map((c) => c.label);
    const aoa: unknown[][] = [headerRow];

    for (const row of sheet.rows) {
      aoa.push(sheet.columns.map((c) => formatCellValue(row[c.key], c.type)));
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Apply currency / number formats per column
    sheet.columns.forEach((col, colIdx) => {
      if (col.type === "currency" || col.type === "number") {
        for (let r = 1; r < aoa.length; r++) {
          const cellRef = XLSX.utils.encode_cell({ r, c: colIdx });
          const cell = ws[cellRef];
          if (cell && typeof cell.v === "number") {
            cell.t = "n";
            cell.z = col.type === "currency" ? "#,##0.00" : "0.##";
          }
        }
      }
    });

    // Auto-size columns
    ws["!cols"] = sheet.columns.map((col, colIdx) => {
      let maxLen = col.label.length;
      for (let r = 1; r < aoa.length; r++) {
        const v = aoa[r][colIdx];
        const s = v === null || v === undefined ? "" : String(v);
        if (s.length > maxLen) maxLen = s.length;
      }
      return { wch: Math.min(maxLen + 2, 60) };
    });

    const base = sanitizeSheetName(sheet.name);
    let name = base;
    let suffix = 1;
    while (usedNames.has(name)) {
      // Make room for the suffix inside Excel's 31 characters: a 31-character
      // base re-sliced to the same 31 characters never became unique.
      const tag = ` ${++suffix}`;
      name = sanitizeSheetName(`${base.slice(0, 31 - tag.length)}${tag}`);
    }
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const filename = `${sanitizeFilename(data.title)}_${exportTimestamp()}.xlsx`;
  XLSX.writeFile(wb, filename);
}

const PPT_BRAND_COLOR = "0F7EB5";
const PPT_MUTED_COLOR = "607D8B";

interface CapturedImage {
  dataUrl: string;
  /** Source CSS-pixel width of the captured node. */
  width: number;
  /** Source CSS-pixel height of the captured node. */
  height: number;
  /**
   * Y offsets (in source CSS pixels, relative to the captured node's top)
   * where the chart can be safely cut without slicing through a row /
   * card / item. Each entry is the *bottom* of one such element.
   */
  boundaries: number[];
}

/**
 * Returns Y offsets (relative to `node`) at which the chart can be cut
 * without slicing through any element matched by `selector`. Critically
 * column-aware: in multi-column layouts (e.g. the capability map, the
 * dependency tree) a horizontal line is only safe if **no card** in any
 * column spans across that Y. Y values where any card straddles the
 * line are excluded.
 */
function collectBoundaries(node: HTMLElement, selector: string): number[] {
  return safeCuts(rangesOf(node, selector));
}

/** A vertical extent, in source CSS pixels from the captured node's top. */
export interface YRange {
  top: number;
  bottom: number;
}

/** The extents of `node`'s descendants matching `selector`, collapsed ones left out. */
function rangesOf(node: HTMLElement, selector: string): YRange[] {
  const baseTop = node.getBoundingClientRect().top;
  const ranges: YRange[] = [];
  for (const el of node.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.height < 1) continue;
    ranges.push({ top: r.top - baseTop, bottom: r.bottom - baseTop });
  }
  return ranges;
}

/**
 * Every edge of `ranges` that no range straddles, ascending, with edges
 * within a pixel of each other merged.
 */
export function safeCuts(ranges: YRange[]): number[] {
  if (ranges.length === 0) return [];

  // Candidate cut Ys: every card's top and bottom edge.
  const candidates = new Set<number>();
  for (const r of ranges) {
    candidates.add(r.top);
    candidates.add(r.bottom);
  }

  const safe: number[] = [];
  for (const y of candidates) {
    let crosses = false;
    for (const r of ranges) {
      if (r.top + 0.5 < y && y < r.bottom - 0.5) {
        crosses = true;
        break;
      }
    }
    if (!crosses) safe.push(y);
  }
  safe.sort((a, b) => a - b);
  return safe.filter((y, i) => i === 0 || y - safe[i - 1] > 1);
}

/**
 * Lift clipping on `node`'s descendants for the capture, so content that
 * scrolls is captured whole; returns the function that puts it back.
 * `includeHidden` also lifts `overflow: hidden` (the single-picture path);
 * without it only scroll containers (`auto` / `scroll`) are opened, and a
 * rounded bar, a chip or a truncated label keeps its clipping.
 */
function releaseOverflow(node: HTMLElement, includeHidden: boolean): () => void {
  const clipping = includeHidden ? ["auto", "scroll", "hidden"] : ["auto", "scroll"];
  const overflowRestores: (() => void)[] = [];
  for (const el of node.querySelectorAll<HTMLElement>("*")) {
    const cs = window.getComputedStyle(el);
    if (!clipping.includes(cs.overflowX) && !clipping.includes(cs.overflowY)) continue;
    const saved = {
      overflow: el.style.overflow,
      overflowX: el.style.overflowX,
      overflowY: el.style.overflowY,
    };
    el.style.overflowX = "visible";
    el.style.overflowY = "visible";
    overflowRestores.push(() => {
      el.style.overflow = saved.overflow;
      el.style.overflowX = saved.overflowX;
      el.style.overflowY = saved.overflowY;
    });
  }
  // Force the layout to settle with the new overflow values.
  void node.offsetWidth;
  return () => {
    for (const restore of overflowRestores) restore();
  };
}

/** The node's full size, scrolled-out content included. */
function captureSize(node: HTMLElement): { width: number; height: number } {
  const rect = node.getBoundingClientRect();
  return {
    width: Math.max(rect.width, node.scrollWidth),
    height: Math.max(rect.height, node.scrollHeight),
  };
}

/**
 * Render `node` to a PNG on `background`, its chart canvases drawn in
 * afterwards (`compositeCanvases`).
 */
async function renderPng(
  node: HTMLElement,
  width: number,
  height: number,
  pixelRatio: number,
  background: string = PRINT_COLORS.paper,
): Promise<string> {
  const dataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio,
    backgroundColor: background,
    width,
    height,
    // Neutralise any positioning on the capture root. html-to-image copies
    // the node's computed cssText onto the clone it renders inside a
    // foreignObject, so a root parked off-screen (position:absolute with a
    // large negative left — the usual way to mount an export-only chart
    // without display:none) lays out entirely outside the canvas and the
    // PNG comes back blank. options.style is applied last, so this pins the
    // clone at the canvas origin; core's own chart nodes are static and
    // unaffected.
    style: { position: "static", left: "0", top: "0", margin: "0" },
    filter: captureFilter,
  });
  return compositeCanvases(node, dataUrl, width, height);
}

/**
 * What html-to-image clones. Left out:
 * - Material Symbols icon spans: they rely on a font ligature html-to-image
 *   can't reliably embed, so they leak through as raw glyph names
 *   ("payments", "trending_up", etc.).
 * - Canvases (the charts): html-to-image clones one as an `<img>` inside the
 *   SVG it rasterises, and WebKit does not paint a nested image there on the
 *   first draw, so every chart came out blank in Safari. They are drawn onto
 *   the picture afterwards instead, the same way in every browser.
 */
export function captureFilter(n: Node): boolean {
  if (n instanceof HTMLCanvasElement) return false;
  if (!(n instanceof HTMLElement)) return true;
  return !n.classList.contains("material-symbols-outlined");
}

/** The canvases under `node` that show on screen, in document order. */
function visibleCanvases(node: HTMLElement): HTMLCanvasElement[] {
  return Array.from(node.querySelectorAll("canvas")).filter((c) => {
    const r = c.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || c.width === 0 || c.height === 0) return false;
    const cs = window.getComputedStyle(c);
    return cs.display !== "none" && cs.visibility !== "hidden";
  });
}

/**
 * Draw `node`'s visible canvases onto its captured picture, each at its
 * rectangle relative to the node (scroll offsets included), scaled to the
 * picture's pixels, in document order (zrender stacks several in one chart).
 * A node with no canvas keeps its picture untouched; a picture that cannot be
 * composited (no 2D context, an undecodable or tainted image) is kept as
 * captured rather than failing the export.
 */
async function compositeCanvases(
  node: HTMLElement,
  dataUrl: string,
  width: number,
  height: number,
): Promise<string> {
  const canvases = visibleCanvases(node);
  if (canvases.length === 0) return dataUrl;
  try {
    const img = await loadImage(dataUrl);
    const out = document.createElement("canvas");
    out.width = img.width;
    out.height = img.height;
    const ctx = out.getContext("2d");
    // Stryker disable next-line ConditionalExpression: equivalent: a null context throws on the drawImage below, and the catch returns the same uncomposited dataUrl
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0);
    const sx = img.width / width;
    const sy = img.height / height;
    const base = node.getBoundingClientRect();
    for (const c of canvases) {
      const r = c.getBoundingClientRect();
      ctx.drawImage(
        c,
        (r.left - base.left + node.scrollLeft) * sx,
        (r.top - base.top + node.scrollTop) * sy,
        r.width * sx,
        r.height * sy,
      );
    }
    return out.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

async function captureChartImage(
  node: HTMLElement,
  rowSelector?: string,
): Promise<CapturedImage | null> {
  // Temporarily disable overflow clipping on every descendant so charts
  // that scroll horizontally (e.g. Lifecycle gantt timeline, wide
  // capability heatmaps) capture their full content rather than only
  // the visible viewport — otherwise the export looks "zoomed in".
  const restoreOverflow = releaseOverflow(node, true);

  try {
    const { width: captureWidth, height: captureHeight } = captureSize(node);
    const dataUrl = await renderPng(node, captureWidth, captureHeight, 2);
    return {
      dataUrl,
      width: captureWidth,
      height: captureHeight,
      boundaries: rowSelector ? collectBoundaries(node, rowSelector) : [],
    };
  } catch {
    return null;
  } finally {
    restoreOverflow();
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Slice a captured image into one or more pages such that each page,
 * when scaled to fit the slide chart area's width, stays within the
 * available height — and crucially never cuts mid-row by always
 * splitting at one of the precomputed row boundaries.
 */
async function paginateChartImage(
  captured: CapturedImage,
  chartW: number,
  chartH: number,
): Promise<{ dataUrl: string; sourceWidth: number; sourceHeight: number }[]> {
  const pageMaxSourceH = captured.width * (chartH / chartW);
  if (captured.height <= pageMaxSourceH + 1) {
    return [
      {
        dataUrl: captured.dataUrl,
        sourceWidth: captured.width,
        sourceHeight: captured.height,
      },
    ];
  }

  // Build the list of cut points (Y offsets in source CSS pixels) walking
  // through the row boundaries greedily: take as many rows as fit into a
  // page, cut at the last boundary that fits.
  //
  // A row taller than `pageMaxSourceH` would otherwise force a cut at
  // its top edge, producing a near-empty page made up of whatever sat
  // above it. Reject any candidate cut that would produce a page
  // smaller than `minPageSourceH` and fall through to `cutAt = b`,
  // putting the oversized row on its own slide instead.
  const cuts: number[] = [];
  const minPageSourceH = pageMaxSourceH * 0.25;
  if (captured.boundaries.length > 0) {
    let pageStart = 0;
    let lastFitting = pageStart;
    let i = 0;
    while (i < captured.boundaries.length) {
      const b = captured.boundaries[i];
      if (b - pageStart > pageMaxSourceH) {
        const candidate = lastFitting;
        const usable =
          candidate > pageStart && candidate - pageStart >= minPageSourceH;
        const cutAt = usable ? candidate : b;
        cuts.push(cutAt);
        pageStart = cutAt;
        lastFitting = cutAt;
        // Re-evaluate the current boundary against the new page when the
        // cut landed before it; otherwise advance.
        if (cutAt >= b) i++;
      } else {
        lastFitting = b;
        i++;
      }
    }
  }
  // No safe boundaries → keep the chart on a single slide rather than
  // make blind cuts that risk slicing through visual content.
  if (cuts.length === 0) {
    return [
      {
        dataUrl: captured.dataUrl,
        sourceWidth: captured.width,
        sourceHeight: captured.height,
      },
    ];
  }

  const img = await loadImage(captured.dataUrl);
  const scale = img.height / captured.height; // = pixelRatio used during capture

  // Boundaries come from explicit `data-export-row` markers on the
  // report, so they're already trustworthy cut points. We deliberately
  // do NOT snap them to pixel whitespace: cards inside a CSS grid
  // often live in a taller stretched cell with empty space below the
  // visible content, and snapping would move the cut up into that
  // empty space — leaving the next page starting mid-cell.
  // De-duplicate any cuts that ended up within a pixel of each other
  // (e.g. nearby tops/bottoms after the column-aware filter).
  cuts.sort((a, b) => a - b);
  for (let i = cuts.length - 1; i > 0; i--) {
    if (cuts[i] - cuts[i - 1] < 1) cuts.splice(i, 1);
  }
  // If the final slice (last cut → end of chart) would be tiny, drop
  // the last cut so the trailing rows merge into the previous page —
  // safer than emitting a near-empty trailing slide.
  while (
    cuts.length > 0 &&
    captured.height - cuts[cuts.length - 1] < minPageSourceH
  ) {
    cuts.pop();
  }

  const allCuts = [...cuts, captured.height];
  const pages: { dataUrl: string; sourceWidth: number; sourceHeight: number }[] = [];
  let from = 0;
  for (const to of allCuts) {
    const sliceSrcH = to - from;
    if (sliceSrcH <= 0) continue;
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = Math.round(sliceSrcH * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = PRINT_COLORS.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      img,
      0,
      Math.round(from * scale),
      img.width,
      Math.round(sliceSrcH * scale),
      0,
      0,
      img.width,
      Math.round(sliceSrcH * scale),
    );
    pages.push({
      dataUrl: canvas.toDataURL("image/png"),
      sourceWidth: captured.width,
      sourceHeight: sliceSrcH,
    });
    from = to;
  }
  return pages;
}

function fitImageInBox(
  sourceW: number,
  sourceH: number,
  boxW: number,
  boxH: number,
  boxX: number,
  boxY: number,
): { x: number; y: number; w: number; h: number } {
  const sourceRatio = sourceW / sourceH;
  const targetRatio = boxW / boxH;
  let drawW = boxW;
  let drawH = boxH;
  if (sourceRatio > targetRatio) {
    drawH = boxW / sourceRatio;
  } else {
    drawW = boxH * sourceRatio;
  }
  return {
    x: boxX + (boxW - drawW) / 2,
    y: boxY + (boxH - drawH) / 2,
    w: drawW,
    h: drawH,
  };
}

// ─── Section mode ───────────────────────────────────────────────────────────

/** Where a table's header row sits, so a slide that starts inside the table can repeat it. */
export interface TableHeadBox {
  /** The header row's extent, in source CSS pixels from the captured node's top… */
  top: number;
  bottom: number;
  /** …and from its left. */
  left: number;
  right: number;
  /** Where the table's body ends: a page starting below this is past the table. */
  bodyBottom: number;
  /** The top of the table's box (its hugging container, border included). */
  boxTop: number;
}

interface SectionCapture extends CapturedImage {
  tables: TableHeadBox[];
  background: string;
}

/** One page of a section: a slice of the capture, under a repeated table header or not. */
export interface SectionPagePlan {
  from: number;
  to: number;
  header: TableHeadBox | null;
}

/**
 * Keep each sub-heading with the first row that follows it: one range from the
 * heading's top to that row's bottom, so no cut can fall between them. A
 * heading with no row after it is kept whole on its own.
 */
export function keepWithNext(rows: YRange[], headings: YRange[]): YRange[] {
  return headings.map((h) => {
    let next: YRange | null = null;
    for (const r of rows) {
      if (r.top < h.bottom - 0.5) continue;
      if (!next || r.top < next.top) next = r;
    }
    return { top: h.top, bottom: next ? Math.max(next.bottom, h.bottom) : h.bottom };
  });
}

/**
 * The table header to repeat above a page that starts at `y`: the innermost
 * table whose body `y` falls inside, past its header row. Null when `y` is not
 * inside a table body.
 */
export function headerAt(y: number, tables: TableHeadBox[]): TableHeadBox | null {
  let found: TableHeadBox | null = null;
  for (const tb of tables) {
    if (y <= tb.bottom + 0.5 || y >= tb.bodyBottom - 0.5) continue;
    if (!found || tb.top > found.top) found = tb;
  }
  return found;
}

const headerHeight = (h: TableHeadBox | null): number => (h ? h.bottom - h.top : 0);

/**
 * Plan a section's pages: greedy at the safe `boundaries`, as the single-
 * picture path cuts, with each page's budget less the height of the table
 * header repeated above it. A block taller than a page gets a page of its own;
 * a tiny last page merges into the one before it.
 */
export function planSectionPages(
  height: number,
  boundaries: number[],
  pageMax: number,
  tables: TableHeadBox[],
): SectionPagePlan[] {
  if (height <= pageMax + 1) return [{ from: 0, to: height, header: null }];
  const budget = (start: number) => pageMax - headerHeight(headerAt(start, tables));
  const minPage = pageMax * 0.25;
  // Stryker disable next-line ArrayDeclaration: equivalent: a non-number seeded here is never popped (height minus it is NaN) and the c > 0 filter below drops it, so the pages are the same
  const cuts: number[] = [];
  let pageStart = 0;
  let lastFitting = 0;
  let i = 0;
  // Stryker disable next-line EqualityOperator: equivalent: one step past the end reads undefined, NaN fails the budget test, and the else branch only sets lastFitting, which is not read after the loop
  while (i < boundaries.length) {
    const b = boundaries[i];
    if (b - pageStart > budget(pageStart)) {
      const usable = lastFitting > pageStart && lastFitting - pageStart >= minPage;
      const cutAt = usable ? lastFitting : b;
      cuts.push(cutAt);
      pageStart = cutAt;
      lastFitting = cutAt;
      if (cutAt >= b) i++;
    } else {
      lastFitting = b;
      i++;
    }
  }
  while (
    // Stryker disable next-line ConditionalExpression,EqualityOperator: equivalent: on an empty list cuts[-1] is undefined, height - undefined is NaN and NaN < minPage is false, so the loop stops all the same
    cuts.length > 0 &&
    height - cuts[cuts.length - 1] < minPage
  )
    cuts.pop();
  // Stryker disable next-line MethodExpression,ConditionalExpression,LogicalOperator,EqualityOperator: equivalent: for ascending boundaries the pop loop above already leaves every cut in (0, height), and a cut at 0 or a repeat is skipped by `to - from < 1` below (fuzzed over 200k plans)
  const ends = [...cuts.filter((c) => c > 0 && c < height), height];
  const pages: SectionPagePlan[] = [];
  let from = 0;
  for (const to of ends) {
    if (to - from < 1) continue;
    pages.push({ from, to, header: from > 0 ? headerAt(from, tables) : null });
    from = to;
  }
  return pages;
}

/**
 * The largest pixel ratio, at most 2, at which a `width` × `height` capture
 * stays inside the device's canvas area; a long section on iOS would
 * otherwise fail to render.
 */
export function capturePixelRatio(width: number, height: number, isAppleMobile: boolean): number {
  const area = width * height;
  // Stryker disable next-line EqualityOperator: equivalent: at area 0 the fall-through computes min(2, sqrt(max / 0)) = min(2, Infinity) = 2, the same value
  if (area <= 0) return 2;
  return Math.min(2, Math.sqrt(canvasMaxArea(isAppleMobile) / area));
}

/** Every table header row inside `node`, measured from its top-left. */
function measureTableHeads(node: HTMLElement): TableHeadBox[] {
  const base = node.getBoundingClientRect();
  const heads: TableHeadBox[] = [];
  for (const table of node.querySelectorAll("table")) {
    const head = table.tHead?.getBoundingClientRect();
    if (!head || head.height < 1) continue;
    const t = table.getBoundingClientRect();
    // The strip spans the table's own container (MUI's outlined
    // TableContainer) when it hugs the table, so the side borders continue.
    // Stryker disable next-line OptionalChaining: equivalent: a table found by querySelectorAll under node always has a parent element (node at least)
    const wrap = table.parentElement?.getBoundingClientRect();
    const x = wrap && Math.abs(wrap.width - t.width) <= 4 ? wrap : t;
    heads.push({
      top: head.top - base.top,
      bottom: head.bottom - base.top,
      left: x.left - base.left,
      right: x.right - base.left,
      bodyBottom: t.bottom - base.top,
      boxTop: Math.min(x.top, head.top) - base.top,
    });
  }
  return heads;
}

/**
 * The safe cuts of a section: its rows, each sub-heading held to the row after
 * it. A table's header row counts as a heading too, from the top of the
 * table's box (so the box's top border goes with it), and a slide never ends
 * on a table's header with its first row on the next.
 */
export function sectionCuts(rows: YRange[], headings: YRange[], tables: TableHeadBox[]): number[] {
  if (rows.length === 0) return [];
  const heads = tables.map((tb) => ({ top: tb.boxTop, bottom: tb.bottom }));
  return safeCuts([...rows, ...keepWithNext(rows, [...headings, ...heads])]);
}

async function captureSection(
  node: HTMLElement,
  rowSelector: string | undefined,
  background: string,
): Promise<SectionCapture | null> {
  const restoreOverflow = releaseOverflow(node, false);
  try {
    const { width, height } = captureSize(node);
    const ratio = capturePixelRatio(width, height, isAppleMobileDevice(navigator));
    // Stryker disable next-line ArrayDeclaration: equivalent: without a row selector there are no boundaries, so no page but the first is planned and no table is ever consulted
    const tables = rowSelector ? measureTableHeads(node) : [];
    const boundaries = rowSelector
      ? sectionCuts(rangesOf(node, rowSelector), rangesOf(node, `[${EXPORT_HEADING_ATTR}]`), tables)
      // Stryker disable next-line ArrayDeclaration: equivalent: without a row selector a non-numeric boundary never exceeds the budget (NaN comparison), so no cut is planned either way
      : [];
    const dataUrl = await renderPng(node, width, height, ratio, background);
    return { dataUrl, width, height, boundaries, tables, background };
  // Stryker disable next-line BlockStatement: equivalent: an emptied catch returns undefined instead of null, and the only caller tests the result for falsiness (`if (!captured)`)
  } catch {
    return null;
  } finally {
    restoreOverflow();
  }
}

interface SlicedPage {
  dataUrl: string;
  sourceWidth: number;
  sourceHeight: number;
}

/**
 * Draw each planned page from the capture: the repeated header strip (when
 * the page starts inside a table) above the slice. A single page with no
 * header is the capture itself, with no decoding.
 */
async function renderSectionPages(
  captured: SectionCapture,
  plan: SectionPagePlan[],
): Promise<SlicedPage[]> {
  const whole = { dataUrl: captured.dataUrl, sourceWidth: captured.width, sourceHeight: captured.height };
  if (plan.length === 1 && !plan[0].header) return [whole];
  const img = await loadImage(captured.dataUrl);
  const scale = img.height / captured.height;
  const px = (n: number) => Math.round(n * scale);
  const pages: SlicedPage[] = [];
  for (const { from, to, header } of plan) {
    const stripH = headerHeight(header);
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = px(to - from + stripH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return [whole];
    ctx.fillStyle = captured.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (header) {
      const w = px(header.right - header.left);
      ctx.drawImage(img, px(header.left), px(header.top), w, px(stripH), px(header.left), 0, w, px(stripH));
    }
    ctx.drawImage(img, 0, px(from), img.width, px(to - from), 0, px(stripH), img.width, px(to - from));
    pages.push({
      dataUrl: canvas.toDataURL("image/png"),
      sourceWidth: captured.width,
      sourceHeight: to - from + stripH,
    });
  }
  return pages;
}

export async function exportReportToPptx(data: ReportExportData): Promise<void> {
  const t = (key: string, fallback: string, opts?: Record<string, unknown>): string =>
    i18n.t(`reports:${key}`, { defaultValue: fallback, ...opts });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 inches
  pptx.title = data.title;

  const slideWidth = 13.333;
  const slideHeight = 7.5;
  const margin = 0.5;

  const sectionMode = !!data.sections && data.sections.length > 0;
  // A section-mode deck in a right-to-left language sets its text right to
  // left; the single-picture deck is left exactly as it was.
  const dir = sectionMode ? textDirection(i18n.language) : {};

  // A section-mode deck sits on the page's own surface, its colours chosen
  // to read on it; the single-picture deck keeps white and the brand blue.
  const palette = sectionMode ? slidePalette(data.background) : DEFAULT_SLIDE_PALETTE;
  // A section-mode title slide carries no picture: its title block is
  // centred on the slide instead of sitting above an empty chart area.
  const titleTop = sectionMode ? (slideHeight - TITLE_BLOCK_H) / 2 : margin;

  // Slide 1: combined title + chart
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: palette.background };

  titleSlide.addText(data.title, {
    x: margin,
    y: titleTop,
    w: slideWidth - 2 * margin,
    h: 0.7,
    fontSize: 28,
    bold: true,
    color: palette.heading,
    fontFace: "Calibri",
    ...dir,
  });

  const generatedAt = new Date().toLocaleString(i18n.language);
  const subtitleParts: string[] = [
    t("export.titleSlide", "Generated {{date}}", { date: generatedAt }),
  ];
  if (data.filterSummary && data.filterSummary.length > 0) {
    const filtersText = data.filterSummary
      .map((f) => `${f.label}: ${f.value}`)
      .join("  •  ");
    subtitleParts.push(filtersText);
  } else if (data.subtitle) {
    subtitleParts.push(data.subtitle);
  }

  titleSlide.addText(subtitleParts.join("    "), {
    x: margin,
    y: titleTop + 0.7,
    w: slideWidth - 2 * margin,
    h: 0.45,
    fontSize: 12,
    color: palette.muted,
    fontFace: "Calibri",
    ...dir,
  });

  // Chart area: lower ~70% of the slide
  const chartTop = margin + 1.3;
  const chartHeight = slideHeight - chartTop - margin;
  const chartWidth = slideWidth - 2 * margin;

  if (data.sections && sectionMode) {
    await addSectionSlides(pptx, data.sections, t, dir, data.background ?? PRINT_COLORS.paper, palette);
  } else if (data.chartNode) {
    const captured = await captureChartImage(data.chartNode, data.paginateRowSelector);
    if (captured) {
      // Pagination is opt-in via `paginateRowSelector`. Without it we
      // always render the chart on a single slide and scale it to fit —
      // visualizations like treemaps, heatmaps and network graphs lose
      // meaning when split horizontally, so don't risk it.
      const paginated = data.paginateRowSelector
        ? await paginateChartImage(captured, chartWidth, chartHeight)
        : [];
      // No pages back (no canvas to slice with) means one slide, not no export.
      const pages =
        paginated.length > 0
          ? paginated
          : [
              {
                dataUrl: captured.dataUrl,
                sourceWidth: captured.width,
                sourceHeight: captured.height,
              },
            ];
      const firstPage = pages[0];
      const firstFit = fitImageInBox(
        firstPage.sourceWidth,
        firstPage.sourceHeight,
        chartWidth,
        chartHeight,
        margin,
        chartTop,
      );
      titleSlide.addImage({ data: firstPage.dataUrl, ...firstFit });

      // Continuation slides for any remaining pages. They reuse a
      // smaller header (just the title + "Page n/N") so we have more
      // vertical room for the image itself.
      const totalPages = pages.length;
      if (totalPages > 1) {
        const contChartTop = margin + 0.7;
        const contChartHeight = slideHeight - contChartTop - margin;
        for (let p = 1; p < totalPages; p++) {
          const slide = pptx.addSlide();
          slide.background = { color: "FFFFFF" };
          slide.addText(
            `${data.title} — ${t("export.pageIndicator", "{{current}} / {{total}}", {
              current: p + 1,
              total: totalPages,
            })}`,
            {
              x: margin,
              y: margin,
              w: slideWidth - 2 * margin,
              h: 0.5,
              fontSize: 18,
              bold: true,
              color: PPT_BRAND_COLOR,
              fontFace: "Calibri",
            },
          );
          const page = pages[p];
          const fit = fitImageInBox(
            page.sourceWidth,
            page.sourceHeight,
            chartWidth,
            contChartHeight,
            margin,
            contChartTop,
          );
          slide.addImage({ data: page.dataUrl, ...fit });
        }
      }
    } else {
      titleSlide.addText(t("export.chartUnavailable", "Chart preview unavailable."), {
        x: margin,
        y: chartTop,
        w: chartWidth,
        h: chartHeight,
        fontSize: 14,
        color: PPT_MUTED_COLOR,
        align: "center",
        valign: "middle",
        italic: true,
      });
    }
  }

  // PPTX is the visual export — the chart capture (and its pagination
  // when requested) already conveys everything on screen, including
  // any tables rendered as part of the chart view (e.g. the Matrix
  // report's heatmap table). Adding extra slides per `<table>` would
  // just duplicate that content; reach for XLSX when raw data is the
  // goal.

  const filename = `${sanitizeFilename(data.title)}_${exportTimestamp()}.pptx`;
  await pptx.writeFile({ fileName: filename });
}

type Translate = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

/** A slide's background and the colours of its heading and of its muted text, as hex without `#`. */
export interface SlidePalette {
  background: string;
  heading: string;
  muted: string;
}

/** The title + generated line's height on the title slide (0.7 + 0.45 in). */
const TITLE_BLOCK_H = 1.15;

const DEFAULT_SLIDE_PALETTE: SlidePalette = {
  background: "FFFFFF",
  heading: PPT_BRAND_COLOR,
  muted: PPT_MUTED_COLOR,
};

const pptHex = (css: string) => css.slice(1).toUpperCase();

/** `#rgb` / `#rrggbb` as six hex digits, or null for anything else. */
function sixDigitHex(css: string): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return h.toUpperCase();
}

/** WCAG relative luminance of six hex digits. */
function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    // Stryker disable next-line EqualityOperator: equivalent: a channel is n / 255, and no n gives exactly 0.03928 (10 / 255 is 0.0392...), so <= and < never differ
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The slides' colours on `background` (a CSS hex colour): that background,
 * and on a dark one the light brand blue and a light grey, which read on it
 * where the brand blue and the slate grey do not. Without a usable
 * background, white with the usual colours.
 */
export function slidePalette(background?: string): SlidePalette {
  const hex = background ? sixDigitHex(background) : null;
  if (!hex) return DEFAULT_SLIDE_PALETTE;
  // Stryker disable next-line EqualityOperator: equivalent: no #rgb / #rrggbb colour has a luminance of exactly 0.5 (all 16,777,216 checked), so >= and > never differ
  if (luminance(hex) >= 0.5) return { ...DEFAULT_SLIDE_PALETTE, background: hex };
  return { background: hex, heading: pptHex(brand.primaryLight), muted: pptHex(PRINT_COLORS.control) };
}

/** Text set right to left, aligned to the right. */
type TextDirection = { align?: "right"; rtlMode?: boolean };

/** How a slide's text runs in `locale`: right to left for Arabic, else the default. */
export function textDirection(locale: string): TextDirection {
  return isRtlLocale(locale) ? { align: "right", rtlMode: true } : {};
}

// Section slides use the continuation slides' geometry: a heading line, then
// the picture below it.
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const SLIDE_MARGIN = 0.5;
const SECTION_TOP = SLIDE_MARGIN + 0.7;
const SECTION_W = SLIDE_W - 2 * SLIDE_MARGIN;
const SECTION_H = SLIDE_H - SECTION_TOP - SLIDE_MARGIN;

/** A slide headed `heading`, in the continuation slides' style. */
function addHeadedSlide(
  pptx: PptxGenJS,
  heading: string,
  dir: TextDirection,
  palette: SlidePalette,
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: palette.background };
  slide.addText(heading, {
    x: SLIDE_MARGIN,
    y: SLIDE_MARGIN,
    w: SECTION_W,
    h: 0.5,
    fontSize: 18,
    bold: true,
    color: palette.heading,
    fontFace: "Calibri",
    ...dir,
  });
  return slide;
}

/** Capture and cut one section; null when its capture or its slicing failed. */
async function sectionPages(
  section: ReportExportSection,
  background: string,
): Promise<SlicedPage[] | null> {
  const captured = await captureSection(section.node, section.paginateRowSelector, background);
  if (!captured) return null;
  const pageMax = captured.width * (SECTION_H / SECTION_W);
  const plan = planSectionPages(captured.height, captured.boundaries, pageMax, captured.tables);
  try {
    return await renderSectionPages(captured, plan);
  // Stryker disable next-line BlockStatement: equivalent: an emptied catch returns undefined instead of null, and the only caller tests the result for falsiness (`if (!pages)`)
  } catch {
    return null;
  }
}

/**
 * Each section on its own slide(s), headed by its title, with ` — n / N` only
 * when it spans several. A section that cannot be captured says so on its
 * slide; the others still export.
 */
async function addSectionSlides(
  pptx: PptxGenJS,
  sections: ReportExportSection[],
  t: Translate,
  dir: TextDirection,
  background: string,
  palette: SlidePalette,
): Promise<void> {
  for (const section of sections) {
    const pages = await sectionPages(section, background);
    if (!pages) {
      const slide = addHeadedSlide(pptx, section.title, dir, palette);
      slide.addText(t("export.chartUnavailable", "Chart preview unavailable."), {
        x: SLIDE_MARGIN,
        y: SECTION_TOP,
        w: SECTION_W,
        h: SECTION_H,
        fontSize: 14,
        color: palette.muted,
        align: "center",
        valign: "middle",
        italic: true,
        rtlMode: dir.rtlMode,
      });
      continue;
    }
    pages.forEach((page, p) => {
      const heading =
        pages.length > 1
          ? `${section.title} — ${t("export.pageIndicator", "{{current}} / {{total}}", {
              current: p + 1,
              total: pages.length,
            })}`
          : section.title;
      const slide = addHeadedSlide(pptx, heading, dir, palette);
      const fit = fitImageInBox(
        page.sourceWidth,
        page.sourceHeight,
        SECTION_W,
        SECTION_H,
        SLIDE_MARGIN,
        SECTION_TOP,
      );
      // Right under the heading: a short page centred in the box left a gap
      // under the title.
      slide.addImage({ data: page.dataUrl, ...fit, y: SECTION_TOP });
    });
  }
}

function exportTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}
