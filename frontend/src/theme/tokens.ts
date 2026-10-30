/**
 * Design tokens — single source of truth for color, spacing, radius, typography.
 *
 * Pure TypeScript (no React or MUI imports) so it is tree-shakeable and usable
 * from non-component code. Every value here matches a value already used in
 * the running app — introducing this module is not meant to change anything
 * visually.
 *
 * Naming is semantic: prefer `STATUS_COLORS.success` over `green`. Card-type
 * and layer hex values mirror the runtime canonical config in
 * `backend/app/services/seed.py` and are used as fallbacks when a runtime
 * lookup is not available (e.g. legend keys, static charts).
 *
 * See `frontend/UI_GUIDELINES.md` for usage rules.
 */

// ── Brand & surface ─────────────────────────────────────────────────────

export const brand = {
  primary: "#1976d2",
  /** Lighter brand variant — Material Blue 200. Used as a high-contrast
   *  accent on dark surfaces (snackbar action buttons, dark-mode link
   *  hover, lifecycle "plan" chip), where `primary` is too dark to
   *  legibly stand against the background. */
  primaryLight: "#90caf9",
  /** Turbo EA logo accent — purple→pink. Used only for the Sponsor
   *  affordance (the gradient button next to the version in the profile
   *  menu and the sponsorship dialog's call-to-action buttons). */
  sponsorFrom: "#7B2CBF",
  sponsorTo: "#E91E63",
} as const;

export const surface = {
  light: { default: "#fafbfc", paper: "#fff" },
  dark: { default: "#121212", paper: "#1e1e1e" },
} as const;

// ── Navbar (admin-configurable — these are the built-in defaults/presets) ──

export const NAVBAR_DEFAULTS = { bg: "#1a1a2e", fg: "#ffffff" } as const;

/** Curated navbar background/text combinations offered in Admin → Settings.
 *  Every pair meets WCAG AA contrast (≥ 4.5:1) for normal text. */
export const NAVBAR_PRESETS = [
  { key: "navy", bg: "#1a1a2e", fg: "#ffffff" },
  { key: "light", bg: "#ffffff", fg: "#1a1a2e" },
  { key: "charcoal", bg: "#212121", fg: "#ffffff" },
  { key: "slate", bg: "#1e293b", fg: "#ffffff" },
  { key: "blue", bg: brand.primary, fg: "#ffffff" },
  { key: "forest", bg: "#1b5e20", fg: "#ffffff" },
  { key: "plum", bg: "#4a148c", fg: "#ffffff" },
] as const;

export type NavbarPresetKey = (typeof NAVBAR_PRESETS)[number]["key"];

// ── Status (matches MUI default success/warning/error/info hues) ─────────

export const STATUS_COLORS = {
  success: "#4caf50",
  warning: "#ff9800",
  error: "#f44336",
  info: "#2196f3",
  neutral: "#9e9e9e",
} as const;

// ── Field facets (reports colour-by) ────────────────────────────────────

/** Yes / No colours for a boolean field used as a report's colour-by or
 *  filter facet. "No" is a saturated blue, never a grey: every *Not set*
 *  swatch and `MULTIPLE_VALUE_COLOR` are greys, and a grey "No" read as
 *  "nothing recorded". Not the error red either — a `false` answer is an
 *  answer, not a problem — and green / blue stays apart for red-green
 *  colour-blind readers. */
export const BOOLEAN_COLORS = {
  true: STATUS_COLORS.success,
  false: STATUS_COLORS.info,
} as const;

/** Neutral colour for a card that carries several values at once (a
 *  multi-select field, or relations with differing subtype values). */
export const MULTIPLE_VALUE_COLOR = "#607d8b";

// ── Approval status (cards) ─────────────────────────────────────────────

export const APPROVAL_STATUS_COLORS = {
  DRAFT: STATUS_COLORS.neutral,
  APPROVED: STATUS_COLORS.success,
  BROKEN: STATUS_COLORS.warning,
  REJECTED: STATUS_COLORS.error,
} as const;

// ── Severity / priority (4-step scale) ───────────────────────────────────
// Used by PPM tasks, TurboLens findings, risk levels.

