/**
 * Column freeze (a.k.a. pinning) for every AG Grid in the app.
 *
 * AG Grid *renders* pinned columns in Community (`colDef.pinned`), but the UI
 * that lets a user pin one — the column menu's "Pin column" submenu — is an
 * Enterprise feature. This module supplies that missing affordance in a way
 * that works on any of our grids:
 *
 *   1. `headerComponentParams` feeds the stock header component a custom
 *      *template*. That keeps every default behaviour intact (sorting, the
 *      sort indicator, the filter button and its active state, the menu
 *      button, keyboard nav) and only adds two extra elements: a "freeze"
 *      pin shown while hovering an unfrozen column, and an "unfreeze" pin
 *      shown permanently on a frozen one. Which of the two is visible is
 *      decided purely in CSS by whether the header cell sits inside AG Grid's
 *      `.ag-pinned-left-header` container, so there is no state to keep in
 *      sync with the grid.
 *   2. A capture-phase click listener on the grid's wrapper element turns a
 *      click on either pin into `setColumnsPinned()`. Capture phase (plus
 *      swallowing the preceding `mousedown`) is what stops the same click
 *      from also sorting the column or starting a column drag.
 *
 * The same toggle is offered a second way — a pin on every row of the grid's
 * Columns tab (`ColumnFreezeToggle`), fed by the `frozenColumns` /
 * `toggleFrozen` members returned here — so the feature is findable without
 * hovering a header.
 *
 * Persistence is the caller's, in one of two shapes:
 *
 *   - **The page already persists a full `getColumnState()` snapshot**
 *     (Inventory). `pinned` rides along in it, so pass `frozen` derived from
 *     that snapshot, omit `onFrozenChange`, and do NOT call `applyFrozen()` —
 *     the page's existing `onColumnPinned` capture closes the loop.
 *   - **The page persists only a slice of prefs** (Risk, Compliance, Users,
 *     Resources, Audit log, ADR). Pass `frozen` + `onFrozenChange` and run the
 *     column defs through `applyFrozen()`, which stamps `pinned` from `frozen`.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { ColDef, GridApi } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import type { SxProps, Theme } from "@mui/material";
import { useTranslation } from "react-i18next";

/** Marker class on both pins — the click delegate keys on it. */
export const FREEZE_TOGGLE_CLASS = "tea-freeze";
/**
 * AG Grid's auto-generated row-selection column (`CONTROLS_COLUMN_ID_PREFIX`).
 * It is `lockPosition: "left"`, which only orders it within its own region —
 * so as soon as the user freezes a column, the checkboxes end up *after* the
 * pinned region. Pinning it too keeps it genuinely first; see
 * `selectionColumnDef` below.
 */
const CONTROLS_COLUMN_SELECTOR = '[col-id^="ag-Grid-ControlsColumn"]';
/** Shown on hover over a column that is not frozen. */
const FREEZE_ACTION_CLASS = "tea-freeze-do";
/** Shown permanently on a frozen column. */
const UNFREEZE_ACTION_CLASS = "tea-freeze-undo";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The stock AG Grid header template (every `data-ref` preserved, so the
 * default header component wires up exactly as it normally would) plus the
 * two pin toggles. They are the *first* children of the label container,
 * which is `flex-direction: row-reverse`, so the pin renders at the outer
 * edge of the header cell rather than inside the ellipsised label.
 */
export function buildFreezeHeaderTemplate(freezeLabel: string, unfreezeLabel: string): string {
  const freeze = escapeHtml(freezeLabel);
  const unfreeze = escapeHtml(unfreezeLabel);
  return (
    `<div class="ag-cell-label-container" role="presentation">` +
    `<span class="material-symbols-outlined ${FREEZE_TOGGLE_CLASS} ${FREEZE_ACTION_CLASS}" role="button" tabindex="-1" title="${freeze}" aria-label="${freeze}">push_pin</span>` +
    `<span class="material-symbols-outlined ${FREEZE_TOGGLE_CLASS} ${UNFREEZE_ACTION_CLASS}" role="button" tabindex="-1" title="${unfreeze}" aria-label="${unfreeze}">push_pin</span>` +
    `<span data-ref="eMenu" class="ag-header-icon ag-header-cell-menu-button" aria-hidden="true"></span>` +
    `<span data-ref="eFilterButton" class="ag-header-icon ag-header-cell-filter-button" aria-hidden="true"></span>` +
    `<div data-ref="eLabel" class="ag-header-cell-label" role="presentation">` +
    `<span data-ref="eText" class="ag-header-cell-text"></span>` +
    `<span data-ref="eFilter" class="ag-header-icon ag-header-label-icon ag-filter-icon" aria-hidden="true"></span>` +
    `<ag-sort-indicator data-ref="eSortIndicator"></ag-sort-indicator>` +
    `</div>` +
    `</div>`
  );
}

