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
import type { SoAWSignatory } from "@/types";
import { sanitizeRichHtml } from "./richHtml";

/** Escape a string for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** True when the HTML has no visible text (empty, whitespace or empty tags). */
export function htmlIsEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  const text = (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").trim();
  return !text;
}

export const DOCUMENT_PRINT_CSS = `
  @page { size: A4 portrait; margin: 18mm; }
  body.doc-print { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #222; line-height: 1.6; font-size: 11pt; }
  .doc-print h1 { font-size: 22pt; color: #1a1a2e; border-bottom: 2px solid #1976d2; padding-bottom: 8px; margin-bottom: 8px; }
  .doc-print h2 { font-size: 16pt; color: #333; margin-top: 28px; }
  .doc-print h3 { font-size: 13pt; color: #444; margin-top: 20px; }
  .doc-print table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  .doc-print th, .doc-print td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 10pt; vertical-align: top; }
  .doc-print th { background: #f5f5f5; font-weight: 600; }
  .doc-print .meta-label { font-weight: 600; width: 160px; }
  .doc-print .doc-caption { font-size: 10pt; color: #666; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 4px; }
  .doc-print .doc-subtitle { font-size: 14pt; color: #555; margin: 0 0 12px; }
  .doc-print .doc-chips { margin: 0 0 16px; }
  .doc-print .doc-chip { display: inline-block; font-size: 9pt; padding: 1px 10px; border-radius: 3px; background: #eee; color: #333; margin-right: 6px; }
  .doc-print .pre { white-space: pre-wrap; }
  .doc-print .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .doc-print .sig-card { padding: 12px; border: 1px solid #ccc; border-radius: 4px; }
  .doc-print .sig-card.approved { border-color: #66bb6a; background: #f1f8e9; }
  .doc-print .sig-card.pending { border-color: #ccc; background: #fafafa; }
  .doc-print .sig-card .sig-status { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-weight: 700; font-size: 10pt; }
  .doc-print .sig-card .sig-status.approved { color: #2e7d32; }
  .doc-print .sig-card .sig-status.pending { color: #ed6c02; }
  .doc-print .sig-card .sig-name { font-weight: 600; font-size: 10pt; }
  .doc-print .sig-card .sig-detail { font-size: 9pt; color: #666; }
  .doc-print-footer { display: none; }
  @media print {
    body.doc-print { margin: 20px; }
    .no-print { display: none !important; }
    .doc-print .sig-card.approved, .doc-print .doc-chip { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .doc-print-footer { display: block; position: fixed; bottom: 0; left: 0; right: 0; text-align: center; font-size: 8pt; color: #888; border-top: 1px solid #ccc; padding-top: 4px; }
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
  /** Delay before `print()` so the pop-up has laid out; defaults to 400 ms. */
  printDelayMs?: number;
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
  const body = sanitizeRichHtml(opts.bodyHtml);
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

/** Fill an already-open pop-up and schedule the print dialog. */
export function writePrintDocument(win: Window, opts: PrintDocumentOptions): void {
  win.document.write(buildPrintHtml(opts));
  win.document.close();
  // Give the browser a moment to render, then open print dialog.
  setTimeout(() => win.print(), opts.printDelayMs ?? 400);
}

/** Open and fill in one go, for a caller that already holds its data. */
export function printDocument(opts: PrintDocumentOptions): void {
  const win = openPrintWindow();
  if (!win) return;
  writePrintDocument(win, opts);
}

// ─── Fragment builders ──────────────────────────────────────────────────────

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

/** Inline chips, e.g. status / severity / level badges under a title. */
export function chipRow(labels: (string | null | undefined)[]): string {
  const kept = labels.filter((l): l is string => !!l && l.trim() !== "");
  if (kept.length === 0) return "";
  return `<p class="doc-chips">${kept.map((l) => `<span class="doc-chip">${escapeHtml(l)}</span>`).join("")}</p>`;
}

export interface SignatureLabels {
  approved: string;
  pending: string;
  /** "Signed: {date}" with the date already formatted. */
  signed: (date: string) => string;
}

/** The two-column signature card grid SoAW and ADR previews share. */
export function signatureGrid(
  signatories: SoAWSignatory[],
  labels: SignatureLabels,
  formatDateTime: (iso: string) => string,
): string {
  if (signatories.length === 0) return "";
  const cards = signatories
    .map((sig) => {
      const ok = sig.status === "signed";
      let html = `<div class="sig-card ${ok ? "approved" : "pending"}">`;
      html += `<div class="sig-status ${ok ? "approved" : "pending"}">${
        ok ? `&#10003; ${escapeHtml(labels.approved)}` : `&#9711; ${escapeHtml(labels.pending)}`
      }</div>`;
      html += `<div class="sig-name">${escapeHtml(sig.display_name)}</div>`;
      if (sig.email) html += `<div class="sig-detail">${escapeHtml(sig.email)}</div>`;
      if (ok && sig.signed_at) {
        html += `<div class="sig-detail">${escapeHtml(labels.signed(formatDateTime(sig.signed_at)))}</div>`;
      }
      html += `</div>`;
      return html;
    })
    .join("");
  return `<div class="sig-grid">${cards}</div>`;
}
