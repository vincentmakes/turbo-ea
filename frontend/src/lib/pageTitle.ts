import { matchRoutes } from "react-router";

/**
 * The single source of truth for "what does this URL call itself in the browser
 * tab?".
 *
 * Deliberately shaped like `ROUTE_PERMISSIONS` (`lib/routePermissions.ts`) and
 * resolved with the same `matchRoutes` trick, so the two tables read alike and a
 * route added to one is obviously missing from the other. The parity test in
 * `pageTitle.test.ts` reads `App.tsx` from disk and fails when a new route lands
 * in neither this table nor `UNTITLED_ROUTES`.
 *
 * The title is only ever the *static* half. A page that knows something better —
 * a card's name, a risk's reference, the tab the user is on — publishes it
 * through `usePageSubject` (`hooks/usePageTitle.ts`) and that wins; the key here
 * is what the tab says while the entity is still loading, which is why it must
 * never be a raw id.
 */
export interface RouteTitle {
  /** react-router path pattern — must match the one in `App.tsx` exactly. */
  path: string;
  /** Key in the `nav` i18n namespace. */
  titleKey: string;
}

export const ROUTE_TITLES: RouteTitle[] = [
  // --- Inventory ----------------------------------------------------------
  { path: "/inventory", titleKey: "inventory" },
  { path: "/cards/:id", titleKey: "pageTitles.card" },

  // --- Reports ------------------------------------------------------------
  { path: "/reports/portfolio", titleKey: "reports.portfolio" },
  { path: "/reports/flexible-portfolio", titleKey: "reports.flexiblePortfolio" },
  { path: "/reports/capability-map", titleKey: "reports.capabilityMap" },
  { path: "/reports/lifecycle", titleKey: "reports.lifecycle" },
  { path: "/reports/dependencies", titleKey: "reports.dependencies" },
  { path: "/reports/cost", titleKey: "reports.cost" },
  { path: "/reports/matrix", titleKey: "reports.matrix" },
  { path: "/reports/data-quality", titleKey: "reports.dataQuality" },
  { path: "/reports/eol", titleKey: "reports.endOfLife" },
  { path: "/reports/saved", titleKey: "reports.saved" },
  { path: "/reports/ea-delivery", titleKey: "reports.eaDelivery" },

  // --- EA Delivery --------------------------------------------------------
  { path: "/ea-delivery/soaw/new", titleKey: "pageTitles.soaw" },
  { path: "/ea-delivery/soaw/:id/preview", titleKey: "pageTitles.soaw" },
  { path: "/ea-delivery/soaw/:id", titleKey: "pageTitles.soaw" },
  { path: "/ea-delivery/adr/new", titleKey: "pageTitles.decision" },
  { path: "/ea-delivery/adr/:id/preview", titleKey: "pageTitles.decision" },
  { path: "/ea-delivery/adr/:id", titleKey: "pageTitles.decision" },

  // --- Modules ------------------------------------------------------------
  { path: "/bpm", titleKey: "bpm" },
  // `ProcessFlowEditorPage` is a shim that forwards the id to `BpmnModeler`;
  // neither loads the process card, so this route keeps the static label rather
  // than paying a `GET /cards/{id}` for a tab title.
  { path: "/bpm/processes/:id/flow", titleKey: "pageTitles.processFlow" },
  { path: "/ppm", titleKey: "ppm" },
  { path: "/ppm/:id", titleKey: "ppm" },
  { path: "/grc", titleKey: "grc" },
  { path: "/grc/risks/:id", titleKey: "pageTitles.risk" },
  { path: "/turbolens", titleKey: "turbolens" },
  { path: "/turbolens/assessments/:id", titleKey: "turbolens.assessments" },

  // --- Diagrams -----------------------------------------------------------
  { path: "/diagrams", titleKey: "diagrams" },
  { path: "/diagrams/:id", titleKey: "diagrams" },
  { path: "/diagrams/:id/edit", titleKey: "diagrams" },

  // --- Personal -----------------------------------------------------------
  { path: "/todos", titleKey: "todos" },
  { path: "/surveys/:surveyId/respond/:cardId", titleKey: "pageTitles.survey" },

  // --- Reference catalogues -----------------------------------------------
  { path: "/capability-catalogue", titleKey: "userMenu.capabilityCatalogue" },
  { path: "/process-catalogue", titleKey: "userMenu.processCatalogue" },
  { path: "/value-stream-catalogue", titleKey: "userMenu.valueStreamCatalogue" },
  { path: "/principles-catalogue", titleKey: "userMenu.principlesCatalogue" },

  // --- Admin --------------------------------------------------------------
  { path: "/admin/metamodel", titleKey: "admin.metamodel" },
  { path: "/admin/users", titleKey: "admin.usersAndRoles" },
  { path: "/admin/settings", titleKey: "admin.settings" },
  { path: "/admin/extensions", titleKey: "admin.extensions" },
  { path: "/admin/surveys", titleKey: "admin.surveys" },
  { path: "/admin/surveys/new", titleKey: "admin.surveys" },
  { path: "/admin/surveys/:id/results", titleKey: "admin.surveys" },
  { path: "/admin/surveys/:id", titleKey: "admin.surveys" },

  // --- Extensions ---------------------------------------------------------
  // A contributed page's own name is not knowable here; the extension's route
  // component publishes it when it has one.
  { path: "/ext/*", titleKey: "pageTitles.extension" },
];

