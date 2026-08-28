import { matchRoutes } from "react-router";

import { hasPermission } from "@/components/RequirePermission";

/**
 * The single source of truth for "which permission does this URL need?".
 *
 * Two consumers share it, which is why it lives here rather than inside either
 * of them:
 *   - `RouteGuard` (`components/RouteGuard.tsx`) wraps the authenticated route
 *     table, so typing a URL is gated exactly like clicking the nav item;
 *   - `SsoCallback` asks, before redirecting a freshly signed-in user to the
 *     page they originally asked for, whether they can actually open it.
 *
 * `AppLayout`'s nav definitions derive their permissions from here too, so the
 * menu and the router can never disagree about what a page needs.
 *
 * A path that is absent from this table is ungated — see
 * `INTENTIONALLY_UNGATED` below, and the parity test in
 * `routePermissions.test.ts` that stops a new route from being added without a
 * decision either way.
 */
export interface RoutePermission {
  /** react-router path pattern — must match the one in `App.tsx` exactly. */
  path: string;
  /** Permission key, or a list any one of which grants access. */
  permission: string | string[];
}

export const ROUTE_PERMISSIONS: RoutePermission[] = [
  // --- Inventory ----------------------------------------------------------
  // Per-card access (stakeholder roles, `GET /cards/{id}/effective-permissions`)
  // is enforced by the backend and by CardDetail itself; the route gate is the
  // app-level permission only.
  { path: "/inventory", permission: "inventory.view" },
  { path: "/cards/:id", permission: "inventory.view" },

  // --- Reports ------------------------------------------------------------
  { path: "/reports/portfolio", permission: "reports.portfolio" },
  { path: "/reports/flexible-portfolio", permission: "reports.portfolio" },
  { path: "/reports/capability-map", permission: "reports.ea_dashboard" },
  { path: "/reports/lifecycle", permission: "reports.ea_dashboard" },
  { path: "/reports/dependencies", permission: "reports.ea_dashboard" },
  // A report that is nothing but costs, so its subject permission is its only
  // gate — matching what the backend now checks.
  { path: "/reports/cost", permission: "costs.view" },
  { path: "/reports/matrix", permission: "reports.ea_dashboard" },
  { path: "/reports/data-quality", permission: "reports.ea_dashboard" },
  { path: "/reports/eol", permission: "reports.ea_dashboard" },
  // Deliberately NOT `saved_reports.create`: the seeded viewer role cannot
  // create saved reports but legitimately reads ones shared with it, and
  // `GET /saved-reports` requires only authentication.
  { path: "/reports/saved", permission: "reports.ea_dashboard" },

  // --- EA Delivery --------------------------------------------------------
  { path: "/ea-delivery", permission: "soaw.view" },
  { path: "/reports/ea-delivery", permission: "soaw.view" },
  { path: "/ea-delivery/soaw/new", permission: "soaw.manage" },
  { path: "/ea-delivery/soaw/:id/preview", permission: "soaw.view" },
  // The editor opens read-only for a viewer, so `soaw.view` is the right gate.
  { path: "/ea-delivery/soaw/:id", permission: "soaw.view" },
  { path: "/ea-delivery/adr/new", permission: "adr.manage" },
  { path: "/ea-delivery/adr/:id/preview", permission: "adr.view" },
  { path: "/ea-delivery/adr/:id", permission: "adr.view" },

  // --- Modules ------------------------------------------------------------
  // Permission gates the route; `ModuleGate` (inside the route element) gates
  // the render on the module's enabled flag. Outer check first: "you may not
  // see this at all" outranks "this is switched off".
  { path: "/bpm", permission: "bpm.view" },
  { path: "/bpm/processes/:id/flow", permission: "bpm.view" },
  { path: "/ppm", permission: "ppm.view" },
  { path: "/ppm/:id", permission: "ppm.view" },
  { path: "/grc", permission: "grc.view" },
  { path: "/grc/risks/:id", permission: "risks.view" },
  { path: "/turbolens", permission: "turbolens.view" },
  { path: "/turbolens/assessments/:id", permission: "turbolens.view" },

  // --- Diagrams -----------------------------------------------------------
  { path: "/diagrams", permission: "diagrams.view" },
  { path: "/diagrams/:id", permission: "diagrams.view" },
  { path: "/diagrams/:id/edit", permission: "diagrams.manage" },

  // --- Surveys ------------------------------------------------------------
  { path: "/surveys/:surveyId/respond/:cardId", permission: "surveys.respond" },

  // --- Reference catalogues -----------------------------------------------
  { path: "/capability-catalogue", permission: "inventory.view" },
  { path: "/process-catalogue", permission: "inventory.view" },
  { path: "/value-stream-catalogue", permission: "inventory.view" },
  // `GET /principles-catalogue` requires `admin.metamodel` server-side.
  { path: "/principles-catalogue", permission: "admin.metamodel" },

  // --- Admin --------------------------------------------------------------
  { path: "/admin/metamodel", permission: "admin.metamodel" },
  { path: "/admin/users", permission: "admin.users" },
  { path: "/admin/settings", permission: "admin.settings" },
  { path: "/admin/eol", permission: "eol.manage" },
  { path: "/admin/web-portals", permission: "web_portals.manage" },
  { path: "/admin/servicenow", permission: "servicenow.manage" },
  { path: "/admin/extensions", permission: "admin.manage_extensions" },
  { path: "/admin/surveys", permission: "surveys.manage" },
  { path: "/admin/surveys/new", permission: "surveys.manage" },
  { path: "/admin/surveys/:id/results", permission: "surveys.manage" },
  { path: "/admin/surveys/:id", permission: "surveys.manage" },
  { path: "/admin/turbolens", permission: "turbolens.manage" },
];

