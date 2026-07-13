// Shared AG Grid date-column filter config (Inventory grid, ADR/Decisions grid).
//
// Datetime columns (created_at / updated_at) and custom `date` fields store
// their value as an ISO string (e.g. "2026-04-27T10:00:00Z" for datetimes,
// "2026-04-27" for date-only fields). AG Grid's `agDateColumnFilter` compares
// the filter Date against the raw cell value via a comparator; its built-in
// comparator does not reliably parse full ISO datetime strings, so we supply
// our own that parses the string and compares at day granularity.

/** Truncate a Date to local midnight so comparisons are day-level. */
function toDayValue(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * AG Grid date-filter comparator.
 *
 * Returns a negative number when the cell date is before the filter date,
 * 0 when they fall on the same day, and a positive number when after.
 * Blank or unparseable cell values sort before every filter date so they
 * never satisfy an "after" / "equals" predicate.
 */
export function compareDateFilter(filterDate: Date, cellValue: unknown): number {
  if (cellValue === null || cellValue === undefined || cellValue === "") return -1;
  const cell = new Date(cellValue as string);
  if (Number.isNaN(cell.getTime())) return -1;
  return toDayValue(cell) - toDayValue(filterDate);
}

/**
 * Reusable partial column definition enabling the date filter with our comparator.
 *
 * `buttons: ["reset"]` adds AG Grid's Reset button to the filter popup so any
 * column's filter can be cleared in one click. A column's own `filterParams`
 * replaces (does not deep-merge with) the grid `defaultColDef.filterParams`, so
 * the button is declared here as well as on the default col-def.
 */
export const dateColumnFilterDef = {
  filter: "agDateColumnFilter" as const,
  filterParams: { comparator: compareDateFilter, buttons: ["reset"] as const },
};
