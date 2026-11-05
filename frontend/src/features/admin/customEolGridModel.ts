/**
 * Pure model of the custom EOL products grid: one row per product with what
 * its cycles add up to (count, latest cycle, worst status, linked cards),
 * the sidebar filters, and the persisted preferences. Kept out of the
 * component so it is testable without AG Grid. Editing happens in the
 * product panel, never in the grid.
 */
import { cycleStatus } from "@/lib/eolCustom";
import type { EolStatusKey } from "@/lib/eol";
import type { EolCustomCycle, EolCustomProduct } from "@/types";
import {
  CUSTOM_EOL_COLUMNS,
  DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS,
  LOCKED_CUSTOM_EOL_COLUMNS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  type CustomEolFilters,
} from "./CustomEolFilterSidebar";

export interface EolProductRow {
  key: string;
  product: EolCustomProduct;
  title: string;
  cycleCount: number;
  /** The newest cycle's name, or null without any. */
  latestCycle: string | null;
  /** That cycle's latest version, or null. */
  latestVersion: string | null;
  /** The worst status across the cycles — what the row's chip shows. */
  status: EolStatusKey;
  /** Every cycle's status, in the API's order. */
  statuses: EolStatusKey[];
  statusCounts: Partial<Record<EolStatusKey, number>>;
  /** Cards the caller can see that link the product (any cycle, or none). */
  linked: number;
  /** The latest change to the product or any of its cycles. */
  updated: string | null;
}

/**
 * How bad each status is. "Unknown" outranks "supported" so a legacy cycle
 * with no end of life is visible from the list, not hidden by a healthy one.
 */
export const STATUS_RANK: Record<EolStatusKey, number> = {
  eol: 3,
  approaching: 2,
  unknown: 1,
  supported: 0,
};

/** The worst of the statuses; a product with no cycle is unknown. */
export function worstStatus(statuses: EolStatusKey[]): EolStatusKey {
  let worst: EolStatusKey = "unknown";
  let rank = -1;
  for (const s of statuses) {
    if (STATUS_RANK[s] > rank) {
      rank = STATUS_RANK[s];
      worst = s;
    }
  }
  return worst;
}

/** The newest cycle by release date; undated cycles come last, ties keep the API's order. */
export function latestCycleOf(cycles: EolCustomCycle[]): EolCustomCycle | null {
  let best: EolCustomCycle | null = null;
  for (const c of cycles) {
    if (!best) {
      best = c;
      continue;
    }
    if (!c.releaseDate) continue;
    if (!best.releaseDate || c.releaseDate > best.releaseDate) best = c;
  }
  return best;
}

function newest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function buildRows(products: EolCustomProduct[], today?: string): EolProductRow[] {
  return products.map((p) => {
    const statuses = p.cycles.map((c) => cycleStatus(c.eol, c.support, today));
    const statusCounts: Partial<Record<EolStatusKey, number>> = {};
    for (const s of statuses) statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    const latest = latestCycleOf(p.cycles);
    return {
      key: p.key,
      product: p,
      title: p.title,
      cycleCount: p.cycles.length,
      latestCycle: latest?.cycle ?? null,
      latestVersion: latest?.latest ?? null,
      status: worstStatus(statuses),
      statuses,
      statusCounts,
      linked: p.linked_cards,
      updated: p.cycles.reduce((acc, c) => newest(acc, c.updated_at), p.updated_at),
    };
  });
}

/** Narrow rows the client already holds — on the raw search text, no debounce. */
export function filterRows(rows: EolProductRow[], f: CustomEolFilters): EolProductRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    if (f.usage === "linked" && r.linked === 0) return false;
    if (f.usage === "unused" && r.linked > 0) return false;
    if (!q) return true;
    const haystack = [
      r.title,
      r.key,
      ...r.product.cycles.map((c) => c.cycle),
      ...r.product.cycles.map((c) => c.latest ?? ""),
    ];
    return haystack.some((v) => v.toLowerCase().includes(q));
  });
}

// ── Preferences ────────────────────────────────────────────────────────────

/** v2: the columns changed when the grid went from a row per cycle to a row
 * per product, so an older preference set is left alone rather than read. */
export const PREFS_STORAGE_KEY = "turboea.eolCustomProducts.v2.prefs";
const ALL_COLUMN_IDS = CUSTOM_EOL_COLUMNS.map((c) => c.id);

export interface CustomEolPrefs {
  filtersCollapsed: boolean;
  sidebarWidth: number;
  visibleColumns: string[];
  frozenColumns: string[];
  columnOrder: string[];
}

export const DEFAULT_PREFS: CustomEolPrefs = {
  filtersCollapsed: false,
  sidebarWidth: 260,
  visibleColumns: DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS,
  // The column that says which row you are looking at stays in view.
  frozenColumns: ["product"],
  columnOrder: [],
};

const knownIds = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((id): id is string => typeof id === "string" && ALL_COLUMN_IDS.includes(id))
    : [];

/** Read the stored prefs, dropping anything malformed or unknown. */
export function loadPrefs(): CustomEolPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<CustomEolPrefs>;
    const visible = knownIds(p.visibleColumns);
    return {
      filtersCollapsed: !!p.filtersCollapsed,
      sidebarWidth:
        typeof p.sidebarWidth === "number" && Number.isFinite(p.sidebarWidth)
          ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, p.sidebarWidth))
          : DEFAULT_PREFS.sidebarWidth,
      visibleColumns: visible.length
        ? Array.from(new Set([...LOCKED_CUSTOM_EOL_COLUMNS, ...visible]))
        : DEFAULT_VISIBLE_CUSTOM_EOL_COLUMNS,
      frozenColumns: Array.isArray(p.frozenColumns)
        ? knownIds(p.frozenColumns)
        : DEFAULT_PREFS.frozenColumns,
      columnOrder: knownIds(p.columnOrder),
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: CustomEolPrefs): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Storage full or disabled — the grid works without it.
  }
}