/**
 * Routes that are ungated on purpose. Listed explicitly so the parity test can
 * tell "reviewed and left open" apart from "nobody looked at it".
 */
export const INTENTIONALLY_UNGATED: string[] = [
  // The universal fallback — for the catch-all, for RequirePermission's and
  // ModuleGate's Back buttons, and for the post-sign-in denial redirect.
  // Gating it would leave some users with no reachable page at all.
  "/",
  // Personal surfaces. `todos.py` has no permission checks by design.
  "/todos",
  "/surveys",
  // Pure <Navigate> redirects: the gate belongs at the destination, otherwise
  // Access denied renders at a URL the user never sees.
  "/ea-delivery/risks",
  "/ea-delivery/risks/:id",
  // `ExtensionRoutesOutlet` already applies RequirePermission per contributed
  // route when the manifest declares one. A table entry here would either
  // double-gate or break permission-less extension pages.
  "/ext/*",
  // The router's own not-found fallback.
  "*",
];

/** Route patterns wrapped in a `matchRoutes`-compatible shape, built once. */
const MATCHABLE = ROUTE_PERMISSIONS.map((r) => ({ path: r.path }));

/**
 * The permission a pathname requires, or `undefined` when it is ungated.
 *
 * Uses react-router's own matcher so specificity ranking is identical to
 * `<Routes>` — `/admin/surveys/:id/results` wins over `/admin/surveys/:id`
 * without the table having to be hand-ordered.
 */
export function permissionForPath(pathname: string): string | string[] | undefined {
  const matches = matchRoutes(MATCHABLE, pathname);
  if (!matches || matches.length === 0) return undefined;
  // matchRoutes ranks best-first for a flat route array.
  const matched = matches[matches.length - 1].route as { path?: string };
  return ROUTE_PERMISSIONS.find((r) => r.path === matched.path)?.permission;
}

/**
 * Can this user open this URL? Fail-closed: unknown permissions mean no.
 *
 * Deliberately consults permissions only, never module-enabled flags. Those
 * are async singletons that read `false` until they have loaded, so folding
 * them in here would bounce users off a page purely because a flag had not
 * arrived yet. Modules gate the render (`ModuleGate` shows a spinner, then a
 * friendly disabled card); permissions gate the redirect.
 */
export function canAccessPath(
  perms: Record<string, boolean> | undefined,
  pathname: string,
): boolean {
  const permission = permissionForPath(pathname);
  if (!permission) return true;
  return hasPermission(perms, permission);
}
