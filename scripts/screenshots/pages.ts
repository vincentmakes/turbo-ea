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
  sampleApp: { name: "SAP S/4HANA", type: "Application" },
} as const;

// ---------------------------------------------------------------------------
// Shared click-selector helpers (all locale variants for tab/button labels)
// ---------------------------------------------------------------------------

/** Build a comma-separated has-text selector chain for a tab across locales. */
function tabSelector(...labels: string[]): string {
  return labels
    .flatMap((l) => [`button:has-text('${l}')`, `[role='tab']:has-text('${l}')`])
    .join(", ");
}

const TAB_COMMENTS = tabSelector(
  "Comments", "Kommentare", "Commentaires", "Comentarios",
  "Commenti", "Comentários", "评论",
);
const TAB_TODOS = tabSelector(
  "Todos", "Aufgaben", "Tâches", "Tareas", "Attività", "Tarefas", "待办事项",
);
const TAB_STAKEHOLDERS = tabSelector(
  "Stakeholders", "Stakeholder", "Parties prenantes", "Partes interesadas",
  "Partes interessadas", "利益相关者",
);
const TAB_HISTORY = tabSelector(
  "History", "Historie", "Historique", "Historial",
  "Cronologia", "Histórico", "历史",
);
const TAB_BPM_DASHBOARD = tabSelector(
  "Dashboard", "Tableau de bord", "Panel de Control", "Painel", "仪表盘",
);
const TAB_METAMODEL_GRAPH = tabSelector(
  "Metamodel Graph", "Metamodell-Graph", "Graphe du métamodèle",
  "Grafo del metamodelo", "Grafo metamodello", "Grafo do metamodelo", "元模型图",
);
const TAB_ROLES = tabSelector(
  "Roles", "Rollen", "Rôles", "Ruoli", "Papéis", "角色",
);
const TAB_DECISIONS = tabSelector(
  "Architecture Decisions", "Architekturentscheidungen", "Décisions d'architecture",
  "Decisiones de arquitectura", "Decisioni architetturali", "Decisões de arquitetura",
  "架构决策",
);
const TAB_RESOURCES = tabSelector(
  "Resources", "Ressourcen", "Ressources", "Recursos",
  "Risorse", "资源",
);
const BTN_CREATE = [
  "button:has-text('Create')", "button:has-text('Erstellen')",
  "button:has-text('Créer')", "button:has-text('Crear')",
  "button:has-text('Crea')", "button:has-text('Criar')", "button:has-text('创建')",
].join(", ");

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
      de: "02_dashboard_unten",
      fr: "02_tableau_de_bord_bas",
      es: "02_panel_inferior",
      it: "02_dashboard_inferiore",
      pt: "02_painel_inferior",
      zh: "02_dashboard_bottom",
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
      de: "03_inventar",
      fr: "03_inventaire",
      es: "03_inventario",
      it: "03_inventario",
      pt: "03_inventario",
      zh: "03_inventory",
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
      de: "04_karten_detail",
      fr: "04_detail_fiche",
      es: "04_detalle_ficha",
      it: "04_dettaglio_scheda",
      pt: "04_detalhe_ficha",
      zh: "04_card_detail",
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
      de: "09_berichte_menu",
      fr: "09_menu_rapports",
      es: "09_menu_informes",
      it: "09_menu_report",
      pt: "09_menu_relatorios",
      zh: "09_reports_menu",
    },
  },
  {
    id: "10_report_portfolio",
    route: "/reports/portfolio",
    waitFor: ".recharts-responsive-container",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "10_report_portfolio",
      de: "10_bericht_portfolio",
      fr: "10_rapport_portfolio",
      es: "10_informe_portafolio",
      it: "10_report_portfolio",
      pt: "10_relatorio_portfolio",
      zh: "10_report_portfolio",
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
    },
  },
  {
    id: "12_lifecycle",
    route: "/reports/lifecycle",
    waitFor: ".recharts-responsive-container, [class*='Lifecycle']",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "12_lifecycle",
      de: "12_lebenszyklus",
      fr: "12_cycle_de_vie",
      es: "12_ciclo_vida",
      it: "12_ciclo_vita",
      pt: "12_ciclo_vida",
      zh: "12_lifecycle",
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
      de: "17_ea_lieferung",
      fr: "17_livraison_ea",
      es: "17_entrega_ea",
      it: "17_consegna_ea",
      pt: "17_entrega_ea",
      zh: "17_ea_delivery",
    },
  },

  // ── EA Delivery — ADR Decisions Tab ──────────────────────────────────
  {
    id: "17b_ea_delivery_decisions",
    route: "/ea-delivery",
    waitFor: ".MuiPaper-root",
    actions: [
      { type: "wait", ms: 400 },
      { type: "click", selector: TAB_DECISIONS },
      { type: "wait", ms: 600 },
    ],
    filenames: {
      en: "17b_ea_delivery_decisions",
      de: "17b_ea_lieferung_entscheidungen",
      fr: "17b_livraison_ea_decisions",
      es: "17b_entrega_ea_decisiones",
      it: "17b_consegna_ea_decisioni",
      pt: "17b_entrega_ea_decisoes",
      zh: "17b_ea_delivery_decisions",
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
      de: "19_benutzer_menu",
      fr: "19_menu_utilisateur",
      es: "19_menu_usuario",
      it: "19_menu_utente",
      pt: "19_menu_usuario",
      zh: "19_user_menu",
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
      de: "23_inventar_filter",
      fr: "23_inventaire_filtres",
      es: "23_inventario_filtros",
      it: "23_inventario_filtri",
      pt: "23_inventario_filtros",
      zh: "23_inventory_filters",
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
    },
  },

  // ── AI Suggest Panel on Card Detail ─────────────────────────────────────
  {
    id: "27_ai_suggest_panel",
    route: "/cards/{{cardId:sampleApp}}",
    waitFor: "[data-testid='card-detail'], [class*='CardDetail'], h5, h4",
    actions: [
      { type: "wait", ms: 400 },
      // Click the AI suggest sparkle button
      { type: "click", selector: "button[aria-label*='AI'], button[aria-label*='suggest'], button:has(.material-symbols-outlined:has-text('auto_awesome')), [data-testid='ai-suggest-btn']" },
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
    },
  },

  // ── Matrix Report ───────────────────────────────────────────────────────
  {
    id: "35_report_matrix",
    route: "/reports/matrix",
    waitFor: ".MuiPaper-root",
    actions: [{ type: "wait", ms: 800 }],
    filenames: {
      en: "35_report_matrix",
      de: "35_bericht_matrix",
      fr: "35_rapport_matrice",
      es: "35_informe_matriz",
      it: "35_report_matrice",
      pt: "35_relatorio_matriz",
      zh: "35_report_matrix",
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
