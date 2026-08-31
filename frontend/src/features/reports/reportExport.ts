import * as XLSX from "xlsx";
import { toPng } from "html-to-image";
import PptxGenJS from "pptxgenjs";
import i18n from "@/i18n";
import { toIsoDate } from "@/lib/dates";

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
}

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
          const num = Number(text.replace(/[^0-9.-]/g, ""));
          row[`c${i}`] = Number.isFinite(num) && text !== "" ? num : text;
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

    let name = sanitizeSheetName(sheet.name);
    let suffix = 1;
    while (usedNames.has(name)) {
      name = sanitizeSheetName(`${sheet.name} ${++suffix}`);
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
  const baseTop = node.getBoundingClientRect().top;
  const ranges: { top: number; bottom: number }[] = [];
  for (const el of node.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.height < 1) continue;
    ranges.push({ top: r.top - baseTop, bottom: r.bottom - baseTop });
  }
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

async function captureChartImage(
  node: HTMLElement,
  rowSelector?: string,
): Promise<CapturedImage | null> {
  // Temporarily disable overflow clipping on every descendant so charts
  // that scroll horizontally (e.g. Lifecycle gantt timeline, wide
  // capability heatmaps) capture their full content rather than only
  // the visible viewport — otherwise the export looks "zoomed in".
  const overflowRestores: (() => void)[] = [];
  for (const el of node.querySelectorAll<HTMLElement>("*")) {
    const cs = window.getComputedStyle(el);
    const needsOverride =
      cs.overflowX === "auto" ||
      cs.overflowX === "scroll" ||
      cs.overflowX === "hidden" ||
      cs.overflowY === "auto" ||
      cs.overflowY === "scroll" ||
      cs.overflowY === "hidden";
    if (!needsOverride) continue;
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

  try {
    const rect = node.getBoundingClientRect();
    const captureWidth = Math.max(rect.width, node.scrollWidth);
    const captureHeight = Math.max(rect.height, node.scrollHeight);
    const dataUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: "#ffffff",
      width: captureWidth,
      height: captureHeight,
      // Neutralise any positioning on the capture root. html-to-image copies
      // the node's computed cssText onto the clone it renders inside a
      // foreignObject, so a root parked off-screen (position:absolute with a
      // large negative left — the usual way to mount an export-only chart
      // without display:none) lays out entirely outside the canvas and the
      // PNG comes back blank. options.style is applied last, so this pins the
      // clone at the canvas origin; core's own chart nodes are static and
      // unaffected.
      style: { position: "static", left: "0", top: "0", margin: "0" },
      // Skip Material Symbols icon spans — they rely on a font ligature
      // that html-to-image can't reliably embed, so they otherwise leak
      // through as raw glyph names ("payments", "trending_up", etc.).
      filter: (n) => {
        if (!(n instanceof HTMLElement)) return true;
        return !n.classList.contains("material-symbols-outlined");
      },
    });
    return {
      dataUrl,
      width: captureWidth,
      height: captureHeight,
      boundaries: rowSelector ? collectBoundaries(node, rowSelector) : [],
    };
  } catch {
    return null;
  } finally {
    for (const restore of overflowRestores) restore();
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
    ctx.fillStyle = "#ffffff";
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

export async function exportReportToPptx(data: ReportExportData): Promise<void> {
  const t = (key: string, fallback: string, opts?: Record<string, unknown>): string =>
    i18n.t(`reports:${key}`, { defaultValue: fallback, ...opts });

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 inches
  pptx.title = data.title;

  const slideWidth = 13.333;
  const slideHeight = 7.5;
  const margin = 0.5;

  // Slide 1: combined title + chart
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: "FFFFFF" };

  titleSlide.addText(data.title, {
    x: margin,
    y: margin,
    w: slideWidth - 2 * margin,
    h: 0.7,
    fontSize: 28,
    bold: true,
    color: PPT_BRAND_COLOR,
    fontFace: "Calibri",
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
    y: margin + 0.7,
    w: slideWidth - 2 * margin,
    h: 0.45,
    fontSize: 12,
    color: PPT_MUTED_COLOR,
    fontFace: "Calibri",
  });

  // Chart area: lower ~70% of the slide
  const chartTop = margin + 1.3;
  const chartHeight = slideHeight - chartTop - margin;
  const chartWidth = slideWidth - 2 * margin;

  if (data.chartNode) {
    const captured = await captureChartImage(data.chartNode, data.paginateRowSelector);
    if (captured) {
      // Pagination is opt-in via `paginateRowSelector`. Without it we
      // always render the chart on a single slide and scale it to fit —
      // visualizations like treemaps, heatmaps and network graphs lose
      // meaning when split horizontally, so don't risk it.
      const pages = data.paginateRowSelector
        ? await paginateChartImage(captured, chartWidth, chartHeight)
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

function exportTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}
