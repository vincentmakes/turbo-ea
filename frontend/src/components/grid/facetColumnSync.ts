// Pure logic behind useFacetColumnSync.ts — the bridge that keeps the cell
// context menu's "Show matching" in sync with a page's sidebar filter facets.
//
// A facet is a multi-select SET (e.g. approvalStatuses: string[]) while a
// column filter is a single equals predicate — they are not isomorphic, so
// "mirroring" is deliberately narrow: a column-filter entry counts as
// mirrored only while (a) the menu created it on a bound column, (b) the
// grid's model for that colId still deep-equals what the menu wrote, and
// (c) the facet holds exactly that one value. The moment a panel edit breaks
// (c), the mirrored column filter is dropped so the panel takes over (OR
// semantics render correctly instead of being AND-narrowed by a stale
// equals filter). Breaking (b) first — the user edited the filter through
// the column header popup, or a saved view / Clear-filters replaced the
// model — silently forgets the provenance and touches neither side.
import type { CellMenuContext } from "./useCellContextMenu";

export interface FacetBinding<TData = unknown> {
  /**
   * Facet value for the clicked cell, or null to fall back to a plain
   * column filter (unmappable value, e.g. a blank cell on a facet without
   * an "(empty)" option).
   */
  toFacetValue: (ctx: CellMenuContext<TData>) => string | null;
  /** Current facet selection, normalized to string[] ([] = unset). */
  getValues: () => string[];
  /**
   * Replace the facet selection ([] clears it). May carry page side effects
   * (e.g. Inventory's type facet resets its dependent facets). `ctx` is the
   * cell the action came from — facets that store richer objects than the
   * facet value (Resources' card picker keeps `{id, name, type}`) build them
   * from the clicked row.
   */
  setValues: (values: string[], ctx: CellMenuContext<TData>) => void;
  /**
   * When false, Show matching sets the facet only and no column filter is
   * written (server-side grids like Resources; columns whose filter text is
   * locale-dependent). Default true.
   */
  columnFilter?: boolean;
}

/** Provenance of one menu-created ("mirrored") column filter. */
export interface MirrorEntry {
  facetValue: string;
  /** The column-filter model the menu wrote, or null when columnFilter:false. */
  model: Record<string, unknown> | null;
}

/**
 * The common `toFacetValue`: the cell's raw filter value as a string, or null
 * for a blank cell (facets without an "(empty)" option can't express it, so
 * the menu falls back to a plain blank column filter).
 */
export function nonBlankFacetValue(ctx: CellMenuContext<unknown>): string | null {
  const v = ctx.filterValue;
  return v === null || v === undefined || v === "" ? null : String(v);
}

/**
 * Binding over a plain `string[]` facet whose values are the column's raw
 * cell values — the common shape across the GRC and admin sidebars.
 */
export function arrayFacetBinding<TData>(opts: {
  get: () => string[];
  set: (values: string[], ctx: CellMenuContext<TData>) => void;
  /** Defaults to the raw cell value (`nonBlankFacetValue`). */
  toFacetValue?: (ctx: CellMenuContext<TData>) => string | null;
  columnFilter?: boolean;
}): FacetBinding<TData> {
  return {
    toFacetValue:
      opts.toFacetValue ?? ((ctx) => nonBlankFacetValue(ctx as CellMenuContext<unknown>)),
    getValues: opts.get,
    setValues: opts.set,
    columnFilter: opts.columnFilter,
  };
}

/** Deep equality for filter models — they are plain JSON data. */
export function modelsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec);
  const bKeys = Object.keys(bRec);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => modelsEqual(aRec[k], bRec[k]));
}

export type PruneAction = "keep" | "unregister" | "dropColumnModel";

/**
 * The slice of useFacetColumnSync that useCellContextMenu consumes — passed
 * as its `facetSync` option. Defined here (pure module) so the two hooks
 * only share a type-level dependency.
 */
export interface CellMenuFacetSync<TData = unknown> {
  /** The clicked column is bound and the cell maps to a facet value. */
  canMirror: (ctx: CellMenuContext<TData>) => boolean;
  /**
   * Show matching: set the facet to exactly [value], write the column model
   * (unless the binding is facet-only), register the mirror. False when the
   * column is unbound or the cell maps to no facet value — caller falls back
   * to the plain column filter.
   */
  showMatching: (ctx: CellMenuContext<TData>) => boolean;
  /**
   * Clear both facet and column model for the clicked column. False for
   * unbound columns — caller falls back to clearing the column model only.
   */
  clearColumn: (ctx: CellMenuContext<TData>) => boolean;
  /** The bound facet currently holds a selection (drives Clear visibility). */
  hasFacetFilter: (ctx: CellMenuContext<TData>) => boolean;
  /** The binding writes no column filter (drives the Clear item's label). */
  isFacetOnly: (ctx: CellMenuContext<TData>) => boolean;
}

/**
 * Decide what to do with one registry entry given the facet's current
 * selection and the grid's current model for that column.
 *
 * - "keep":            the facet still holds exactly [entry.facetValue] and
 *                      the mirrored model is untouched.
 * - "unregister":      the grid model no longer equals what the menu wrote
 *                      (popup-authored, saved-view apply, Clear filters) —
 *                      forget the provenance, touch neither side.
 * - "dropColumnModel": the facet diverged while the mirrored model is still
 *                      in place — remove that colId from the grid model (the
 *                      panel edit wins) and unregister.
 *
 * Removal-only on the grid side, so no facet↔model feedback loop can form.
 */
export function pruneAction(
  entry: MirrorEntry,
  facetValues: string[],
  gridModelForCol: unknown,
): PruneAction {
  if (entry.model !== null && !modelsEqual(gridModelForCol, entry.model)) {
    return "unregister";
  }
  if (facetValues.length === 1 && facetValues[0] === entry.facetValue) {
    return "keep";
  }
  // Facet diverged. With no mirrored model this degrades to bookkeeping.
  return entry.model === null ? "unregister" : "dropColumnModel";
}
