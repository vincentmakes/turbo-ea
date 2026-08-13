/**
 * Keeps the cell context menu's "Show matching" and a page's sidebar filter
 * facets in sync ("mirroring"), so a menu-created filter is visible — and
 * clearable — in the filter panel, and lands consistently in saved views
 * that persist both the sidebar state and the column filter model.
 *
 * Wiring:
 *
 *   const facetSync = useFacetColumnSync(gridRef, { bindings, facetState: filters });
 *   const cellMenu = useCellContextMenu(gridRef, { ..., facetSync: facetSync.cellMenu });
 *
 * Semantics (see facetColumnSync.ts for the pure rules):
 *  - "Show matching" on a bound column sets the facet to exactly [value] AND
 *    writes the equals column filter (unless the binding is facet-only), and
 *    records the pair in a session-local mirror registry.
 *  - Any panel edit that makes the facet diverge from the mirrored value
 *    drops the mirrored column filter — the panel wins, and the grid never
 *    stays AND-narrowed by a stale equals filter. The prune only ever
 *    REMOVES column-model entries, so no facet↔model feedback loop can form.
 *  - Filters authored through the column header popup are recognized by
 *    deep-equality divergence and silently released from the registry —
 *    they are never destroyed and never write back into facets.
 *  - Pages with a programmatic model-apply path (Inventory's
 *    applyColumnFilters: toolbar Clear, sidebar Clear-all, saved-view apply)
 *    must call `resetRegistry()` there, so an apply can never be raced by
 *    the prune.
 *  - Provenance is session-local by design: after a reload, a persisted
 *    mirror behaves as an ordinary column filter (the persisted facet+model
 *    pair is consistent by construction; only the auto-prune right lapses).
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { GridApi } from "ag-grid-community";
import type { GridApiSource } from "./useColumnFreeze";
import type { CellMenuContext } from "./useCellContextMenu";
import { buildMatchModel } from "./cellContextMenu";
import {
  pruneAction,
  type CellMenuFacetSync,
  type FacetBinding,
  type MirrorEntry,
} from "./facetColumnSync";

export interface UseFacetColumnSyncOptions<TData> {
  /** colId → facet binding. Unlisted columns are untouched. */
  bindings: Record<string, FacetBinding<TData>>;
  /**
   * The page's facet state object (e.g. Inventory's `filters`). The prune
   * effect is keyed on its identity — pass the state value itself, not a
   * derived object.
   */
  facetState: unknown;
}

export interface FacetColumnSync<TData> {
  /** Pass as useCellContextMenu's `facetSync` option. */
  cellMenu: CellMenuFacetSync<TData>;
  /**
   * Forget all mirror provenance. Call from any programmatic model-apply
   * path (saved-view apply, Clear-filters) so the prune cannot race it.
   */
  resetRegistry: () => void;
}

function apiOf<TData>(source: GridApiSource<TData>): GridApi<TData> | null {
  if (!source) return null;
  return "api" in source ? ((source.api as GridApi<TData> | undefined) ?? null) : source;
}

