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

/**
 * ArchiMate diagrams are gated per layer tab (`archimatediagrams.<tab>.<action>`,
 * mirroring `TAB_LAYERS` in backend `api/v1/diagrams.py`). A route that cannot
 * know which layers a diagram spans — the editor, the unscoped create dialog —
 * accepts the key on any layer; the backend then checks the diagram's own span.
 */
export const ARCHIMATE_MANAGE_ANY_LAYER = [
  "archimatediagrams.business.manage",
  "archimatediagrams.application.manage",
  "archimatediagrams.technology.manage",
];

/** The Architecture Studio diagram list: Settings admins, or a `view`/`manage` key on any layer.
 *  Also reused by the Diagrams page's own "ArchiMate" type filter -- same "can see some
 *  ArchiMate diagram" permission, so the filter option doesn't appear for someone it would
 *  always 403 for. */
export const ARCHIMATE_STUDIO_LIST = [
  "admin.settings",
  "archimatediagrams.business.view",
  "archimatediagrams.application.view",
  "archimatediagrams.technology.view",
  ...ARCHIMATE_MANAGE_ANY_LAYER,
];

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
  { path: "/reports/licensing", permission: "licenses.view" },
  { path: "/reports/matrix", permission: "reports.ea_dashboard" },
  { path: "/reports/data-quality", permission: "reports.ea_dashboard" },
  { path: "/reports/eol", permission: "reports.ea_dashboard" },
  // Deliberately NOT `saved_reports.create`: the seeded viewer role cannot
  // create saved reports but legitimately reads ones shared with it, and
  // `GET /saved-reports` requires only authentication.
  { path: "/reports/saved", permission: "reports.ea_dashboard" },

  // --- EA Delivery --------------------------------------------------------
  // The page lists SoAWs and decisions, each behind its own permission, so a
  // reader of either opens it and sees only that kind (`deliveryAccess`).
  { path: "/ea-delivery", permission: ["soaw.view", "adr.view"] },
  { path: "/reports/ea-delivery", permission: ["soaw.view", "adr.view"] },
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
  { path: "/value-chain", permission: "bpm.value_chain" },
  { path: "/value-chain/value-stream", permission: "bpm.value_chain" },
  { path: "/ppm", permission: "ppm.view" },
  { path: "/ppm/:id", permission: "ppm.view" },
  { path: "/ppm/:id/report", permission: "ppm.view" },
  { path: "/grc", permission: "grc.view" },
  { path: "/grc/risks/:id", permission: "risks.view" },
  { path: "/turbolens", permission: "turbolens.view" },
  { path: "/turbolens/assessments/:id", permission: "turbolens.view" },

  // --- Diagrams -----------------------------------------------------------
  { path: "/diagrams", permission: "diagrams.view" },
  { path: "/diagrams/:id", permission: "diagrams.view" },
  { path: "/diagrams/:id/edit", permission: "diagrams.manage" },
  // Scoped ArchiMate diagram-entry points (nav rework, Task 8): the Diagrams
  // page pre-filtered to one layer. A plain `view` key is enough to see the
  // list (the create dialog's own Save still needs `manage`, checked there).
  {
    path: "/business-architecture/diagram",
    permission: ["archimatediagrams.business.view", "archimatediagrams.business.manage"],
  },
  {
    path: "/application-architecture/diagram",
    permission: ["archimatediagrams.application.view", "archimatediagrams.application.manage"],
  },
  {
    path: "/technology-architecture/diagram",
    permission: ["archimatediagrams.technology.view", "archimatediagrams.technology.manage"],
  },
  // "Coming soon" placeholder (Data Flow; SWOT and What-if removed -- now
  // duplicated by an installed extension) — no data behind it yet, but kept
  // under the same gate as its Application & Data Architecture siblings
  // rather than left ungated, so the group does not show for a user who
  // cannot see Diagrams at all.
  { path: "/application-architecture/data-flow", permission: "diagrams.view" },
  { path: "/application-architecture/bo-relationship", permission: "boRelationship.view" },

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
  // Architecture Studio's diagram list: anyone who may view ArchiMate diagrams on some layer can
  // open it. The editor's Back returns to the page it was opened from (or to /diagrams).
  { path: "/admin/architectureStudio", permission: ARCHIMATE_STUDIO_LIST },
  // The editor itself (an existing diagram) has no read-only mode, so it needs
  // `manage` on some layer; the backend checks the diagram's own layer span
  // (`view` to load it, `manage` to save it).
  { path: "/admin/architectureStudio/:id", permission: ARCHIMATE_MANAGE_ANY_LAYER },
  // Pre-rebrand path, redirected to the one above — same permission since
  // nothing else about the gate changed, only the URL.
  { path: "/admin/archimate", permission: ARCHIMATE_STUDIO_LIST },
  { path: "/admin/archimate/:id", permission: ARCHIMATE_MANAGE_ANY_LAYER },
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


/**
 * The permission a pathname requires, or `undefined` when it is ungated.
 *
 * Uses react-router's own matcher so specificity ranking is identical to
 * `<Routes>` — `/admin/surveys/:id/results` wins over `/admin/surveys/:id`
 * without the table having to be hand-ordered.
 */
export function permissionForPath(pathname: string): string | string[] | undefined {
  // The table entries are route objects themselves, so the match hands back
  // the entry it matched; null when nothing does.
  const matches = matchRoutes(ROUTE_PERMISSIONS, pathname);
  if (!matches) return undefined;
  // matchRoutes ranks best-first for a flat route array.
  return matches[matches.length - 1].route.permission;
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