/**
 * Styles for the grid wrapper. Spread into the wrapper's `sx` alongside
 * whatever the page already sets.
 *
 * Visibility rules, in order:
 *  - both pins hidden by default;
 *  - hovering a header cell reveals the "freeze" pin;
 *  - a header cell inside the pinned container always shows the "unfreeze"
 *    pin (filled, in the primary colour) and never the "freeze" one — the
 *    hover rule is out-specificity'd rather than `!important`-ed;
 *  - without hover (touch), the pin is always visible.
 */
export const columnFreezeSx: SxProps<Theme> = {
  [`& .${FREEZE_TOGGLE_CLASS}`]: {
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
    marginInlineStart: "2px",
    marginInlineEnd: "2px",
    color: "text.secondary",
    opacity: 0.6,
    "&:hover": { opacity: 1, color: "primary.main" },
  },
  [`& .${UNFREEZE_ACTION_CLASS}`]: {
    fontVariationSettings: "'FILL' 1",
    color: "primary.main",
    opacity: 0.85,
  },
  [`& .ag-header-cell:hover .${FREEZE_ACTION_CLASS}`]: { display: "inline-flex" },
  [`& .ag-pinned-left-header .${UNFREEZE_ACTION_CLASS}, & .ag-pinned-right-header .${UNFREEZE_ACTION_CLASS}`]:
    { display: "inline-flex" },
  [`& .ag-pinned-left-header .ag-header-cell:hover .${FREEZE_ACTION_CLASS}, & .ag-pinned-right-header .ag-header-cell:hover .${FREEZE_ACTION_CLASS}`]:
    { display: "none" },
  "@media (hover: none)": {
    [`& .ag-header-cell .${FREEZE_ACTION_CLASS}`]: { display: "inline-flex" },
    [`& .ag-pinned-left-header .ag-header-cell .${FREEZE_ACTION_CLASS}, & .ag-pinned-right-header .ag-header-cell .${FREEZE_ACTION_CLASS}`]:
      { display: "none" },
  },
  // The pins are an on-screen affordance only.
  "@media print": {
    [`& .${FREEZE_TOGGLE_CLASS}`]: { display: "none" },
  },
  // The row-selection column is pinned permanently (see `selectionColumnDef`)
  // so it can never be pushed right of a frozen column. On a grid where the
  // user has frozen nothing that would still draw AG Grid's pinned-region
  // divider after the checkboxes, which reads as a frozen column that isn't
  // one — so drop the divider while the pinned region holds nothing else.
  [`& .ag-pinned-left-header:not(:has(.ag-header-cell:not(${CONTROLS_COLUMN_SELECTOR})))`]: {
    borderRight: "none",
  },
  [`& .ag-pinned-left-cols-container:not(:has(.ag-cell:not(${CONTROLS_COLUMN_SELECTOR}))) .ag-cell.ag-cell-last-left-pinned`]:
    { borderRight: "none" },
};

/**
 * Spread into `<AgGridReact selectionColumnDef=…>` on any grid with row
 * selection. Pinning the checkbox column is what keeps it leftmost once the
 * user freezes something: pinned columns render in their own region, ahead of
 * everything unpinned, so an unpinned checkbox column would sit *after* the
 * frozen columns. `lockPosition: "left"` (AG Grid's own default for this
 * column) then holds it first within the pinned region.
 *
 * Static rather than derived from the frozen set: AG Grid rebuilds the
 * selection column only when its colId changes, so a `selectionColumnDef`
 * flipped at runtime would not take effect.
 */
export const freezeSelectionColumnDef: ColDef = { pinned: "left" };

export interface UseColumnFreezeOptions {
  /**
   * colIds currently frozen to the leading edge. Feeds `frozenColumns` (which
   * the sidebar's pins render from) and `applyFrozen`.
   */
  frozen?: string[];
  /**
   * Called with the new frozen list after a toggle. Omit when the page
   * persists AG Grid's own column state — its `onColumnPinned` capture
   * already records `pinned`, and a second writer would fight it.
   */
  onFrozenChange?: (frozen: string[]) => void;
}

