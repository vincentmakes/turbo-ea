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
import { AllCommunityModule, ModuleRegistry, colorSchemeDark, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export const gridThemeLight = themeQuartz;
export const gridThemeDark = themeQuartz.withPart(colorSchemeDark);
