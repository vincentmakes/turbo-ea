/**
 * Screenshot page definitions.
 *
 * Each entry describes one screenshot: where to navigate, what to wait for,
 * optional interactions (scroll, click), and the output filenames per locale.
 *
 * Filenames follow the existing `NN_description.png` convention used in
 * `docs/assets/img/{locale}/`.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreenshotAction =
  | { type: "scroll"; target: "bottom" | "top" | string; pixels?: number }
  | { type: "click"; selector: string; nth?: number }
  | { type: "wait"; ms: number }
  | { type: "hover"; selector: string }
  // Type text into a field one key at a time (via pressSequentially) so
  // keystroke-driven widgets like MUI Autocomplete open their option popup.
  | { type: "type"; selector: string; text: string };

export interface PageDef {
  /** Unique identifier (used as fallback filename when locale name is missing). */
  id: string;

  /**
   * Route to navigate to. Use `{{cardId}}` as a placeholder — it will be
   * replaced at runtime with a card UUID looked up by name from the demo data.
   */
  route: string;

  /** CSS selector to wait for before capturing. */
  waitFor?: string;

  /** Ordered actions to perform after the page loads. */
  actions?: ScreenshotAction[];

  /**
   * Clip the screenshot to a specific element instead of the full viewport.
   * Useful for menu popups or sections.
   */
  clipSelector?: string;

  /** Per-locale filenames (without `.png`).  Locales not listed use `id`. */
  filenames: Record<string, string>;

  /**
   * Viewport override for this specific screenshot.
   * Defaults to the global viewport (1280x800).
   */
  viewport?: { width: number; height: number };
}

// ---------------------------------------------------------------------------
// Card lookup helpers — resolved at runtime via the API
// ---------------------------------------------------------------------------

/** Cards that will be looked up by name at runtime.  Key → search name. */
export const CARD_LOOKUPS = {
  sampleApp: { name: "SAP S/4HANA", type: "Application" },
  sampleInitiative: { name: "SAP S/4HANA Migration", type: "Initiative" },
  sampleProcess: { name: "Order to Cash", type: "BusinessProcess" },
  // An L1 capability whose sub-capabilities carry the relations — used for the
  // "+N in sub-items" roll-up shots. Chosen because its descendants span two
  // application subtypes, so the drawer shows real grouping rather than one
  // undifferentiated list.
  sampleParentCapability: { name: "Service & After-Sales", type: "BusinessCapability" },
} as const;

// ---------------------------------------------------------------------------
// Locale-aware label lookup
// ---------------------------------------------------------------------------

/**
 * Locales the capture pipeline covers.
 *
 * Keep in sync with `SUPPORTED_LOCALES` (frontend/src/i18n/index.ts), the
 * backend allow-lists in api/v1/{users,settings}.py, and the `locales` default
 * in capture.ts.
 */
export const LOCALES = [
  "en", "de", "fr", "es", "it", "pt", "zh", "ru", "da", "ar",
] as const;

const I18N_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "frontend",
  "src",
  "i18n",
  "locales"
);

const nsCache = new Map<string, Record<string, string>>();

/** Load (and memoise) one locale's translation namespace.  Keys are flat/dotted. */
function loadNamespace(locale: string, ns: string): Record<string, string> {
  const cacheKey = `${locale}/${ns}`;
  let parsed = nsCache.get(cacheKey);
  if (!parsed) {
    const file = path.join(I18N_ROOT, locale, `${ns}.json`);
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    nsCache.set(cacheKey, parsed);
  }
  return parsed;
}

/**
 * Every distinct translation of one or more `namespace:key` refs, across all
 * supported locales.
 *
 * Selectors OR every variant together, so the capture never needs to know which
 * locale is active — and adding a locale to `LOCALES` is all it takes for its
 * labels to be matched. The previous approach hardcoded the strings, which meant
 * a new locale's tabs silently failed to click (the click is only a WARNING) and
 * the screenshot captured whatever tab happened to be open.
 */
