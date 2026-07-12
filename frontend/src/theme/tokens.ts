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

export const RAG_COLORS = {
  red: "#d32f2f",
  amber: "#f57c00",
  green: "#2e7d32",
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
  BusinessProcess: "#e65100",
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
} as const;

// ── Non-color tokens ────────────────────────────────────────────────────

/** Border radius scale (px). MUI's `borderRadius` `sx` prop also accepts numbers from the spacing scale. */
export const radius = { sm: 4, md: 8, lg: 12 } as const;

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
