import { useState, useEffect, useCallback, useMemo } from "react";
import { api } from "@/api/client";
import { currencySymbolOverride } from "@/lib/currency";

/** Minimal currency formatter shape. A real `Intl.NumberFormat` satisfies it;
 * for currencies with a symbol override we return a lightweight wrapper that
 * swaps the currency token for the override glyph. */
export type CurrencyFormatter = { format: (value: number) => string };

let _cache: string | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(c: string) => void>();

function notify(c: string) {
  _cache = c;
  for (const fn of _listeners) fn(c);
}

/**
 * Prime the cache from outside the hook (e.g. /settings/bootstrap on app boot)
 * so first-mount consumers skip their own GET.
 */
export function invalidateCurrency(c: string) {
  notify(c);
}

function _fetchOnce(): Promise<void> {
  if (_cache) return Promise.resolve();
  if (_inflight) return _inflight;
  _inflight = api
    .get<{ currency: string }>("/settings/currency")
    .then((r) => notify(r.currency))
    .catch(() => {
      /* keep default */
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function useCurrency() {
  const [currency, setCurrency] = useState(_cache || "USD");
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setCurrency);
    if (!_cache) {
      _fetchOnce().finally(() => setLoading(false));
    }
    return () => {
      _listeners.delete(setCurrency);
    };
  }, []);

  const baseFmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  /** Currency symbol — override glyph (e.g. the new Saudi Riyal sign) when one
   * applies, otherwise the symbol the formatter emits, e.g. "$", "€". */
  const symbol = useMemo(() => {
    const override = currencySymbolOverride(currency);
    if (override) return override;
    const parts = baseFmt.formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value || currency;
  }, [baseFmt, currency]);

  /** Full-format: e.g. $1,200,000 or 1.200.000 €. For overridden currencies the
   * Intl currency token is swapped for the override glyph while grouping and
   * placement stay locale-correct. */
  const fmt = useMemo<CurrencyFormatter>(() => {
    const override = currencySymbolOverride(currency);
    if (!override) return baseFmt;
    return {
      format: (value: number) =>
        baseFmt
          .formatToParts(value)
          .map((p) => (p.type === "currency" ? override : p.value))
          .join(""),
    };
  }, [baseFmt, currency]);

  /** Short format for tight spaces: e.g. $450k, €1.2M */
  const fmtShort = useCallback(
    (v: number) => {
      if (Math.abs(v) >= 1_000) {
        return `${symbol}${(v / 1_000).toFixed(0)}k`;
      }
      return fmt.format(v);
    },
    [symbol, fmt],
  );

  /** Call after admin changes the currency to update all consumers. */
  const invalidate = useCallback((newCurrency: string) => {
    notify(newCurrency);
  }, []);

  return { currency, loading, fmt, fmtShort, symbol, invalidate };
}
