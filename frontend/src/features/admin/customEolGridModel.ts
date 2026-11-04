/**
 * Pure model of the custom EOL products grid: one row per cycle (a product
 * with no cycle yet gets one placeholder row, so it still shows), the sidebar
 * filters, the field → API mapping the per-row write uses, and the persisted
 * preferences. Kept out of the component so it is testable without AG Grid.
 */
import { customCycleStatus } from "@/lib/eolCustom";
import type { EolStatusKey } from "@/lib/eol";
import type { EolCustomProduct, EolMilestone } from "@/types";
import {
  CUSTOM_EOL_COLUMNS,
  LOCKED_CUSTOM_EOL_COLUMNS,
  type CustomEolFilters,
} from "./CustomEolFilterSidebar";

export interface EolGridRow {
  /** The cycle id, or `product:<key>` for a product that has no cycle yet. */
  id: string;
  productKey: string;
  productTitle: string;
  product: EolCustomProduct;
  cycleId: string | null;
  cycle: string;
  releaseDate: string | null;
  support: EolMilestone;
  eol: EolMilestone;
  latest: string | null;
  latestReleaseDate: string | null;
  status: EolStatusKey;
  linked: number;
  updated: string | null;
}

export function buildRows(products: EolCustomProduct[], today?: string): EolGridRow[] {
  const rows: EolGridRow[] = [];
  for (const p of products) {
    if (p.cycles.length === 0) {
      rows.push({
        id: `product:${p.key}`,
        productKey: p.key,
        productTitle: p.title,
        product: p,
        cycleId: null,
        cycle: "",
        releaseDate: null,
        support: null,
        eol: null,
        latest: null,
        latestReleaseDate: null,
        status: "unknown",
        linked: p.linked_cards,
        updated: p.updated_at,
      });
      continue;
    }
    for (const c of p.cycles) {
      rows.push({
        id: c.id,
        productKey: p.key,
        productTitle: p.title,
        product: p,
        cycleId: c.id,
        cycle: c.cycle,
        releaseDate: c.releaseDate,
        support: c.support,
        eol: c.eol,
        latest: c.latest,
        latestReleaseDate: c.latestReleaseDate,
        status: customCycleStatus(c.eol, c.support, today),
        linked: c.linked_cards,
        updated: c.updated_at,
      });
    }
  }
  return rows;
}

/** Narrow rows the client already holds — on the raw search text, no debounce. */
export function filterRows(rows: EolGridRow[], f: CustomEolFilters): EolGridRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.products.length && !f.products.includes(r.productKey)) return false;
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    if (f.usage === "linked" && r.linked === 0) return false;
    if (f.usage === "unused" && r.linked > 0) return false;
    if (!q) return true;
    return [r.productTitle, r.productKey, r.cycle, r.latest ?? ""].some((v) =>
      v.toLowerCase().includes(q),
    );
  });
}

/** Grid fields a cell edit or a drag-fill writes, and the API key for each. */
export const EDITABLE_FIELDS: Record<string, string> = {
  cycle: "cycle",
  releaseDate: "releaseDate",
  support: "support",
  eol: "eol",
  latest: "latest",
  latestReleaseDate: "latestReleaseDate",
};

/** Fillable columns: every editable one but the cycle name, which is unique per product. */
export const FILLABLE_FIELDS = new Set(
  Object.keys(EDITABLE_FIELDS).filter((f) => f !== "cycle"),
);

/** The PATCH body for one field, blank text sent as null. */
export function cyclePatch(field: string, value: unknown): Record<string, unknown> {
  const key = EDITABLE_FIELDS[field];
  if (!key) throw new Error(`Not an editable field: ${field}`);
  const v = typeof value === "string" ? value.trim() : value;
  return { [key]: v === "" || v === undefined ? null : v };
}

// ── Preferences ────────────────────────────────────────────────────────────

export const PREFS_STORAGE_KEY = "turboea.eolCustomProducts.prefs";
const ALL_COLUMN_IDS = CUSTOM_EOL_COLUMNS.map((c) => c.id);

export interface CustomEolPrefs {
  filtersCollapsed: boolean;
  sidebarWidth: number;
  visibleColumns: string[];
  frozenColumns: string[];
  columnOrder: string[];
  groupBy: string | null;
}

export const DEFAULT_PREFS: CustomEolPrefs = {
  filtersCollapsed: false,
  sidebarWidth: 260,
  visibleColumns: ALL_COLUMN_IDS,
  // The two columns that say which row you are looking at stay in view.
  frozenColumns: ["product", "cycle"],
  columnOrder: [],
  groupBy: "product",
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
        typeof p.sidebarWidth === "number" ? p.sidebarWidth : DEFAULT_PREFS.sidebarWidth,
      visibleColumns: visible.length
        ? Array.from(new Set([...LOCKED_CUSTOM_EOL_COLUMNS, ...visible]))
        : ALL_COLUMN_IDS,
      frozenColumns: Array.isArray(p.frozenColumns)
        ? knownIds(p.frozenColumns)
        : DEFAULT_PREFS.frozenColumns,
      columnOrder: knownIds(p.columnOrder),
      groupBy:
        p.groupBy === null || p.groupBy === "product" || p.groupBy === "status"
          ? p.groupBy
          : DEFAULT_PREFS.groupBy,
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
