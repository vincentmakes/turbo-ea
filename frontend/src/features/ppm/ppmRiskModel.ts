/**
 * Pure model of an initiative's risks: the score bands and colours, the
 * status labels, the summary strip, the print order, the risk grid's columns,
 * its sidebar filters and its persisted preferences. Shared by the Risk
 * Management tab, its filter sidebar, the initiative PDF and the spreadsheet
 * export, and testable without React or AG Grid.
 */
import { RAG_COLORS } from "@/theme/tokens";
import type { PpmRisk } from "@/types";

/** A translator bound to the `ppm` namespace (the caller hands in its own `t`). */
type Translate = (key: string) => string;

// ── Score bands ────────────────────────────────────────────────────────────

export type RiskScoreBand = "high" | "medium" | "low";

/** Highest first — the order the sidebar and the group headers list them. */
export const RISK_SCORE_BANDS: readonly RiskScoreBand[] = ["high", "medium", "low"];

/** A score of 15 or more is high, 6 or more medium, anything below low. */
export function scoreBand(score: number): RiskScoreBand {
  if (score >= 15) return "high";
  if (score >= 6) return "medium";
  return "low";
}

const BAND_COLOR: Record<RiskScoreBand, string> = {
  high: RAG_COLORS.red,
  medium: RAG_COLORS.amber,
  low: RAG_COLORS.green,
};

/** The colour of a band: its RAG token. */
export function bandColor(band: RiskScoreBand): string {
  return BAND_COLOR[band];
}

/** The fill of a risk's score chip. */
export function scoreColor(score: number): string {
  return BAND_COLOR[scoreBand(score)];
}

const BAND_LABEL_KEYS: Record<RiskScoreBand, string> = {
  high: "riskGridBandHigh",
  medium: "riskGridBandMedium",
  low: "riskGridBandLow",
};

export function scoreBandLabel(band: RiskScoreBand, t: Translate): string {
  return t(BAND_LABEL_KEYS[band]);
}

// ── Statuses ───────────────────────────────────────────────────────────────

export const RISK_STATUSES: readonly PpmRisk["status"][] = [
  "open",
  "mitigating",
  "mitigated",
  "closed",
  "accepted",
];

/** Spelled out so the unused-key scan sees every key a status reads. */
const STATUS_LABEL_KEYS: Record<string, string> = {
  open: "riskStatusOpen",
  mitigating: "riskStatusMitigating",
  mitigated: "riskStatusMitigated",
  closed: "riskStatusClosed",
  accepted: "riskStatusAccepted",
};

/**
 * The `ppm` key that labels a status: `open` → `riskStatusOpen`. A status
 * this build does not know (a newer server) comes back as itself, which `t`
 * then shows verbatim rather than a wrong label.
 */
export function riskStatusLabelKey(status: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_LABEL_KEYS, status)
    ? STATUS_LABEL_KEYS[status]
    : status;
}

export function riskStatusLabel(status: string, t: Translate): string {
  return t(riskStatusLabelKey(status));
}

export const RISK_STATUS_CHIP_COLOR: Record<
  string,
  "default" | "error" | "warning" | "success" | "info"
> = {
  open: "error",
  mitigating: "warning",
  mitigated: "success",
  closed: "default",
  accepted: "info",
};

/**
 * The theme colour behind a status chip, as a palette path (`error.main`) —
 * the sidebar's status chips and the Status group headers use it so one
 * status has one colour everywhere on the tab.
 */
export function riskStatusPaletteColor(status: string): string {
  const color = Object.prototype.hasOwnProperty.call(RISK_STATUS_CHIP_COLOR, status)
    ? RISK_STATUS_CHIP_COLOR[status]
    : "default";
  return color === "default" ? "grey.600" : `${color}.main`;
}

/** Resolve a palette path (`error.main`, `grey.600`) against a theme palette. */
export function paletteColor(palette: object, path: string): string | undefined {
  const [group, shade] = path.split(".");
  const entry = (palette as Record<string, unknown>)[group];
  if (!entry || typeof entry !== "object") return undefined;
  const value = (entry as Record<string, unknown>)[shade];
  return typeof value === "string" ? value : undefined;
}

// ── Summary and print order ────────────────────────────────────────────────

/** The summary strip: every risk, the open ones and the high-scoring ones. */
export function riskSummary(risks: readonly PpmRisk[]): {
  total: number;
  open: number;
  high: number;
} {
  return {
    total: risks.length,
    open: risks.filter((r) => r.status === "open").length,
    high: risks.filter((r) => scoreBand(r.risk_score) === "high").length,
  };
}

