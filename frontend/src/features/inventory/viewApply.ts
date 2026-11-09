/**
 * Pure helpers that turn a saved inventory view (a `Bookmark`) back into the
 * page's state. Shared by the sidebar's Views list and the page's `?view=<id>`
 * deep link, so the two apply a view the same way.
 */
import { normalizeTreeLevel } from "@/components/grid/rowGrouping";
import { normalizeDataQualityFilter } from "@/lib/dataQualityBands";
import type { ActiveQuery, Bookmark } from "@/types";
import type { Filters } from "./InventoryFilterSidebar";

/** The grouping a view restores (views saved before a feature restore it off). */
export interface ViewGrouping {
  groupBy: string | null;
  groupTree: boolean;
  groupTreeLevel: number | null;
}

/** A view whose filters are a server-evaluated multi-hop query. The web UI
 *  never writes `query`, so its presence alone drives the read-only behaviour. */
export function isQueryView(bm: Bookmark): boolean {
  return bm.query != null;
}

/**
 * The sidebar filters a view restores, field by field with a default for each
 * (views saved before a facet existed carry none). Null when the view stores
 * no filters payload at all, which leaves the current filters alone. A query
 * view always restores its start type as the one selected type, whatever its
 * stored payload says, because the query is evaluated against that type.
 */
export function bookmarkFilters(bm: Bookmark): Filters | null {
  const f = bm.filters as Partial<Filters> | undefined;
  const startType = bm.query?.type;
  if (!f && !startType) return null;
  const src: Partial<Filters> = f ?? {};
  return {
    types: startType ? [startType] : src.types || [],
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
