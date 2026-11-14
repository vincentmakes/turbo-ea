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

import type { ArchimateLayer } from "@/features/archimate/taxonomy/elements";

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

// ── Admin pickers (built-in presets) ─────────────────────────────────────

/** The swatches the role editor (`RolesAdmin`) offers for a role's colour, in
 *  display order; the first is the colour a new role starts with. A role stores
 *  the colour it was given, so this list is a design choice, not data — editing
 *  it never repaints an existing role. Twelve Material 700 hues, far enough apart
 *  to tell twelve role chips apart. */
export const ROLE_COLOR_PRESETS = [
  "#1976d2", // blue 700
  "#388e3c", // green 700
  "#d32f2f", // red 700
  "#f57c00", // orange 700
  "#7b1fa2", // purple 700
  "#0097a7", // cyan 700
  "#c2185b", // pink 700
  "#5d4037", // brown 700
  "#455a64", // blue grey 700
  "#303f9f", // indigo 700
  "#00796b", // teal 700
  "#afb42b", // lime 700
] as const;

/** The type chip on a field in the metamodel's card-layout editor
 *  (`CardLayoutEditor`): one hue per built-in field type, so a glance down a
 *  section tells text from numbers from selects. A categorical key, not a
 *  status scale. `other` is any type without its own hue — `multiline_text`
 *  and every extension-contributed custom type. */
export const FIELD_TYPE_COLORS = {
  text: "#1976d2", // blue 700
  number: "#7b1fa2", // purple 700
  cost: "#e65100", // orange 900
  boolean: "#2e7d32", // green 800
  date: "#c2185b", // pink 700
  url: "#0277bd", // light blue 800
  single_select: "#00838f", // cyan 800
  multiple_select: "#4527a0", // deep purple 800
  percentage: "#00695c", // teal 800
  other: "#616161", // grey 700
} as const;

export type FieldTypeColorKey = keyof typeof FIELD_TYPE_COLORS;

/** Icon accents in the reports area that take a field-type hue: the Data
 *  Quality report's tile, the Cost report's top-cost-driver KPI and a private
 *  saved report's lock. A role alias, so those screens say what they mean
 *  rather than borrowing the card-layout editor's chip palette; the values are
 *  `FIELD_TYPE_COLORS`' teal 800, orange 900 and grey. */
export const REPORT_ICON_COLORS = {
  dataQuality: FIELD_TYPE_COLORS.percentage,
  costDriver: FIELD_TYPE_COLORS.cost,
  privateReport: FIELD_TYPE_COLORS.other,
} as const;

// ── Status (matches MUI default success/warning/error/info hues) ─────────

export const STATUS_COLORS = {
  success: "#4caf50",
  warning: "#ff9800",
  error: "#f44336",
  info: "#2196f3",
  neutral: "#9e9e9e",
} as const;

/** The warning orange's darker step — orange 800, MUI's *default*
 *  `palette.warning.main`. The app theme wires the lighter
 *  `STATUS_COLORS.warning` (#ff9800, 2.2:1 on white) into the palette, which is
 *  too faint for a small glyph or a dot, so a warning drawn as an icon next to
 *  `RAG_COLORS.green` / `.red` (MUI's default success and error) takes this one
 *  (3.1:1): a pending signature, an invited user, an at-risk project, a medium
 *  TurboLens finding, the diagram editor's "out of sync" pulse. Not
 *  `RAG_COLORS.amber` (#f57c00, orange 700), the status-report amber. */
export const WARNING_STRONG_COLOR = "#ed6c02";

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

/** A status shown as a soft chip: a pale fill with dark text of the same hue
 *  (Material 50 fill, 800–900 text). Used where a verdict sits inside
 *  dense content and a saturated chip would shout — the web portal's approval
 *  and data-quality chips. The text hues are the darker steps of the status
 *  family, not `STATUS_COLORS`, which are too light to read as text on a tint. */
export const STATUS_CHIP_COLORS = {
  success: { fill: "#e8f5e9", text: "#2e7d32" }, // green 50 / green 800
  warning: { fill: "#fff3e0", text: "#e65100" }, // orange 50 / orange 900
  error: { fill: "#ffebee", text: "#c62828" }, // red 50 / red 800
} as const;

export type StatusChipKey = keyof typeof STATUS_CHIP_COLORS;

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

// ── Lifecycle phases ────────────────────────────────────────────────────

