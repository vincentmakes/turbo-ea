/**
 * Cell context menu for every AG Grid in the app — right-click (or long-press
 * on touch) a cell to filter the grid by its value, ServiceNow-style:
 *
 *   Show matching · Filter out · Copy value · Clear column filter
 *
 * AG Grid's own context menu is an Enterprise feature; this supplies the
 * affordance on Community via `onCellContextMenu` plus a MUI Menu anchored at
 * the pointer. Filters land in AG Grid's column filter model, merged one
 * column at a time, so pages that persist that model (Inventory, ADR) pick
 * the change up through their existing `onFilterChanged` handlers — no extra
 * plumbing per page.
 *
 * Wiring (same shape as useColumnFreeze):
 *
 *   const cellMenu = useCellContextMenu(gridRef, {...});
 *   <Box {...cellMenu.containerProps} sx={{ ...pageSx, ...cellMenu.sx }}>
 *     <AgGridReact {...cellMenu.gridProps} … />
 *   </Box>
 *   {cellMenu.menu}
 *
 * Touch support is a long-press (600 ms, cancelled by >5 px of movement so
 * scrolling never triggers it) driven by pointer events on the wrapper. The
 * click browsers synthesize when the finger lifts is swallowed twice: a
 * one-shot capture listener on `document` protects the just-opened menu's
 * backdrop (which sits outside the wrapper), and `onClickCapture` on the
 * wrapper stops AG Grid's own row/cell click handlers (row navigation,
 * drawer opening) as a fallback if that click arrives late.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import type { CellContextMenuEvent, Column, GridApi, IRowNode } from "ag-grid-community";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { GridApiSource } from "./useColumnFreeze";
import {
  buildContainsModel,
  buildExcludeModel,
  buildMatchModel,
  cellFilterValue,
  copyText,
  filterKindOf,
  type CellFilterKind,
} from "./cellContextMenu";

/** How long a touch must hold still before the menu opens. */
export const LONG_PRESS_MS = 600;
/** Finger travel beyond this cancels the long-press — it's a scroll. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 5;
/**
 * Android synthesizes a native `contextmenu` at roughly the same moment our
 * long-press timer fires; ignore `onCellContextMenu` for this long afterwards
 * so the menu doesn't open twice.
 */
const LONG_PRESS_CONTEXTMENU_GUARD_MS = 400;
/** Longest list of individual values offered for a multi-valued cell. */
const MAX_SPLIT_VALUES = 8;

export interface CellMenuContext<TData> {
  colId: string;
  data: TData;
  /** WYSIWYG cell text (formatter applied) — what Copy copies. */
  displayValue: string;
  /** What the column's filter engine matches against. */
  filterValue: unknown;
  filterKind: CellFilterKind;
}

/**
 * One value of a multi-valued cell. `label` is what the menu shows; `filter`
 * is the text matched with contains/notContains — they differ on columns that
 * display option labels but filter on raw keys (multi-select attributes).
 */
export interface CellSplitValue {
  label: string;
  filter: string;
}

export interface UseCellContextMenuOptions<TData> {
  /**
   * When false, the menu offers Copy only. For grids whose filtering is
   * server-side (Resources), where a client column filter would silently do
   * nothing.
   */
  enableFilterItems?: boolean;
  /** Suppress the menu entirely while true (e.g. Inventory's grid-edit mode). */
  disabled?: () => boolean;
  /** Suppress for specific rows — pass the page's `grouping.isGroupRow`. */
  suppressForRow?: (data: TData) => boolean;
  /** Suppress for specific columns (action/delete columns). */
  excludeColumns?: (colId: string) => boolean;
  /**
   * Split a multi-valued cell ("A; B; C") into its values. Returning more
   * than one value swaps the menu to a per-value list (filtered with
   * contains/notContains) plus an "Entire cell" item; exactly one value
   * filters with contains directly; null/empty means the cell is single-valued.
   */
  splitValues?: (ctx: CellMenuContext<TData>) => CellSplitValue[] | null;
  /**
   * Extra items rendered above the filter items, separated by a divider —
   * how the ADR grid keeps its row actions (Edit / Preview / …) in the same
   * menu. Call `close` after handling a click.
   */
  extraItems?: (ctx: CellMenuContext<TData>, close: () => void) => ReactNode;
}

