/**
 * Column ordering for every AG Grid in the app — the React half.
 *
 * The contract is deliberately parallel to `useColumnFreeze`: the page owns a
 * list of colIds as its own preference, hands it in, and runs its column defs
 * through the returned `applyOrder()`. AG Grid rebuilds its columns in
 * whatever order the `columnDefs` array arrives in, so order flows exactly the
 * way `pinned` does — no imperative grid call.
 *
 * Two things the caller must get right:
 *
 *  - **`applyOrder` is the single owner of order.** Never set
 *    `maintainColumnOrder` on a grid using this hook: it makes AG Grid ignore
 *    a new `columnDefs` order outright, which would make the preference
 *    invisible. If the page also persists a `getColumnState()` snapshot,
 *    restore it with `applyOrder: false` — that snapshot owns width and sort
 *    only, the same way it already stopped owning `hide` and `pinned`.
 *  - **Wire `syncFromGrid` to `onDragStopped`**, next to
 *    `columnFreeze.syncFrozenFromGrid`. That is what keeps a header drag and
 *    the sidebar's Columns tab agreeing, and what makes the drag survive a
 *    reload.
 *
 * The stored order is self-healing: `applyOrder` folds whatever columns are
 * currently present into it (`mergeOrder`) and publishes the result back
 * through `onOrderChange` from an effect. That is what lets the inventory's
 * attribute and relation columns — which only exist once the metamodel has
 * loaded, and change again on every card-type switch — take their place
 * without the page having to sequence anything.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { ColDef } from "ag-grid-community";
import {
  applyVisibleOrder,
  isFixedColumn,
  isInternalColId,
  isOrderableColumn,
  colIdOf,
  mergeOrder,
  sameOrder,
  sortColumnsByOrder,
} from "./columnOrder";
import { apiOf } from "./useColumnFreeze";
import type { GridApiSource } from "./useColumnFreeze";

export interface UseColumnOrderOptions {
  /**
   * Persisted colId order. May hold ids that are not currently on screen and
   * omit ones that are — `applyOrder` reconciles both.
   */
  order?: string[];
  /** Called with the reconciled order. Omit for a read-only grid. */
  onOrderChange?: (order: string[]) => void;
}

export interface ColumnOrder {
  /**
   * Stamps the stored order onto column defs. Call it **outermost** in the
   * page's `columnDefs` memo, wrapping `applyFrozen()`.
   */
  applyOrder: <T extends ColDef>(cols: T[]) => T[];
  /** The current full order — feeds the sidebar's `ColumnOrderSection`. */
  orderedIds: string[];
  /** Wire to `onDragStopped`: records a header drag into the preference. */
  syncFromGrid: () => void;
  /** Drop the preference, returning the grid to its natural colDef order. */
  resetOrder: () => void;
}

export function useColumnOrder<TData = unknown>(
  gridRef: RefObject<GridApiSource<TData>>,
  options: UseColumnOrderOptions = {},
): ColumnOrder {
  // Read through a ref so the callbacks stay stable — pages list this hook's
  // result in their `columnDefs` dependency array.
  const onOrderChangeRef = useRef(options.onOrderChange);
  onOrderChangeRef.current = options.onOrderChange;

  // Key on the *contents* of `order`, not the array identity: callers hold it
  // in state and hand us a fresh array on every render.
  const orderKey = JSON.stringify(options.order ?? []);
  const orderedIds = useMemo(() => JSON.parse(orderKey) as string[], [orderKey]);

  // Latest reconciled order. `applyOrder` fills this during render; the effect
  // below publishes it, and `syncFromGrid` starts from it so that ids for
  // columns which aren't currently present survive a header drag.
  const mergedRef = useRef<string[]>(orderedIds);
  // What we last handed to `onOrderChange`, so a publish can't loop.
  const publishedRef = useRef<string | null>(null);

  const applyOrder = useCallback(
    <T extends ColDef>(cols: T[]): T[] => {
      const natural = cols.filter(isOrderableColumn).map(colIdOf);
      const merged = mergeOrder(natural, JSON.parse(orderKey) as string[]);
      mergedRef.current = merged;
      return sortColumnsByOrder(cols, merged);
    },
    [orderKey],
  );

  // Publish the reconciliation. In an effect, never during render — and only
  // when it actually differs, so this converges in one extra render instead of
  // looping. `publishedRef` guards the window before the state round-trips.
  useEffect(() => {
    const merged = mergedRef.current;
    if (sameOrder(merged, orderedIds)) return;
    const key = JSON.stringify(merged);
    if (publishedRef.current === key) return;
    publishedRef.current = key;
    onOrderChangeRef.current?.(merged);
  });

  const syncFromGrid = useCallback(() => {
    const onOrderChange = onOrderChangeRef.current;
    const api = apiOf(gridRef.current);
    if (!api || !onOrderChange) return;

    // `getAllGridColumns()` is the grid's full logical order — hidden columns
    // included — so this reads back real positions, not just what is on screen.
    const gridIds: string[] = [];
    for (const column of api.getAllGridColumns() ?? []) {
      const id = column.getColId();
      if (!id || isInternalColId(id) || isFixedColumn(column.getColDef())) continue;
      gridIds.push(id);
    }
    if (gridIds.length === 0) return;

    // Fold the grid's sequence back into the stored order, so ids for columns
    // the grid doesn't currently carry at all (another card type's attributes)
    // keep their slots instead of being dropped.
    const base = mergedRef.current;
    const next = applyVisibleOrder(base, gridIds);
    // `onDragStopped` fires for *resizes* too — without this, every resize
    // drag would write the preference and rebuild the column defs.
    if (sameOrder(next, base)) return;

    mergedRef.current = next;
    publishedRef.current = JSON.stringify(next);
    onOrderChange(next);
  }, [gridRef]);

  const resetOrder = useCallback(() => {
    mergedRef.current = [];
    publishedRef.current = null;
    onOrderChangeRef.current?.([]);
  }, []);

  // Stable identity: pages list this in the dependency array around their
  // column defs, and a new object every render would rebuild — and re-hand to
  // AG Grid — the whole column set on each one.
  return useMemo(
    () => ({ applyOrder, orderedIds, syncFromGrid, resetOrder }),
    [applyOrder, orderedIds, syncFromGrid, resetOrder],
  );
}
