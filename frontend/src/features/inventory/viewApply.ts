/**
 * Pure helpers that turn a saved inventory view (a `Bookmark`) back into the
 * page's state. Shared by the sidebar's Views list and the page's `?view=<id>`
 * deep link, so the two apply a view the same way.
 */
import { normalizeTreeLevel } from "@/components/grid/rowGrouping";
import { normalizeDataQualityFilter } from "@/lib/dataQualityBands";
import type { ActiveQuery, Bookmark } from "@/types";
import type { Filters } from "./InventoryFilterSidebar";
import { pruneViaKeys, startTypes } from "./querySet";

/** The grouping a view restores (views saved before a feature restore it off). */
export interface ViewGrouping {
  groupBy: string | null;
  groupTree: boolean;
  groupTreeLevel: number | null;
}

/** A view whose filters are a server-evaluated multi-hop query. Its query is
 *  edited in the page's path strip (and by an MCP assistant); the sidebar's
 *  metadata dialog never sends it, so `query` alone marks a query view. */
export function isQueryView(bm: Bookmark): boolean {
  return bm.query != null;
}

/**
 * The sidebar filters a view restores, field by field with a default for each
 * (views saved before a facet existed carry none). Null when the view stores
 * no filters payload at all, which leaves the current filters alone. A query
 * view always restores its start types as the selected types, whatever its
 * stored payload says, because the query is evaluated against those types.
 */
export function bookmarkFilters(bm: Bookmark): Filters | null {
  const f = bm.filters as Partial<Filters> | undefined;
  const queryTypes = bm.query ? startTypes(bm.query) : [];
  if (!f && queryTypes.length === 0) return null;
  const src: Partial<Filters> = f ?? {};
  return {
    types: queryTypes.length > 0 ? queryTypes : src.types || [],
    search: src.search || "",
    subtypes: src.subtypes || [],
    lifecyclePhases: src.lifecyclePhases || [],
    // Views saved before bands existed carry a `dataQualityMin` threshold.
    dataQualityBands: normalizeDataQualityFilter(src),
    approvalStatuses: src.approvalStatuses || [],
    showArchived: src.showArchived || false,
    orphanedOnly: src.orphanedOnly || false,
    staleOnly: src.staleOnly || false,
    eolStatuses: src.eolStatuses || [],
    linkTypes: src.linkTypes || [],
    origins: src.origins || [],
    attributes: src.attributes || {},
    relations: src.relations || {},
    tagIds: src.tagIds || [],
    mineScope: src.mineScope ?? null,
  };
}

/** The grouping a view restores: axis, the parent-tree layer and its level. */
export function bookmarkGrouping(bm: Bookmark): ViewGrouping {
  const f = bm.filters as
    | { groupBy?: unknown; groupTree?: unknown; groupTreeLevel?: unknown }
    | undefined;
  return {
    groupBy: typeof f?.groupBy === "string" ? f.groupBy : null,
    groupTree: !!f?.groupTree,
    groupTreeLevel: normalizeTreeLevel(f?.groupTreeLevel),
  };
}

/**
 * Prefix of a matched-cards column in a view's stored `columns`: `via:<node
 * key>` (see `matchNodes`). These columns belong to the page, never to the
 * column picker's selection, so they are split out on every read of a view's
 * columns and added back only when a view is saved.
 */
export const VIA_COLUMN_PREFIX = "via:";

/** The grid colId (and stored column entry) of a matched-cards column. */
export function viaColumnId(key: string): string {
  return `${VIA_COLUMN_PREFIX}${key}`;
}

/** Is `colId` a matched-cards column? */
export function isViaColumnId(colId: string): boolean {
  return colId.startsWith(VIA_COLUMN_PREFIX);
}

/** A view's stored columns split into the picker's column keys and the matched-cards node keys. */
export function splitViewColumns(columns: readonly string[] | null | undefined): {
  columns: string[];
  via: string[];
} {
  const plain: string[] = [];
  const via: string[] = [];
  for (const c of columns ?? []) {
    if (typeof c !== "string") continue;
    if (isViaColumnId(c)) {
      const key = c.slice(VIA_COLUMN_PREFIX.length);
      if (key && !via.includes(key)) via.push(key);
    } else plain.push(c);
  }
  return { columns: plain, via };
}

/**
 * The matched-cards columns a view switches on: its `via:` entries whose
 * step its query still holds (a plain view has none).
 */