export const SEVERITY_COLORS = {
  critical: "#d32f2f",
  high: "#f57c00",
  medium: "#fbc02d",
  low: "#66bb6a",
} as const;

/** Alias — priority and severity share the same 4-step scale. */
export const PRIORITY_COLORS = SEVERITY_COLORS;

// ── Health / RAG (status reports, BPM dashboards) ────────────────────────

export const HEALTH_COLORS = {
  good: STATUS_COLORS.success,
  warn: STATUS_COLORS.warning,
  bad: STATUS_COLORS.error,
} as const;

// ── EOL coverage (where a card's End-of-Life data comes from) ────────────
// Deliberately not the EOL *status* palette: these say whether anything is
// recorded at all, not how urgent an end of life is, so they avoid red/amber.

export const EOL_COVERAGE_COLORS = {
  linked: "#1976d2",
  manual: "#3949ab",
  missing: STATUS_COLORS.neutral,
} as const;

export const RAG_COLORS = {
  red: "#d32f2f",
  amber: "#f57c00",
  green: "#2e7d32",
} as const;

/** End-of-life warning — an application, component or capability whose end of
 *  life has passed or is near (reports, card lists, the Process Navigator
 *  drawer) — orange 900. Not the BusinessProcess card-type colour, which
 *  shares the value today. */
export const EOL_WARNING_COLOR = "#e65100";

// ── Print pages (a bare browser window outside the MUI theme) ────────────

/** Inks of every print page the app opens in a new window (`lib/printDocument.ts`,
 *  the BPM process-flow print): white paper, outside the MUI theme and dark mode. */
export const PRINT_COLORS = {
  text: "#333333",
  muted: "#888888",
  rule: "#dddddd",
  panel: "#f5f5f5",
  control: "#cccccc", // border of the secondary (Close) button, table rules
  paper: "#ffffff", // also the text on a filled (fully-signed) badge
  // The document print (`DOCUMENT_PRINT_CSS`): headings, body ink, the
  // signature block's rule, cards and badges.
  heading: "#1a1a2e", // h1 title
  ink: "#222222", // body text
  subheading: "#444444", // h3
  inkSecondary: "#666666", // a signature's detail line
  ruleLight: "#e0e0e0", // the rule above the signatures
  panelLight: "#fafafa", // a pending signature card
  success: "#2e7d32", // signed: badge text, fully-signed fill, approved status
  successLight: "#66bb6a", // an approved signature card's border
  successPale: "#f1f8e9", // an approved signature card's fill
  successTint: "#e8f5e9", // the "signed" badge's fill
  warning: "#ed6c02", // a pending signature's status
} as const;

// ── Notification-type accents (NotificationBell) ─────────────────────────
// Categorical palette used only to visually differentiate notification
// types in the bell dropdown — not a semantic status scale. Values reuse
// existing tokens where the hue matches exactly; the rest are MUI accent
// hues kept verbatim so the dropdown looks unchanged.

export const NOTIFICATION_TYPE_COLORS = {
  todo_assigned: brand.primary, // #1976d2
  task_assigned: "#7b1fa2", // purple 700
  card_updated: "#ed6c02", // orange 800
  comment_added: RAG_COLORS.green, // #2e7d32
  approval_status_changed: "#9c27b0", // purple 500
  soaw_sign_requested: RAG_COLORS.red, // #d32f2f
  soaw_signed: RAG_COLORS.green, // #2e7d32
  survey_request: "#0288d1", // light blue 700
  app_update_available: "#00796b", // teal 700
  app_updated: "#5e35b1", // deep purple 600
  extension_available: "#00838f", // cyan 800
  extension_update_available: "#ef6c00", // orange 800
  extension_updated: "#2e7d32", // green 800 — it landed, unlike the amber "available"
  extension_notice: "#00695c", // teal 800 — a message an installed extension sent
  // Documents and approvals reuse their family's hue so a glance at the bell
  // groups them: SoAW/ADR signature traffic red-to-green, process flow amber,
  // risk deep red, compliance teal.
  soaw_sign_recalled: "#795548", // brown 500
  soaw_rejected: RAG_COLORS.red, // #d32f2f
  adr_sign_requested: RAG_COLORS.red, // #d32f2f
  adr_signed: RAG_COLORS.green, // #2e7d32
  adr_sign_recalled: "#795548", // brown 500
  adr_rejected: RAG_COLORS.red, // #d32f2f
  process_flow_approval_requested: RAG_COLORS.amber, // #f57c00
  process_flow_approved: RAG_COLORS.green, // #2e7d32
  process_flow_rejected: RAG_COLORS.red, // #d32f2f
  process_flow_withdrawn: "#795548", // brown 500
  risk_assigned: "#c62828", // red 800
  risk_status_changed: "#ad1457", // pink 800
  security_scan_complete: "#00695c", // teal 800
  ops_rescue_access: "#b71c1c", // red 900 — security alert
} as const;