export interface CellContextMenu {
  /** Spread onto `<AgGridReact>`. */
  gridProps: {
    onCellContextMenu: (event: CellContextMenuEvent) => void;
    preventDefaultOnContextMenu: boolean;
  };
  /** Spread onto the element wrapping `<AgGridReact>` (long-press handling). */
  containerProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
    onClickCapture: (event: React.MouseEvent) => void;
  };
  /**
   * Spread into the wrapper's `sx` alongside the page's own. Deliberately a
   * plain object (not `SxProps`) so it composes into sx literals without
   * exploding the union type.
   */
  sx: Record<string, string>;
  /** Render once, after the grid. */
  menu: ReactElement;
}

interface MenuState<TData> {
  x: number;
  y: number;
  ctx: CellMenuContext<TData>;
  /** splitValues() result, captured at open. */
  values: CellSplitValue[] | null;
  /** Whether the clicked column had an active filter at open. */
  hasColumnFilter: boolean;
}

type MenuStage = "root" | "pickMatch" | "pickExclude";

function apiOf<TData>(source: GridApiSource<TData>): GridApi<TData> | null {
  if (!source) return null;
  return "api" in source ? ((source.api as GridApi<TData> | undefined) ?? null) : source;
}

/** Suppress the iOS long-press callout — the pointer path owns the gesture. */
const cellContextMenuSx: Record<string, string> = {
  WebkitTouchCallout: "none",
};

