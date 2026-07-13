// localStorage-backed preferences for the ADR/Decisions grid (AdrGrid).
//
// Mirrors the Inventory grid's persistence (visibility + column layout +
// column-filter model) but deliberately simpler: no saved views, and the
// visibility set stores *hidden* column ids rather than selected ones, so
// columns unknown to a stored pref — e.g. a freshly installed extension's
// grid column — default to visible with no migration logic.
//
// Two components write here (DecisionsPanel owns visibility, AdrGrid owns
// filters/layout), so all writes go through the read-modify-write
// `updateAdrGridPrefs` to keep one writer from clobbering the other's keys.

import type { ColumnState } from "ag-grid-community";

export const ADR_GRID_LS_KEY = "turboea_adr_grid";

/** Columns that can never be hidden — the grid is meaningless without them. */
export const ADR_LOCKED_COLUMN_KEYS = new Set(["reference", "title"]);

/**
 * The built-in ADR grid columns, in display order. `key` doubles as the AG
 * Grid `colId` (must stay stable — the persisted visibility set, filter
 * model, and column state all key on it); `tKey` is the delivery-namespace
 * translation key for the header label, reused by the sidebar column chooser.
 */
export const ADR_COLUMN_DEFS: { key: string; tKey: string }[] = [
  { key: "reference", tKey: "adr.grid.reference" },
  { key: "status", tKey: "adr.grid.status" },
  { key: "title", tKey: "adr.grid.title" },
  { key: "decision", tKey: "adr.grid.decision" },
  { key: "linkedCards", tKey: "adr.grid.linkedCards" },
  { key: "createdBy", tKey: "adr.grid.createdBy" },
  { key: "created", tKey: "adr.grid.created" },
  { key: "lastModified", tKey: "adr.grid.lastModified" },
  { key: "signed", tKey: "adr.grid.signed" },
  { key: "signedBy", tKey: "adr.grid.signedBy" },
];

export interface AdrGridPrefs {
  /** colIds the user unchecked in the column chooser. Absent = all visible. */
  hiddenColumns?: string[];
  /** AG Grid getColumnState() snapshot — order/width/pinning/sort. */
  columnState?: ColumnState[];
  /** AG Grid getFilterModel() snapshot — active per-column filters. */
  columnFilterModel?: Record<string, unknown>;
}

export function loadAdrGridPrefs(): AdrGridPrefs | null {
  try {
    const raw = localStorage.getItem(ADR_GRID_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as AdrGridPrefs;
  } catch {
    return null;
  }
}

export function updateAdrGridPrefs(patch: Partial<AdrGridPrefs>): void {
  try {
    const next = { ...(loadAdrGridPrefs() ?? {}), ...patch };
    localStorage.setItem(ADR_GRID_LS_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded or storage unavailable — prefs just don't persist.
  }
}