// ── Data quality buckets (Dashboard chart) ───────────────────────────────

export const DATA_QUALITY_COLORS = {
  "0-25": STATUS_COLORS.error,
  "25-50": STATUS_COLORS.warning,
  "50-75": STATUS_COLORS.info,
  "75-100": STATUS_COLORS.success,
} as const;

// ── Compliance finding lifecycle (GRC > Compliance) ─────────────────────
// 4-state main path + 3 side branches. Visualised in the
// ComplianceLifecycleTimeline at the top of the FindingDetailDrawer.

export const COMPLIANCE_LIFECYCLE_COLORS = {
  new: STATUS_COLORS.info,
  in_review: STATUS_COLORS.warning,
  mitigated: "#9ccc65", // lime — "applied, awaiting verification"
  verified: STATUS_COLORS.success,
  risk_tracked: STATUS_COLORS.error,
  accepted: "#2e7d32", // dark green — terminal acceptance
  not_applicable: STATUS_COLORS.neutral,
} as const;

export type ComplianceLifecycleState = keyof typeof COMPLIANCE_LIFECYCLE_COLORS;

// Ordered main-path states for the timeline; side branches are rendered
// as a badge above the line, not as a phase dot.
export const COMPLIANCE_LIFECYCLE_MAIN_PATH: ComplianceLifecycleState[] = [
  "new",
  "in_review",
  "mitigated",
  "verified",
];

export const COMPLIANCE_LIFECYCLE_SIDE_BRANCHES: ComplianceLifecycleState[] = [
  "risk_tracked",
  "accepted",
  "not_applicable",
];

// ── Card-type fallbacks ──────────────────────────────────────────────────
// Runtime canonical values come from the per-type config in the database
// (admin-editable). These are static fallbacks for legend keys and code that
// needs a value before / without a metamodel lookup.

export const CARD_TYPE_COLORS = {
  Objective: "#c7527d",
  Platform: "#027446",
  Initiative: "#33cc58",
  Organization: "#2889ff",
  BusinessCapability: "#003399",
  BusinessContext: "#fe6690",
  BusinessProcess: "#028f00",
  Application: "#0f7eb5",
  Interface: "#02afa4",
  DataObject: "#774fcc",
  ITComponent: "#d29270",
  TechCategory: "#a6566d",
  Provider: "#ffa31f",
  System: "#5B738B",
} as const;

// ── EA layers (Layered Dependency View, capability map, dependency report) ─

export const LAYER_COLORS = {
  "Strategy & Transformation": "#33cc58",
  "Business Architecture": "#2889ff",
  "Application & Data": "#0f7eb5",
  "Technical Architecture": "#d29270",
} as const;

/**
 * The colour of a layer that has none of its own: a custom category created
 * without one (the backend's default too, `card_type_categories.DEFAULT_COLOR`)
 * or a category value the registry does not know.
 */
export const DEFAULT_LAYER_COLOR = "#999999";

// ── Vendor accent (VendorField, Provider chips) ─────────────────────────

export const VENDOR_ACCENT = {
  fill: CARD_TYPE_COLORS.Provider, // #ffa31f
  border: "#e68a00",
} as const;

// ── Time-travel slider accents ──────────────────────────────────────────

