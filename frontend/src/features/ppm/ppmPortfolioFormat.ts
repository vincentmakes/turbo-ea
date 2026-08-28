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

export const RAG_LABEL: Record<string, string> = {
  onTrack: "health_onTrack",
  atRisk: "health_atRisk",
  offTrack: "health_offTrack",
};

/** Format a date string as "Q3'25" */
export function fmtQuarter(dateStr: string | null): string {
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

/** Format a number in compact "k" notation with thousands separator */
export function fmtK(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) {
    const k = n / 1_000;
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(k);
  }
  return String(Math.round(n));
}

/** Determine the "k" suffix: values in thousands → "k{CUR}", otherwise "{CUR}" */
export function costUnit(planned: number, actual: number, currency: string): string {
  if (Math.abs(planned) >= 1_000 || Math.abs(actual) >= 1_000) return `k${currency}`;
  return currency;
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
