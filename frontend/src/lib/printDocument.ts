/**
 * The one pop-up print path for a document-shaped record.
 *
 * A Statement of Architecture Work, an Architecture Decision Record, a risk
 * and a compliance finding all "print to PDF" the same way: an HTML body is
 * built from the record, written into a fresh blank window with its own
 * stylesheet, and the browser's print dialog is opened so the user can pick
 * *Save as PDF*. The app's global `print.css` (landscape, report chrome) never
 * applies, because the pop-up is its own document.
 *
 * Two shapes, because of pop-up blockers: `window.open` counts as
 * user-initiated only while the click's activation is live, and an `await`
 * before it (a fetch, a dynamic import) loses that in Safari and Firefox. A
 * handler that needs data first therefore calls `openPrintWindow()` in the
 * click, awaits, then `writePrintDocument(win, ...)`; one that already holds
 * the record calls `printDocument(...)`.
 *
 * The body is run through `sanitizeRichHtml` as a whole before it is written,
 * so a stored rich-text section cannot carry a script into the pop-up. The
 * fragment builders below still escape every scalar, so a plain-text field
 * containing `<` renders literally instead of being stripped.
 */
import i18n from "@/i18n";
import { PRINT_COLORS, brand } from "@/theme/tokens";
import type { SoAWSignatory } from "@/types";
import {
  DOCUMENT_CONTENT_CLASS,
  PRINT_CONTENT_COLOURS,
  documentContentCss,
  documentImageCss,
} from "./documentContentCss";
import { DOCUMENT_IMAGE_PATH_PREFIX } from "./documentImageMarkup";
import { escapeHtml } from "./escapeHtml";
import { sanitizeRichHtml } from "./richHtml";
import { richHtmlHasContent } from "./richHtmlContent";

export { escapeHtml };

/**
 * True when the HTML has nothing to show: no visible text and no document
 * picture (see `richHtmlHasContent`).
 */
export function htmlIsEmpty(html: string | null | undefined): boolean {
  return !richHtmlHasContent(html);
}

/**
 * Picture rules for a printed document under `scope`: the shared document
 * picture CSS, and a picture is never split across a page break.
 */
export function printDocumentImageCss(scope: string): string {
  return `${documentImageCss(scope)}\n${scope} img { break-inside: avoid; page-break-inside: avoid; }`;
}

/**
 * The rules for stored rich content in a printed document or the SoAW
 * preview, under `root` (the body class): links, code, sub-headings, tables,
 * each scoped to the `.doc-content` wrapper so the document's own tables keep
 * their look; rows never split across pages; on screen (the SoAW preview,
 * the pop-up before it prints) each wrapper scrolls sideways when a table
 * is wider than it. Pictures are styled by `printDocumentImageCss` under the
 * whole root.
 */
export function printDocumentContentCss(root: string): string {
  return documentContentCss(`${root} .${DOCUMENT_CONTENT_CLASS}`, PRINT_CONTENT_COLOURS, {
    pictures: false,
    print: true,
    scroll: true,
  });
}

/** The title block's classes (`documentHeader`): centred heading without rule, centred subtitle. */
export function printDocumentHeaderCss(root: string): string {
  return (
    `${root} h1.doc-title { text-align: center; border: none; }\n` +
    `${root} p.doc-subtitle { text-align: center; font-size: 14pt; color: ${PRINT_COLORS.inkSecondary}; }`
  );
}