/**
 * Routes that deliberately show the bare application title.
 *
 * Listed explicitly, exactly like `INTENTIONALLY_UNGATED`, so the parity test
 * can tell "reviewed and left bare" apart from "nobody looked at it".
 */
export const UNTITLED_ROUTES: string[] = [
  // The dashboard is the application's front page: «Dashboard | Turbo EA» says
  // nothing «Turbo EA» does not already say.
  "/",
  // Signed-out and account-less surfaces. A tab someone left open on the login
  // screen or a public portal stays anonymous, and no auth strings are needed.
  "/portal/:slug",
  "/auth/callback",
  "/auth/set-password",
  "/auth/forgot-password",
  "/auth/reset-password",
  // The published-diagram embed sets the diagram's own name (it always has it
  // by the time it renders anything), so a static label would only flash.
  "/embed/diagram/:slug",
  // Pure <Navigate> redirects: the title belongs at the destination, otherwise
  // the tab names a URL the user never sees.
  "/ea-delivery",
  "/ea-delivery/risks",
  "/ea-delivery/risks/:id",
  "/surveys",
  "/admin/eol",
  "/admin/web-portals",
  "/admin/servicenow",
  "/admin/turbolens",
  // The router's own not-found fallback.
  "*",
];

/** Route patterns wrapped in a `matchRoutes`-compatible shape, built once. */
const MATCHABLE = ROUTE_TITLES.map((r) => ({ path: r.path }));

/**
 * The `nav`-namespace key a pathname titles itself with, or `undefined` when it
 * is deliberately bare.
 *
 * Uses react-router's own matcher so specificity ranking is identical to
 * `<Routes>` — `/admin/surveys/:id/results` wins over `/admin/surveys/:id`
 * without the table having to be hand-ordered.
 */
export function titleKeyForPath(pathname: string): string | undefined {
  const matches = matchRoutes(MATCHABLE, pathname);
  if (!matches || matches.length === 0) return undefined;
  // matchRoutes ranks best-first for a flat route array.
  const matched = matches[matches.length - 1].route as { path?: string };
  return ROUTE_TITLES.find((r) => r.path === matched.path)?.titleKey;
}

/** Between the subject and the application title. */
export const TITLE_SEPARATOR = " | ";
/** Between the segments of a multi-part subject, e.g. «Settings · General». */
export const SUBJECT_SEPARATOR = " · ";
/**
 * A browser tab shows very few characters. Clamping the subject keeps the
 * application title visible, which is what tells the user which instance the
 * tab belongs to.
 */
export const MAX_SUBJECT_LENGTH = 70;

/**
 * `["SAP S/4HANA"]` + `"Turbo EA"` → `"SAP S/4HANA | Turbo EA"`.
 *
 * An empty subject leaves the application title alone, and a subject that is
 * already the application title is not repeated.
 */
export function composeTitle(
  subject: string | string[] | null | undefined,
  appTitle: string,
): string {
  const app = (appTitle || "").trim();
  const segments = (Array.isArray(subject) ? subject : [subject])
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    // A tab named after its own page — «Todos · Todos» — says nothing twice.
    .filter((s, i, all) => i === 0 || s !== all[i - 1]);

  if (segments.length === 0) return app;

  let joined = segments.join(SUBJECT_SEPARATOR);
  // Count code points, not UTF-16 units, so an emoji or CJK name is never cut
  // through the middle of a surrogate pair.
  const points = Array.from(joined);
  if (points.length > MAX_SUBJECT_LENGTH) {
    joined = `${points.slice(0, MAX_SUBJECT_LENGTH - 1).join("").trimEnd()}…`;
  }

  if (!app || joined === app) return app || joined;
  return `${joined}${TITLE_SEPARATOR}${app}`;
}
