/**
 * Fiscal year start month (1-12, January = 1), as configured by an admin under
 * Admin -> Settings. Singleton cache shared process-wide, primed by
 * /settings/bootstrap on boot so first-mount consumers skip their own GET.
 *
 * The value matters wherever PPM budget or cost data is bucketed by year: the
 * backend convention (`_fiscal_year` in
 * backend/app/services/calculation_ppm.py) names a fiscal year after the year
 * it *ends* in, so with a start month of October 2025-10-15 opens FY2026.
 * Anything deriving a fiscal year on the client must mirror that, or it will
 * disagree with the `fiscal_year` stored on budget lines.
 */
import { useState, useEffect } from "react";
import { api } from "@/api/client";

export const DEFAULT_FISCAL_YEAR_START = 1;

let _cache: number | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(m: number) => void>();

function normalise(month: unknown): number | null {
  return typeof month === "number" && Number.isInteger(month) && month >= 1 && month <= 12
    ? month
    : null;
}

function notify(month: number) {
  _cache = month;
  for (const fn of _listeners) fn(month);
}

/**
 * Prime the cache from outside the hook (e.g. /settings/bootstrap on app boot).
 * Ignores anything outside 1-12 so a malformed payload keeps the January
 * default rather than shifting every fiscal year by a bogus offset.
 */
export function invalidateFiscalYearStart(month: number) {
  const valid = normalise(month);
  if (valid !== null) notify(valid);
}

function _fetchOnce(): Promise<void> {
  if (_cache !== null) return Promise.resolve();
  if (_inflight) return _inflight;
  _inflight = api
    .get<{ month: number }>("/settings/fiscal-year-start")
    .then((r) => {
      const valid = normalise(r?.month);
      if (valid !== null) notify(valid);
    })
    .catch(() => {
      /* keep default */
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function useFiscalYearStart() {
  const [month, setMonth] = useState(_cache ?? DEFAULT_FISCAL_YEAR_START);
  const [loading, setLoading] = useState(_cache === null);

  useEffect(() => {
    _listeners.add(setMonth);
    if (_cache === null) {
      _fetchOnce().finally(() => setLoading(false));
    }
    return () => {
      _listeners.delete(setMonth);
    };
  }, []);

  return { month, loading };
}

/** Reset for tests. */
export function resetFiscalYearStart() {
  _cache = null;
  _inflight = null;
}