export const DOCUMENT_PRINT_CSS = `
  @page { size: A4 portrait; margin: 18mm; }
  body.doc-print { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; color: ${PRINT_COLORS.ink}; line-height: 1.6; font-size: 11pt; }
  .doc-print h1 { font-size: 22pt; color: ${PRINT_COLORS.heading}; border-bottom: 2px solid ${brand.primary}; padding-bottom: 8px; }
  .doc-print h2 { font-size: 16pt; color: ${PRINT_COLORS.text}; margin-top: 28px; }
  .doc-print h3 { font-size: 13pt; color: ${PRINT_COLORS.subheading}; margin-top: 20px; }
  .doc-print table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .doc-print th, .doc-print td { border: 1px solid ${PRINT_COLORS.control}; padding: 6px 10px; text-align: left; font-size: 10pt; vertical-align: top; }
  .doc-print th { background: ${PRINT_COLORS.panel}; font-weight: 600; }
  .doc-print .meta-label { font-weight: 600; width: 140px; }
  .doc-print .pre { white-space: pre-wrap; }
  .doc-signatures { margin-top: 36px; border-top: 2px solid ${PRINT_COLORS.ruleLight}; padding-top: 16px; }
  .doc-signatures h2 { display: flex; align-items: center; gap: 8px; }
  .doc-signatures .sig-badge { display: inline-block; font-size: 9pt; padding: 2px 10px; border-radius: 3px; font-weight: 600; }
  .doc-signatures .sig-badge.signed { background: ${PRINT_COLORS.successTint}; color: ${PRINT_COLORS.success}; }
  .doc-signatures .sig-badge.fully-signed { background: ${PRINT_COLORS.success}; color: ${PRINT_COLORS.paper}; }
  .doc-signatures .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .doc-signatures .sig-card { padding: 12px; border: 1px solid ${PRINT_COLORS.control}; border-radius: 4px; }
  .doc-signatures .sig-card.approved { border-color: ${PRINT_COLORS.successLight}; background: ${PRINT_COLORS.successPale}; }
  .doc-signatures .sig-card.pending { border-color: ${PRINT_COLORS.control}; background: ${PRINT_COLORS.panelLight}; }
  .doc-signatures .sig-card .sig-status { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 700; font-size: 10pt; }
  .doc-signatures .sig-card .sig-status.approved { color: ${PRINT_COLORS.success}; }
  .doc-signatures .sig-card .sig-status.pending { color: ${PRINT_COLORS.warning}; }
  .doc-signatures .sig-card .sig-name { font-weight: 600; font-size: 10pt; }
  .doc-signatures .sig-card .sig-detail { font-size: 9pt; color: ${PRINT_COLORS.inkSecondary}; }
  .doc-print-footer { display: none; }
  ${printDocumentHeaderCss(".doc-print")}
  ${printDocumentImageCss(".doc-print")}
  ${printDocumentContentCss(".doc-print")}
  @media print {
    body.doc-print { margin: 20px; }
    .no-print { display: none !important; }
    .doc-signatures .sig-grid { grid-template-columns: 1fr 1fr; }
    .doc-signatures .sig-card.approved { border-color: ${PRINT_COLORS.successLight}; background: ${PRINT_COLORS.successPale} !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .doc-signatures .sig-badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .doc-print-footer { display: block; position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 8pt; color: ${PRINT_COLORS.muted}; border-top: 1px solid ${PRINT_COLORS.control}; padding-top: 4px; }
  }
`;

export interface PrintDocumentOptions {
  /** Window / PDF title. Escaped before use. */
  title: string;
  /** Inner body HTML. Sanitised as a whole before it is written. */
  bodyHtml: string;
  /** Already-translated footer fragments, joined with a middle dot. */
  footerParts?: string[];
  /** Class on `<body>`; defaults to `doc-print` (what `DOCUMENT_PRINT_CSS` targets). */
  bodyClass?: string;
  /** Stylesheet; defaults to `DOCUMENT_PRINT_CSS`. */
  css?: string;
  /**
   * Delay before `print()` so the pop-up has laid out; defaults to 400 ms.
   * Counted from when every picture has loaded or failed.
   */
  printDelayMs?: number;
}

const SANITISED_PICTURE = `<img src="${DOCUMENT_IMAGE_PATH_PREFIX}`;

/**
 * Every document picture's `src` made absolute against `origin`, so the
 * `about:blank` pop-up loads it whatever base URL it inherited. Runs on the
 * sanitiser's output, where a picture always starts `<img src="/api/…` and
 * the sequence cannot occur anywhere else (text escapes `<`, attribute values
 * escape `"`). An opaque or missing origin leaves the HTML as it is.
 */
export function absoluteDocumentImages(html: string, origin: string): string {
  if (!origin || origin === "null") return html;
  return html.split(SANITISED_PICTURE).join(`<img src="${escapeHtml(origin)}${DOCUMENT_IMAGE_PATH_PREFIX}`);
}

/** A `<col>`'s or a table's `width: Npx` (exactly the form the sanitiser keeps), or `null`. */
function pixelWidth(el: Element): number | null {
  const match = /^\s*width:\s*(\d+(?:\.\d+)?)px;?\s*$/.exec(el.getAttribute("style") ?? "");
  const px = match ? Number(match[1]) : 0;
  return px > 0 ? px : null;
}