export function bookmarkViaColumns(bm: Bookmark): string[] {
  if (!bm.query) return [];
  const { via } = splitViewColumns(bm.columns);
  return pruneViaKeys(via, bm.query, bm.query);
}

/**
 * A view's (or the grid's) column filter model and column state with every
 * matched-cards entry (`via:<key>`) removed whose key is not in `keys`, the
 * steps switched on. A `via:` column means a step of one query: an entry for
 * a step that is off, or that a query edit dropped or re-typed, would hand
 * its filter, sort, width and freeze to whatever column takes that key next.
 * Plain columns are left alone; null / undefined stay as they are, and an
 * input with nothing to remove is returned as is.
 */
export function stripViaLayout<L extends { colId: string }>(
  filterModel: Record<string, unknown> | null | undefined,
  columnState: readonly L[] | null | undefined,
  keys: readonly string[],
): { filterModel: Record<string, unknown> | null | undefined; columnState: L[] | null | undefined } {
  const keep = new Set(keys.map(viaColumnId));
  const stale = (colId: string) => isViaColumnId(colId) && !keep.has(colId);
  let model = filterModel;
  if (filterModel && Object.keys(filterModel).some(stale)) {
    model = Object.fromEntries(Object.entries(filterModel).filter(([colId]) => !stale(colId)));
  }
  let state = columnState as L[] | null | undefined;
  if (columnState && columnState.some((c) => stale(c.colId))) {
    state = columnState.filter((c) => !stale(c.colId));
  }
  return { filterModel: model, columnState: state };
}

/** The colIds of `ids` that are not a stale matched-cards column (see `stripViaLayout`). */
export function stripViaIds(ids: readonly string[], keys: readonly string[]): string[] {
  const keep = new Set(keys.map(viaColumnId));
  return ids.filter((id) => !isViaColumnId(id) || keep.has(id));
}

/** The active query a view puts in force, or null for a plain view. */
export function activeQueryFromBookmark(bm: Bookmark): ActiveQuery | null {
  if (!bm.query) return null;
  return {
    viewId: bm.id,
    name: bm.name,
    query: bm.query,
    createdVia: bm.created_via ?? null,
  };
}

/**
 * A persisted active query checked against the views the user can read now:
 * null when its view is gone, unreadable or no longer a query view; a fresh
 * active query when the view was re-saved with another query or name; the
 * same object when nothing changed.
 */
export function refreshActiveQuery(aq: ActiveQuery, bookmarks: Bookmark[]): ActiveQuery | null {
  const bm = bookmarks.find((b) => b.id === aq.viewId);
  const fresh = bm ? activeQueryFromBookmark(bm) : null;
  if (!fresh) return null;
  const unchanged =
    fresh.name === aq.name && JSON.stringify(fresh.query) === JSON.stringify(aq.query);
  return unchanged ? aq : fresh;
}

/**
 * The filters with every facet cleared — the one definition the sidebar's
 * "Clear all" and the page's "New query view" (which clears the facets so the
 * grid shows exactly what the chain matches) share.
 */
export function emptyFilters(): Filters {
  return {
    types: [],
    search: "",
    subtypes: [],
    lifecyclePhases: [],
    dataQualityBands: [],
    approvalStatuses: [],
    showArchived: false,
    attributes: {},
    relations: {},
    tagIds: [],
    mineScope: null,
    orphanedOnly: false,
    staleOnly: false,
    eolStatuses: [],
    linkTypes: [],
    origins: [],
  };
}

/**
 * Whether any facet narrows the inventory, a selected card type included:
 * starting a new query view clears them all (after asking), and the start
 * type is always chosen in the path strip.
 */
export function hasActiveFacets(filters: Filters): boolean {
  return (
    filters.types.length > 0 ||
    filters.search !== "" ||
    filters.subtypes.length > 0 ||
    filters.lifecyclePhases.length > 0 ||
    filters.dataQualityBands.length > 0 ||
    filters.approvalStatuses.length > 0 ||
    filters.showArchived ||
    Object.keys(filters.attributes).length > 0 ||
    Object.keys(filters.relations || {}).length > 0 ||
    (filters.tagIds?.length ?? 0) > 0 ||
    filters.mineScope != null ||
    filters.orphanedOnly ||
    filters.staleOnly ||
    filters.eolStatuses.length > 0 ||
    (filters.linkTypes?.length ?? 0) > 0 ||
    (filters.origins?.length ?? 0) > 0
  );
}
