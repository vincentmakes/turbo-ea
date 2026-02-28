/**
 * Screenshot page definitions.
 *
 * Each entry describes one screenshot: where to navigate, what to wait for,
 * optional interactions (scroll, click), and the output filenames per locale.
 *
 * Filenames follow the existing `NN_description.png` convention used in
 * `docs/assets/img/{locale}/`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScreenshotAction =
  | { type: "scroll"; target: "bottom" | "top" | string }
  | { type: "click"; selector: string }
  | { type: "wait"; ms: number }
  | { type: "hover"; selector: string };

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
  sampleApp: { name: "NexaCore ERP", type: "Application" },
} as const;

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
      es: "01_panel_de_control",
    },
  },
  {
    id: "02_dashboard_bottom",
    route: "/",
    waitFor: ".recharts-responsive-container",
    actions: [
      { type: "wait", ms: 800 },
      { type: "scroll", target: "bottom" },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "02_dashboard_bottom",
      es: "02_panel_inferior",
    },
  },

  // ── Inventory ──────────────────────────────────────────────────────────
  {
    id: "03_inventory",
    route: "/inventory",
    waitFor: ".ag-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "03_inventory",
      es: "03_inventario",
    },
  },

  // ── Card Detail ────────────────────────────────────────────────────────
  {
    id: "04_card_detail",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "04_card_detail",
      es: "04_detalle_ficha",
    },
  },
  {
    id: "05_card_comments",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: "button:has-text('Comments'), [role='tab']:has-text('Comments'), [role='tab']:has-text('Comentarios')" },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "05_card_comments",
      es: "05_ficha_comentarios",
    },
  },
  {
    id: "06_card_todos",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: "button:has-text('Todos'), [role='tab']:has-text('Todos'), [role='tab']:has-text('Tareas')" },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "06_card_todos",
      es: "06_ficha_tareas",
    },
  },
  {
    id: "07_card_stakeholders",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: "button:has-text('Stakeholders'), [role='tab']:has-text('Stakeholders'), [role='tab']:has-text('Interesados')" },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "07_card_stakeholders",
      es: "07_ficha_partes_interesadas",
    },
  },
  {
    id: "08_card_history",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: "button:has-text('History'), [role='tab']:has-text('History'), [role='tab']:has-text('Historial')" },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "08_card_history",
      es: "08_ficha_historial",
    },
  },

  // ── Reports ────────────────────────────────────────────────────────────
  {
    id: "09_reports_menu",
    route: "/reports/portfolio",
    waitFor: "body",
    actions: [{ type: "wait", ms: 400 }],
    filenames: {
      en: "09_reports_menu",
      es: "09_menu_informes",
    },
  },
  {
    id: "10_report_portfolio",
    route: "/reports/portfolio",
    waitFor: ".recharts-responsive-container",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "10_report_portfolio",
      es: "10_informe_portafolio",
    },
  },
  {
    id: "11_capability_map",
    route: "/reports/capability-map",
    waitFor: "[class*='CapabilityMap'], [data-testid='capability-map'], .MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "11_capability_map",
      es: "11_mapa_capacidades",
    },
  },
  {
    id: "12_lifecycle",
    route: "/reports/lifecycle",
    waitFor: ".recharts-responsive-container, [class*='Lifecycle']",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "12_lifecycle",
      es: "12_ciclo_vida",
    },
  },
  {
    id: "13_dependencies",
    route: "/reports/dependencies",
    waitFor: "canvas, svg, [class*='Dependency']",
    actions: [{ type: "wait", ms: 1000 }],
    filenames: {
      en: "13_dependencies",
      es: "13_dependencias",
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
      es: "14_bpm_navegador",
    },
  },
  {
    id: "15_bpm_dashboard",
    route: "/bpm",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      // Click dashboard tab if present
      { type: "click", selector: "button:has-text('Dashboard'), [role='tab']:has-text('Dashboard'), [role='tab']:has-text('Panel')" },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "15_bpm_dashboard",
      es: "15_bpm_panel_control",
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
      es: "16_diagramas",
    },
  },

  // ── EA Delivery ────────────────────────────────────────────────────────
  {
    id: "17_ea_delivery",
    route: "/ea-delivery",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "17_ea_delivery",
      es: "17_entrega_ea",
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
      es: "18_tareas",
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
      { type: "click", selector: "[data-testid='user-menu'], [aria-label='Profile'], header button:last-child, .MuiToolbar-root button:last-of-type" },
      { type: "wait", ms: 400 },
    ],
    filenames: {
      en: "19_user_menu",
      es: "19_menu_usuario",
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
      es: "20_admin_metamodelo",
    },
  },
  {
    id: "21_admin_users",
    route: "/admin/users",
    waitFor: ".MuiPaper-root, .MuiTable-root, .ag-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "21_admin_users",
      es: "21_admin_usuarios",
    },
  },

  // ── Create Card Dialog ─────────────────────────────────────────────────
  {
    id: "22_create_card",
    route: "/inventory",
    waitFor: ".ag-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: "button:has-text('Create'), button:has-text('Crear')" },
      { type: "wait", ms: 500 },
    ],
    filenames: {
      en: "22_create_card",
      es: "22_crear_ficha",
    },
  },

  // ── Inventory Filters ──────────────────────────────────────────────────
  {
    id: "23_inventory_filters",
    route: "/inventory",
    waitFor: ".ag-root",
    actions: [{ type: "wait", ms: 600 }],
    filenames: {
      en: "23_inventory_filters",
      es: "23_inventario_filtros",
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
