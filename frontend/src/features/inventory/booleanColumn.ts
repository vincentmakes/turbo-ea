/**
 * The Inventory grid column for a `boolean` attribute: three states, read and
 * edited as Yes / No / Not set (#1266).
 *
 * Without its own column def a boolean column fell back to AG Grid's type
 * inference from the first row, and since the shared `valueGetter` returns
 * `""` for an unset value, the inferred type changed with whichever card
 * happened to sort first — a checkbox renderer on one page, a raw `true` /
 * `false` text cell on the next, and an editor that could not say "unset".
 *
 *  - `cellDataType: false` switches the inference off, so the column is the
 *    same whatever the rows are.
 *  - The formatter shows `—` for an unset value (as card detail does), Yes or
 *    No otherwise — legacy `"yes"` / `"true"` strings included, through the
 *    same `booleanValueOf` the editors and the filter facets use. It also
 *    feeds the "Export current view" sheet, which is WYSIWYG by design.
 *  - The editor is `agSelectCellEditor` over `["", true, false]`. AG Grid
 *    labels its options through this same formatter, calling it with
 *    `node: null` (there is no row behind a dropdown entry), and that is the
 *    one context where the unset entry reads **Not set** instead of `—`: it
 *    is an action there, not a display. `persistCellValue` already writes a
 *    picked `""` as `null` (`normalizeAttrValue`) and keeps `false`.
 *  - Sorting ranks Not set < No < Yes. AG Grid's default comparator coerces
 *    `""` and `false` to the same number and would interleave them.
 */

import { booleanValueOf } from "@/lib/fieldFacets";

export interface BooleanColumnLabels {
  yes: string;
  no: string;
  notSet: string;
}

/** What an unset boolean cell shows. */
export const BOOLEAN_EMPTY_CELL = "—";

/** The values the cell editor offers: Not set, Yes, No. */
export const BOOLEAN_EDITOR_VALUES: readonly unknown[] = ["", true, false];

/** A cell's display text; `inEditor` is true for the editor's dropdown entries. */
export function formatBooleanCell(
  value: unknown,
  labels: BooleanColumnLabels,
  inEditor = false,
): string {
  const b = booleanValueOf(value);
  if (b === null) return inEditor ? labels.notSet : BOOLEAN_EMPTY_CELL;
  return b ? labels.yes : labels.no;
}

function rank(value: unknown): number {
  const b = booleanValueOf(value);
  if (b === null) return 0;
  return b ? 2 : 1;
}

/** Sort order Not set < No < Yes. */
export function compareBooleanCells(a: unknown, b: unknown): number {
  return rank(a) - rank(b);
}

/** The column-def fragment a boolean attribute column spreads in. */
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