export function useCellContextMenu<TData = unknown>(
  gridRef: RefObject<GridApiSource<TData>>,
  options: UseCellContextMenuOptions<TData> = {},
): CellContextMenu {
  const { t } = useTranslation("common");

  // Read through a ref inside the stable callbacks so they never go stale;
  // the menu JSX below uses `options` from the current render directly.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [menuState, setMenuState] = useState<MenuState<TData> | null>(null);
  const [stage, setStage] = useState<MenuStage>("root");
  const [copied, setCopied] = useState(false);

  const pressRef = useRef<{ x: number; y: number; target: HTMLElement } | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickRef = useRef(false);
  const lastLongPressAtRef = useRef(0);

  const closeMenu = useCallback(() => {
    setMenuState(null);
    setStage("root");
  }, []);

  const openMenu = useCallback(
    (x: number, y: number, api: GridApi<TData>, column: Column, node: IRowNode<TData>) => {
      const opts = optionsRef.current;
      if (opts.disabled?.()) return;
      const data = node.data;
      if (data === undefined || opts.suppressForRow?.(data)) return;
      const colId = column.getColId();
      if (opts.excludeColumns?.(colId)) return;

      const filterKind = filterKindOf(column.getColDef(), colId);
      const displayValue = String(
        api.getCellValue({ rowNode: node, colKey: colId, useFormatter: true }) ?? "",
      );
      const ctx: CellMenuContext<TData> = {
        colId,
        data,
        displayValue,
        filterValue: cellFilterValue(api, node, column),
        filterKind,
      };
      const values = opts.splitValues?.(ctx) ?? null;
      const hasColumnFilter = Boolean((api.getFilterModel() ?? {})[colId]);
      setStage("root");
      setMenuState({ x, y, ctx, values, hasColumnFilter });
    },
    [],
  );

  const handleCellContextMenu = useCallback(
    (event: CellContextMenuEvent) => {
      // The long-press path already opened the menu; Android's synthesized
      // contextmenu must not open it a second time.
      if (Date.now() - lastLongPressAtRef.current < LONG_PRESS_CONTEXTMENU_GUARD_MS) return;
      const api = apiOf(gridRef.current);
      if (!api || !event.column || !event.node) return;

      const mouse = event.event as MouseEvent | null;
      let x = mouse?.clientX ?? 0;
      let y = mouse?.clientY ?? 0;
      if (!x && !y) {
        // Keyboard (Shift+F10 / Menu key) arrives with zeroed coordinates —
        // anchor on the focused cell instead.
        const cellEl = (mouse?.target as HTMLElement | null)?.closest?.(".ag-cell");
        const rect = cellEl?.getBoundingClientRect();
        if (rect) {
          x = rect.left + Math.min(rect.width / 2, 120);
          y = rect.bottom - 4;
        }
      }
      openMenu(x, y, api, event.column as Column, event.node as IRowNode<TData>);
    },
    [gridRef, openMenu],
  );

  // ---- Long-press (touch/pen) --------------------------------------------

  const cancelPress = useCallback(() => {
    pressRef.current = null;
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  const fireLongPress = useCallback(() => {
    const press = pressRef.current;
    cancelPress();
    if (!press) return;
    const api = apiOf(gridRef.current);
    if (!api) return;

    const cellEl = press.target.closest?.(".ag-cell");
    const colId = cellEl?.getAttribute("col-id");
    const rowEl = press.target.closest?.("[row-index]");
    if (!cellEl || !colId || !rowEl) return;
    const node = api.getDisplayedRowAtIndex(Number(rowEl.getAttribute("row-index")));
    const column = api.getColumn(colId);
    if (!node || !column) return;

    lastLongPressAtRef.current = Date.now();
    // Swallow the click the browser synthesizes when the finger lifts: the
    // wrapper capture below covers clicks inside the grid, and a one-shot
    // document capture covers the menu backdrop (outside the wrapper), which
    // would otherwise close the menu the instant it opened.
    suppressClickRef.current = true;
    const swallow = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      suppressClickRef.current = false;
    };
    document.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => {
      document.removeEventListener("click", swallow, true);
      suppressClickRef.current = false;
    }, 500);

    openMenu(press.x, press.y, api, column, node);
  }, [cancelPress, gridRef, openMenu]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      cancelPress();
      pressRef.current = {
        x: event.clientX,
        y: event.clientY,
        target: event.target as HTMLElement,
      };
      pressTimerRef.current = setTimeout(fireLongPress, LONG_PRESS_MS);
    },
    [cancelPress, fireLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const press = pressRef.current;
      if (!press) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) cancelPress();
    },
    [cancelPress],
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  // ---- Filter application -------------------------------------------------

  const applyColumnModel = useCallback(
    (colId: string, model: Record<string, unknown> | null) => {
      const api = apiOf(gridRef.current);
      if (!api) return;
      const current = { ...(api.getFilterModel() ?? {}) };
      if (model) current[colId] = model;
      else delete current[colId];
      api.setFilterModel(Object.keys(current).length ? current : null);
    },
    [gridRef],
  );

  // The handlers below close over `menuState` — they are only referenced from
  // the menu JSX, which is rebuilt every render, so their identity is free to
  // change.
  const handleFilterAction = useCallback(
    (exclude: boolean) => {
      if (!menuState) return;
      if (menuState.values && menuState.values.length > 1) {
        setStage(exclude ? "pickExclude" : "pickMatch");
        return;
      }
      const model =
        menuState.values && menuState.values.length === 1
          ? buildContainsModel(menuState.values[0].filter, exclude)
          : (exclude ? buildExcludeModel : buildMatchModel)(
              menuState.ctx.filterKind,
              menuState.ctx.filterValue,
            );
      if (model) applyColumnModel(menuState.ctx.colId, model);
      closeMenu();
    },
    [menuState, applyColumnModel, closeMenu],
  );

  const handlePickValue = useCallback(
    (value: string | null, exclude: boolean) => {
      if (!menuState) return;
      const model =
        value === null
          ? // "Entire cell" — match the joined text the filter engine sees.
            (exclude ? buildExcludeModel : buildMatchModel)("text", menuState.ctx.filterValue)
          : buildContainsModel(value, exclude);
      if (model) applyColumnModel(menuState.ctx.colId, model);
      closeMenu();
    },
    [menuState, applyColumnModel, closeMenu],
  );

  const handleCopy = useCallback(() => {
    if (menuState) {
      void copyText(menuState.ctx.displayValue).then((ok) => ok && setCopied(true));
    }
    closeMenu();
  }, [menuState, closeMenu]);

  const handleClearColumnFilter = useCallback(() => {
    if (menuState) applyColumnModel(menuState.ctx.colId, null);
    closeMenu();
  }, [menuState, applyColumnModel, closeMenu]);

  // ---- Render -------------------------------------------------------------

  const showFilterItems =
    (options.enableFilterItems ?? true) &&
    menuState !== null &&
    menuState.ctx.filterKind !== "none";
  const extra = menuState ? options.extraItems?.(menuState.ctx, closeMenu) : null;
  const pickExclude = stage === "pickExclude";

  const menu = (
    <>
      <Menu
        open={menuState !== null}
        onClose={closeMenu}
        anchorReference="anchorPosition"
        anchorPosition={menuState ? { top: menuState.y, left: menuState.x } : undefined}
      >
        {stage === "root" && extra}
        {stage === "root" && extra != null && <Divider />}
        {stage === "root" && showFilterItems && (
          <MenuItem onClick={() => handleFilterAction(false)}>
            <ListItemIcon>
              <MaterialSymbol icon="filter_alt" size={20} />
            </ListItemIcon>
            <ListItemText>{t("grid.showMatching")}</ListItemText>
          </MenuItem>
        )}
        {stage === "root" && showFilterItems && (
          <MenuItem onClick={() => handleFilterAction(true)}>
            <ListItemIcon>
              <MaterialSymbol icon="block" size={20} />
            </ListItemIcon>
            <ListItemText>{t("grid.filterOut")}</ListItemText>
          </MenuItem>
        )}
        {stage === "root" && (
          <MenuItem onClick={handleCopy} disabled={!menuState || menuState.ctx.displayValue === ""}>
            <ListItemIcon>
              <MaterialSymbol icon="content_copy" size={20} />
            </ListItemIcon>
            <ListItemText>{t("grid.copyValue")}</ListItemText>
          </MenuItem>
        )}
        {stage === "root" && showFilterItems && menuState?.hasColumnFilter && (
          <MenuItem onClick={handleClearColumnFilter}>
            <ListItemIcon>
              <MaterialSymbol icon="filter_alt_off" size={20} />
            </ListItemIcon>
            <ListItemText>{t("grid.clearColumnFilter")}</ListItemText>
          </MenuItem>
        )}
        {stage !== "root" &&
          (menuState?.values ?? []).slice(0, MAX_SPLIT_VALUES).map((value) => (
            <MenuItem key={value.filter} onClick={() => handlePickValue(value.filter, pickExclude)}>
              <ListItemIcon>
                <MaterialSymbol icon={pickExclude ? "block" : "filter_alt"} size={20} />
              </ListItemIcon>
              <ListItemText>{value.label}</ListItemText>
            </MenuItem>
          ))}
        {stage !== "root" && <Divider />}
        {stage !== "root" && (
          <MenuItem onClick={() => handlePickValue(null, pickExclude)}>
            <ListItemIcon>
              <MaterialSymbol icon="select_all" size={20} />
            </ListItemIcon>
            <ListItemText>{t("grid.entireCell")}</ListItemText>
          </MenuItem>
        )}
      </Menu>
      <Snackbar
        open={copied}
        autoHideDuration={1500}
        // Ignore clickaway: iOS Safari fires spurious clickaways on scroll,
        // and the snackbar is purely informational anyway.
        onClose={(_event, reason) => {
          if (reason === "clickaway") return;
          setCopied(false);
        }}
        message={t("grid.copied")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </>
  );

  const gridProps = useMemo(
    () => ({
      onCellContextMenu: handleCellContextMenu,
      preventDefaultOnContextMenu: true,
    }),
    [handleCellContextMenu],
  );

  const containerProps = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      onClickCapture,
    }),
    [onPointerDown, onPointerMove, cancelPress, onClickCapture],
  );

  return { gridProps, containerProps, sx: cellContextMenuSx, menu };
}
