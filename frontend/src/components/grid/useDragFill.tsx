/**
 * Excel-style drag-fill for any AG Grid with editable cells.
 *
 * Focus a fillable cell and a small square appears at its trailing bottom
 * corner; drag it up or down and the range it covers is outlined; release and
 * a confirmation names the column, the value and the row count before anything
 * is written.
 *
 * AG Grid ships this as `enableFillHandle`, but that lives in the Range
 * Selection module — Enterprise. This app is on Community, so the affordance
 * is re-implemented here, exactly as `useColumnFreeze` re-implements column
 * pinning. Vertical, single-column fill only (see UI_GUIDELINES §3.6).
 *
 * Wiring (same shape as useColumnFreeze / useCellContextMenu):
 *
 *   const dragFill = useDragFill(gridRef, {
 *     containerRef: columnFreeze.containerRef,
 *     enabled: () => gridEditMode,
 *     onFill: handleGridFill,
 *   });
 *   <Box ref={columnFreeze.containerRef} sx={{ ...pageSx, ...dragFill.sx }}>
 *     <AgGridReact … {...dragFill.gridProps} />
 *     {dragFill.overlay}
 *   </Box>
 *   {dragFill.dialog}
 *
 * ── Three rules this module exists to hold ────────────────────────────────
 *
 * 1. **One wrapper ref, minted by `useColumnFreeze`.** This hook borrows it and
 *    adds NO wrapper-level handlers of its own; every pointer handler lives on
 *    the handle element it renders. That is what keeps it clear of
 *    `useCellContextMenu`, which owns the wrapper's React pointer props — by
 *    construction rather than by careful ordering. The handle's own
 *    `pointerdown` additionally `stopPropagation()`s, so the cell menu's
 *    600 ms long-press timer never even arms.
 *
 * 2. **`gridProps` carries `onCellFocused` and nothing else.** `useRowGrouping`
 *    already returns `onModelUpdated`, and a page spreads both — a second hook
 *    claiming the same key would silently win and break grouping. Everything
 *    else this hook needs is subscribed through `api.addEventListener`, which
 *    is additive.
 *
 * 3. **Position is written to `.style`, never to React state.** Repositioning
 *    happens on every scroll frame of a possibly 10 000-row grid; routing that
 *    through a setState would re-render the whole page per frame.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import type { CellFocusedEvent, ColDef, GridApi, IRowNode } from "ag-grid-community";
import Box from "@mui/material/Box";
import { useTranslation } from "react-i18next";
import { useIsRtl } from "@/hooks/useIsRtl";
import DragFillConfirmDialog, {
  type FillFailure,
  type FillOutcome,
} from "./DragFillConfirmDialog";
import { apiOf, type GridApiSource } from "./useColumnFreeze";
import {
  AUTOSCROLL_EDGE_PX,
  FILL_HANDLE_CLASS,
  FILL_MARQUEE_CLASS,
  FILL_PREVIEW_CLASS,
  autoScrollStep,
  cloneFillValue,
  fillRowIndices,
  findCellElement,
  isCellEditableAt,
  rowIndexAtPoint,
} from "./dragFill";

export type { FillFailure, FillOutcome };

/** Side of the handle square, in px, on a fine pointer. */
const HANDLE_PX = 10;
/** Most rows one gesture may cover, so a runaway drag can't queue thousands of writes. */
const DEFAULT_MAX_ROWS = 500;

/** One row a fill will write. */
export interface FillTarget<TData> {
  /** `getRowId` output where the grid has one, else a synthetic `row:<index>`. */
  rowId: string;
  data: TData;
}

export interface FillRequest<TData> {
  colId: string;
  /** `colDef.field` — what a page's persist primitive branches on. */
  field: string | undefined;
  /** Raw anchor value, already deep-cloned. */
  value: unknown;
  /** WYSIWYG anchor text (formatter applied) — the dialog's value preview. */
  displayValue: string;
  /** Header text — the dialog's column name. */
  columnLabel: string;
  source: FillTarget<TData>;
  targets: FillTarget<TData>[];
}