/** One colour per lifecycle phase, wherever a phase is drawn as a colour — the
 *  card's Lifecycle section, the Layered Dependency View's phase dot, the
 *  Lifecycle report, the inventory's phase filter, a web portal's lifecycle
 *  bar. Keys are `PHASES` (`lib/lifecyclePhases.ts`).
 *
 *  These five surfaces used to carry five palettes that disagreed on every
 *  phase but "plan" (phase in alone was #1976d2, #2196f3, #42a5f5 and #66bb6a).
 *  The canonical set is the card detail page's (the Lifecycle section, where
 *  people read a lifecycle most): plan grey, phase in brand blue, active green
 *  800, phase out orange 800 — Material's darker status steps, because a phase
 *  is told apart by colour alone on a dot or a bar segment and these clear 3:1
 *  against both white and the dark paper, which the lighter `STATUS_COLORS`
 *  hues do not (#4caf50 2.8:1, #ff9800 2.2:1 on white). End of life is red 700
 *  rather than the section's former red 800 (#c62828): red 800 falls under 3:1
 *  on the dark paper (2.97:1), red 700 clears both (5.0:1 / 3.4:1). Plan stays
 *  neutral grey: it is "not started yet", nothing to call attention to.
 *  Literals, not references to `STATUS_COLORS` / `brand`, so re-tuning those
 *  never repaints a lifecycle. */
export const LIFECYCLE_PHASE_COLORS = {
  plan: "#9e9e9e", // grey 500
  phaseIn: "#1976d2", // blue 700
  active: "#2e7d32", // green 800
  phaseOut: "#ed6c02", // orange 800
  endOfLife: "#d32f2f", // red 700
} as const;

export type LifecyclePhaseColorKey = keyof typeof LIFECYCLE_PHASE_COLORS;

// ── Print pages (a bare browser window outside the MUI theme) ────────────

/** Inks of every print page the app opens in a new window (`lib/printDocument.ts`,
 *  the BPM process-flow print): white paper, outside the MUI theme and dark mode. */
export const PRINT_COLORS = {
  text: "#333333",
  muted: "#888888",
  rule: "#e0e0e0", // grey 300, MUI's divider on white — the same rule as `ruleLight`
  panel: "#f5f5f5",
  control: "#cccccc", // border of the secondary (Close) button, table rules
  paper: "#ffffff", // also the text on a filled (fully-signed) badge
  // The document print (`DOCUMENT_PRINT_CSS`): headings, body ink, the
  // signature block's rule, cards and badges.
  heading: "#1a1a2e", // h1 title
  ink: "#212121", // body text — grey 900, the charcoal navbar preset
  subheading: "#444444", // h3
  inkSecondary: "#616161", // a signature's detail line — grey 700
  ruleLight: "#e0e0e0", // the rule above the signatures
  panelLight: "#fafbfc", // a pending signature card — the light page background
  success: "#2e7d32", // signed: badge text, fully-signed fill, approved status
  successLight: "#66bb6a", // an approved signature card's border
  successPale: "#e8f5e9", // an approved signature card's fill — green 50, as `successTint`
  successTint: "#e8f5e9", // the "signed" badge's fill
  warning: "#ed6c02", // a pending signature's status
} as const;

/** Fixed inks drawn ON SCREEN whose colour is decided by what they sit on (a
 *  light card-type fill, a heat step, a diagram line), not by the theme's text
 *  colours. They share the print inks' values; this alias names the on-screen
 *  role so the report screens do not borrow the print palette.
 *  - `onLightFill`: dark text on a light fill in either mode (capability map,
 *    portfolio, process map, the matrix's low counts in light mode).
 *  - `onDark`: light text on a dark cell (the matrix's low counts in dark mode).
 *  - `secondary`: a quiet line or label (the matrix diagonal's count, the
 *    Layered Dependency View's resting line and label in light mode).
 *  - `muted`: the Layered Dependency View's arrowhead.
 *  - `rule` / `ruleDark`: a Layered Dependency View label's border, light / dark.
 *  - `paper`: a Layered Dependency View label's background in light mode. */
