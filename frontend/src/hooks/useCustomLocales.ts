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
    if (typeof item !== "object" || item === null) continue;
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

function _fetch(): Promise<CustomLocaleInfo[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  _inflight = api
    .get<{ custom_locales?: unknown }>("/settings/bootstrap")
    .then((r) => sanitizeCustomLocales(r?.custom_locales))
    .catch(() => [] as CustomLocaleInfo[])
    .then((v) => {
      _set(v);
      return v;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/**
 * Prime the cache (bootstrap, or the admin after a change) with `v`, or drop
 * it and read it again when called without a value.
 */
export function invalidateCustomLocales(v?: CustomLocaleInfo[]): void {
  if (v) {
    _set(v);
    return;
  }
  _cache = null;
  void _fetch();
}

/** The enabled custom languages; empty until known. */
export function useCustomLocales() {
  const [locales, setLocales] = useState<CustomLocaleInfo[]>(_cache ?? []);

  useEffect(() => {
    _listeners.add(setLocales);
    if (_cache) setLocales(_cache);
    else void _fetch();
    return () => {
      _listeners.delete(setLocales);
    };
  }, []);

  return { customLocales: locales };
}
