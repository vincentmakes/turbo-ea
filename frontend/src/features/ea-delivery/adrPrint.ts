/**
 * Print / PDF view of a single Architecture Decision Record.
 *
 * Builds the same content, in the same order, as the Word export in
 * `adrExport.ts` (facts, change summary, the four sections, linked decisions,
 * files, linked cards, extension sections, signatures or the recorded line)
 * from the shared `adrDocumentFacts.ts`, as an HTML body for the shared
 * pop-up print path in
 * `@/lib/printDocument`. Kept free of `docx` so the preview and editor chunks
 * can import it statically.
 */
import i18n from "@/i18n";
import {
  formatDateTimeWith,
  formatDateWith,
  getCachedDateFormat,
} from "@/hooks/useDateFormat";
import { getExtensionAdrExportSections } from "@/lib/extensionHost";
import {
  documentHeader,
  escapeHtml,
  htmlIsEmpty,
  metaTable,
  printDocument,
  section,
  signatureBlock,
  tableHtml,
  textBlock,
  writePrintDocument,
  type PrintDocumentOptions,
} from "@/lib/printDocument";
import type { ArchitectureDecision } from "@/types";
import {
  adrFactRows,
  adrFileNames,
  adrHeading,
  adrLinkHeaders,
  adrLinkRows,
  adrRecordedLine,
  type ExportableDecision,
} from "./adrDocumentFacts";
import { fillMentionLabelsI18n } from "./mentions/mentionLabels";

const t = (key: string, opts?: Record<string, unknown>) =>
  String(i18n.t(`delivery:${key}`, opts as never));

/** The inner HTML body for one ADR. Pure; exported for tests. */
export function buildAdrPrintBody(adr: ExportableDecision): string {
  const fmt = getCachedDateFormat();
  const date = (iso: string | null | undefined) => (iso ? formatDateWith(fmt, iso) : "");
  const dateTime = (iso: string) => formatDateTimeWith(fmt, iso);

  // The SoAW cover: document type, then "ADR-012 · Rev 2 — title".
  let html = documentHeader(t("adr.export.documentTitle"), adrHeading(adr, t));

  html += section(t("export.documentInfo"), metaTable(adrFactRows(adr, t, date)));
  html += section(t("adr.export.changeSummary"), textBlock(adr.change_summary));

  // Labels first: a section holding only a restricted / deleted mention is not empty.
  const rich = (title: string, content: string | null) => {
    const filled = fillMentionLabelsI18n(content ?? "");
    return htmlIsEmpty(filled) ? "" : section(title, filled);
  };
  html += rich(t("adr.context"), adr.context);
  html += rich(t("adr.decision"), adr.decision);
  html += rich(t("adr.consequences"), adr.consequences);
  html += rich(t("adr.alternativesConsidered"), adr.alternatives_considered);

  html += section(t("adr.export.links"), tableHtml(adrLinkHeaders(t), adrLinkRows(adr, t)));
  html += section(
    t("adr.export.files"),
    tableHtml(
      [t("adr.export.fileName")],
      adrFileNames(adr).map((name) => [name]),
    ),
  );

  const linked = adr.linked_cards ?? [];
  html += section(
    t("adr.linkedCards"),
    tableHtml(
      [t("adr.export.cardName"), t("adr.export.cardType")],
      linked.map((c) => [c.name, c.type]),
    ),
  );

  // Extension-contributed sections (UI SDK 1.3) — the same plain-data builders
  // the Word export renders; a throwing builder is skipped, never fatal.
  for (const { extKey, contribution } of getExtensionAdrExportSections()) {
    let sections;
    try {
      sections = contribution.build(adr as unknown as Record<string, unknown>);
    } catch (err) {
      console.warn(`[extension:${extKey}] ADR export builder threw — skipped`, err);
      continue;
    }
    for (const s of sections ?? []) {
      if (!s?.heading) continue;
      let inner = (s.paragraphs ?? []).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      if (s.table && s.table.headers.length > 0) inner += tableHtml(s.table.headers, s.table.rows);
      html += section(s.heading, inner || "<p></p>");
    }
  }

  // A recorded decision was not signed here: one line replaces the block.
  const recorded = adrRecordedLine(adr, t, date);
  if (recorded) {
    html += section(t("export.signatures"), `<p>${escapeHtml(recorded)}</p>`);
    return html;
  }

  html += signatureBlock(
    adr.signatories ?? [],
    {
      title: t("export.signatures"),
      fullySigned: t("export.fullySigned"),
      approved: t("export.approved"),
      pending: t("export.pending"),
      signed: (d) => t("export.signed", { date: d }),
    },
    dateTime,
  );

  return html;
}

/** Title, body and footer for the pop-up. Pure; exported for tests. */
export function adrPrintDocument(adr: ArchitectureDecision): PrintDocumentOptions {
  const fmt = getCachedDateFormat();
  // The SoAW footer rule: approver, approval date and print date, and only on
  // a document that has signatories at all.
  const parts: string[] = [];
  const signatories = adr.signatories ?? [];
  if (signatories.length > 0) {
    const approver = signatories.find((s) => s.status === "signed");
    const approvalDate = adr.signed_at ?? approver?.signed_at ?? null;
    if (approver) parts.push(t("export.approvedBy", { name: approver.display_name }));
    if (approvalDate) parts.push(t("export.dateOfApproval", { date: formatDateWith(fmt, approvalDate) }));
    parts.push(t("export.printed", { date: formatDateWith(fmt, new Date()) }));
  }
  return {
    title: adrHeading(adr, t),
    bodyHtml: buildAdrPrintBody(adr),
    footerParts: parts,
  };
}

/**
 * Open the print dialog for one ADR. Pass `win` when the window was opened
 * before an `await` (see `openPrintWindow`); otherwise it opens its own.
 */
export function printAdr(adr: ArchitectureDecision, win?: Window | null): void {
  const opts = adrPrintDocument(adr);
  if (win) writePrintDocument(win, opts);
  else printDocument(opts);
}