export const TIMELINE_COLORS = {
  past: "#e68a00",
  future: "#7c4dff",
  reset: "#ef6c00",
  /** Go-live accent — a card becoming active on the timeline. Deliberately
   *  more saturated than `brand.primary`: transition marks are 3px wide, and
   *  at that size the darker brand blue reads as grey next to the red
   *  retirement mark. Also used for the matching highlight pulse, so the mark
   *  and the card it points at are unmistakably the same colour. */
  goLive: "#0177FF",
  /** A transition mark where cards both arrive and retire — blue and red at
   *  once. As vibrant as `goLive` and `STATUS_COLORS.error`, since it sits in
   *  the same 3px-wide company. Deliberately a DIFFERENT purple from `future`:
   *  on the canvas that violet means "arriving later", and reusing it on the
   *  track would give one colour two meanings inside the same feature. */
  mixed: "#9c27b0",
} as const;

// ── Categorical series ──────────────────────────────────────────────────

/**
 * Qualitative palette for values that have no colour of their own — an
 * admin-defined select option left uncoloured, a boolean flag, a series the
 * metamodel says nothing about. Assign by a stable hash of the value's key so
 * the same value keeps the same colour across renders, reports and sessions.
 *
 * Hues are spread far enough apart to stay distinguishable next to each other
 * and legible on both the light and dark paper surfaces.
 */
export const CATEGORICAL_COLORS = [
  "#1976d2",
  "#7b1fa2",
  "#00897b",
  "#ef6c00",
  "#c2185b",
  "#3949ab",
  "#00838f",
  "#5d4037",
  "#558b2f",
  "#d32f2f",
] as const;

// ── Dashboard charts (ECharts) ──────────────────────────────────────────

/**
 * Fixed-order categorical hues for dashboard charts, selected per mode (the
 * dark column is the same eight hues stepped for the dark paper, not a flip).
 * Assign by slot index in a fixed order, never cycled: a ninth category folds
 * into "Other". The order is part of the colour-blind safety — validated with
 * the dataviz palette script against `surface.*.paper` (light: worst adjacent
 * CVD ΔE 9.1, normal-vision 19.6; dark: 8.4 / 19.3). Three light slots sit
 * under 3:1 on white, so dashboard charts always carry a tooltip and a legend
 * or direct labels. Status dimensions use their status tokens instead.
 */
export const CHART_CATEGORICAL = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
} as const;

/** The Cost report treemap's tile fills: a sequential blue ramp, cycled by
 *  cost rank (index 0 is the most expensive card), kept from the original
 *  Cost report so the look does not change. */
export const COST_TREEMAP_COLORS = [
  "#1565c0",
  "#1976d2",
  "#1e88e5",
  "#2196f3",
  "#42a5f5",
  "#64b5f6",
  "#90caf9",
  "#bbdefb",
  "#0d47a1",
  "#1565c0",
] as const;

/** Label text printed on a dark, saturated chart fill (the cost treemap's
 *  blue tiles), and its translucent variant for a secondary line. */
export const CHART_LABEL_ON_DARK = "#ffffff";
export const CHART_LABEL_ON_DARK_MUTED = "rgba(255,255,255,0.8)";

/** Single-hue sequential ramp ends (low → high) for heatmaps and their
 *  legend, per mode, anchored on the brand blue so a heatmap reads as the
 *  app's own colour. Light: Material Blue 50 (`#e3f2fd`, recedes into the
 *  white paper) → `brand.primary` (`#1976d2`, 4.6:1 on white). Dark: a deep
 *  navy (`#1e3a5f`, recedes into the dark paper) → `brand.primaryLight`
 *  (Material Blue 200), the brand's legible variant on dark surfaces. */
export const CHART_SEQUENTIAL = {
  light: ["#e3f2fd", brand.primary],
  dark: ["#1e3a5f", brand.primaryLight],
} as const;

/** Accent colours of the homepage KPI tiles — the values the Overview,
 *  My Workspace and Admin tiles have always used, named once here. */
