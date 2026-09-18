/**
 * Workbook readers — the leaf the extension SDK's `loadSpreadsheet` resolves.
 *
 * `excelImport.ts` is a 2,000-line card importer whose only generic piece is
 * "read this file into rows"; lifting that piece here means the loader hands
 * an extension the readers without dragging the card-import validators,
 * and the importer itself re-exports `parseWorkbook` from here so its own
 * callers never moved. Both readers set `cellDates: true` so a date cell
 * Excel reformatted comes back as a JS `Date` (UTC midnight) instead of an
 * opaque serial number, and `defval: ""` so a blank cell is a blank string
 * rather than a missing key.
 */
import * as XLSX from "xlsx";

export interface WorkbookSheet {
  name: string;
  rows: Record<string, unknown>[];
}

/** Single-sheet reader: the rows of the workbook's FIRST sheet. */
export function parseWorkbook(file: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(file, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
}

/** Every sheet, in workbook order, each as header-keyed rows. */
export function readWorkbookSheets(file: ArrayBuffer): WorkbookSheet[] {
  const wb = XLSX.read(file, { type: "array", cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    return {
      name,
      rows: ws ? XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" }) : [],
    };
  });
}
