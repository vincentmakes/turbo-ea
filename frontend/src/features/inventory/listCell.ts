/**
 * The grammar of a multi-valued workbook cell — the `rel:<key>` columns, the
 * `tags` column and the `stakeholder:<role>` columns — shared by both halves of
 * the Excel round-trip (`excelExport.ts` writes it, `excelImport.ts` reads it).
 *
 * Values are separated by `; `, never by `,`: card and tag names are free text
 * and commonly carry a comma ("Acme, Inc."). A `;` inside a value is written
 * `\;`. The splitter keeps every escape in the parts it returns, because a
 * relation ref also carries the path escapes `\\` and `\/` that `decodePath()`
 * reads later; a plain value such as a tag is unescaped with
 * `unescapeListItem()`.
 *
 * Workbooks written before tags moved to `;` (format 3 and earlier), and sheets
 * built by hand with no `_Meta` sheet, may still use commas. They are read in
 * the legacy comma mode, where a cell with no `;` is one value when the whole
 * cell names something that exists, and comma-separated otherwise (#1171: a
 * single target named "This is X, it does Y" used to be read as two).
 */

/** The workbook format the exporter writes (`_Meta.format_version`). */
export const WORKBOOK_FORMAT_VERSION = "4";

/** Formats the importer reads with nothing lost. Format 3 differs from 4 only
 * in its `tags` separator, which the comma reading still handles. */
const FULLY_READABLE_FORMATS = new Set(["3", WORKBOOK_FORMAT_VERSION]);

/** Whether a workbook's declared format imports without a mismatch banner. */
export function isCurrentWorkbookFormat(version: string | undefined): boolean {
  return version == null || version === "" || FULLY_READABLE_FORMATS.has(version);
}

/** Whether a declared format already writes the `tags` column `;`-separated. */
export function tagsAreSemicolonSeparated(version: string | undefined): boolean {
  const n = Number.parseInt(version ?? "", 10);
  return Number.isFinite(n) && n >= 4;
}

/** The separator written between the values of a multi-valued cell. */
export const LIST_SEPARATOR = "; ";

/**
 * How to read a multi-valued cell:
 * - `semicolon`: the format is known to use `;`, so a comma is always text.
 * - `comma`: a legacy format whose separator was `,`.
 * - `auto`: nothing declares the format (a hand-built sheet, a CSV) — `;` when
 *   the cell has one, the comma reading otherwise.
 */
export type ListCellMode = "semicolon" | "comma" | "auto";

/** Escape `;` in a value that is already escaped for something else (a
 * relation ref carrying `\\` and `\/` from `encodePathSegment()`). */
export function escapeListSeparator(value: string): string {
  return value.replace(/;/g, "\\;");
}

/** Escape a plain value (a tag) for a multi-valued cell: `\` and `;`. */
export function escapeListItem(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;");
}

/** Reverse `escapeListItem()`: every `\x` becomes `x`. */
export function unescapeListItem(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "\\" && i + 1 < value.length) {
      out += value[i + 1];
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

function hasUnescapedSemicolon(cell: string): boolean {
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === "\\") i++;
    else if (cell[i] === ";") return true;
  }
  return false;
}

/** Split on every `;` that is not escaped. Escapes stay in the parts. */
function splitOnUnescapedSemicolon(cell: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let i = 0; i < cell.length; i++) {
    const ch = cell[i];
    if (ch === "\\" && i + 1 < cell.length) {
      cur += ch + cell[i + 1];
      i++;
    } else if (ch === ";") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function readsBySemicolon(cell: string, mode: ListCellMode): boolean {
  return mode === "semicolon" || (mode === "auto" && hasUnescapedSemicolon(cell));
}

function splitOnComma(cell: string): string[] {
  return cell
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface SplitListCell {
  /** The values, escapes intact. */
  parts: string[];
  /** True when the cell was read as `;`-separated, i.e. its values are
   * escaped and a plain value must go through `unescapeListItem()`. */
  bySemicolon: boolean;
}

/**
 * Split a multi-valued cell into its values.
 *
 * `resolvesWhole` is consulted only by the comma reading, and only when the
 * cell holds a comma: it says whether the whole cell names one existing thing,
 * in which case the comma is part of that name rather than a separator.
 */
export function splitListCell(
  cell: string,
  mode: ListCellMode,
  resolvesWhole?: (whole: string) => boolean,
): SplitListCell {
  const trimmed = cell.trim();
  if (!trimmed) return { parts: [], bySemicolon: false };
  if (readsBySemicolon(trimmed, mode)) {
    return { parts: splitOnUnescapedSemicolon(trimmed), bySemicolon: true };
  }
  if (!trimmed.includes(",") || resolvesWhole?.(trimmed)) {
    return { parts: [trimmed], bySemicolon: false };
  }
  return { parts: splitOnComma(trimmed), bySemicolon: false };
}

/**
 * Every value `splitListCell()` could return for this cell, whatever
 * `resolvesWhole` answers — the whole cell and each comma part when the comma
 * reading is ambiguous. Lets a caller look all of them up in one round-trip
 * before deciding.
 */
export function listCellReadings(cell: string, mode: ListCellMode): string[] {
  const trimmed = cell.trim();
  if (!trimmed) return [];
  if (readsBySemicolon(trimmed, mode)) return splitOnUnescapedSemicolon(trimmed);
  if (!trimmed.includes(",")) return [trimmed];
  return [trimmed, ...splitOnComma(trimmed)];
}