export const DASHBOARD_KPI_COLORS = {
  total: brand.primary,
  completion: STATUS_COLORS.success,
  approved: RAG_COLORS.green,
  broken: RAG_COLORS.amber,
  favorites: "#f5a623",
  stakeholders: brand.primary,
  todos: "#43a047",
  surveys: "#7b1fa2",
  activeUsers: "#43a047",
  noStakeholders: "#ef6c00",
  overdue: RAG_COLORS.red,
  stuck: "#7b1fa2",
  /** Overall data quality: ≥ 75 %, ≥ 50 %, below. */
  qualityGood: "#43a047",
  qualityFair: "#f5a623",
  qualityPoor: RAG_COLORS.red,
} as const;

/** The BPM process-assessment trend: one categorical hue per scored
 *  dimension, keyed by the assessment field it plots — not a status scale. */
export const BPM_ASSESSMENT_COLORS = {
  overall_score: brand.primary,
  efficiency: "#4caf50",
  effectiveness: "#ff9800",
  compliance: "#9c27b0",
  automation: "#00bcd4",
} as const;

// ── BPM ─────────────────────────────────────────────────────────────────
// The BPM screens' own hues, kept at the values they have always rendered.
// A token is referenced only where the hue IS that token's meaning (a data
// object is the DataObject card); a hue that merely shares a value stays a literal.

/** BPMN element-type icon colours, keyed by element family (resolved per
 *  element type in `features/bpm/elementTypes.ts`). This is the BPMN icon
 *  palette and is deliberately literal, not references to the brand, severity,
 *  RAG or card-type tokens that happen to share a value today: re-tuning one of
 *  those (e.g. correcting the BusinessProcess fallback to the seeded `#028f00`)
 *  must not repaint a BPMN element. */
export const BPMN_ELEMENT_COLORS = {
  task: "#1976d2", // task, user task — blue 700
  service: "#7b1fa2", // service task — purple 700
  script: "#00695c", // script task — teal 800
  rule: "#e65100", // business-rule task, boundary event — orange 900
  messaging: "#0097a7", // send / receive task — cyan 700
  manual: "#795548", // manual task — brown 500
  subprocess: "#512da8", // call activity, sub-process, transaction, ad-hoc — deep purple 700
  gateway: "#f57c00", // every gateway, intermediate events — orange 700
  start: "#2e7d32", // start event — green 800
  end: "#c62828", // end event — red 800
  data: CARD_TYPE_COLORS.DataObject, // data object / data store references — #774fcc
  unknown: "#999999", // an element type the app does not know yet
} as const;

/** A Process Navigator card with no value for the chosen colour overlay, or a value no option knows. */
export const BPM_UNSET_COLOR = "#bdbdbd";

/** The BusinessProcess type colour as seeded (`seed.py`, pinned by `tokens.test.ts`): the
 *  called-process badge, its link dot and the navigator header fallback, which also render
 *  where no metamodel is loaded (portals). */
export const BPM_CALLED_PROCESS_COLOR = CARD_TYPE_COLORS.BusinessProcess;

/** Fill the read-only BPMN viewer paints behind an automated task — green 50. */
export const BPM_HIGHLIGHT_FILL = "#e8f5e9";

/** Message-flow rows (Process Flow → Message flows) share the messaging elements' hue. */
export const BPM_MESSAGE_FLOW_COLOR = BPMN_ELEMENT_COLORS.messaging;

/** Process-flow accent — the diagram icon on a navigator card and its "published flow" state, and
 *  the "Auto" chip on an automated step. Purple 700, the service-task hue, but a different meaning. */
export const BPM_FLOW_ACCENT_COLOR = "#7b1fa2";

/** Hue of the faint wash behind an automated step in the navigator's step list (drawn at 4 %
 *  alpha) — deep purple 400. */
export const BPM_AUTOMATED_STEP_TINT = "#7e57c2";

/** Outline of a link dot on the BPMN canvas, so a pale card-type colour still reads on white. */
export const BPM_LINK_DOT_OUTLINE = "rgba(0,0,0,0.25)";