/** A new array, highest score first, ties by title. The input is left alone. */
export function sortRisksForPrint(risks: readonly PpmRisk[]): PpmRisk[] {
  return [...risks].sort(
    (a, b) => b.risk_score - a.risk_score || a.title.localeCompare(b.title),
  );
}

// ── Sidebar filters ────────────────────────────────────────────────────────

/** The owner filter's "no owner" option. Never a user id. */
export const NO_OWNER = "__none__";

export interface PpmRiskFilters {
  search: string;
  statuses: string[];
  bands: RiskScoreBand[];
  /** Owner user ids, and `NO_OWNER` for risks nobody owns. */
  owners: string[];
}

export const EMPTY_RISK_FILTERS: PpmRiskFilters = {
  search: "",
  statuses: [],
  bands: [],
  owners: [],
};

/** How many filters narrow the rows — the rail chip and the Filters tab dot. */
export function activeRiskFilterCount(f: PpmRiskFilters): number {
  return (f.search.trim() ? 1 : 0) + f.statuses.length + f.bands.length + f.owners.length;
}

/**
 * The risks the sidebar keeps. Runs on the raw search text: every risk is
 * already in memory, so there is nothing to debounce. Search matches title,
 * description, mitigation and owner, case-insensitively.
 */
export function filterRisks(risks: readonly PpmRisk[], f: PpmRiskFilters): PpmRisk[] {
  const q = f.search.trim().toLowerCase();
  return risks.filter((r) => {
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    if (f.bands.length && !f.bands.includes(scoreBand(r.risk_score))) return false;
    if (f.owners.length && !f.owners.includes(r.owner_id ?? NO_OWNER)) return false;
    if (!q) return true;
    return [r.title, r.description, r.mitigation, r.owner_name].some(
      (v) => !!v && v.toLowerCase().includes(q),
    );
  });
}

export interface RiskOwnerOption {
  id: string;
  name: string;
}

/** The owners present in the risks, by name. */
export function riskOwnerOptions(risks: readonly PpmRisk[]): RiskOwnerOption[] {
  const owners = new Map<string, string>();
  for (const r of risks) {
    if (r.owner_id) owners.set(r.owner_id, r.owner_name || r.owner_id);
  }
  return [...owners]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The Risk column's value — what it sorts and filters on: the title, then the description. */
export function riskCellText(r: PpmRisk | undefined): string {
  if (!r) return "";
  return r.description ? `${r.title}\n${r.description}` : r.title;
}

// ── Grid columns ───────────────────────────────────────────────────────────

export interface RiskGridColumn {
  id: string;
  /** A `ppm` key. */
  labelKey: string;
  icon: string;
}

/** Every column of the grid, in default order. */
export const RISK_GRID_COLUMNS: readonly RiskGridColumn[] = [
  { id: "risk", labelKey: "riskGridColumnRisk", icon: "warning" },
  { id: "probability", labelKey: "probability", icon: "casino" },
  { id: "impact", labelKey: "impact", icon: "bolt" },
  { id: "risk_score", labelKey: "riskScore", icon: "speed" },
  { id: "status", labelKey: "riskStatus", icon: "traffic" },
  { id: "owner_name", labelKey: "riskOwner", icon: "person" },
  { id: "mitigation", labelKey: "mitigation", icon: "shield" },
  { id: "actions", labelKey: "riskGridColumnActions", icon: "more_horiz" },
];

export const RISK_GRID_COLUMN_IDS: readonly string[] = RISK_GRID_COLUMNS.map((c) => c.id);

/** The column that names the row and the row's buttons cannot be hidden. */
export const LOCKED_RISK_COLUMNS: ReadonlySet<string> = new Set(["risk", "actions"]);

/** The action buttons are never sorted, frozen or moved, so no pref but visibility names them. */
const ARRANGEABLE: readonly string[] = RISK_GRID_COLUMN_IDS.filter((id) => id !== "actions");

/**
 * The columns a first visit shows, and what Reset brings back. Probability
 * and impact are read off the score cell's "4 × 5" caption, so their own
 * columns start hidden and leave the width to the text.
 */
export const DEFAULT_VISIBLE_RISK_COLUMNS: readonly string[] = RISK_GRID_COLUMN_IDS.filter(
  (id) => id !== "probability" && id !== "impact",
);

/** True when `visible` is anything but the default column set. */
export function riskColumnsDifferFromDefault(visible: ReadonlySet<string>): boolean {
  return (
    visible.size !== DEFAULT_VISIBLE_RISK_COLUMNS.length ||
    DEFAULT_VISIBLE_RISK_COLUMNS.some((id) => !visible.has(id))
  );
}

// ── Group by ───────────────────────────────────────────────────────────────

export const RISK_GROUP_AXES = ["status", "owner", "band"] as const;
export type RiskGroupAxis = (typeof RISK_GROUP_AXES)[number];

// ── Preferences ────────────────────────────────────────────────────────────

export const RISK_GRID_PREFS_KEY = "turboea.ppmRisks.prefs";

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 260;

export interface RiskGridSort {
  colId: string;
  sort: "asc" | "desc";
}

export interface RiskGridPrefs {
  filtersCollapsed: boolean;
  sidebarWidth: number;
  visibleColumns: string[];
  frozenColumns: string[];
  columnOrder: string[];
  sortModel: RiskGridSort[];
  groupBy: RiskGroupAxis | null;
}

/** Highest score first until the user picks a sort of their own. */
export const DEFAULT_RISK_SORT: readonly RiskGridSort[] = [{ colId: "risk_score", sort: "desc" }];

/** A fresh default set every call, so no caller can mutate another's. */
export function defaultRiskGridPrefs(): RiskGridPrefs {
  return {
    filtersCollapsed: false,
    sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    visibleColumns: [...DEFAULT_VISIBLE_RISK_COLUMNS],
    frozenColumns: [],
    columnOrder: [],
    sortModel: [],
    groupBy: null,
  };
}

export const DEFAULT_RISK_GRID_PREFS: Readonly<RiskGridPrefs> = defaultRiskGridPrefs();

const idsIn = (v: unknown, known: readonly string[]): string[] =>
  Array.isArray(v)
    ? v.filter(
        // Stryker disable next-line ConditionalExpression: `known` holds strings only, so includes() already rejects every non-string; the typeof only narrows the type
        (id): id is string => typeof id === "string" && known.includes(id),
      )
    : [];

const isSort = (v: unknown): v is RiskGridSort => {
  // Stryker disable next-line ConditionalExpression: a non-null primitive has no colId, so the colId check below rejects it all the same
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    // Stryker disable next-line ConditionalExpression: ARRANGEABLE holds strings only, so includes() already rejects a non-string colId
    typeof s.colId === "string" &&
    ARRANGEABLE.includes(s.colId) &&
    (s.sort === "asc" || s.sort === "desc")
  );
};