export function useFacetColumnSync<TData = unknown>(
  gridRef: RefObject<GridApiSource<TData>>,
  options: UseFacetColumnSyncOptions<TData>,
): FacetColumnSync<TData> {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const registryRef = useRef(new Map<string, MirrorEntry>());
  // The api the divergence listener is attached to — re-attached when the
  // grid remounts (e.g. the RTL locale-flip remount replaces the api).
  const listenedApiRef = useRef<GridApi<TData> | null>(null);

  // Popup-divergence listener: a mirrored entry whose grid model no longer
  // deep-equals what the menu wrote (edited via the header filter popup,
  // replaced by a saved view, cleared by the toolbar) is released from the
  // registry. The facet is never touched here.
  const onGridFilterChanged = useCallback(() => {
    const api = listenedApiRef.current;
    if (!api || api.isDestroyed()) return;
    const model = (api.getFilterModel() ?? {}) as Record<string, unknown>;
    for (const [colId, entry] of registryRef.current) {
      if (entry.model === null) continue;
      if (pruneAction(entry, [entry.facetValue], model[colId]) === "unregister") {
        registryRef.current.delete(colId);
      }
    }
  }, []);

  const ensureListener = useCallback(
    (api: GridApi<TData>) => {
      if (listenedApiRef.current === api) return;
      if (listenedApiRef.current && !listenedApiRef.current.isDestroyed()) {
        listenedApiRef.current.removeEventListener("filterChanged", onGridFilterChanged);
      }
      listenedApiRef.current = api;
      api.addEventListener("filterChanged", onGridFilterChanged);
    },
    [onGridFilterChanged],
  );

  useEffect(
    () => () => {
      const api = listenedApiRef.current;
      if (api && !api.isDestroyed()) {
        api.removeEventListener("filterChanged", onGridFilterChanged);
      }
      listenedApiRef.current = null;
    },
    [onGridFilterChanged],
  );

  /** Remove one column's entry from the grid's filter model (merge-style). */
  const dropColumnModel = useCallback(
    (api: GridApi<TData>, colId: string) => {
      const current = { ...(api.getFilterModel() ?? {}) } as Record<string, unknown>;
      if (!(colId in current)) return;
      delete current[colId];
      api.setFilterModel(Object.keys(current).length ? current : null);
    },
    [],
  );

  // Prune on every facet-state change: panel edits win over mirrored column
  // filters. Registry deletions happen before any grid write, so the
  // filterChanged this triggers only sees the already-updated registry.
  useEffect(() => {
    const registry = registryRef.current;
    if (registry.size === 0) return;
    const api = apiOf(gridRef.current);
    const model = (api?.getFilterModel() ?? {}) as Record<string, unknown>;
    for (const [colId, entry] of [...registry]) {
      const binding = optionsRef.current.bindings[colId];
      if (!binding) {
        registry.delete(colId);
        continue;
      }
      const action = pruneAction(entry, binding.getValues(), model[colId]);
      if (action === "keep") continue;
      registry.delete(colId);
      if (action === "dropColumnModel" && api && !api.isDestroyed()) {
        dropColumnModel(api, colId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.facetState, gridRef, dropColumnModel]);

  const canMirror = useCallback((ctx: CellMenuContext<TData>): boolean => {
    const binding = optionsRef.current.bindings[ctx.colId];
    return !!binding && binding.toFacetValue(ctx) !== null;
  }, []);

  const showMatching = useCallback(
    (ctx: CellMenuContext<TData>): boolean => {
      const binding = optionsRef.current.bindings[ctx.colId];
      if (!binding) return false;
      const facetValue = binding.toFacetValue(ctx);
      if (facetValue === null) return false;

      const api = apiOf(gridRef.current);
      let model: Record<string, unknown> | null = null;
      if (binding.columnFilter !== false && api && !api.isDestroyed()) {
        model = buildMatchModel(ctx.filterKind, ctx.filterValue);
      }
      // Register BEFORE writing the model (the grid's filterChanged fires
      // synchronously and must find a matching entry), and set the facet
      // LAST (the prune effect then sees an exact match and keeps).
      registryRef.current.set(ctx.colId, { facetValue, model });
      if (model && api && !api.isDestroyed()) {
        ensureListener(api);
        api.setFilterModel({ ...(api.getFilterModel() ?? {}), [ctx.colId]: model });
      }
      binding.setValues([facetValue], ctx);
      return true;
    },
    [gridRef, ensureListener],
  );

  const clearColumn = useCallback(
    (ctx: CellMenuContext<TData>): boolean => {
      const binding = optionsRef.current.bindings[ctx.colId];
      if (!binding) return false;
      registryRef.current.delete(ctx.colId);
      const api = apiOf(gridRef.current);
      if (api && !api.isDestroyed()) dropColumnModel(api, ctx.colId);
      binding.setValues([], ctx);
      return true;
    },
    [gridRef, dropColumnModel],
  );

  const hasFacetFilter = useCallback((ctx: CellMenuContext<TData>): boolean => {
    const binding = optionsRef.current.bindings[ctx.colId];
    return !!binding && binding.getValues().length > 0;
  }, []);

  const isFacetOnly = useCallback((ctx: CellMenuContext<TData>): boolean => {
    return optionsRef.current.bindings[ctx.colId]?.columnFilter === false;
  }, []);

  const resetRegistry = useCallback(() => {
    registryRef.current.clear();
  }, []);

  const cellMenu = useMemo<CellMenuFacetSync<TData>>(
    () => ({ canMirror, showMatching, clearColumn, hasFacetFilter, isFacetOnly }),
    [canMirror, showMatching, clearColumn, hasFacetFilter, isFacetOnly],
  );

  return useMemo(() => ({ cellMenu, resetRegistry }), [cellMenu, resetRegistry]);
}