export interface UseDragFillOptions<TData> {
  /** The wrapper element. Pass `columnFreeze.containerRef` — never mint a second. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Master switch. Inventory: `() => gridEditMode`. */
  enabled?: () => boolean;
  /** Skip these rows as anchor and as target. Pass the page's group-row test. */
  suppressForRow?: (data: TData) => boolean;
  /** Page veto layered on top of AG Grid's own `editable`. */
  isFillable?: (colId: string, colDef: ColDef<TData>) => boolean;
  /**
   * Perform the writes. Called only after the user confirms, and must resolve
   * with a per-row outcome rather than throwing — the dialog renders whatever
   * it gets back. `onProgress` drives the determinate bar.
   */
  onFill: (
    request: FillRequest<TData>,
    onProgress: (done: number, total: number) => void,
  ) => Promise<FillOutcome>;
  /** Cap on rows per gesture. Default 500. */
  maxRows?: number;
}

export interface DragFill {
  /** Spread onto `<AgGridReact>`. */
  gridProps: { onCellFocused: (event: CellFocusedEvent) => void };
  /** Spread into the wrapper's `sx` alongside the page's own. */
  sx: Record<string, unknown>;
  /** Render inside the wrapper, after `<AgGridReact>`. */
  overlay: ReactElement;
  /** Render once, after the wrapper. */
  dialog: ReactElement;
}

/** The cell the handle currently hangs off. Identity, never a bare index. */
interface Anchor {
  rowId: string;
  colId: string;
}

interface DragState {
  pointerId: number;
  anchorIndex: number;
  colId: string;
  toIndex: number;
  /** Last pointer position, so an auto-scroll frame can re-resolve the row. */
  clientX: number;
  clientY: number;
}

/** What the dialog is currently working with; null when it is closed. */
interface PendingFill<TData> {
  request: FillRequest<TData>;
}

const dragFillSx: Record<string, unknown> = {
  // The overlay positions against this. `useRowGrouping` sets the same value
  // for its sticky bar; identical key, identical value, so spread order is
  // irrelevant. Declared here so a grid without grouping still works.
  position: "relative",
  [`& .${FILL_PREVIEW_CLASS}`]: {
    backgroundColor: "action.selected",
  },
};