/**
 * Resized tables fitted to the printed page. A table whose every column
 * carries a pixel width (a table the editor resized) gets each `<col>`'s
 * width as its share of their sum, in percent, and its own width as that
 * sum with `max-width: 100%`: it prints at its stored width when that fits
 * and shrinks, keeping its proportions, when it does not (with
 * `table-layout: fixed` and every column a percentage, the table's minimum
 * width is only its borders and padding, so `max-width` bounds it). A table
 * without stored widths is left alone, and HTML without a table is returned
 * as it is. Runs on the sanitiser's output and writes only numbers it
 * computed.
 */
export function printTableWidths(html: string): string {
  if (!html.includes("<table")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  let changed = false;
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const cols = Array.from(table.children)
      .filter((c) => c.tagName === "COLGROUP")
      .flatMap((g) => Array.from(g.children).filter((c) => c.tagName === "COL"));
    const widths = cols.map(pixelWidth);
    if (widths.length === 0 || widths.some((w) => w === null)) continue;
    const total = (widths as number[]).reduce((a, b) => a + b, 0);
    cols.forEach((col, i) => {
      const percent = Math.round(((widths[i] as number) / total) * 10000) / 100;
      col.setAttribute("style", `width: ${percent}%`);
    });
    table.setAttribute("style", `width: ${Math.round(total * 100) / 100}px; max-width: 100%`);
    changed = true;
  }
  return changed ? doc.body.innerHTML : html;
}

/** Build the complete HTML document written into the pop-up. Pure. */
export function buildPrintHtml(opts: PrintDocumentOptions): string {
  const css = opts.css ?? DOCUMENT_PRINT_CSS;
  const bodyClass = opts.bodyClass ?? "doc-print";
  const parts = (opts.footerParts ?? []).filter((p) => p && p.trim());
  const footer =
    parts.length > 0
      ? `<div class="doc-print-footer">${parts.map(escapeHtml).join("  &middot;  ")}</div>`
      : "";
  const body = absoluteDocumentImages(
    printTableWidths(sanitizeRichHtml(opts.bodyHtml)),
    window.location.origin,
  );
  return `<!DOCTYPE html><html lang="${escapeHtml(i18n.language || "en")}" dir="${i18n.dir()}"><head><meta charset="utf-8">
<title>${escapeHtml(opts.title)}</title>
<style>${css}</style></head><body class="${escapeHtml(bodyClass)}">${body}${footer}</body></html>`;
}

/**
 * Open the blank pop-up. Call it synchronously inside the click handler,
 * before any `await`. Returns `null` (after telling the user) when blocked.
 */
export function openPrintWindow(): Window | null {
  const w = window.open("", "_blank");
  if (!w) {
    alert(String(i18n.t("delivery:export.popupBlocked")));
    return null;
  }
  return w;
}

/** The longest the print dialog waits for the pictures, in ms. */
export const PRINT_IMAGE_WAIT_MS = 10_000;

/** The pictures of `doc` that have neither loaded nor failed yet. */
export function pendingImages(doc: Document): HTMLImageElement[] {
  // Stryker disable next-line LogicalOperator: a document always has `images`; the fallback spares hand-made test windows
  return Array.from(doc.images ?? []).filter((img) => !img.complete);
}

/**
 * Resolves once every one of `images` has loaded or failed, or after
 * `capMs`, whichever comes first. A picture that fails still counts as done:
 * the print shows its broken frame rather than waiting for ever.
 */
export function waitForImages(
  images: readonly HTMLImageElement[],
  capMs: number = PRINT_IMAGE_WAIT_MS,
): Promise<void> {
  if (images.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = images.length;
    const timer = setTimeout(resolve, capMs);
    for (const img of images) {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        left -= 1;
        if (left === 0) {
          clearTimeout(timer);
          resolve();
        }
      };
      img.addEventListener("load", done);
      img.addEventListener("error", done);
    }
  });
}

/**
 * Fill an already-open pop-up and schedule the print dialog: once every
 * picture has loaded or failed (at most `PRINT_IMAGE_WAIT_MS`), then after
 * `printDelayMs` so the browser has laid out. With no picture to wait for,
 * the delay starts at once, exactly as before pictures existed.
 */