export const SCREEN_INK = {
  onLightFill: PRINT_COLORS.text,
  onDark: PRINT_COLORS.control,
  secondary: PRINT_COLORS.inkSecondary,
  muted: PRINT_COLORS.muted,
  rule: PRINT_COLORS.control,
  ruleDark: PRINT_COLORS.subheading,
  paper: PRINT_COLORS.paper,
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
  extension_update_available: "#ed6c02", // orange 800 (MUI's default warning)
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
  // A decision's standing moved (replaced, amended, revoked): informational,
  // the decision family's amber rather than an alarm.
  adr_standing_changed: RAG_COLORS.amber, // #f57c00
  // Discussion on a decision or SoAW: the card-comment green for a comment,
  // the primary blue for being named in one.
  document_comment: RAG_COLORS.green, // #2e7d32
  document_mention: brand.primary, // #1976d2
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
  reset: "#ed6c02",
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
  "#ed6c02",
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

/** Label text printed on a dark, saturated chart fill (the cost treemap's
 *  blue tiles), and its translucent variant for a secondary line. */
/** The change badge on a Cost treemap tile: a rise, a fall (light enough to read on the blues). */
export const COST_DELTA_UP = "#a5d6a7";
export const COST_DELTA_DOWN = "#ef9a9a";

export const COST_DELTA_UP_ON_LIGHT = "#1b5e20";
export const COST_DELTA_DOWN_ON_LIGHT = "#b71c1c";

/** The folded "Others" group of a chart (past the eighth hue), per mode. */
export const CHART_OTHER = { light: "#b4b2a8", dark: "#4b4a45" } as const;
/** The Cost report's no-group bucket, lighter than `CHART_OTHER` so the two never read as one. */
export const COST_UNSPECIFIED = { light: "#d9d7cf", dark: "#6a6860" } as const;

/** Label text printed on a light chart fill. */
export const CHART_LABEL_ON_LIGHT = "#0b0b0b";
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

/** A discrete ten-step heat scale (low → high count) per mode, for a grid of
 *  counts read cell by cell — the Matrix report. Not `CHART_SEQUENTIAL`: that
 *  is a two-stop continuous ramp ending at the brand blue, while this one has
 *  ten fixed Material Blue steps running past it to blue 900 in light mode, so
 *  the busiest cells stand out from the merely busy; its stops are neither the
 *  same nor a subset (dark mode ends at blue 400, not blue 200). Index by
 *  `floor(value / max × 9)`. */
export const HEATMAP_RAMP = {
  light: [
    "#e3f2fd",
    "#bbdefb",
    "#90caf9",
    "#64b5f6",
    "#42a5f5",
    "#2196f3",
    "#1e88e5",
    "#1976d2",
    "#1565c0",
    "#0d47a1",
  ],
  dark: [
    "#0d2137",
    "#0d3054",
    "#0a3d6e",
    "#0d4a88",
    "#10579e",
    "#1565c0",
    "#1976d2",
    "#1e88e5",
    "#2196f3",
    "#42a5f5",
  ],
} as const;

/** The hue of the Matrix report's hovered diagonal (a card type against itself,
 *  where a row and a column are the same card), drawn as a wash: 10 % alpha on
 *  the light paper, 18 % on the dark one. Deep purple 800, the value of
 *  `FIELD_TYPE_COLORS.multiple_select`, named here for this role: no other
 *  token is a "self cell" highlight, and it must stay apart from the blue of a
 *  related, hovered cell (`HEATMAP_RAMP`). */
export const MATRIX_DIAGONAL_COLOR = FIELD_TYPE_COLORS.multiple_select;

/** Accent colours of the homepage KPI tiles — the values the Overview,
 *  My Workspace and Admin tiles have always used, named once here. */
export const DASHBOARD_KPI_COLORS = {
  total: brand.primary,
  completion: STATUS_COLORS.success,
  approved: RAG_COLORS.green,
  broken: RAG_COLORS.amber,
  favorites: "#f5a623",
  stakeholders: brand.primary,
  todos: STATUS_COLORS.success,
  surveys: "#7b1fa2",
  activeUsers: STATUS_COLORS.success,
  noStakeholders: "#ed6c02",
  overdue: RAG_COLORS.red,
  stuck: "#7b1fa2",
  // Activity feeds (system activity, recent activity on my cards).
  activity: "#5e35b1",
  /** Overall data quality: ≥ 75 %, ≥ 50 %, below. */
  qualityGood: STATUS_COLORS.success,
  qualityFair: "#f5a623",
  qualityPoor: RAG_COLORS.red,
} as const;

/** A favourite: the star on a card, an initiative or a diagram, the
 *  favourites-only filter and the My Favourites section. The amber of the
 *  homepage's Favourites KPI tile, named for every screen that marks one. */
export const FAVORITE_COLOR = DASHBOARD_KPI_COLORS.favorites;

/** The BPM process-assessment trend: one categorical hue per scored
 *  dimension, keyed by the assessment field it plots — not a status scale. */
export const BPM_ASSESSMENT_COLORS = {
  overall_score: brand.primary,
  efficiency: "#4caf50",
  effectiveness: "#ff9800",
  compliance: "#9c27b0",
  automation: "#00bcd4",
} as const;

// ── PPM ─────────────────────────────────────────────────────────────────

/** The two cost categories on the PPM Budget & Costs spend charts — the
 *  cumulative lines and their dashed budget lines, on screen and in the
 *  initiative PDF. CapEx is the brand blue; OpEx is the purple the charts
 *  have always drawn, MUI's default `secondary.main` per mode (purple 500 in
 *  light, purple 200 in dark: the app theme sets only `primary`). The PDF is
 *  paper, so it always takes `light`. */
export const PPM_COST_COLORS = {
  light: { capex: brand.primary, opex: "#9c27b0" },
  dark: { capex: brand.primary, opex: "#ce93d8" },
} as const;

/** The PPM Gantt's task bars, one set per task status (`PpmTaskStatus`). Each
 *  status has four shades: `bar` is the bar's remaining (not yet done) part,
 *  `progress` the filled part up to the task's percent complete, and the two
 *  `…Selected` shades the same parts while the bar is selected — darker, so a
 *  selection reads on every status. To do is grey (not started), in progress
 *  blue, done green, blocked red: the same reading as the task board's status
 *  colours, stepped so a bar's two parts stay distinct. */
export const PPM_GANTT_COLORS = {
  todo: { bar: "#9e9e9e", progress: "#757575", barSelected: "#757575", progressSelected: "#616161" },
  in_progress: { bar: "#90caf9", progress: "#1976d2", barSelected: "#1565c0", progressSelected: "#1976d2" },
  done: { bar: "#a5d6a7", progress: "#2e7d32", barSelected: "#1b5e20", progressSelected: "#2e7d32" },
  blocked: { bar: "#d32f2f", progress: "#c62828", barSelected: "#b71c1c", progressSelected: "#c62828" },
} as const;

export type PpmGanttStatusKey = keyof typeof PPM_GANTT_COLORS;

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

/** A value the data does not carry, on any screen that colours by a value: a
 *  diagram card with no value for its colour-by field, a PPM project with no
 *  status-report RAG yet, a Lifecycle report bar in no bucket. The Process
 *  Navigator's grey (`BPM_UNSET_COLOR`), named for everywhere else. */
export const UNSET_VALUE_COLOR = BPM_UNSET_COLOR;

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
  "--bio-surface-subtle": "#212121", // grey 900, between the paper and the medium step
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

// ── Third-party brands ──────────────────────────────────────────────────

/** The logo colours of the single-sign-on providers the login page draws on
 *  its "Sign in with …" button (Microsoft's four squares, Google's "G", Okta's
 *  ring). Like `ROLE_COLOR_PRESETS`, the colour IS the data: each is the
 *  provider's published brand colour, reproduced so the mark is recognisable,
 *  and never re-tuned to the app's palette or reused for anything else. */
export const THIRD_PARTY_BRAND = {
  microsoft: { red: "#f25022", green: "#7fba00", blue: "#00a4ef", yellow: "#ffb900" },
  google: { blue: "#4285f4", green: "#34a853", yellow: "#fbbc05", red: "#ea4335" },
  okta: { blue: "#007dc1" },
} as const;

export type ThirdPartyBrandKey = keyof typeof THIRD_PARTY_BRAND;

// ── EA Delivery deliverables ────────────────────────────────────────────

/** One accent per deliverable kind in EA Delivery — the icon on an
 *  initiative's deliverable section, the "New artefact" split button's menu,
 *  and the SoAW editor / preview header. A categorical key, so a glance tells a
 *  Statement of Architecture Work from an ADR from a diagram. Role aliases of
 *  existing palette values: the SoAW orange is orange 900 (`EOL_WARNING_COLOR`'s
 *  value, a different meaning), the ADR blue the info hue, the diagram blue the
 *  Application card-type fallback. */
export const DELIVERABLE_COLORS = {
  soaw: "#e65100", // orange 900
  adr: STATUS_COLORS.info, // #2196f3
  diagram: CARD_TYPE_COLORS.Application, // #0f7eb5
} as const;

export type DeliverableKey = keyof typeof DELIVERABLE_COLORS;

// ── Ranks ───────────────────────────────────────────────────────────────

/** Gold / silver / bronze for a ranking tier in TurboLens: the top three
 *  products of an assessment's gap analysis (Architect wizard and the saved
 *  assessment viewer) and the Dashboard's quality tiers. Like a brand mark, the
 *  colours are the convention — a podium reads as gold, silver, bronze — so they
 *  are never re-tuned to the app palette or reused for a status. `fill` is the
 *  medal itself (a border, a bar, an icon); `text` the darker step of the same
 *  metal, legible as a label on the light paper. */
export const MEDAL_COLORS = {
  gold: { fill: "#ffd700", text: "#b8860b" }, // gold / dark goldenrod
  silver: { fill: "#bdbdbd", text: "#757575" }, // grey 400 / grey 600
  bronze: { fill: "#cd7f32", text: "#8b4513" }, // bronze / saddle brown
} as const;

export type MedalKey = keyof typeof MEDAL_COLORS;

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

/** Shadows outside the arrange mode. `sticky` is the hairline under a bar that
 *  stays pinned while content scrolls beneath it (a web portal's filter bar);
 *  `hover` lifts a clickable card under the pointer (a web portal's card tile). */
export const SURFACE_SHADOW = {
  sticky: "0 1px 3px rgba(0, 0, 0, 0.06)",
  hover: "0 4px 20px rgba(0, 0, 0, 0.1)",
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

// ── Value Chain bands (Value Chain report) ──────────────────────────────

// A fixed 4-colour palette for the process-type bands — NOT admin-editable
// (unlike card-type colours). Each value carries white text at ≥ 4.5:1; use
// `readableTypeColor(color, isDark)` when the colour is an accent (bar, icon)
// on the theme paper.
export const VALUE_CHAIN_BAND_COLORS = {
  management: "#00796b",
  core: brand.primary,
  support: "#8e24aa",
  not_set: "#757575",
} as const;

// ── ArchiMate layers (ArchiMate editor / palette) ───────────────────────

// Conventional pastel layer fills with a same-hue stroke at ~55 % lightness
// (physical uses a darker stroke to tell it apart from technology, which
// shares its fill).
export const ARCHIMATE_LAYER_COLORS: Record<ArchimateLayer, { fill: string; stroke: string }> = {
  strategy: { fill: "#f5deaa", stroke: "#c6a253" },
  business: { fill: "#ffffb5", stroke: "#c6c653" },
  application: { fill: "#b5ffff", stroke: "#53c6c6" },
  technology: { fill: "#c9e7b7", stroke: "#7ec653" },
  physical: { fill: "#c9e7b7", stroke: "#4e862d" },
  motivation: { fill: "#ccccff", stroke: "#5353c6" },
  implementation: { fill: "#ffe0e0", stroke: "#c65353" },
  other: { fill: "#f0f0f0", stroke: "#8c8c8c" },
};

// Text on the pastel fills must stay dark in dark mode too.
export const ARCHIMATE_TEXT_COLOR = "#1a1a1a";

// ── Type exports ────────────────────────────────────────────────────────

export type StatusKey = keyof typeof STATUS_COLORS;
export type ApprovalStatusKey = keyof typeof APPROVAL_STATUS_COLORS;
export type SeverityKey = keyof typeof SEVERITY_COLORS;
export type CardTypeKey = keyof typeof CARD_TYPE_COLORS;
export type LayerKey = keyof typeof LAYER_COLORS;

/** The colour a BusinessProcess falls back to when its card type has none. */
export const PROCESS_FALLBACK_COLOR = "#028f00";

/** The ArchiMate diagram kind: its card icon and its filter chip. */
export const ARCHIMATE_DIAGRAM_COLOR = "#7b1fa2";

/** Greys for an icon that is idle, locked or secondary (ArchiMate mapping
 *  tables, viewpoint picker, relation hints), lightest to strongest. */
export const MUTED_ICON_COLORS = {
  faint: "#ddd",
  soft: "#bbb",
  locked: "#ccc",
  hint: "#999",
  strong: "#666",
} as const;

/** The paper colour a diagram is exported on: an image is read outside the app, so it
 *  takes no theme. */
export const EXPORT_BACKGROUND_COLOR = "#ffffff";
