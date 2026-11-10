/**
 * The Inventory views widget's config, read defensively, and the request it
 * makes. Mirrors `_inventory_views_problem` in
 * `backend/app/services/dashboard_service.py` and `INVENTORY_VIEWS_*` in
 * `dashboard_defaults.py`: a value the server would refuse is read as its
 * default here, so a hand-edited config still renders.
 *
 * The widget lists views by rule (whose views, query views only), never by
 * pinned ids: no id may sit in a widget config.
 */
import type { Bookmark } from "@/types";

export const INVENTORY_VIEWS_FILTERS = ["all", "my", "shared"] as const;
export type InventoryViewsFilter = (typeof INVENTORY_VIEWS_FILTERS)[number];

/** How many views the widget lists, in the order the API returns them. */
export const INVENTORY_VIEWS_MAX = 6;

export interface InventoryViewsConfig {
  filter: InventoryViewsFilter;
  queryOnly: boolean;
}

/** The catalogue default, as the backend's `INVENTORY_VIEWS_DEFAULT_CONFIG`. */
export const INVENTORY_VIEWS_DEFAULTS: InventoryViewsConfig = { filter: "all", queryOnly: false };

export function readInventoryViewsConfig(config: Record<string, unknown> | null | undefined): InventoryViewsConfig {
  const c = config ?? {};
  return {
    filter: INVENTORY_VIEWS_FILTERS.includes(c.filter as InventoryViewsFilter)
      ? (c.filter as InventoryViewsFilter)
      : INVENTORY_VIEWS_DEFAULTS.filter,
    queryOnly: c.query_only === true,
  };
}

/** The stored form of a config — the only two keys the backend accepts. */
export function inventoryViewsConfigOf(config: InventoryViewsConfig): Record<string, unknown> {
  return { filter: config.filter, query_only: config.queryOnly };
}

export function inventoryViewsPath(config: InventoryViewsConfig): string {
  return `/bookmarks?filter=${config.filter}`;
}

/** The views the widget shows: query views only when asked, at most `INVENTORY_VIEWS_MAX`. */
export function shownViews(views: Bookmark[], config: InventoryViewsConfig): Bookmark[] {
  const kept = config.queryOnly ? views.filter((bm) => bm.query != null) : views;
  return kept.slice(0, INVENTORY_VIEWS_MAX);
}