export function writePrintDocument(win: Window, opts: PrintDocumentOptions): void {
  win.document.write(buildPrintHtml(opts));
  win.document.close();
  const delay = opts.printDelayMs ?? 400;
  const schedule = () => {
    setTimeout(() => win.print(), delay);
  };
  const pending = pendingImages(win.document);
  if (pending.length === 0) schedule();
  else void waitForImages(pending).then(schedule);
}

/** Open and fill in one go, for a caller that already holds its data. */
export function printDocument(opts: PrintDocumentOptions): void {
  const win = openPrintWindow();
  if (!win) return;
  writePrintDocument(win, opts);
}

// ─── Fragment builders ──────────────────────────────────────────────────────

/**
 * The SoAW title block: a centred document-type heading without the rule,
 * then the record's name as a centred 14pt subtitle. Every printed record
 * opens this way so an ADR, a risk and a finding read like the SoAW.
 */
export function documentHeader(typeLabel: string, name: string): string {
  return (
    `<h1 class="doc-title">${escapeHtml(typeLabel)}</h1>` +
    `<p class="doc-subtitle">${escapeHtml(name)}</p>`
  );
}

/** Two-column label/value table; rows with an empty value are skipped. */
export function metaTable(rows: [label: string, value: string | null | undefined][]): string {
  const kept = rows.filter(([, v]) => v != null && String(v).trim() !== "");
  if (kept.length === 0) return "";
  const body = kept
    .map(
      ([label, value]) =>
        `<tr><td class="meta-label">${escapeHtml(label)}</td><td class="pre">${escapeHtml(String(value))}</td></tr>`,
    )
    .join("");
  return `<table>${body}</table>`;
}

/** An `<h2>` heading followed by a trusted HTML fragment; nothing when the fragment is blank. */
export function section(title: string, html: string): string {
  if (!html || !html.trim()) return "";
  return `<h2>${escapeHtml(title)}</h2>${html}`;
}

/**
 * A stored rich fragment (a decision or SoAW section) in its `.doc-content`
 * wrapper, which the stored-content rules are scoped to. Nothing when blank.
 */
export function documentContent(html: string | null | undefined): string {
  if (!html || !html.trim()) return "";
  return `<div class="${DOCUMENT_CONTENT_CLASS}">${html}</div>`;
}

/** A plain-text block that keeps its line breaks. */
export function textBlock(text: string | null | undefined): string {
  if (!text || !text.trim()) return "";
  return `<p class="pre">${escapeHtml(text)}</p>`;
}

/** A header + rows table; nothing when there are no rows. */
export function tableHtml(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "";
  const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
  const body = rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c ?? "")}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${head}${body}</table>`;
}

export interface SignatureLabels {
  /** Block heading, e.g. "Signatures". */
  title: string;
  /** Badge on the heading once every signatory has signed. */
  fullySigned: string;
  approved: string;
  pending: string;
  /** "Signed: {date}" with the date already formatted. */
  signed: (date: string) => string;
}

/**
 * The SoAW signature block: a ruled-off section whose heading carries a
 * "Fully signed" badge once everyone has signed, then the two-column card grid.
 * Nothing when there are no signatories.
 */
export function signatureBlock(
  signatories: SoAWSignatory[],
  labels: SignatureLabels,
  formatDateTime: (iso: string) => string,
): string {
  if (signatories.length === 0) return "";
  const allSigned = signatories.every((s) => s.status === "signed");
  let html = `<div class="doc-signatures"><h2>${escapeHtml(labels.title)}`;
  if (allSigned) html += ` <span class="sig-badge fully-signed">${escapeHtml(labels.fullySigned)}</span>`;
  html += `</h2><div class="sig-grid">`;
  for (const sig of signatories) {
    const ok = sig.status === "signed";
    html += `<div class="sig-card ${ok ? "approved" : "pending"}">`;
    html += `<div class="sig-status ${ok ? "approved" : "pending"}">${
      ok ? `&#10003; ${escapeHtml(labels.approved)}` : `&#9711; ${escapeHtml(labels.pending)}`
    }</div>`;
    html += `<div class="sig-name">${escapeHtml(sig.display_name)}</div>`;
    if (sig.email) html += `<div class="sig-detail">${escapeHtml(sig.email)}</div>`;
    if (ok && sig.signed_at) {
      html += `<div class="sig-detail">${escapeHtml(labels.signed(formatDateTime(sig.signed_at)))}</div>`;
    }
    html += `</div>`;
  }
  html += `</div></div>`;
  return html;
}
