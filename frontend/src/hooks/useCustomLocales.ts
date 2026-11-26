/**
 * useCustomLocales — the enabled custom (admin-added) UI languages, for the
 * language pickers.
 *
 * Boot-time singleton primed by `primeBootstrap()` from the `custom_locales`
 * field of `/settings/bootstrap`; on its own it reads the same field (there is
 * no separate public list). Every value it holds is also pushed into the
 * custom-language registry, so `localeLabel` and `isRtlLocale` know the names
 * and directions. Built-in languages stay with `useEnabledLocales`.
 */
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { isBuiltInLocale, registerCustomLocales } from "@/i18n/customLocales";
import type { CustomLocaleInfo } from "@/types";

let _cache: CustomLocaleInfo[] | null = null;
let _inflight: Promise<CustomLocaleInfo[]> | null = null;
const _listeners = new Set<(v: CustomLocaleInfo[]) => void>();

/** Keep the well-formed entries of an untrusted list; never a built-in code. */
export function sanitizeCustomLocales(raw: unknown): CustomLocaleInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomLocaleInfo[] = [];
  for (const item of raw) {
    // A primitive destructures to nothing and is dropped by the code check.
    if (!item) continue;
    const { code, name, rtl, hash } = item as Record<string, unknown>;
    if (typeof code !== "string" || !code || isBuiltInLocale(code)) continue;
    out.push({
      code,
      name: typeof name === "string" && name ? name : code,
      rtl: rtl === true,
      hash: typeof hash === "string" ? hash : "",
    });
  }
  return out;
}

function _set(v: CustomLocaleInfo[]) {
  _cache = v;
  registerCustomLocales(v);
  for (const fn of _listeners) fn(v);
}

/**
 * The fallback read, shared by every consumer that mounts before anything
 * primed the cache. Once it settled the cache always holds a list (it is only
 * ever replaced by another list), so the read never runs twice.
 */
function _fetch(): Promise<CustomLocaleInfo[]> {
  if (_inflight) return _inflight;
  // Started inside a promise chain, so a test double that returns nothing
  // cannot throw inside the effect that called it; a reply without the field
  // (or no reply at all) reads as no languages.
  _inflight = Promise.resolve()
    .then(() => api.get<{ custom_locales?: unknown }>("/settings/bootstrap"))
    .then((r) => sanitizeCustomLocales(r.custom_locales))
    .catch(() => [] as CustomLocaleInfo[])
    .then((v) => {
      _set(v);
      return v;
    });
  return _inflight;
}

/**
 * Prime the cache with `v` — from `primeBootstrap()`. After an admin change,
 * call `refreshBootstrap()`, which waits for a read in flight and re-primes
 * this list from a read made after the change.
 */
export function invalidateCustomLocales(v: CustomLocaleInfo[]): void {
  _set(v);
}

/** The enabled custom languages; empty until known. */
export function useCustomLocales() {
  const [locales, setLocales] = useState<CustomLocaleInfo[]>(_cache ?? []);

  useEffect(() => {
    _listeners.add(setLocales);
    if (!_cache) void _fetch();
    // Stryker disable next-line BlockStatement: React drops a state update on an unmounted component, so a listener left behind changes nothing visible
    return () => {
      // Stryker disable next-line CallExpression: as above — the stale listener's updates are dropped
      _listeners.delete(setLocales);
    };
    // Stryker disable next-line ArrayDeclaration: a constant dependency list runs the effect once, exactly like []
  }, []);

  return { customLocales: locales };
}
