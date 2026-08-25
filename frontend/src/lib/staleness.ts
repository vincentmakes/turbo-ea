/**
 * Survey staleness windows — "only cards nobody has changed in the last N
 * days/months".
 *
 * Mirror of `staleness_cutoff` in `backend/app/services/card_flags.py`. The
 * builder shows the admin the date its window resolves to *before* anything is
 * saved, so this file and that one have to agree exactly: same calendar month
 * math, same day clamping, same bounds. Change one and change the other —
 * `staleness.test.ts` pins the cases that matter.
 */
import type { StalenessUnit, StalenessWindow } from "@/types";

/** Ten years either way, matching MAX_STALENESS_BY_UNIT on the backend. */
export const MAX_STALENESS_BY_UNIT: Record<StalenessUnit, number> = {
  days: 3650,
  months: 120,
};

/** The presets offered in the builder, in display order. `null` is "Any" —
 *  no window at all, which is the absence of the key rather than a zero. */
export const STALENESS_PRESETS: { key: string; window: StalenessWindow | null }[] = [
  { key: "any", window: null },
  { key: "d30", window: { value: 30, unit: "days" } },
  { key: "d90", window: { value: 90, unit: "days" } },
  { key: "m6", window: { value: 6, unit: "months" } },
  { key: "m12", window: { value: 12, unit: "months" } },
];

/**
 * Narrow an unknown value — a stored `target_filters.not_updated_for` from a
 * survey that predates this filter, or one an extension template wrote — to a
 * usable window, or `null`.
 *
 * Returning `null` rather than throwing is deliberate: a garbage stored value
 * has to degrade to "Any" in the picker, not render NaN or blank the step.
 */
export function parseStalenessWindow(raw: unknown): StalenessWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const { value, unit } = raw as { value?: unknown; unit?: unknown };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return null;
  if (unit !== "days" && unit !== "months") return null;
  if (value > MAX_STALENESS_BY_UNIT[unit]) return null;
  return { value, unit };
}

/** The preset key a window corresponds to, or `"custom"` when it matches none. */
export function matchStalenessPreset(window: StalenessWindow | null): string {
  const hit = STALENESS_PRESETS.find((p) =>
    p.window === null
      ? window === null
      : !!window && p.window.value === window.value && p.window.unit === window.unit,
  );
  return hit ? hit.key : "custom";
}

/**
 * The date a window resolves to — the cutoff a card's last update must fall
 * before.
 *
 * Built from `now`'s **UTC** calendar day, because that is the day the server
 * subtracts from. A user in UTC+13 designing at 09:00 local is on the previous
 * UTC day, and the caption has to promise what the query will actually do, not
 * what the local calendar suggests. Returned as a local-midnight Date so
 * `formatDate` prints those y/m/d digits back unchanged.
 */
export function stalenessCutoffDate(window: StalenessWindow, now: Date = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  if (window.unit === "days") {
    const shifted = new Date(Date.UTC(year, month, day) - window.value * 86_400_000);
    return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  }

  // Calendar months, day clamped to the target month's length — the mirror of
  // recurrence.add_months, so Mar 31 minus one month is Feb 28, not Mar 3.
  const total = year * 12 + month - window.value;
  const targetYear = Math.floor(total / 12);
  const targetMonth = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(targetYear, targetMonth, Math.min(day, lastDay));
}