/** Read the stored prefs, dropping anything malformed or unknown. */
export function loadRiskGridPrefs(): RiskGridPrefs {
  const d = defaultRiskGridPrefs();
  try {
    const raw = localStorage.getItem(RISK_GRID_PREFS_KEY);
    // Stryker disable next-line ConditionalExpression: a null item parses to null and an empty one throws into the catch; both return the defaults
    if (!raw) return d;
    const p: unknown = JSON.parse(raw);
    // Stryker disable next-line ConditionalExpression,LogicalOperator: null throws into the catch and a primitive has none of the keys, so every path still yields the defaults
    if (!p || typeof p !== "object") return d;
    const o = p as Record<string, unknown>;
    const visible = idsIn(o.visibleColumns, RISK_GRID_COLUMN_IDS);
    return {
      filtersCollapsed: o.filtersCollapsed === true,
      sidebarWidth:
        // Stryker disable next-line ConditionalExpression: Number.isFinite is false for every non-number, so the typeof only narrows the type
        typeof o.sidebarWidth === "number" && Number.isFinite(o.sidebarWidth)
          ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, o.sidebarWidth))
          : d.sidebarWidth,
      // Locked columns are always shown, whatever was stored.
      visibleColumns: visible.length
        ? RISK_GRID_COLUMN_IDS.filter((id) => LOCKED_RISK_COLUMNS.has(id) || visible.includes(id))
        : d.visibleColumns,
      frozenColumns: idsIn(o.frozenColumns, ARRANGEABLE),
      columnOrder: idsIn(o.columnOrder, ARRANGEABLE),
      sortModel: Array.isArray(o.sortModel)
        ? o.sortModel.filter(isSort).map((s) => ({ colId: s.colId, sort: s.sort }))
        : [],
      groupBy: (RISK_GROUP_AXES as readonly unknown[]).includes(o.groupBy)
        ? (o.groupBy as RiskGroupAxis)
        : null,
    };
  } catch {
    return d;
  }
}

export function saveRiskGridPrefs(p: RiskGridPrefs): void {
  try {
    localStorage.setItem(RISK_GRID_PREFS_KEY, JSON.stringify(p));
  } catch {
    // Storage full or disabled — the grid works without it.
  }
}
