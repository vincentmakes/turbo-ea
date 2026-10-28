/**
 * Pure helpers for managing dashboards: their display name, who manages them,
 * reordering, and which roles the access picker treats specially.
 */
import { hasPermission } from "@/components/RequirePermission";
import type { Dashboard } from "@/types";

/** The permission that lets a user customise and manage dashboards. */
export const MANAGE_DASHBOARDS = "admin.dashboards";

export function canManageDashboards(permissions: Record<string, boolean> | undefined): boolean {
  return hasPermission(permissions, MANAGE_DASHBOARDS);
}

/** The base language of an i18next language tag (`fr-CA` → `fr`). */
export function baseLocale(language: string | undefined): string {
  return (language || "en").split("-")[0].toLowerCase();
}

/** A dashboard's name in `locale`, falling back to its stored (English) name. */
export function dashboardLabel(dashboard: Pick<Dashboard, "name" | "translations">, locale: string): string {
  const translated = dashboard.translations?.[baseLocale(locale)];
  return translated && translated.trim() ? translated : dashboard.name;
}

export interface SortOrderPatch {
  id: string;
  sort_order: number;
}

/**
 * The two `sort_order` writes that move `dashboards[index]` one step left
 * (`-1`) or right (`+1`) past its neighbour, or `[]` at either end. Two
 * dashboards can share an order (ties sort by name), so a tie is broken by
 * giving the one that should come second the next number.
 */
export function swapSortOrders(
  dashboards: Pick<Dashboard, "id" | "sort_order">[],
  index: number,
  direction: -1 | 1,
): SortOrderPatch[] {
  const other = index + direction;
  if (index < 0 || index >= dashboards.length || other < 0 || other >= dashboards.length) return [];
  const moving = dashboards[index];
  const neighbour = dashboards[other];
  if (moving.sort_order !== neighbour.sort_order) {
    return [
      { id: moving.id, sort_order: neighbour.sort_order },
      { id: neighbour.id, sort_order: moving.sort_order },
    ];
  }
  const base = moving.sort_order;
  return direction === -1
    ? [
        { id: moving.id, sort_order: base },
        { id: neighbour.id, sort_order: base + 1 },
      ]
    : [
        { id: moving.id, sort_order: base + 1 },
        { id: neighbour.id, sort_order: base },
      ];
}

export interface RoleLike {
  key: string;
  permissions?: Record<string, boolean>;
}

/**
 * A role that sees every dashboard whatever its access list says. Non-admin
 * callers of `GET /roles` get no permission matrix, so the built-in `admin`
 * key is recognised by name as well.
 */
export function isWildcardRole(role: RoleLike): boolean {
  return role.key === "admin" || !!role.permissions?.["*"];
}
