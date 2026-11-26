/**
 * Excel holds at most 32,767 characters in a cell, and the bundled xlsx writer
 * throws a bare "Text length must not exceed 32767 characters" at write time
 * when a string is longer (#1445). The export checks every sheet's rows before
 * building it, so the person is told which card and column to shorten instead.
 *
 * Its own module rather than `excelExport.ts`, which the Inventory page tests
 * mock wholesale: the page needs the real class for its `instanceof` check.
 */
export const EXCEL_CELL_MAX_LENGTH = 32767;

export class ExportCellTooLongError extends Error {
  readonly sheet: string;
  readonly column: string;
  readonly rowLabel: string;
  readonly length: number;

  constructor(sheet: string, column: string, rowLabel: string, length: number) {
    super(
      `${rowLabel}: column "${column}" on sheet "${sheet}" holds ${length} characters, ` +
        `more than the ${EXCEL_CELL_MAX_LENGTH} an Excel cell takes`,
    );
    this.name = "ExportCellTooLongError";
    this.sheet = sheet;
    this.column = column;
    this.rowLabel = rowLabel;
    this.length = length;
  }
}

/** Throw for the first string cell (row order, then column order) that is
 * longer than an Excel cell allows. Only strings are checked: a number, a
 * boolean or a date never reaches the limit. */
export function assertCellsFitExcel(
  sheet: string,
  rows: Record<string, unknown>[],
  rowLabel: (row: Record<string, unknown>, index: number) => string,
): void {
  rows.forEach((row, index) => {
    for (const [column, value] of Object.entries(row)) {
      if (typeof value === "string" && value.length > EXCEL_CELL_MAX_LENGTH) {
        throw new ExportCellTooLongError(sheet, column, rowLabel(row, index), value.length);
      }
    }
  });
}
