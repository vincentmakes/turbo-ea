/**
 * EA principles ⇄ `.xlsx`.
 *
 * The export is a valid import file: the same columns, in the same order, so
 * an admin can export, edit in Excel and re-import. On import a row matches an
 * existing principle by `reference_number`, then by title; the server decides
 * (`POST /metamodel/principles/bulk-import`). A column the sheet lacks stays
 * `undefined` on every item, which the server reads as "leave as it is" — so
 * a sheet with only `title` and `description` never touches the rest.
 */
import type { EAPrinciple, PrincipleImportItem } from "@/types";
import { downloadSheet, exportTimestamp, readSheetRows } from "@/lib/sheetRows";

export const PRINCIPLE_SHEET = "Principles";

export const PRINCIPLE_COLUMNS = [
  "reference_number",
  "title",
  "description",
  "rationale",
  "implications",
  "is_active",
  "sort_order",
] as const;

const OPTIONAL_COLUMNS = [
  "reference_number",
  "description",
  "rationale",
  "implications",
  "is_active",
  "sort_order",
] as const;

/** Read a workbook into import rows (the "Principles" sheet, else the first). */
export function parsePrincipleWorkbook(buffer: ArrayBuffer): PrincipleImportItem[] {
  return readSheetRows(buffer, PRINCIPLE_SHEET).map(({ sheetRow, cells: row }) => {
    const item: PrincipleImportItem = { row_index: sheetRow, title: row.title ?? "" };
    for (const column of OPTIONAL_COLUMNS) {
      if (column in row) item[column] = row[column];
    }
    return item;
  });
}

/** One principle as a sheet row, in `PRINCIPLE_COLUMNS` order. */
export function principleRow(p: EAPrinciple): (string | number)[] {
  return [
    p.reference_number ?? "",
    p.title,
    p.description ?? "",
    p.rationale ?? "",
    p.implications ?? "",
    p.is_active ? "true" : "false",
    p.sort_order,
  ];
}

export function exportPrinciples(principles: EAPrinciple[], now: Date = new Date()): void {
  downloadSheet(
    `principles-${exportTimestamp(now)}.xlsx`,
    PRINCIPLE_SHEET,
    PRINCIPLE_COLUMNS,
    principles.map(principleRow),
  );
}

/** A starter workbook: the headers and one illustrative row. */
export function downloadPrincipleTemplate(): void {
  downloadSheet("principles-import-template.xlsx", PRINCIPLE_SHEET, PRINCIPLE_COLUMNS, [
    [
      "",
      "Reuse before buy before build",
      "Prefer existing capabilities over new purchases, and purchases over custom builds.",
      "Lowers cost and complexity\nSpeeds up delivery",
      "Every new solution starts with a reuse assessment",
      "true",
      10,
    ],
  ]);
}
