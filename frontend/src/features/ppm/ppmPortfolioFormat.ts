/**
 * Pure formatting helpers for the PPM portfolio board.
 *
 * Extracted from `PpmPortfolio.tsx` so they can be unit-tested and shared by the
 * authenticated board and the account-less portal board, which render the same
 * component. Nothing here touches React, the API client, or i18n.
 */

import { toLocalDate } from "@/lib/dates";

export const RAG: Record<string, string> = {
  onTrack: "#2e7d32",
  atRisk: "#ed6c02",
  offTrack: "#d32f2f",
};

/** A health dot with no report behind it, or a value the board does not know. */
export const RAG_NONE = "#bdbdbd";

export const RAG_LABEL: Record<string, string> = {
  onTrack: "health_onTrack",
  atRisk: "health_atRisk",
  offTrack: "health_offTrack",
};

/** Format a date string as "Q3'25" */
export function fmtQuarter(dateStr: string | null | undefined): string {
  const d = toLocalDate(dateStr);
  if (!d) return "\u2014";
  const q = Math.floor(d.getMonth() / 3) + 1;
  const y = String(d.getFullYear()).slice(2);
  return `Q${q}'${y}`;
}

/** Format a date as "Feb-26" style */
export function fmtMonthYear(dateStr: string): string {
  const d = toLocalDate(dateStr);
  if (!d) return "\u2014";
  const m = d.toLocaleString("en", { month: "short" });
  const y = String(d.getFullYear()).slice(2);
  return `${m}-${y}`;
}

export function getQuarters(startMonth: Date, months: number) {
  const qs: { label: string; start: Date; end: Date }[] = [];
  const cur = new Date(startMonth);
  const endDate = new Date(startMonth.getTime() + months * 30.44 * 86400000);
  while (cur < endDate) {
    const q = Math.floor(cur.getMonth() / 3) + 1;
    const qStart = new Date(cur.getFullYear(), (q - 1) * 3, 1);
    const qEnd = new Date(cur.getFullYear(), q * 3, 0);
    const label = `Q${q}'${String(cur.getFullYear()).slice(2)}`;
    if (!qs.length || qs[qs.length - 1].label !== label) {
      qs.push({ label, start: qStart, end: qEnd });
    }
    cur.setMonth(cur.getMonth() + 1);
  }
  return qs;
}

/** The magnitude a figure is read in: millions, thousands, or as it is. */
export type Scale = "M" | "k" | "";

export function magnitude(n: number): Scale {
  if (Math.abs(n) >= 1_000_000) return "M";
  if (Math.abs(n) >= 1_000) return "k";
  return "";
}

/** A figure in a given scale, digits only: 1.5 (M), 578 (k), 250 (bare). */
export function fmtK(n: number, scale: Scale): string {
  if (scale === "M") return (n / 1_000_000).toFixed(1);
  if (scale === "k") return (n / 1_000).toFixed(0);
  return String(Math.round(n));
}

/**
 * The two figures of a cost bar and their one unit suffix.
 *
 * The scale is chosen ONCE, from the larger of the two, and the suffix follows
 * it, so the pair reads "1.5/2.1 MCHF" or "578/900 kCHF". Choosing a scale per
 * figure and the suffix from a third rule is how the board rendered
 * "1.5M/2.1M kCHF" and "773/1.4M kCHF" (the Overview had already fixed the
 * same bug on its own copy; this is the one copy both now use).
 */
export function costPair(
  actual: number,
  planned: number,
  currency: string,
): { actualText: string; plannedText: string; unit: string } {
  const scale = magnitude(Math.max(Math.abs(actual), Math.abs(planned)));
  return {
    actualText: fmtK(actual, scale),
    plannedText: fmtK(planned, scale),
    unit: `${scale}${currency}`,
  };
}

/**
 * A KPI amount in the unit the budget bars use: "1.2 kCHF", "5.7 MCHF".
 *
 * A full "CHF 5,710,000" wraps the moment the derived glyph sits beside it in
 * a KPI cell, so the summary figures on the initiative pages read in thousands
 * or millions with one decimal; below a thousand `exact` (the currency
 * formatter) renders the figure as it is, since there is nothing to shorten.
 */
export function compactAmount(
  n: number,
  currency: string,
  exact: (value: number) => string,
): string {
  const abs = Math.abs(n);
  if (abs < 1_000) return exact(n);
  const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  if (abs >= 1_000_000) return `${oneDecimal.format(n / 1_000_000)} M${currency}`;
  return `${oneDecimal.format(n / 1_000)} k${currency}`;
}

/**
 * The board's content width and page gutter.
 *
 * Shared by the authenticated page, the portal board and the portal banner above
 * it, so the portal name sits directly over the first column instead of floating
 * inset from it. The gutter deliberately matches `AppLayout`'s content padding —
 * a portal has no AppLayout, so without this the board runs to the viewport edge
 * and the filter row's floating labels collide with the banner.
 */
export const BOARD_MAX_WIDTH = 1800;
export const BOARD_GUTTER = { xs: 1.5, sm: 3 } as const;

// Use MUI default primary and error colors — these match the app theme
export const COST_BAR_COLOR = "#1976d2";
export const COST_BAR_OVER = "#c62828";
