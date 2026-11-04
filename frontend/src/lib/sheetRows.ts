/**
 * Row-level helpers for the small single-sheet importers and exporters (EA
 * principles, decision records): read a sheet into rows keyed by normalised
 * header, and write one sheet with auto-sized columns.
 *
 * Header matching is case-insensitive and treats spaces as underscores, so
 * "Reference Number", "reference_number" and "REFERENCE NUMBER" all land on
 * `reference_number`. A header the sheet lacks is simply absent from the row
 * — which is how an importer tells "no such column" from "blank cell".
 */
import * as XLSX from "xlsx";
import { readWorkbookSheets } from "@/lib/spreadsheet";

export type SheetRow = Record<string, string>;

/** A non-blank row: its cells by normalised header, and where it sits in the sheet. */
export interface ParsedSheetRow {
  /** 0-based position in the sheet (the header is row 0), i.e. Excel's row number minus one. */
  sheetRow: number;
  cells: SheetRow;
}

/** Normalise a header cell to a lookup key: trimmed, lower-cased, spaces → `_`. */
export function headerKey(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

/** A cell as text: dates as `YYYY-MM-DD`, everything else trimmed. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).trim();
}

/**
 * The rows of the sheet named `preferredSheet` (case-insensitive), or of the
 * first sheet when there is none. Every header the sheet has is a key on
 * every row; fully blank rows are dropped, but each row keeps its position in
 * the sheet so a message can name the row the person sees in Excel.
 */
export function readSheetRows(buffer: ArrayBuffer, preferredSheet: string): ParsedSheetRow[] {
  const sheets = readWorkbookSheets(buffer);
  const wanted = preferredSheet.trim().toLowerCase();
  const sheet = sheets.find((s) => s.name.trim().toLowerCase() === wanted) ?? sheets[0];
  if (!sheet) return [];
  const rows: ParsedSheetRow[] = [];
  sheet.rows.forEach((rawRow, index) => {
    const cells: SheetRow = {};
    for (const [k, v] of Object.entries(rawRow)) cells[headerKey(k)] = cellText(v);
    if (!Object.values(cells).some((v) => v !== "")) return;
    // SheetJS stamps each parsed row with its 0-based sheet position
    // (non-enumerable, so the loop above never sees it).
    const sheetRow = (rawRow as { __rowNum__?: number }).__rowNum__ ?? index + 1;
    rows.push({ sheetRow, cells });
  });
  return rows;
}

/** Split a `;`-separated list cell into trimmed, non-empty values. */
export function listCell(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Column widths that fit the content, capped at 60 characters. */
export function autoFitColumns(rows: unknown[][]): XLSX.ColInfo[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      const longestLine = Math.max(...String(cell ?? "").split("\n").map((l) => l.length));
      widths[i] = Math.max(widths[i] ?? 8, longestLine + 2);
    });
  }
  return widths.map((w) => ({ wch: Math.min(w, 60) }));
}

/** `YYYY-MM-DD_HHMM` in local time, for export file names. */
export function exportTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

/** Build a one-sheet workbook from a header row and data rows. */
export function buildSheetWorkbook(
  sheetName: string,
  headers: readonly string[],
  rows: unknown[][],
): XLSX.WorkBook {
  const aoa = [[...headers], ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = autoFitColumns(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

/** Build and download a one-sheet workbook. */
export function downloadSheet(
  fileName: string,
  sheetName: string,
  headers: readonly string[],
  rows: unknown[][],
): void {
  XLSX.writeFile(buildSheetWorkbook(sheetName, headers, rows), fileName);
}