function i18nLabels(...refs: string[]): string[] {
  const out = new Set<string>();
  for (const ref of refs) {
    const sep = ref.indexOf(":");
    const ns = ref.slice(0, sep);
    const key = ref.slice(sep + 1);
    for (const locale of LOCALES) {
      const value = loadNamespace(locale, ns)[key];
      if (value) out.add(value);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Shared click-selector helpers (all locale variants for tab/button labels)
// ---------------------------------------------------------------------------

/**
 * Escape a label for use inside a double-quoted Playwright `:has-text("…")`.
 * Escape \ before " — the order matters so a trailing backslash can't turn into
 * \\" and close the string literal early.
 */
function hasTextArg(label: string): string {
  return label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Build a comma-separated has-text selector chain for a tab across locales. */
function tabSelector(...labels: string[]): string {
  // Scope to [role='tablist'] to avoid matching navbar buttons with the same text.
  // Use double-quoted :has-text(...) so labels containing apostrophes
  // (e.g. "Vue d'ensemble", "Décisions d'architecture") parse correctly.
  return labels
    .flatMap((l) => [
      `[role='tablist'] [role='tab']:has-text("${hasTextArg(l)}")`,
      `[role='tablist'] button:has-text("${hasTextArg(l)}")`,
    ])
    .join(", ");
}

const TAB_COMMENTS = tabSelector(...i18nLabels("cards:tabs.comments"));
const TAB_TODOS = tabSelector(
  ...i18nLabels("cards:tabs.todos", "common:todos.tabs.todos")
);
const TAB_STAKEHOLDERS = tabSelector(...i18nLabels("cards:tabs.stakeholders"));
const TAB_HISTORY = tabSelector(...i18nLabels("cards:tabs.history"));
const TAB_BPM_DASHBOARD = tabSelector(...i18nLabels("bpm:tabs.dashboard"));
const TAB_METAMODEL_GRAPH = tabSelector(...i18nLabels("admin:metamodel.tabs.graph"));
const TAB_ROLES = tabSelector(...i18nLabels("admin:users.tabs.roles"));
const TAB_RESOURCES = tabSelector(
  ...i18nLabels(
    "cards:tabs.resources",
    "admin:settings.tabs.resources",
    "admin:metamodel.tabs.resources"
  )
);
const TAB_SOAW = tabSelector(...i18nLabels("cards:tabs.soaw", "delivery:soaw.label"));
const TAB_COMPLIANCE = tabSelector(
  ...i18nLabels("cards:tabs.compliance", "admin:compliance_tab_compliance")
);
const TAB_PPM_OVERVIEW = tabSelector(...i18nLabels("ppm:overview"));
const TAB_PPM_STATUS_REPORTS = tabSelector(...i18nLabels("ppm:statusReports"));
const TAB_PPM_BUDGET = tabSelector(...i18nLabels("ppm:budgetAndCosts"));
const TAB_PPM_RISK = tabSelector(...i18nLabels("ppm:riskManagement"));
const TAB_PPM_TASKS = tabSelector(...i18nLabels("ppm:tasks"));
const TAB_PPM_GANTT = tabSelector(...i18nLabels("ppm:gantt"));
const BTN_CREATE = i18nLabels("common:actions.create", "nav:create")
  .map((l) => `button:has-text("${hasTextArg(l)}")`)
  .join(", ");
/** Top navbar "Reports" menu button, across locales. */
const NAV_REPORTS = i18nLabels("nav:reports")
  .map((l) => `.MuiToolbar-root button:has-text("${hasTextArg(l)}")`)
  .join(", ");

// ---------------------------------------------------------------------------
// Docs screenshots (docs/assets/img/{locale}/)
// ---------------------------------------------------------------------------

export const DOC_PAGES: PageDef[] = [
  // ── Dashboard ──────────────────────────────────────────────────────────
  {
    id: "01_dashboard",
    route: "/",
    waitFor: ".recharts-responsive-container",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "01_dashboard",
      de: "01_dashboard",
      fr: "01_tableau_de_bord",
      es: "01_panel_de_control",
      it: "01_dashboard",
      pt: "01_painel",
      zh: "01_dashboard",
      ru: "01_panel_upravleniya",
    },
  },
  {
    id: "02_dashboard_bottom",
    route: "/",
    waitFor: ".recharts-responsive-container",
    // Scroll partway down so the chart row (Cards by Type, Approval Status,
    // Data Quality, Lifecycle) is the focal point — going all the way to
    // "bottom" lands on the activity feed alone, which is not what the doc
    // page promises ("Dashboard - Bottom View with Charts").
    actions: [
      { type: "wait", ms: 800 },
      { type: "scroll", target: "", pixels: 360 },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "02_dashboard_bottom",
      de: "02_dashboard_unten",
      fr: "02_tableau_de_bord_bas",
      es: "02_panel_inferior",
      it: "02_dashboard_inferiore",
      pt: "02_painel_inferior",
      zh: "02_dashboard_bottom",
      ru: "02_panel_upravleniya_nizhniy",
    },
  },

  // ── Inventory ──────────────────────────────────────────────────────────
  // NOTE: the plain `03_inventory` grid shot was removed — `23_inventory_filters`
  // shows the same grid *plus* the filter sidebar and is what the Inventory guide
  // actually embeds, so `03` was captured in every locale but referenced nowhere,
  // violating the two-way pages.ts ↔ docs contract in CLAUDE.md.

  // ── Card Detail ────────────────────────────────────────────────────────
  {
    id: "04_card_detail",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "04_card_detail",
      de: "04_karten_detail",
      fr: "04_detail_fiche",
      es: "04_detalle_ficha",
      it: "04_dettaglio_scheda",
      pt: "04_detalhe_ficha",
      zh: "04_card_detail",
      ru: "04_detali_kartochki",
    },
  },
  {
    id: "05_card_comments",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_COMMENTS },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "05_card_comments",
      de: "05_karten_kommentare",
      fr: "05_fiche_commentaires",
      es: "05_ficha_comentarios",
      it: "05_scheda_commenti",
      pt: "05_ficha_comentarios",
      zh: "05_card_comments",
      ru: "05_kartochka_kommentarii",
    },
  },
  {
    id: "06_card_todos",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_TODOS },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "06_card_todos",
      de: "06_karten_aufgaben",
      fr: "06_fiche_taches",
      es: "06_ficha_tareas",
      it: "06_scheda_attivita",
      pt: "06_ficha_tarefas",
      zh: "06_card_todos",
      ru: "06_kartochka_zadachi",
    },
  },
  {
    id: "07_card_stakeholders",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_STAKEHOLDERS },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "07_card_stakeholders",
      de: "07_karten_stakeholder",
      fr: "07_fiche_parties_prenantes",
      es: "07_ficha_partes_interesadas",
      it: "07_scheda_stakeholder",
      pt: "07_ficha_partes_interessadas",
      zh: "07_card_stakeholders",
      ru: "07_kartochka_zainteresovannye",
    },
  },
  {
    id: "08_card_history",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_HISTORY },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "08_card_history",
      de: "08_karten_historie",
      fr: "08_fiche_historique",
      es: "08_ficha_historial",
      it: "08_scheda_cronologia",
      pt: "08_ficha_historico",
      zh: "08_card_history",
      ru: "08_kartochka_istoriya",
    },
  },

  // ── Reports ────────────────────────────────────────────────────────────
  {
    id: "09_reports_menu",
    route: "/reports/portfolio",
    waitFor: ".recharts-responsive-container, .MuiPaper-root",
    actions: [
      { type: "wait", ms: 600 },
      // Click the Reports dropdown button in the nav bar to show the menu
      { type: "click", selector: NAV_REPORTS },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "09_reports_menu",
      de: "09_berichte_menu",
      fr: "09_menu_rapports",
      es: "09_menu_informes",
      it: "09_menu_report",
      pt: "09_menu_relatorios",
      zh: "09_reports_menu",
      ru: "09_menu_otchety",
    },
  },
  {
    id: "10_report_portfolio",
    route: "/reports/portfolio",
    waitFor: "[role='combobox']",
    // Configure the two Select dropdowns: Group by → Organization,
    // Color apps by → TIME Model. MUI Select menu items carry the option
    // value on `data-value`, which lets us click them without depending on
    // the translated label.
    actions: [
      { type: "wait", ms: 800 },
      // Open Group by (first combobox in the toolbar)
      { type: "click", selector: "[role='combobox']", nth: 0 },
      { type: "wait", ms: 300 },
      { type: "click", selector: "li[data-value='rel:Organization']" },
      { type: "wait", ms: 300 },
      // Open Color apps by (second combobox)
      { type: "click", selector: "[role='combobox']", nth: 1 },
      { type: "wait", ms: 300 },
      { type: "click", selector: "li[data-value='timeModel']" },
      { type: "wait", ms: 1800 },
    ],
    filenames: {
      en: "10_report_portfolio",
      de: "10_bericht_portfolio",
      fr: "10_rapport_portfolio",
      es: "10_informe_portafolio",
      it: "10_report_portfolio",
      pt: "10_relatorio_portfolio",
      zh: "10_report_portfolio",
      ru: "10_otchet_portfel",
    },
  },
  {
    id: "11_capability_map",
    route: "/reports/capability-map",
    waitFor: "[class*='CapabilityMap'], [data-testid='capability-map'], .MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "11_capability_map",
      de: "11_faehigkeiten_karte",
      fr: "11_carte_capacites",
      es: "11_mapa_capacidades",
      it: "11_mappa_capacita",
      pt: "11_mapa_capacidades",
      zh: "11_capability_map",
      ru: "11_karta_vozmozhnostey",
    },
  },
  {
    id: "12_lifecycle",
    // Filter to IT Components — the lifecycle view is more visually
    // meaningful for tech assets that actually carry end-of-life dates.
    // The page doesn't read `?type=` from the URL (config comes from saved
    // reports / localStorage), so drive the Card Type Select widget directly.
    route: "/reports/lifecycle",
    waitFor: "[role='combobox']",
    actions: [
      { type: "wait", ms: 800 },
      { type: "click", selector: "[role='combobox']" },
      { type: "wait", ms: 300 },
      { type: "click", selector: "li[data-value='ITComponent']" },
      { type: "wait", ms: 1800 },
    ],
    filenames: {
      en: "12_lifecycle",
      de: "12_lebenszyklus",
      fr: "12_cycle_de_vie",
      es: "12_ciclo_vida",
      it: "12_ciclo_vita",
      pt: "12_ciclo_vida",
      zh: "12_lifecycle",
      ru: "12_zhiznennyy_tsikl",
    },
  },
  {
    id: "13_dependencies",
    route: "/reports/dependencies",
    waitFor: "canvas, svg, [class*='Dependency']",
    actions: [{ type: "wait", ms: 1000 }],
    filenames: {
      en: "13_dependencies",
      de: "13_abhaengigkeiten",
      fr: "13_dependances",
      es: "13_dependencias",
      it: "13_dipendenze",
      pt: "13_dependencias",
      zh: "13_dependencies",
      ru: "13_zavisimosti",
    },
  },
  {
    id: "13b_dependencies_c4",
    route: "/reports/dependencies",
    // Wait for the toggle group, not `.react-flow` — the latter only mounts
    // after the LDV toggle is clicked.
    waitFor: "[value='c4']",
    // Switch to the Layered Dependency View, then center on SAP S/4HANA
    // (the demo seed's flagship Application with rich relations) so the
    // screenshot actually shows the diagram, not the empty picker.
    actions: [
      { type: "click", selector: "[value='c4']" },
      { type: "wait", ms: 800 },
      // The empty-state picker no longer takes a plain text click (its long
      // virtualized list makes the row unactionable). Drive the "Center on"
      // Autocomplete instead: focus it, type the card name so its option
      // popup opens, then pick the first (exact-prefix) match. Selecting an
      // Autocomplete option closes the popup cleanly — no dropdown lingers
      // over the diagram.
      { type: "type", selector: "input[role='combobox']", text: "SAP S/4HANA" },
      { type: "wait", ms: 700 },
      { type: "click", selector: "[role='option']" },
      // React Flow runs an auto-layout + fit-view animation; allow it to settle.
      { type: "wait", ms: 2500 },
    ],
    filenames: {
      en: "13b_dependencies_c4",
      de: "13b_abhaengigkeiten_c4",
      fr: "13b_dependances_c4",
      es: "13b_dependencias_c4",
      it: "13b_dipendenze_c4",
      pt: "13b_dependencias_c4",
      zh: "13b_dependencies_c4",
      ru: "13b_zavisimosti_c4",
    },
  },

  // ── BPM ────────────────────────────────────────────────────────────────
  {
    id: "14_bpm_navigator",
    route: "/bpm",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "14_bpm_navigator",
      de: "14_bpm_navigator",
      fr: "14_bpm_navigateur",
      es: "14_bpm_navegador",
      it: "14_bpm_navigatore",
      pt: "14_bpm_navegador",
      zh: "14_bpm_navigator",
      ru: "14_bpm_navigator",
    },
  },
  {
    id: "15_bpm_dashboard",
    route: "/bpm",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_BPM_DASHBOARD },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "15_bpm_dashboard",
      de: "15_bpm_dashboard",
      fr: "15_bpm_tableau_de_bord",
      es: "15_bpm_panel_control",
      it: "15_bpm_dashboard",
      pt: "15_bpm_painel",
      zh: "15_bpm_dashboard",
      ru: "15_bpm_panel_upravleniya",
    },
  },

  // ── Diagrams ───────────────────────────────────────────────────────────
  {
    id: "16_diagrams",
    route: "/diagrams",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "16_diagrams",
      de: "16_diagramme",
      fr: "16_diagrammes",
      es: "16_diagramas",
      it: "16_diagrammi",
      pt: "16_diagramas",
      zh: "16_diagrams",
      ru: "16_diagrammy",
    },
  },

  // ── EA Delivery ────────────────────────────────────────────────────────
  {
    id: "17_ea_delivery",
    // Deep-link to a specific initiative so the right pane shows the
    // workspace (deliverables, children, details) instead of the empty CTA.
    // EA Delivery is reached at /reports/ea-delivery (legacy /ea-delivery
    // redirects here). The page is a single two-pane workspace and ignores
    // ?tab=, so we only pass ?initiative=.
    route: "/reports/ea-delivery?initiative={{cardId:sampleInitiative}}",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "17_ea_delivery",
      de: "17_ea_lieferung",
      fr: "17_livraison_ea",
      es: "17_entrega_ea",
      it: "17_consegna_ea",
      pt: "17_entrega_ea",
      zh: "17_ea_delivery",
      ru: "17_postavka_ea",
    },
  },

  // ── Card Detail — Resources Tab ────────────────────────────────────
  {
    id: "17c_card_resources",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_RESOURCES },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "17c_card_resources",
      de: "17c_karten_ressourcen",
      fr: "17c_fiche_ressources",
      es: "17c_ficha_recursos",
      it: "17c_scheda_risorse",
      pt: "17c_ficha_recursos",
      zh: "17c_card_resources",
      ru: "17c_kartochka_resursy",
    },
  },

  // ── Tasks ──────────────────────────────────────────────────────────────
  {
    id: "18_tasks",
    route: "/todos",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 400 }],
    filenames: {
      en: "18_tasks",
      de: "18_aufgaben",
      fr: "18_taches",
      es: "18_tareas",
      it: "18_attivita",
      pt: "18_tarefas",
      zh: "18_tasks",
      ru: "18_zadachi",
    },
  },

  // ── User Menu ──────────────────────────────────────────────────────────
  {
    id: "19_user_menu",
    route: "/",
    waitFor: ".recharts-responsive-container",
    actions: [
      { type: "wait", ms: 400 },
      // Click the user avatar / profile button in the top-right
      { type: "click", selector: ".MuiToolbar-root button:has-text('account_circle')" },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "19_user_menu",
      de: "19_benutzer_menu",
      fr: "19_menu_utilisateur",
      es: "19_menu_usuario",
      it: "19_menu_utente",
      pt: "19_menu_usuario",
      zh: "19_user_menu",
      ru: "19_menu_polzovatelya",
    },
  },

  // ── Admin pages ────────────────────────────────────────────────────────
  {
    id: "20_admin_metamodel",
    route: "/admin/metamodel",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "20_admin_metamodel",
      de: "20_admin_metamodell",
      fr: "20_admin_metamodele",
      es: "20_admin_metamodelo",
      it: "20_admin_metamodello",
      pt: "20_admin_metamodelo",
      zh: "20_admin_metamodel",
      ru: "20_admin_metamodel",
    },
  },
  {
    id: "21_admin_users",
    route: "/admin/users",
    waitFor: ".MuiPaper-root, .MuiTable-root, .ag-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "21_admin_users",
      de: "21_admin_benutzer",
      fr: "21_admin_utilisateurs",
      es: "21_admin_usuarios",
      it: "21_admin_utenti",
      pt: "21_admin_usuarios",
      zh: "21_admin_users",
      ru: "21_admin_polzovateli",
    },
  },

  // ── Create Card Dialog ─────────────────────────────────────────────────
  {
    id: "22_create_card",
    route: "/inventory",
    waitFor: ".ag-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: BTN_CREATE },
      { type: "wait", ms: 500 },
    ],
    filenames: {
      en: "22_create_card",
      de: "22_karte_erstellen",
      fr: "22_creer_fiche",
      es: "22_crear_ficha",
      it: "22_crea_scheda",
      pt: "22_criar_ficha",
      zh: "22_create_card",
      ru: "22_sozdanie_kartochki",
    },
  },

  // ── Inventory Filters ──────────────────────────────────────────────────
  {
    id: "23_inventory_filters",
    route: "/inventory",
    waitFor: ".ag-root",
    actions: [
      { type: "wait", ms: 600 },
      // Click the "Application" type-filter row in the sidebar. Match on the
      // Material Symbol ligature "apps" (the row's icon) rather than the type
      // label — the label is metamodel-translated per locale ("Anwendung",
      // "Приложение", …) but the icon ligature is language-independent and
      // uniquely identifies the Application row.
      { type: "click", selector: ".MuiListItemButton-root:has-text('apps')" },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "23_inventory_filters",
      de: "23_inventar_filter",
      fr: "23_inventaire_filtres",
      es: "23_inventario_filtros",
      it: "23_inventario_filtri",
      pt: "23_inventario_filtros",
      zh: "23_inventory_filters",
      ru: "23_inventarizatsiya_filtry",
    },
  },

  // ── Login Page ──────────────────────────────────────────────────────────
  {
    id: "24_login",
    route: "/login",
    waitFor: "form, [class*='Login'], .MuiPaper-root",
    actions: [{ type: "wait", ms: 400 }],
    filenames: {
      en: "24_login",
      de: "24_anmeldung",
      fr: "24_connexion",
      es: "24_inicio_sesion",
      it: "24_accesso",
      pt: "24_login",
      zh: "24_login",
      ru: "24_vkhod",
    },
  },

  // ── Admin Settings: Authentication / SSO ────────────────────────────────
  {
    id: "25_admin_settings_auth",
    route: "/admin/settings?tab=authentication",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "25_admin_settings_auth",
      de: "25_admin_einstellungen_auth",
      fr: "25_admin_parametres_auth",
      es: "25_admin_config_autenticacion",
      it: "25_admin_impostazioni_auth",
      pt: "25_admin_config_autenticacao",
      zh: "25_admin_settings_auth",
      ru: "25_admin_nastroyki_auth",
    },
  },

  // ── Admin Settings: AI Suggestions ──────────────────────────────────────
  {
    id: "26_admin_settings_ai",
    route: "/admin/settings?tab=ai",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "26_admin_settings_ai",
      de: "26_admin_einstellungen_ki",
      fr: "26_admin_parametres_ia",
      es: "26_admin_config_ia",
      it: "26_admin_impostazioni_ia",
      pt: "26_admin_config_ia",
      zh: "26_admin_settings_ai",
      ru: "26_admin_nastroyki_ii",
    },
  },

  // ── AI Suggest Panel on Card Detail ─────────────────────────────────────
  {
    id: "27_ai_suggest_panel",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      // Click the AI suggest sparkle button — see DescriptionSection.tsx
      { type: "click", selector: "[data-testid='ai-suggest-button']" },
      { type: "wait", ms: 800 },
    ],
    filenames: {
      en: "27_ai_suggest_panel",
      de: "27_ki_vorschlag_panel",
      fr: "27_panneau_suggestion_ia",
      es: "27_panel_sugerencia_ia",
      it: "27_pannello_suggerimento_ia",
      pt: "27_painel_sugestao_ia",
      zh: "27_ai_suggest_panel",
      ru: "27_panel_predlozheniy_ii",
    },
  },

  // ── Admin Settings: General ─────────────────────────────────────────────
  {
    id: "28_admin_settings_general",
    route: "/admin/settings?tab=general",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "28_admin_settings_general",
      de: "28_admin_einstellungen_allgemein",
      fr: "28_admin_parametres_general",
      es: "28_admin_config_general",
      it: "28_admin_impostazioni_generali",
      pt: "28_admin_config_geral",
      zh: "28_admin_settings_general",
      ru: "28_admin_nastroyki_obshchie",
    },
  },

  // ── Admin Settings: EOL ─────────────────────────────────────────────────
  {
    id: "29_admin_settings_eol",
    route: "/admin/settings?tab=eol",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "29_admin_settings_eol",
      de: "29_admin_einstellungen_eol",
      fr: "29_admin_parametres_eol",
      es: "29_admin_config_eol",
      it: "29_admin_impostazioni_eol",
      pt: "29_admin_config_eol",
      zh: "29_admin_settings_eol",
      ru: "29_admin_nastroyki_eol",
    },
  },

  // ── Admin Settings: Web Portals ─────────────────────────────────────────
  {
    id: "30_admin_settings_web_portals",
    route: "/admin/settings?tab=web-portals",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "30_admin_settings_web_portals",
      de: "30_admin_einstellungen_webportale",
      fr: "30_admin_parametres_portails_web",
      es: "30_admin_config_portales_web",
      it: "30_admin_impostazioni_portali_web",
      pt: "30_admin_config_portais_web",
      zh: "30_admin_settings_web_portals",
      ru: "30_admin_nastroyki_veb_portaly",
    },
  },

  // ── Admin Settings: ServiceNow ──────────────────────────────────────────
  {
    id: "31_admin_settings_servicenow",
    route: "/admin/settings?tab=servicenow",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "31_admin_settings_servicenow",
      de: "31_admin_einstellungen_servicenow",
      fr: "31_admin_parametres_servicenow",
      es: "31_admin_config_servicenow",
      it: "31_admin_impostazioni_servicenow",
      pt: "31_admin_config_servicenow",
      zh: "31_admin_settings_servicenow",
      ru: "31_admin_nastroyki_servicenow",
    },
  },

  // ── EOL Report ──────────────────────────────────────────────────────────
  {
    id: "32_report_eol",
    route: "/reports/eol",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "32_report_eol",
      de: "32_bericht_eol",
      fr: "32_rapport_eol",
      es: "32_informe_eol",
      it: "32_report_eol",
      pt: "32_relatorio_eol",
      zh: "32_report_eol",
      ru: "32_otchet_eol",
    },
  },

  // ── Data Quality Report ─────────────────────────────────────────────────
  {
    id: "33_report_data_quality",
    route: "/reports/data-quality",
    waitFor: ".MuiPaper-root, .recharts-responsive-container",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "33_report_data_quality",
      de: "33_bericht_datenqualitaet",
      fr: "33_rapport_qualite_donnees",
      es: "33_informe_calidad_datos",
      it: "33_report_qualita_dati",
      pt: "33_relatorio_qualidade_dados",
      zh: "33_report_data_quality",
      ru: "33_otchet_kachestvo_dannykh",
    },
  },

  // ── Cost Report ─────────────────────────────────────────────────────────
  {
    id: "34_report_cost",
    route: "/reports/cost",
    waitFor: ".recharts-responsive-container, [class*='Cost']",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "34_report_cost",
      de: "34_bericht_kosten",
      fr: "34_rapport_couts",
      es: "34_informe_costos",
      it: "34_report_costi",
      pt: "34_relatorio_custos",
      zh: "34_report_cost",
      ru: "34_otchet_stoimost",
    },
  },

  // ── Matrix Report ───────────────────────────────────────────────────────
  {
    id: "35_report_matrix",
    route: "/reports/matrix",
    waitFor: ".MuiPaper-root",
    // Longer than most: the filter bar and the gap tiles settle after the
    // metamodel and the matrix payload have both landed.
    actions: [{ type: "wait", ms: 1200 }],
    filenames: {
      en: "35_report_matrix",
      de: "35_bericht_matrix",
      fr: "35_rapport_matrice",
      es: "35_informe_matriz",
      it: "35_report_matrice",
      pt: "35_relatorio_matriz",
      zh: "35_report_matrix",
      ru: "35_otchet_matritsa",
    },
  },
  // ── Saved Reports ───────────────────────────────────────────────────────
  {
    id: "36_saved_reports",
    route: "/reports/saved",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "36_saved_reports",
      de: "36_gespeicherte_berichte",
      fr: "36_rapports_sauvegardes",
      es: "36_informes_guardados",
      it: "36_report_salvati",
      pt: "36_relatorios_salvos",
      zh: "36_saved_reports",
      ru: "36_sokhranennye_otchety",
    },
  },

  // ── Admin Surveys ───────────────────────────────────────────────────────
  {
    id: "37_admin_surveys",
    route: "/admin/surveys",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "37_admin_surveys",
      de: "37_admin_umfragen",
      fr: "37_admin_enquetes",
      es: "37_admin_encuestas",
      it: "37_admin_sondaggi",
      pt: "37_admin_pesquisas",
      zh: "37_admin_surveys",
      ru: "37_admin_oprosy",
    },
  },

  // ── Metamodel Graph ─────────────────────────────────────────────────────
  {
    id: "38_metamodel_graph",
    route: "/admin/metamodel",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_METAMODEL_GRAPH },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "38_metamodel_graph",
      de: "38_metamodell_graph",
      fr: "38_graphe_metamodele",
      es: "38_grafo_metamodelo",
      it: "38_grafo_metamodello",
      pt: "38_grafo_metamodelo",
      zh: "38_metamodel_graph",
      ru: "38_graf_metamodeli",
    },
  },

  // ── Roles Admin ─────────────────────────────────────────────────────────
  {
    id: "39_admin_roles",
    route: "/admin/users",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_ROLES },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "39_admin_roles",
      de: "39_admin_rollen",
      fr: "39_admin_roles",
      es: "39_admin_roles",
      it: "39_admin_ruoli",
      pt: "39_admin_papeis",
      zh: "39_admin_roles",
      ru: "39_admin_roli",
    },
  },

  // ── PPM (Project Portfolio Management) ──────────────────────────────────
  {
    id: "40_ppm_portfolio",
    route: "/ppm",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "40_ppm_portfolio",
      de: "40_ppm_portfolio",
      fr: "40_ppm_portefeuille",
      es: "40_ppm_portafolio",
      it: "40_ppm_portafoglio",
      pt: "40_ppm_portfolio",
      zh: "40_ppm_portfolio",
      ru: "40_ppm_portfel",
    },
  },
  {
    id: "41_ppm_overview",
    route: "/ppm/{{cardId:sampleInitiative}}",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_PPM_OVERVIEW },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "41_ppm_overview",
      de: "41_ppm_uebersicht",
      fr: "41_ppm_vue_ensemble",
      es: "41_ppm_resumen",
      it: "41_ppm_panoramica",
      pt: "41_ppm_visao_geral",
      zh: "41_ppm_overview",
      ru: "41_ppm_obzor",
    },
  },
  {
    id: "42_ppm_status_reports",
    route: "/ppm/{{cardId:sampleInitiative}}",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_PPM_STATUS_REPORTS },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "42_ppm_status_reports",
      de: "42_ppm_statusberichte",
      fr: "42_ppm_rapports_statut",
      es: "42_ppm_informes_estado",
      it: "42_ppm_rapporti_stato",
      pt: "42_ppm_relatorios_estado",
      zh: "42_ppm_status_reports",
      ru: "42_ppm_otchety_statusa",
    },
  },
  {
    id: "43_ppm_budget_costs",
    route: "/ppm/{{cardId:sampleInitiative}}",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_PPM_BUDGET },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "43_ppm_budget_costs",
      de: "43_ppm_budget_kosten",
      fr: "43_ppm_budget_couts",
      es: "43_ppm_presupuesto_costes",
      it: "43_ppm_budget_costi",
      pt: "43_ppm_orcamento_custos",
      zh: "43_ppm_budget_costs",
      ru: "43_ppm_byudzhet_zatraty",
    },
  },
  {
    id: "44_ppm_risk_management",
    route: "/ppm/{{cardId:sampleInitiative}}",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_PPM_RISK },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "44_ppm_risk_management",
      de: "44_ppm_risikomanagement",
      fr: "44_ppm_gestion_risques",
      es: "44_ppm_gestion_riesgos",
      it: "44_ppm_gestione_rischi",
      pt: "44_ppm_gestao_riscos",
      zh: "44_ppm_risk_management",
      ru: "44_ppm_upravlenie_riskami",
    },
  },
  {
    id: "45_ppm_task_board",
    route: "/ppm/{{cardId:sampleInitiative}}",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_PPM_TASKS },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "45_ppm_task_board",
      de: "45_ppm_aufgaben_board",
      fr: "45_ppm_tableau_taches",
      es: "45_ppm_tablero_tareas",
      it: "45_ppm_board_attivita",
      pt: "45_ppm_quadro_tarefas",
      zh: "45_ppm_task_board",
      ru: "45_ppm_doska_zadach",
    },
  },
  {
    id: "46_ppm_gantt",
    route: "/ppm/{{cardId:sampleInitiative}}",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_PPM_GANTT },
      { type: "wait", ms: 800 },
    ],
    filenames: {
      en: "46_ppm_gantt",
      de: "46_ppm_gantt",
      fr: "46_ppm_gantt",
      es: "46_ppm_gantt",
      it: "46_ppm_gantt",
      pt: "46_ppm_gantt",
      zh: "46_ppm_gantt",
      ru: "46_ppm_gantt",
    },
  },

  // ── BPM Process Flow Editor ──────────────────────────────────────────────
  {
    id: "47_bpm_process_flow",
    route: "/bpm/processes/{{cardId:sampleProcess}}/flow",
    // Wait for actual BPMN lane/task elements to render (not just the container)
    waitFor: ".bjs-container .djs-group, .bjs-container .djs-layer, .bjs-container",
    actions: [
      { type: "wait", ms: 2000 },
      // Trigger Fit-to-Screen so the auto-fit zoom settles before capture —
      // see BpmnModeler.tsx (data-testid added for stable targeting).
      { type: "click", selector: "[data-testid='bpmn-fit-to-screen']" },
      { type: "wait", ms: 800 },
    ],
    filenames: {
      en: "47_bpm_process_flow",
      de: "47_bpm_prozessfluss",
      fr: "47_bpm_flux_processus",
      es: "47_bpm_flujo_proceso",
      it: "47_bpm_flusso_processo",
      pt: "47_bpm_fluxo_processo",
      zh: "47_bpm_process_flow",
      ru: "47_bpm_potok_protsessa",
    },
  },

  // ── Reference Catalogues — Process Catalogue ────────────────────────────
  {
    id: "48_process_catalogue",
    route: "/process-catalogue",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 1200 }],
    filenames: {
      en: "48_process_catalogue",
      de: "48_prozesskatalog",
      fr: "48_catalogue_processus",
      es: "48_catalogo_procesos",
      it: "48_catalogo_processi",
      pt: "48_catalogo_processos",
      zh: "48_process_catalogue",
      ru: "48_katalog_protsessov",
    },
  },

  // ── Reference Catalogues — Value Stream Catalogue ────────────────────────
  {
    id: "49_value_stream_catalogue",
    route: "/value-stream-catalogue",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 1200 }],
    filenames: {
      en: "49_value_stream_catalogue",
      de: "49_wertstrom_katalog",
      fr: "49_catalogue_chaines_valeur",
      es: "49_catalogo_cadenas_valor",
      it: "49_catalogo_flussi_valore",
      pt: "49_catalogo_cadeias_valor",
      zh: "49_value_stream_catalogue",
      ru: "49_katalog_potokov_tsennosti",
    },
  },

  // ── Reference Catalogues — Principles Catalogue ──────────────────────────
  {
    id: "50_principles_catalogue",
    route: "/principles-catalogue",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 1200 }],
    filenames: {
      en: "50_principles_catalogue",
      de: "50_prinzipienkatalog",
      fr: "50_catalogue_principes",
      es: "50_catalogo_principios",
      it: "50_catalogo_principi",
      pt: "50_catalogo_principios",
      zh: "50_principles_catalogue",
      ru: "50_katalog_printsipov",
    },
  },

  // ── Reference Catalogues — Capability Catalogue ──────────────────────────
  {
    id: "51_capability_catalogue",
    route: "/capability-catalogue",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 1200 }],
    filenames: {
      en: "51_capability_catalogue",
      de: "51_capability_katalog",
      fr: "51_catalogue_capacites",
      es: "51_catalogo_capacidades",
      it: "51_catalogo_capacita",
      pt: "51_catalogo_capacidades",
      zh: "51_capability_catalogue",
      ru: "51_katalog_vozmozhnostey",
    },
  },

  // ── GRC — Governance tab ─────────────────────────────────────────────────
  {
    id: "52_grc_governance",
    route: "/grc?tab=governance",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "52_grc_governance",
      de: "52_grc_governance",
      fr: "52_grc_gouvernance",
      es: "52_grc_gobernanza",
      it: "52_grc_governance",
      pt: "52_grc_governanca",
      zh: "52_grc_governance",
      ru: "52_grc_upravlenie",
    },
  },

  // ── GRC — Governance → Decisions sub-tab (master ADR registry) ──────────
  {
    id: "52a_grc_decisions",
    route: "/grc?tab=governance&sub=decisions",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "52a_grc_decisions",
      de: "52a_grc_entscheidungen",
      fr: "52a_grc_decisions",
      es: "52a_grc_decisiones",
      it: "52a_grc_decisioni",
      pt: "52a_grc_decisoes",
      zh: "52a_grc_decisions",
      ru: "52a_grc_resheniya",
    },
  },

  // ── GRC — Risk Register tab ──────────────────────────────────────────────
  {
    id: "53_grc_risk_register",
    route: "/grc?tab=risk",
    waitFor: ".MuiPaper-root",
    // Scroll past the KPI tiles + matrix so the actual register table is
    // the centerpiece of the screenshot — the user-facing "Risk Register"
    // is the list of risks, not just the header summary.
    actions: [
      { type: "wait", ms: 1000 },
      { type: "scroll", target: "", pixels: 420 },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "53_grc_risk_register",
      de: "53_grc_risikoregister",
      fr: "53_grc_registre_risques",
      es: "53_grc_registro_riesgos",
      it: "53_grc_registro_rischi",
      pt: "53_grc_registo_riscos",
      zh: "53_grc_risk_register",
      ru: "53_grc_reestr_riskov",
    },
  },

  // ── GRC — Compliance register ───────────────────────────────────────────
  // The Compliance tab is AI-gated, but the demo seed already ships six
  // pre-existing findings + an AI provider configured at boot, so the
  // register itself renders. We click the inner "Compliance" sub-tab to
  // skip the KPI/overview pane and land on the actual register grid.
  //
  // `[role="tab"]` matches every Tab on the page; the inner Compliance tab
  // sits at index 4 (3 GRC outer tabs + Overview + Compliance — the
  // dedicated CVEs sub-tab was removed with the TurboLens CVE scanner).
  {
    id: "54_grc_compliance",
    route: "/grc?tab=compliance",
    waitFor: "[role='tab']",
    actions: [
      { type: "wait", ms: 1000 },
      { type: "click", selector: "[role='tab']", nth: 4 },
      { type: "wait", ms: 1500 },
    ],
    filenames: {
      en: "54_grc_compliance",
      de: "54_grc_compliance",
      fr: "54_grc_conformite",
      es: "54_grc_cumplimiento",
      it: "54_grc_conformita",
      pt: "54_grc_conformidade",
      zh: "54_grc_compliance",
      ru: "54_grc_sootvetstvie",
    },
  },

  // ── Initiative card — SoAW tab ───────────────────────────────────────────
  {
    id: "55_initiative_soaw_tab",
    route: "/cards/{{cardId:sampleInitiative}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_SOAW },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "55_initiative_soaw_tab",
      de: "55_initiative_soaw_tab",
      fr: "55_initiative_soaw_tab",
      es: "55_iniciativa_soaw_tab",
      it: "55_iniziativa_soaw_tab",
      pt: "55_iniciativa_soaw_tab",
      zh: "55_initiative_soaw_tab",
      ru: "55_initsiativa_soaw_tab",
    },
  },

  // ── Card detail — Compliance tab ─────────────────────────────────────────
  {
    id: "56_card_compliance_tab",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_COMPLIANCE },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "56_card_compliance_tab",
      de: "56_karte_compliance_tab",
      fr: "56_fiche_conformite_tab",
      es: "56_ficha_cumplimiento_tab",
      it: "56_scheda_conformita_tab",
      pt: "56_ficha_conformidade_tab",
      zh: "56_card_compliance_tab",
      ru: "56_kartochka_sootvetstvie_tab",
    },
  },
  {
    // Flexible Portfolio — companion to entry 10 (Application Portfolio).
    // Showcases the card-type picker: Data Object portfolio grouped by
    // Application, coloured by Data Sensitivity.
    id: "57_report_flexible_portfolio",
    route: "/reports/flexible-portfolio",
    waitFor: "[role='combobox']",
    actions: [
      { type: "wait", ms: 800 },
      // 1. Card type → DataObject (1st combobox; only present on the
      //    Flexible Portfolio, not the Application Portfolio).
      { type: "click", selector: "[role='combobox']", nth: 0 },
      { type: "wait", ms: 300 },
      { type: "click", selector: "li[data-value='DataObject']" },
      { type: "wait", ms: 1200 },
      // 2. Group by → rel:Application (now the 2nd combobox).
      { type: "click", selector: "[role='combobox']", nth: 1 },
      { type: "wait", ms: 300 },
      { type: "click", selector: "li[data-value='rel:Application']" },
      { type: "wait", ms: 300 },
      // 3. Color by → dataSensitivity (3rd combobox).
      { type: "click", selector: "[role='combobox']", nth: 2 },
      { type: "wait", ms: 300 },
      { type: "click", selector: "li[data-value='dataSensitivity']" },
      { type: "wait", ms: 1800 },
    ],
    filenames: {
      en: "57_report_flexible_portfolio",
      de: "57_bericht_flexibles_portfolio",
      fr: "57_rapport_portefeuille_flexible",
      es: "57_informe_portafolio_flexible",
      it: "57_report_portfolio_flessibile",
      pt: "57_relatorio_portfolio_flexivel",
      zh: "57_report_flexible_portfolio",
      ru: "57_otchet_gibkoe_portfolio",
    },
  },

  // ── Admin Settings: Migration → Workspace Transfer ──────────────────────
  {
    id: "58_workspace_transfer",
    route: "/admin/settings?tab=migration",
    waitFor: "[role='tablist']",
    actions: [
      { type: "wait", ms: 500 },
      // Switch from the default "Platform migration" sub-tab to "Workspace transfer".
      {
        type: "click",
        selector: tabSelector(
          ...i18nLabels("admin:settings.tabs.workspaceTransfer")
        ),
      },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "58_workspace_transfer",
      de: "58_workspace_transfer",
      fr: "58_transfert_espace_travail",
      es: "58_transferencia_espacio_trabajo",
      it: "58_trasferimento_workspace",
      pt: "58_transferencia_workspace",
      zh: "58_workspace_transfer",
      ru: "58_perenos_rabochey_oblasti",
    },
  },

  // ── Card Detail: relations rolled up from sub-items ─────────────────────
  // Both shots use locale-independent selectors: the Relations accordion is
  // found by its Material Symbols ligature ("hub" is the icon's text content),
  // and the roll-up chip by its `info` colour class — the only info-coloured
  // chip in the section. Label text would need all 8 locales.
  {
    id: "59_card_subitem_chip",
    route: "/cards/{{cardId:sampleParentCapability}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 600 },
      {
        type: "click",
        selector:
          ".MuiAccordionSummary-root:has(span.material-symbols-outlined:text-is('hub'))",
      },
      { type: "wait", ms: 800 },
      {
        type: "scroll",
        target: ".MuiAccordionSummary-root:has(span.material-symbols-outlined:text-is('hub'))",
      },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "59_card_subitem_chip",
      de: "59_karte_unterelemente_chip",
      fr: "59_fiche_sous_elements_puce",
      es: "59_ficha_subelementos_etiqueta",
      it: "59_scheda_sottoelementi_chip",
      pt: "59_ficha_subelementos_chip",
      zh: "59_card_subitem_chip",
      ru: "59_kartochka_podelementy_chip",
    },
  },
  {
    id: "60_card_subitem_relations",
    route: "/cards/{{cardId:sampleParentCapability}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 600 },
      {
        type: "click",
        selector:
          ".MuiAccordionSummary-root:has(span.material-symbols-outlined:text-is('hub'))",
      },
      { type: "wait", ms: 800 },
      // Info-coloured chips are the roll-ups, one per relation group, in group
      // order: Objective, Initiative, Application, … — index 2 is the
      // Applications roll-up, the richest one on this demo card.
      { type: "click", selector: ".MuiChip-outlinedInfo", nth: 2 },
      { type: "wait", ms: 900 },
    ],
    filenames: {
      en: "60_card_subitem_relations",
      de: "60_karte_unterelemente_beziehungen",
      fr: "60_fiche_sous_elements_relations",
      es: "60_ficha_subelementos_relaciones",
      it: "60_scheda_sottoelementi_relazioni",
      pt: "60_ficha_subelementos_relacoes",
      zh: "60_card_subitem_relations",
      ru: "60_kartochka_podelementy_svyazi",
    },
  },

  // ── Admin Settings: Resources (repository-wide file & link management) ──
  // Wait for the AG Grid root rather than a Paper: the grid mounts after the
  // /resources + /resources/stats round-trips, and the stat tiles above it
  // are Papers that would satisfy a `.MuiPaper-root` wait too early.
  {
    id: "61_admin_settings_resources",
    route: "/admin/settings?tab=resources",
    waitFor: ".ag-root",
    actions: [{ type: "wait", ms: 900 }],
    filenames: {
      en: "61_admin_settings_resources",
      de: "61_admin_einstellungen_ressourcen",
      fr: "61_admin_parametres_ressources",
      es: "61_admin_config_recursos",
      it: "61_admin_impostazioni_risorse",
      pt: "61_admin_config_recursos",
      zh: "61_admin_settings_resources",
      ru: "61_admin_nastroyki_resursy",
    },
  },

];

