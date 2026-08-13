// Pure logic behind the cell context menu (useCellContextMenu.tsx) — the
// ServiceNow-style "Show matching / Filter out" affordance every AG Grid in
// the app offers on right-click / long-press.
//
// The filter target is AG Grid's own column filter model, merged one column at
// a time (`api.setFilterModel({...api.getFilterModel(), [colId]: model})`).
// Pages that persist their filter model (Inventory, ADR) pick the change up
// through their existing `onFilterChanged` handlers — programmatic
// `setFilterModel` fires that event too — so applying a filter here needs no
// extra plumbing.
import type { ColDef, Column, GridApi, IRowNode } from "ag-grid-community";

/**
 * What filter model shape a column takes. `none` means the column offers no
 * filter at all (`filter: false`, or AG Grid's auto-generated selection
 * column) — the menu hides its filter items there.
 */
export type CellFilterKind = "text" | "number" | "date" | "none";

/**
 * AG Grid's auto-generated columns (row selection checkboxes) all carry the
 * `ag-Grid-` colId prefix.
 */
const AG_GENERATED_COL_PREFIX = "ag-Grid-";

export function filterKindOf(colDef: ColDef, colId: string): CellFilterKind {
  if (colId.startsWith(AG_GENERATED_COL_PREFIX)) return "none";
  if (colDef.filter === false || colDef.filter === undefined || colDef.filter === null) {
    return "none";
  }
  if (colDef.filter === "agDateColumnFilter") return "date";
  if (colDef.filter === "agNumberColumnFilter") return "number";
  // `true`, "agTextColumnFilter", and "agSetColumnFilter" (an Enterprise name
  // that silently degrades to the text filter on Community) all land here.
  return "text";
}

/**
 * The value the column's filter engine actually matches against: the
 * `filterValueGetter` output when the column declares one (parent, tags,
 * stakeholder columns do — their raw cell value is an id or an object array),
 * else the raw cell value.
 */
export function cellFilterValue<TData>(
  api: GridApi<TData>,
  node: IRowNode<TData>,
  column: Column,
): unknown {
  const colDef = column.getColDef();
  const fvg = colDef.filterValueGetter;
  if (typeof fvg === "function") {
    return fvg({
      api,
      column,
      colDef,
      data: node.data,
      node,
      getValue: (field: string) => api.getCellValue({ rowNode: node, colKey: field }),
      context: undefined,
    });
  }
  return api.getCellValue({ rowNode: node, colKey: column.getColId() });
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Format a cell's date value the way AG Grid's date filter model carries it:
 * a local-day "YYYY-MM-DD HH:mm:ss" string. Day granularity matches
 * `compareDateFilter` (lib/dateColumnFilter.ts), which every date column that
 * supports the menu uses.
 */
function toDateFilterString(value: unknown): string | null {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 00:00:00`;
}

function buildFilterModel(
  kind: CellFilterKind,
  value: unknown,
  exclude: boolean,
): Record<string, unknown> | null {
  if (kind === "none") return null;
  if (isBlank(value)) {
    return { filterType: kind, type: exclude ? "notBlank" : "blank" };
  }
  if (kind === "number") {
    const num = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(num)) return null;
    return { filterType: "number", type: exclude ? "notEqual" : "equals", filter: num };
  }
  if (kind === "date") {
    const dateFrom = toDateFilterString(value);
    if (dateFrom === null) return null;
    return { filterType: "date", type: exclude ? "notEqual" : "equals", dateFrom, dateTo: null };
  }
  return { filterType: "text", type: exclude ? "notEqual" : "equals", filter: String(value) };
}

/** "Show matching" — rows whose value equals the clicked cell's. */
export function buildMatchModel(
  kind: CellFilterKind,
  value: unknown,
): Record<string, unknown> | null {
  return buildFilterModel(kind, value, false);
}

/** "Filter out" — rows whose value differs from the clicked cell's. */
export function buildExcludeModel(
  kind: CellFilterKind,
  value: unknown,
): Record<string, unknown> | null {
  return buildFilterModel(kind, value, true);
}

/**
 * Model for one value of a multi-valued cell ("A; B; C"): `contains` finds
 * every row that lists the value among others; `notContains` excludes them.
 */
export function buildContainsModel(
  value: string,
  exclude: boolean,
): Record<string, unknown> {
  return {
    filterType: "text",
    type: exclude ? "notContains" : "contains",
    filter: value,
  };
}

/**
 * Copy text to the clipboard. `navigator.clipboard` is unavailable on the
 * plain-http intranet deployments self-hosted installs often run on, so fall
 * back to the classic hidden-textarea `execCommand` path.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
