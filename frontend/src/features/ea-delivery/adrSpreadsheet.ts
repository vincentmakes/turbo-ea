/**
 * Architecture decision records ⇄ `.xlsx`.
 *
 * The export writes every section as plain text (`htmlToPlainText`) so the
 * sheet reads well in Excel, plus the read-only facts a register needs
 * (status, revision, author, signatories, dates) and the register's own
 * facts after them (standing, the decision's dates, its people and its typed
 * links as references). The importer
 * (`POST /adr/bulk-import`) is create-only: it reads `reference_number`,
 * `title`, the four sections (turned back into HTML), `cards` and
 * `related_decisions`; a row whose reference already exists is skipped, so
 * re-importing an export changes nothing. Every other column is ignored, the
 * register columns included: an import creates drafts, never standings,
 * dates, people or typed links.
 */
import type { AdrImportItem, ArchitectureDecision, DecisionPerson } from "@/types";
import { toIsoDate, toLocalDate } from "@/lib/dates";
import { htmlToPlainText, plainTextToHtml } from "@/lib/richTextCell";
import { downloadSheet, exportTimestamp, listCell, readSheetRows } from "@/lib/sheetRows";
import { i18nMentionLabels } from "./mentions/mentionLabels";

export const ADR_SHEET = "Decisions";

export const ADR_COLUMNS = [
  "reference_number",
  "title",
  "status",
  "revision_number",
  "context",
  "decision",
  "consequences",
  "alternatives_considered",
  "cards",
  "related_decisions",
  "author",
  "signatories",
  "signed_at",
  "created_at",
  "updated_at",
  "standing",
  "decided_on",
  "effective_from",
  "valid_until",
  "decision_makers",
  "participants",
  "replaces",
  "amends",
  "revokes",
  "consolidates",
] as const;

/** The typed link kinds written as their own columns (`relates` stays in
 *  `related_decisions`). */
const LINK_COLUMNS = ["replaces", "amends", "revokes", "consolidates"] as const;

const SECTIONS = ["context", "decision", "consequences", "alternatives_considered"] as const;

function day(value: string | null | undefined): string {
  const d = toLocalDate(value);
  return d ? toIsoDate(d) : "";
}

/** People's names for one cell. */
function names(people: DecisionPerson[] | undefined): string {
  return (people ?? [])
    .map((p) => p.display_name)
    .filter(Boolean)
    .join("; ");
}

/** One decision as a sheet row, in `ADR_COLUMNS` order. */
export function adrRow(adr: ArchitectureDecision): (string | number)[] {
  // Restricted / deleted mentions read as the reader's words in a cell.
  const labels = i18nMentionLabels();
  return [
    adr.reference_number,
    adr.title,
    adr.status,
    adr.revision_number,
    htmlToPlainText(adr.context, labels),
    htmlToPlainText(adr.decision, labels),
    htmlToPlainText(adr.consequences, labels),
    htmlToPlainText(adr.alternatives_considered, labels),
    (adr.linked_cards ?? []).map((c) => c.name).join("; "),
    (adr.related_references ?? []).join("; "),
    adr.creator_name ?? "",
    adr.signatories.map((s) => `${s.display_name} (${s.status})`).join("; "),
    day(adr.signed_at),
    day(adr.created_at),
    day(adr.updated_at),
    adr.standing ?? "",
    day(adr.decided_on),
    day(adr.effective_from),
    day(adr.valid_until),
    names(adr.decision_makers),
    // Participants come with `include_content=true`, the export's fetch.
    names(adr.participants),
    ...LINK_COLUMNS.map((kind) => (adr.link_references?.[kind] ?? []).join("; ")),
  ];
}

export function exportAdrsToXlsx(adrs: ArchitectureDecision[], now: Date = new Date()): void {
  downloadSheet(
    `architecture-decisions-${exportTimestamp(now)}.xlsx`,
    ADR_SHEET,
    ADR_COLUMNS,
    adrs.map(adrRow),
  );
}

/** Read a workbook into import rows (the "Decisions" sheet, else the first). */
export function parseAdrWorkbook(buffer: ArrayBuffer): AdrImportItem[] {
  return readSheetRows(buffer, ADR_SHEET).map(({ sheetRow, cells: row }) => {
    const item: AdrImportItem = {
      row_index: sheetRow,
      title: row.title ?? "",
      card_names: listCell(row.cards),
      related_references: listCell(row.related_decisions),
    };
    if (row.reference_number) item.reference_number = row.reference_number;
    if (row.status) item.status = row.status;
    // Several rows of one reference (an export with revisions): the backend
    // imports the one with the highest revision number.
    if (row.revision_number) item.revision_number = row.revision_number;
    for (const section of SECTIONS) {
      const html = plainTextToHtml(row[section]);
      if (html) item[section] = html;
    }
    return item;
  });
}

/** A starter workbook: the importable headers and one illustrative row. */
export function downloadAdrTemplate(): void {
  downloadSheet(
    "architecture-decisions-import-template.xlsx",
    ADR_SHEET,
    [
      "reference_number",
      "title",
      "context",
      "decision",
      "consequences",
      "alternatives_considered",
      "cards",
      "related_decisions",
    ],
    [
      [
        "",
        "Adopt event streaming for order data",
        "Order updates reach downstream systems through nightly batch files.",
        "Publish order events to a managed streaming platform.",
        "- Near real-time updates\n- A new platform to operate",
        "Keep batch files; point-to-point APIs",
        "Order Management; Data Platform",
        "",
      ],
    ],
  );
}
