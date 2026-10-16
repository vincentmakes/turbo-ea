/**
 * The Inventory grid column for a `boolean` attribute, rendered and edited
 * like the `single_select` column beside it (#1266).
 *
 * Without its own column def a boolean column fell back to AG Grid's type
 * inference from the first row, and since the shared `valueGetter` returns
 * `""` for an unset value, the inferred type changed with whichever card
 * happened to sort first — a checkbox renderer on one page, a raw `true` /
 * `false` text cell on the next, and an editor that could not say "unset".
 *
 *  - `cellDataType: false` switches the inference off, so the column is the
 *    same whatever the rows are.
 *  - A cell shows the green Yes / blue No pill card detail shows; the page
 *    renders it from `booleanOption` (this module stays React-free). An unset
 *    cell is blank, like an unset single-select cell.
 *  - The formatter feeds the "Export current view" sheet (WYSIWYG): Yes, No,
 *    or blank. Legacy `"yes"` / `"true"` strings read through `booleanValueOf`.
 *  - The editor is `agSelectCellEditor` over `["", true, false]`. AG Grid
 *    labels its options through this same formatter, calling it with
 *    `node: null` (there is no row behind a dropdown entry), and that is the
 *    one context where the unset entry reads **None** — the clear option, as
 *    in every single-select dropdown. `persistCellValue` already writes a
 *    picked `""` as `null` (`normalizeAttrValue`) and keeps `false`.
 *  - Sorting ranks unset < No < Yes. AG Grid's default comparator coerces
 *    `""` and `false` to the same number and would interleave them.
 */

import { booleanValueOf, type FacetLabels } from "@/lib/fieldFacets";

export interface BooleanColumnLabels extends FacetLabels {
  /** The editor's clear entry (`common:labels.none`). */
  none: string;
}

/** The values the cell editor offers: None, Yes, No. */
export const BOOLEAN_EDITOR_VALUES: readonly unknown[] = ["", true, false];

/** A cell's display text; `inEditor` is true for the editor's dropdown entries. */
export function formatBooleanCell(
  value: unknown,
  labels: BooleanColumnLabels,
  inEditor = false,
): string {
  const b = booleanValueOf(value);
  if (b === null) return inEditor ? labels.none : "";
  return b ? labels.yes : labels.no;
}

function rank(value: unknown): number {
  const b = booleanValueOf(value);
  if (b === null) return 0;
  return b ? 2 : 1;
}

/** Sort order unset < No < Yes. */
export function compareBooleanCells(a: unknown, b: unknown): number {
  return rank(a) - rank(b);
}

/** The column-def fragment a boolean attribute column spreads in (renderer aside). */
export function booleanColumnDef(labels: BooleanColumnLabels) {
  return {
    cellDataType: false as const,
    valueFormatter: (p: { value?: unknown; node?: unknown }) =>
      formatBooleanCell(p.value, labels, p.node === null),
    comparator: compareBooleanCells,
    cellEditor: "agSelectCellEditor",
    cellEditorParams: { values: [...BOOLEAN_EDITOR_VALUES] },
  };
}
