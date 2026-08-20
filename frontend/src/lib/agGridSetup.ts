/**
 * AG Grid module registration + shared themes — import this from every page
 * that renders an <AgGridReact>.
 *
 * Since AG Grid 33 module registration is mandatory. We register
 * AllCommunityModule (tree-shaking individual feature modules is not worth
 * the churn for seven grids that collectively use most of Community).
 * NOTE for a future v36 upgrade: v36 pulls ValidationModule out of
 * AllCommunityModule (dev-only helper) — and, far more importantly, v36
 * restructures the grid DOM (removes .ag-body-viewport,
 * .ag-center-cols-container, .ag-pinned-left-header/-cols-container,
 * .ag-header-viewport), which breaks the Community re-implementations in
 * src/components/grid/ (useColumnFreeze, dragFill, rowGrouping,
 * cellContextMenu). Do not bump the major without reworking those hooks.
 *
 * Theming uses the Theming API (default since v33; the legacy CSS themes
 * are deprecated). themeQuartz is the same Quartz design the app used via
 * the legacy ag-theme-quartz.css; colorSchemeDark matches the old
 * ag-theme-quartz-dark. The Theming API still emits the --ag-* CSS custom
 * properties (e.g. --ag-background-color, --ag-row-hover-color,
 * --ag-row-border) that the shared grid hooks read.
 *
 * Deliberately NOT imported from main.tsx: all grid pages are React.lazy,
 * and an eager import here would pull AG Grid into the main bundle.
 */
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  provideGlobalGridOptions,
  themeQuartz,
} from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Veto for AG Grid's viewport guard. Since v33 the grid auto-unpins columns
 * whenever the pinned region would leave the centre viewport under 50px
 * (`keepPinnedColumnsNarrowerThanViewport`) — and it sacrifices the 50px
 * auto row-selection column first, permanently: once stripped, neither
 * `setColumnsPinned` nor `applyColumnState` will re-pin it. On an iPad with
 * the filter sidebar open, freezing one column was enough to trigger it and
 * the checkboxes jumped to the first unpinned slot. This callback is AG
 * Grid's sanctioned escape hatch: it receives the columns the guard wants
 * to unpin and returns the ones actually allowed — everything except the
 * selection column. Frozen DATA columns may still be relieved; the freeze
 * hook's `syncFrozenFromGrid` picks that up and updates the saved prefs.
 */
export function keepSelectionColumnPinned<T extends { getColId(): string }>(params: {
  columns: T[];
}): T[] {
  return params.columns.filter((col) => !col.getColId().startsWith("ag-Grid-"));
}

// Popups (column filter menu, …) render into <body> instead of the grid
// root. Inside the grid they carry no z-index of their own and rely on DOM
// tree order to paint above the rows — which WebKit gets wrong once the
// sticky group headers (position: sticky lives in the grid's scrolled
// content, see useRowGrouping) are promoted to their own compositing
// layers: on iPadOS the filter menu opened invisible (its input still took
// focus and popped the keyboard) or under a pinned group bar. In <body> the
// popup is outside the grid's stacking and compositing world entirely; the
// Theming API styles it there via the popup's own theme wrapper.
//
// One call for all global options — repeated calls may replace rather than
// merge.
provideGlobalGridOptions({
  popupParent: typeof document === "undefined" ? undefined : document.body,
  processUnpinnedColumns: keepSelectionColumnPinned,
});

export const gridThemeLight = themeQuartz;
export const gridThemeDark = themeQuartz.withPart(colorSchemeDark);