export function useDragFill<TData = unknown>(
  gridRef: RefObject<GridApiSource<TData>>,
  options: UseDragFillOptions<TData>,
): DragFill {
  const { t } = useTranslation("common");
  const isRtl = useIsRtl();

  // Read options through a ref inside the stable callbacks so they never go
  // stale; the JSX below uses `options` from the current render directly.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const handleRef = useRef<HTMLDivElement | null>(null);
  const marqueeRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef(0);
  const scrollRafRef = useRef(0);
  const apiRef = useRef<GridApi<TData> | null>(null);
  const editingRef = useRef(false);

  const [pending, setPending] = useState<PendingFill<TData> | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<FillOutcome | null>(null);

  // ---- Geometry ----------------------------------------------------------

  const viewportOf = useCallback((): HTMLElement | null => {
    return optionsRef.current.containerRef.current?.querySelector(".ag-body-viewport") ?? null;
  }, []);

  /** The anchor's current display index, or -1 when it no longer resolves. */
  const anchorIndexOf = useCallback((api: GridApi<TData>, anchor: Anchor): number => {
    const node = api.getRowNode?.(anchor.rowId);
    if (node && typeof node.rowIndex === "number") return node.rowIndex;
    // Grids without getRowId fall back to the synthetic `row:<index>` form.
    const synthetic = anchor.rowId.startsWith("row:") ? Number(anchor.rowId.slice(4)) : NaN;
    return Number.isInteger(synthetic) ? synthetic : -1;
  }, []);

  const rowIdOf = useCallback((node: IRowNode<TData> | null, index: number): string => {
    return node?.id ?? `row:${index}`;
  }, []);

  /** Whether the anchor cell is fillable right now. */
  const anchorIsFillable = useCallback(
    (api: GridApi<TData>, anchor: Anchor, index: number): boolean => {
      const opts = optionsRef.current;
      if (opts.enabled?.() === false) return false;
      if (editingRef.current) return false;
      const node = api.getDisplayedRowAtIndex?.(index);
      if (!node?.data) return false;
      if (opts.suppressForRow?.(node.data)) return false;
      const colDef = api.getColumn?.(anchor.colId)?.getColDef?.() as ColDef<TData> | undefined;
      if (!colDef) return false;
      if (opts.isFillable?.(anchor.colId, colDef) === false) return false;
      return isCellEditableAt(api, anchor.colId, node);
    },
    [],
  );

  /**
   * Write the handle's position straight to the DOM. Called from scroll and
   * resize, so it must not touch React state.
   */
  const reposition = useCallback(() => {
    rafRef.current = 0;
    const handle = handleRef.current;
    const container = optionsRef.current.containerRef.current;
    const api = apiRef.current;
    const anchor = anchorRef.current;
    if (!handle) return;

    const hide = () => {
      handle.style.display = "none";
    };
    if (!container || !api || !anchor) return hide();

    const index = anchorIndexOf(api, anchor);
    if (index < 0 || !anchorIsFillable(api, anchor, index)) return hide();

    const cell = findCellElement(container, index, anchor.colId);
    if (!cell) return hide();

    const viewport = viewportOf();
    const cellRect = cell.getBoundingClientRect();
    // A cell scrolled out of the body viewport must not leave the handle
    // floating over the header or the horizontal scrollbar.
    if (viewport) {
      const vp = viewport.getBoundingClientRect();
      if (cellRect.bottom < vp.top || cellRect.top > vp.bottom) return hide();
    }

    const box = container.getBoundingClientRect();
    // Measured rects are already mirrored by AG Grid's own `enableRtl`, so the
    // trailing corner is a plain left/right pick — a logical inset here would
    // mirror a second time. (§3.11 records the same trap for drag handles.)
    const x = isRtl ? cellRect.left - box.left : cellRect.right - box.left;
    handle.style.display = "block";
    handle.style.left = `${x - HANDLE_PX / 2}px`;
    handle.style.top = `${cellRect.bottom - box.top - HANDLE_PX / 2}px`;
  }, [anchorIndexOf, anchorIsFillable, isRtl, viewportOf]);

  const scheduleReposition = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(reposition);
  }, [reposition]);

  // ---- Preview -----------------------------------------------------------

  const clearPreview = useCallback(() => {
    const container = optionsRef.current.containerRef.current;
    container
      ?.querySelectorAll(`.${FILL_PREVIEW_CLASS}`)
      .forEach((el) => el.classList.remove(FILL_PREVIEW_CLASS));
    const marquee = marqueeRef.current;
    if (marquee) marquee.style.display = "none";
  }, []);

  /**
   * Tint the covered cells and stretch the marquee over the range.
   *
   * The marquee is the primary signal, not the tint: a 400-row fill spans rows
   * that were never rendered, and a class can only reach the ones that were.
   */
  const paintPreview = useCallback(
    (anchorIndex: number, indices: number[], colId: string) => {
      const container = optionsRef.current.containerRef.current;
      const marquee = marqueeRef.current;
      if (!container) return;

      container
        .querySelectorAll(`.${FILL_PREVIEW_CLASS}`)
        .forEach((el) => el.classList.remove(FILL_PREVIEW_CLASS));

      const suppress = optionsRef.current.suppressForRow;
      const api = apiRef.current;
      for (const index of indices) {
        // A group header inside the span is skipped visually as well as in the
        // write, so the outline and the confirmed count tell the same story.
        const data = api?.getDisplayedRowAtIndex?.(index)?.data;
        if (data && suppress?.(data)) continue;
        findCellElement(container, index, colId)?.classList.add(FILL_PREVIEW_CLASS);
      }

      if (!marquee) return;
      const anchorCell = findCellElement(container, anchorIndex, colId);
      if (!anchorCell || indices.length === 0) {
        marquee.style.display = "none";
        return;
      }
      const box = container.getBoundingClientRect();
      const anchorRect = anchorCell.getBoundingClientRect();
      // Rows off the rendered window have no rect; fall back to the furthest
      // one that does, so the outline still shows the direction and reach.
      let top = anchorRect.top;
      let bottom = anchorRect.bottom;
      for (const index of indices) {
        const rect = findCellElement(container, index, colId)?.getBoundingClientRect();
        if (!rect) continue;
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
      }
      const viewport = viewportOf()?.getBoundingClientRect();
      if (viewport) {
        top = Math.max(top, viewport.top);
        bottom = Math.min(bottom, viewport.bottom);
      }
      marquee.style.display = bottom > top ? "block" : "none";
      marquee.style.left = `${anchorRect.left - box.left}px`;
      marquee.style.width = `${anchorRect.width}px`;
      marquee.style.top = `${top - box.top}px`;
      marquee.style.height = `${bottom - top}px`;
    },
    [viewportOf],
  );

  // ---- Auto-scroll -------------------------------------------------------

  const stopAutoScroll = useCallback(() => {
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    }
  }, []);

  const applyDragPoint = useCallback(
    (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      const api = apiRef.current;
      if (!drag || !api) return;
      drag.clientX = clientX;
      drag.clientY = clientY;

      const hit = rowIndexAtPoint(clientX, clientY);
      // A null hit means the pointer is over the header, the scrollbar or off
      // the grid entirely — hold the last row rather than collapsing the range.
      if (hit !== null) {
        const maxRows = optionsRef.current.maxRows ?? DEFAULT_MAX_ROWS;
        const delta = hit - drag.anchorIndex;
        const capped = Math.sign(delta) * Math.min(Math.abs(delta), maxRows);
        drag.toIndex = drag.anchorIndex + capped;
      }

      const rowCount = api.getDisplayedRowCount?.() ?? 0;
      const indices = fillRowIndices(drag.anchorIndex, drag.toIndex, rowCount);
      paintPreview(drag.anchorIndex, indices, drag.colId);
      setDragCount(countTargets(api, indices, optionsRef.current.suppressForRow));
    },
    [paintPreview],
  );

  const [dragCount, setDragCount] = useState(0);

  const autoScrollTick = useCallback(() => {
    scrollRafRef.current = 0;
    const drag = dragRef.current;
    const viewport = viewportOf();
    if (!drag || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const step = autoScrollStep(drag.clientY, rect.top, rect.bottom, AUTOSCROLL_EDGE_PX);
    if (step !== 0) {
      viewport.scrollTop += step;
      // Re-resolve at the unchanged pointer position: the rows moved, the
      // finger did not.
      applyDragPoint(drag.clientX, drag.clientY);
    }
    scrollRafRef.current = requestAnimationFrame(autoScrollTick);
  }, [applyDragPoint, viewportOf]);

  const startAutoScroll = useCallback(() => {
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(autoScrollTick);
  }, [autoScrollTick]);

  // ---- Drag lifecycle ----------------------------------------------------

  const endDrag = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current;
      dragRef.current = null;
      stopAutoScroll();
      clearPreview();
      setDragCount(0);
      const handle = handleRef.current;
      if (handle) {
        handle.style.pointerEvents = "";
        if (drag && handle.hasPointerCapture?.(drag.pointerId)) {
          handle.releasePointerCapture(drag.pointerId);
        }
      }
      if (!commit || !drag) return;

      const api = apiRef.current;
      const anchor = anchorRef.current;
      if (!api || !anchor) return;

      // Re-resolve the anchor: a background reload during the drag may have
      // replaced the row under it, in which case the gesture is void.
      const anchorIndex = anchorIndexOf(api, anchor);
      if (anchorIndex !== drag.anchorIndex) return;
      const sourceNode = api.getDisplayedRowAtIndex?.(anchorIndex);
      if (!sourceNode?.data) return;

      const rowCount = api.getDisplayedRowCount?.() ?? 0;
      const indices = fillRowIndices(anchorIndex, drag.toIndex, rowCount);
      const suppress = optionsRef.current.suppressForRow;
      const targets: FillTarget<TData>[] = [];
      for (const index of indices) {
        const node = api.getDisplayedRowAtIndex?.(index);
        if (!node?.data) continue;
        if (suppress?.(node.data)) continue;
        targets.push({ rowId: rowIdOf(node, index), data: node.data });
      }
      if (targets.length === 0) return;

      const column = api.getColumn?.(drag.colId);
      const colDef = column?.getColDef?.() as ColDef<TData> | undefined;
      // Read the value at RELEASE, not at pointerdown, so an edit made
      // mid-gesture is the one that gets filled.
      const raw = api.getCellValue?.({ rowNode: sourceNode, colKey: drag.colId });
      const displayValue = String(
        api.getCellValue?.({ rowNode: sourceNode, colKey: drag.colId, useFormatter: true }) ?? "",
      );

      setOutcome(null);
      setProgress(null);
      setPending({
        request: {
          colId: drag.colId,
          field: colDef?.field,
          value: cloneFillValue(raw),
          displayValue,
          columnLabel: column
            ? (api.getDisplayNameForColumn?.(column, null) ?? drag.colId)
            : drag.colId,
          source: { rowId: rowIdOf(sourceNode, anchorIndex), data: sourceNode.data },
          targets,
        },
      });
    },
    [anchorIndexOf, clearPreview, rowIdOf, stopAutoScroll],
  );

  const onHandlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const api = apiRef.current;
      const anchor = anchorRef.current;
      if (!api || !anchor) return;
      const anchorIndex = anchorIndexOf(api, anchor);
      if (anchorIndex < 0) return;

      // Stops the wrapper's own pointer handlers (useCellContextMenu's
      // long-press) from arming: it sets its suppress-click flag before
      // consulting `disabled()`, so bubbling here would swallow the next click.
      event.preventDefault();
      event.stopPropagation();

      const handle = event.currentTarget;
      handle.setPointerCapture?.(event.pointerId);
      // Load-bearing: with the captured handle still hit-testable,
      // elementFromPoint under the pointer returns the handle, never a row.
      handle.style.pointerEvents = "none";

      dragRef.current = {
        pointerId: event.pointerId,
        anchorIndex,
        colId: anchor.colId,
        toIndex: anchorIndex,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      startAutoScroll();
    },
    [anchorIndexOf, startAutoScroll],
  );

  const onHandlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      event.preventDefault();
      applyDragPoint(event.clientX, event.clientY);
    },
    [applyDragPoint],
  );

  const onHandlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      endDrag(true);
    },
    [endDrag],
  );

  const onHandlePointerCancel = useCallback(() => {
    if (dragRef.current) endDrag(false);
  }, [endDrag]);

  // ---- Keyboard path (§5 — the gesture must not be pointer-only) ----------

  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const api = apiRef.current;
      const anchor = anchorRef.current;
      if (!api || !anchor) return;
      const anchorIndex = anchorIndexOf(api, anchor);
      if (anchorIndex < 0) return;

      const drag = dragRef.current;
      const rowCount = api.getDisplayedRowCount?.() ?? 0;

      if (event.key === "Escape") {
        if (drag) {
          event.preventDefault();
          endDrag(false);
        }
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        const current = drag ?? {
          pointerId: -1,
          anchorIndex,
          colId: anchor.colId,
          toIndex: anchorIndex,
          clientX: 0,
          clientY: 0,
        };
        const maxRows = optionsRef.current.maxRows ?? DEFAULT_MAX_ROWS;
        const next = current.toIndex + step;
        const delta = next - anchorIndex;
        if (Math.abs(delta) > maxRows) return;
        current.toIndex = Math.min(Math.max(next, 0), Math.max(rowCount - 1, 0));
        dragRef.current = current;
        const indices = fillRowIndices(anchorIndex, current.toIndex, rowCount);
        paintPreview(anchorIndex, indices, current.colId);
        setDragCount(countTargets(api, indices, optionsRef.current.suppressForRow));
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        // Enter with no range yet just opens extend mode; with a range it
        // commits, so one key drives the whole interaction.
        if (drag && drag.toIndex !== anchorIndex) endDrag(true);
      }
    },
    [anchorIndexOf, endDrag, paintPreview],
  );

  // ---- Grid subscriptions -------------------------------------------------

  const onCellFocused = useCallback(
    (event: CellFocusedEvent) => {
      const api = (event.api as GridApi<TData> | undefined) ?? apiOf(gridRef.current);
      if (!api) return;
      apiRef.current = api;
      const colId =
        typeof event.column === "string" ? event.column : event.column?.getColId?.();
      if (colId === undefined || event.rowIndex === null || event.rowIndex === undefined) {
        anchorRef.current = null;
        scheduleReposition();
        return;
      }
      const node = api.getDisplayedRowAtIndex?.(event.rowIndex) ?? null;
      anchorRef.current = { rowId: rowIdOf(node, event.rowIndex), colId };
      scheduleReposition();
    },
    [gridRef, rowIdOf, scheduleReposition],
  );

  // A writing-direction flip remounts the grid and mints a new api, so the
  // anchor captured against the old one is meaningless.
  useEffect(() => {
    anchorRef.current = null;
    apiRef.current = null;
    if (dragRef.current) endDrag(false);
    scheduleReposition();
  }, [isRtl, endDrag, scheduleReposition]);

  // Subscribe through the api event bus rather than `gridProps`: a page may
  // already own `onModelUpdated` (useRowGrouping does), and a duplicate key in
  // a later spread would silently replace it. Mirrors the teardown guard
  // useRowGrouping uses for a grid destroyed before cleanup runs.
  useEffect(() => {
    let api = apiRef.current;
    if (!api) {
      api = apiOf(gridRef.current);
      if (api) apiRef.current = api;
    }
    if (!api?.addEventListener) return;

    const onEditStart = () => {
      editingRef.current = true;
      scheduleReposition();
    };
    const onEditStop = () => {
      editingRef.current = false;
      scheduleReposition();
    };
    // AG Grid types `addEventListener` against a closed union of event names,
    // so borrow that union rather than widening to `string`.
    type GridEventName = Parameters<GridApi<TData>["addEventListener"]>[0];
    const subscriptions: [GridEventName, () => void][] = [
      ["modelUpdated", scheduleReposition],
      ["bodyScroll", scheduleReposition],
      ["virtualColumnsChanged", scheduleReposition],
      ["columnResized", scheduleReposition],
      ["columnMoved", scheduleReposition],
      ["columnPinned", scheduleReposition],
      ["gridSizeChanged", scheduleReposition],
      ["cellEditingStarted", onEditStart],
      ["cellEditingStopped", onEditStop],
    ];
    for (const [event, handler] of subscriptions) api.addEventListener(event, handler);

    const onWindowResize = scheduleReposition;
    window.addEventListener("resize", onWindowResize);

    return () => {
      window.removeEventListener("resize", onWindowResize);
      try {
        for (const [event, handler] of subscriptions) api.removeEventListener?.(event, handler);
      } catch {
        // The grid was destroyed before cleanup ran (route change, RTL flip);
        // its listeners went with it.
      }
    };
  }, [gridRef, scheduleReposition, pending]);

  // The handle is bound to *cell focus*, so nothing can be positioned before
  // the user clicks a cell; this only covers a re-render flipping `enabled`.
  useEffect(() => {
    scheduleReposition();
  });

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
    },
    [],
  );

  // ---- Confirm / apply ---------------------------------------------------

  const closeDialog = useCallback(() => {
    setPending(null);
    setProgress(null);
    setOutcome(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    const total = pending.request.targets.length;
    setProgress({ done: 0, total });
    let result: FillOutcome;
    try {
      result = await optionsRef.current.onFill(pending.request, (done, tot) =>
        setProgress({ done, total: tot }),
      );
    } catch (err) {
      // `onFill` is contracted not to throw, but a page bug must not strand
      // the dialog on a frozen progress bar.
      result = {
        succeeded: 0,
        failures: pending.request.targets.map((target) => ({
          rowId: target.rowId,
          label: target.rowId,
          message: err instanceof Error ? err.message : String(err),
        })),
      };
    }
    setProgress(null);
    if (result.failures.length === 0) {
      closeDialog();
      return;
    }
    setOutcome(result);
  }, [pending, closeDialog]);

  // ---- Render -------------------------------------------------------------

  const overlay = (
    <>
      <Box
        ref={marqueeRef}
        className={FILL_MARQUEE_CLASS}
        aria-hidden
        sx={{
          position: "absolute",
          display: "none",
          pointerEvents: "none",
          border: "2px solid",
          borderColor: "primary.main",
          borderRadius: 0.5,
          bgcolor: "action.hover",
          zIndex: 1,
        }}
      />
      <Box
        ref={handleRef}
        className={FILL_HANDLE_CLASS}
        role="button"
        tabIndex={0}
        aria-label={t("grid.fill.handleLabel")}
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerCancel}
        onLostPointerCapture={onHandlePointerCancel}
        onKeyDown={onHandleKeyDown}
        sx={{
          position: "absolute",
          display: "none",
          width: `${HANDLE_PX}px`,
          height: `${HANDLE_PX}px`,
          bgcolor: "primary.main",
          border: "1px solid",
          borderColor: "background.paper",
          borderRadius: 0.25,
          cursor: "crosshair",
          zIndex: 2,
          // Without this the browser claims the gesture for scrolling and the
          // grid slides away under the finger.
          touchAction: "none",
          userSelect: "none",
          WebkitTouchCallout: "none",
          "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main" },
          // Grow the hit area without growing the dot, so a finger can find it
          // without the target blanketing the neighbouring cell.
          "&::before": {
            content: '""',
            position: "absolute",
            inset: "-3px",
          },
          "@media (hover: none), (pointer: coarse)": {
            width: `${HANDLE_PX + 4}px`,
            height: `${HANDLE_PX + 4}px`,
            "&::before": { inset: "-7px" },
          },
          "@media print": { display: "none !important" },
        }}
      >
        {dragCount > 0 && (
          <Box
            aria-hidden
            sx={{
              position: "absolute",
              insetInlineStart: "100%",
              top: "100%",
              ml: 0.5,
              mt: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              fontSize: 12,
              lineHeight: 1.4,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
          >
            {t("grid.fill.preview", { count: dragCount })}
          </Box>
        )}
      </Box>
    </>
  );

  const dialog = (
    <DragFillConfirmDialog
      open={pending !== null}
      columnLabel={pending?.request.columnLabel ?? ""}
      valueLabel={pending?.request.displayValue ?? ""}
      count={pending?.request.targets.length ?? 0}
      progress={progress}
      outcome={outcome}
      onConfirm={handleConfirm}
      onClose={closeDialog}
    />
  );

  const gridProps = useMemo(() => ({ onCellFocused }), [onCellFocused]);

  return { gridProps, sx: dragFillSx, overlay, dialog };
}

/** Rows in the range that will actually be written (group headers excluded). */
function countTargets<TData>(
  api: GridApi<TData>,
  indices: number[],
  suppressForRow?: (data: TData) => boolean,
): number {
  if (!suppressForRow) return indices.length;
  let count = 0;
  for (const index of indices) {
    const data = api.getDisplayedRowAtIndex?.(index)?.data;
    if (data && suppressForRow(data)) continue;
    count++;
  }
  return count;
}
