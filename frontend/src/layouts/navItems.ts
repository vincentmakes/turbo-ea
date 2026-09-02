/**
 * Nav menu definitions, extracted from `AppLayout` so the route-permission
 * parity test can read them without mounting the whole layout.
 *
 * Core entries that point at a route carry **no** `permission` — it is derived
 * from `ROUTE_PERMISSIONS` (`lib/routePermissions.ts`) instead, so the menu and
 * the router can never disagree about what a page needs. `permission` survives
 * on the type for the two cases that genuinely need their own: the pathless
 * Reports *group*, and nav entries contributed by installed UI extensions,
 * whose permission comes from the extension manifest.
 */
export interface NavItemDef {
  labelKey: string;
  icon: string;
  path?: string;
  children?: {
    labelKey: string;
    icon: string;
    path: string;
    permission?: string | string[];
  }[];
  permission?: string | string[];
}

export const NAV_ITEM_DEFS: NavItemDef[] = [
  { labelKey: "dashboard", icon: "dashboard", path: "/" },
  { labelKey: "inventory", icon: "inventory_2", path: "/inventory" },
  {
    labelKey: "reports",
    icon: "analytics",
    // The group itself has no route, so it keeps an explicit permission.
    permission: "reports.ea_dashboard",
    children: [
      { labelKey: "reports.portfolio", icon: "dashboard", path: "/reports/portfolio" },
      { labelKey: "reports.flexiblePortfolio", icon: "dashboard_customize", path: "/reports/flexible-portfolio" },
      { labelKey: "reports.capabilityMap", icon: "grid_view", path: "/reports/capability-map" },
      { labelKey: "reports.lifecycle", icon: "timeline", path: "/reports/lifecycle" },
      { labelKey: "reports.dependencies", icon: "hub", path: "/reports/dependencies" },
      { labelKey: "reports.cost", icon: "payments", path: "/reports/cost" },
      { labelKey: "reports.matrix", icon: "table_chart", path: "/reports/matrix" },
      { labelKey: "reports.dataQuality", icon: "verified", path: "/reports/data-quality" },
      { labelKey: "reports.endOfLife", icon: "update", path: "/reports/eol" },
      // EA Delivery lives inside /ppm as a tab when PPM is enabled. When PPM
      // is disabled the nav memo in AppLayout promotes EA Delivery to a
      // top-level nav item (in PPM's old slot) so the surface stays reachable.
      { labelKey: "reports.saved", icon: "bookmarks", path: "/reports/saved" },
    ],
  },
  { labelKey: "bpm", icon: "route", path: "/bpm" },
  { labelKey: "ppm", icon: "view_timeline", path: "/ppm" },
  { labelKey: "diagrams", icon: "schema", path: "/diagrams" },
  // `children` is filled only by extension routes requesting navGroup "grc";
  // with none installed this stays a plain top-level link.
  { labelKey: "grc", icon: "policy", path: "/grc", children: [] },
  { labelKey: "todos", icon: "checklist", path: "/todos" },
];

/**
 * The nav positions an extension route may name in its `navPlacement`.
 *
 * Deliberately the `labelKey`s above and nothing else: they are stable
 * identifiers core already owns, and an extension naming one is naming a
 * place in the bar rather than a place in an array that renumbers whenever a
 * module toggle changes what is on screen.
 */
export const NAV_ANCHORS = NAV_ITEM_DEFS.map((item) => item.labelKey);

export const DEFAULT_NAV_PLACEMENT = "end";

/**
 * Index at which a contributed nav entry should be inserted.
 *
 * The frontend mirror of `resolve_placement` in
 * `backend/app/services/extensions/field_contributions.py` — same grammar
 * (`start` / `end` / `before:<anchor>` / `after:<anchor>`), same
 * degrade-to-default rule, so an author who has placed a field section
 * already knows how to place a nav entry.
 *
 * An anchor that is not currently in the bar is NOT an error: `bpm`, `ppm`
 * and `grc` come and go with their module flags, so a placement that names
 * one is right on some instances and unresolvable on others. It degrades to
 * the default rather than being dropped — the entry still appears, just where
 * it would have appeared without the hint.
 *
 * `order` is the list of labelKeys as it stands at this moment, which is what
 * makes the module-flag case fall out for free.
 */
export function resolveNavPlacement(order: string[], placement?: string | null): number {
  const spec = (placement || DEFAULT_NAV_PLACEMENT).trim();
  for (const candidate of [spec, DEFAULT_NAV_PLACEMENT]) {
    if (candidate === "start") return 0;
    if (candidate === "end") return order.length;
    const at = candidate.indexOf(":");
    const prefix = at < 0 ? candidate : candidate.slice(0, at);
    const anchorKey = at < 0 ? "" : candidate.slice(at + 1);
    const index = order.indexOf(anchorKey);
    if (index >= 0) return index + (prefix === "after" ? 1 : 0);
  }
  return order.length;
}

export const ADMIN_ITEM_DEFS: NavItemDef[] = [
  { labelKey: "admin.metamodel", icon: "settings_suggest", path: "/admin/metamodel" },
  { labelKey: "admin.usersAndRoles", icon: "group", path: "/admin/users" },
  { labelKey: "admin.surveys", icon: "assignment", path: "/admin/surveys" },
  { labelKey: "admin.extensions", icon: "extension", path: "/admin/extensions" },
  { labelKey: "admin.settings", icon: "settings", path: "/admin/settings" },
];