export interface ColumnFreeze {
  /** Attach to the element wrapping `<AgGridReact>`. */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * Pass to `<AgGridReact selectionColumnDef=…>` on grids with row selection,
   * so the checkbox column stays left of every frozen column.
   */
  selectionColumnDef: ColDef;
  /** Spread into `defaultColDef`. */
  headerComponentParams: { template: string };
  /** Spread into the wrapper's `sx`. */
  sx: SxProps<Theme>;
  /** Controlled mode: stamps `pinned` onto column defs from `frozen`. */
  applyFrozen: <T extends ColDef>(cols: T[]) => T[];
  /** Currently frozen colIds — feeds the sidebar's Columns tab. */
  frozenColumns: Set<string>;
  /**
   * Freeze / unfreeze one column. The header pin runs through this, and so
   * does the sidebar's per-column pin, so the two can never diverge.
   */
  toggleFrozen: (colId: string) => void;
}

/** Stable id of a column def — what AG Grid reports back as `colId`. */
function colIdOf(col: ColDef): string {
  return col.colId ?? col.field ?? "";
}

/**
 * Grids hold on to either the `<AgGridReact>` instance or the bare `GridApi`
 * captured in `onGridReady` — accept both rather than forcing a second ref.
 */
export type GridApiSource<TData> = AgGridReact<TData> | GridApi<TData> | null;

function apiOf<TData>(source: GridApiSource<TData>): GridApi<TData> | null {
  if (!source) return null;
  return "api" in source ? ((source.api as GridApi<TData> | undefined) ?? null) : source;
}

export function useColumnFreeze<TData = unknown>(
  gridRef: RefObject<GridApiSource<TData>>,
  options: UseColumnFreezeOptions = {},
): ColumnFreeze {
  const { t } = useTranslation("common");
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Read through refs so the listener is installed once and never goes stale.
  const onFrozenChangeRef = useRef(options.onFrozenChange);
  onFrozenChangeRef.current = options.onFrozenChange;

  const headerComponentParams = useMemo(
    () => ({ template: buildFreezeHeaderTemplate(t("grid.freezeColumn"), t("grid.unfreezeColumn")) }),
    [t],
  );

  // The one place a column's frozen state flips — the header pin and the
  // sidebar's Columns tab both come through here.
  const toggleFrozen = useCallback(
    (colId: string) => {
      const api = apiOf(gridRef.current);
      if (!colId || !api) return;
      const column = api.getColumn(colId);
      if (!column || column.getColDef().lockPinned) return;

      api.setColumnsPinned([colId], column.getPinned() ? null : "left");

      const onFrozenChange = onFrozenChangeRef.current;
      if (onFrozenChange) {
        onFrozenChange(
          api
            .getColumnState()
            .filter((c) => c.pinned === "left" && c.colId)
            .map((c) => c.colId as string),
        );
      }
    },
    [gridRef],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.(`.${FREEZE_TOGGLE_CLASS}`)) return;
      // Keep the click off AG Grid's own header handlers: `mousedown` would
      // start a column drag, `click` would progress the sort.
      event.preventDefault();
      event.stopPropagation();
      if (event.type !== "click") return;

      const colId = target.closest(".ag-header-cell")?.getAttribute("col-id");
      if (colId) toggleFrozen(colId);
    };

    el.addEventListener("mousedown", handler, true);
    el.addEventListener("click", handler, true);
    return () => {
      el.removeEventListener("mousedown", handler, true);
      el.removeEventListener("click", handler, true);
    };
  }, [toggleFrozen]);

  // Key on the *contents* of `frozen`, not the array identity — callers hold
  // it in state and would otherwise hand us a fresh array on every render.
  const frozenKey = options.frozen ? JSON.stringify(options.frozen) : null;
  const frozenColumns = useMemo(
    () => new Set<string>(frozenKey === null ? [] : (JSON.parse(frozenKey) as string[])),
    [frozenKey],
  );
  const applyFrozen = useCallback(
    <T extends ColDef>(cols: T[]): T[] => {
      if (frozenKey === null) return cols;
      const frozen = new Set<string>(JSON.parse(frozenKey) as string[]);
      return cols.map((col) => ({ ...col, pinned: frozen.has(colIdOf(col)) ? "left" : null }) as T);
    },
    [frozenKey],
  );

  // Stable identity: pages list this in `useMemo` dependency arrays around
  // their column defs, and a new object every render would rebuild — and
  // re-hand AG Grid — the whole column set on each one.
  return useMemo(
    () => ({
      containerRef,
      selectionColumnDef: freezeSelectionColumnDef,
      headerComponentParams,
      sx: columnFreezeSx,
      applyFrozen,
      frozenColumns,
      toggleFrozen,
    }),
    [headerComponentParams, applyFrozen, frozenColumns, toggleFrozen],
  );
}