/** Process-type option colours as seeded (`seed.py` `PROCESS_TYPE_OPTIONS`): the fallback while
 *  the metamodel loads. Literals that mirror the seed, deliberately not tied to the brand token
 *  that happens to share a value. */
export const BPM_PROCESS_TYPE_COLORS = {
  core: "#1976d2", // blue 700
  support: "#607d8b", // blue grey 500
  management: "#9c27b0", // purple 500
} as const;

/** Dark-mode values for the `--bio-*` variables of `@bpmn-io/properties-panel`, whose stylesheet
 *  ships light values only (applied in `features/bpm/bpmnStyles.ts`). The danger / warning /
 *  focus variables are left alone: they are contrast colours that read on either surface. */
export const BPMN_DARK_THEME = {
  "--bio-surface": surface.dark.paper, // #1e1e1e
  "--bio-surface-overlay": surface.dark.paper, // #1e1e1e
  "--bio-surface-subtle": "#232323",
  "--bio-surface-medium": "#2a2a2a",
  "--bio-surface-strong": "#333333",
  "--bio-surface-inverted": "#e0e0e0",
  "--bio-text": "hsl(0, 0%, 92%)",
  "--bio-text-subtle": "hsl(0, 0%, 72%)",
  "--bio-text-subtlest": "hsl(0, 0%, 58%)",
  "--bio-text-on-inverted": "hsl(0, 0%, 12%)",
  "--bio-border": "hsl(0, 0%, 32%)",
  "--bio-border-subtle": "hsl(0, 0%, 26%)",
  "--bio-border-disabled": "hsl(0, 0%, 22%)",
  "--bio-border-input": "hsl(0, 0%, 38%)",
  "--bio-primary-surface": "hsl(205, 60%, 18%)",
  "--bio-primary-surface-strong": "hsl(205, 60%, 26%)",
  "--bio-danger-surface": "hsl(360, 50%, 22%)",
  "--bio-danger-surface-subtle": "hsl(360, 40%, 16%)",
  "--bio-warning-surface": "hsl(38, 50%, 18%)",
  "--bio-shadow": "hsla(0, 0%, 0%, 60%)",
  "--bio-shadow-subtle": "hsla(0, 0%, 0%, 35%)",
} as const;

// ── Non-color tokens ────────────────────────────────────────────────────

/** Border radius scale (px). MUI's `borderRadius` `sx` prop also accepts numbers from the spacing scale. */
export const radius = { sm: 4, md: 8, lg: 12 } as const;

/**
 * Shadows for an outlined card in an arrange mode (the dashboard's customize
 * mode). `soft` is the resting cue that the card can be picked up and moved;
 * `lifted` says it is in hand while it is dragged. Both are faint and widely
 * diffused on purpose — a large blur at a low alpha reads as a card floating
 * well above the page rather than a rim around it; the card keeps its
 * outlined border, and the shadow only adds to it.
 */
export const CARD_SHADOW = {
  soft: "0 8px 24px rgba(0, 0, 0, 0.06)",
  lifted: "0 16px 40px rgba(0, 0, 0, 0.14)",
} as const;

/** Spacing aliases for the MUI scale (1 unit = 8px by default). */
export const spacing = { xs: 0.5, sm: 1, md: 1.5, lg: 2, xl: 3 } as const;

/** Icon size scale (px) for `<MaterialSymbol size={...}>`. */
export const iconSize = { xs: 16, sm: 18, md: 20, lg: 24, xl: 32 } as const;

export const typography = {
  fontFamily: "'Inter', sans-serif",
  h1: { fontSize: "2rem", fontWeight: 600 },
  h2: { fontSize: "1.5rem", fontWeight: 600 },
  h3: { fontSize: "1.25rem", fontWeight: 600 },
} as const;

// ── Type exports ────────────────────────────────────────────────────────

export type StatusKey = keyof typeof STATUS_COLORS;
export type ApprovalStatusKey = keyof typeof APPROVAL_STATUS_COLORS;
export type SeverityKey = keyof typeof SEVERITY_COLORS;
export type CardTypeKey = keyof typeof CARD_TYPE_COLORS;
export type LayerKey = keyof typeof LAYER_COLORS;