// ---------------------------------------------------------------------------
// Marketing screenshots (marketing-site/assets/screenshots/)
// ---------------------------------------------------------------------------

export const MARKETING_PAGES: PageDef[] = [
  // Hero
  {
    id: "dashboard",
    route: "/",
    waitFor: ".recharts-responsive-container",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 1200, height: 700 },
    filenames: { en: "dashboard" },
  },

  // Product Showcase
  {
    id: "inventory",
    route: "/inventory",
    waitFor: ".ag-root",
    actions: [{ type: "wait", ms: 600 }],
    viewport: { width: 1100, height: 600 },
    filenames: { en: "inventory" },
  },
  {
    id: "card-detail",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [{ type: "wait", ms: 600 }],
    viewport: { width: 1100, height: 800 },
    filenames: { en: "card-detail" },
  },
  {
    id: "diagram-editor",
    route: "/diagrams",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    viewport: { width: 1100, height: 800 },
    filenames: { en: "diagram-editor" },
  },
  {
    id: "end-of-life",
    route: "/reports/eol",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    viewport: { width: 1100, height: 800 },
    filenames: { en: "end-of-life" },
  },

  // PPM
  {
    id: "ppm-portfolio-dashboard",
    route: "/ppm",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 1200, height: 800 },
    filenames: {
      en: "ppm-portfolio-dashboard",
      es: "ppm-panel-portafolio",
      de: "ppm-portfolio-dashboard",
      fr: "ppm-tableau-portefeuille",
      it: "ppm-dashboard-portafoglio",
      pt: "ppm-painel-portfolio",
      zh: "ppm-portfolio-dashboard",
      ru: "ppm-portfolio-dashboard",
    },
  },
  {
    id: "ppm-gantt-chart",
    route: "/ppm/{{cardId:sampleInitiative}}?tab=gantt",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 1000 }],
    viewport: { width: 1200, height: 700 },
    filenames: {
      en: "ppm-gantt-chart",
      es: "ppm-diagrama-gantt",
      de: "ppm-gantt-diagramm",
      fr: "ppm-diagramme-gantt",
      it: "ppm-diagramma-gantt",
      pt: "ppm-diagrama-gantt",
      zh: "ppm-gantt-chart",
      ru: "ppm-gantt-chart",
    },
  },
  {
    id: "ppm-task-board",
    route: "/ppm/{{cardId:sampleInitiative}}?tab=tasks",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 1200, height: 700 },
    filenames: {
      en: "ppm-task-board",
      es: "ppm-tablero-tareas",
      de: "ppm-aufgaben-board",
      fr: "ppm-tableau-taches",
      it: "ppm-board-attivita",
      pt: "ppm-quadro-tarefas",
      zh: "ppm-task-board",
      ru: "ppm-task-board",
    },
  },

  // BPM
  {
    id: "bpm-process-navigator",
    route: "/bpm",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    viewport: { width: 1100, height: 600 },
    filenames: { en: "bpm-process-navigator" },
  },
  {
    id: "bpm-capability-heatmap",
    route: "/reports/capability-map",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 1100, height: 800 },
    filenames: { en: "bpm-capability-heatmap" },
  },

  // Reports
  {
    id: "portfolio-report",
    route: "/reports/portfolio",
    waitFor: ".recharts-responsive-container",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 800, height: 500 },
    filenames: { en: "portfolio-report" },
  },
  {
    id: "capability-heatmap",
    route: "/reports/capability-map",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 800, height: 500 },
    filenames: { en: "capability-heatmap" },
  },
  {
    id: "lifecycle-roadmap",
    route: "/reports/lifecycle",
    waitFor: ".recharts-responsive-container, [class*='Lifecycle']",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 800, height: 500 },
    filenames: { en: "lifecycle-roadmap" },
  },
  {
    id: "dependency-graph",
    route: "/reports/dependencies",
    waitFor: "canvas, svg, [class*='Dependency']",
    actions: [{ type: "wait", ms: 1000 }],
    viewport: { width: 800, height: 500 },
    filenames: { en: "dependency-graph" },
  },
  {
    id: "cost-treemap",
    route: "/reports/cost",
    waitFor: ".recharts-responsive-container, [class*='Cost']",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 800, height: 500 },
    filenames: { en: "cost-treemap" },
  },
  {
    id: "matrix-report",
    route: "/reports/matrix",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 800, height: 500 },
    filenames: { en: "matrix-report" },
  },
  {
    id: "data-quality",
    route: "/reports/data-quality",
    waitFor: ".MuiPaper-root, .recharts-responsive-container",
    actions: [{ type: "wait", ms: 800 }],
    viewport: { width: 800, height: 500 },
    filenames: { en: "data-quality" },
  },
];
