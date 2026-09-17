import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";
import type { CalculatedFieldsMap } from "@/types";

/**
 * Which fields are written by an active calculation, per card type — the
 * list card detail and the inventory grid use to render a field read-only
 * with the *calculated* chip.
 *
 * Module-level cache so every section on a card shares one answer, but
 * **stale-while-revalidate**: a mount serves the cache at once and refetches
 * in the background. The cache used to live for the whole SPA session, so a
 * calculation added in Admin → Calculations left its target editable on every
 * card until a hard reload — and the value typed there was silently
 * overwritten by the calculation on save. The inflight guard keeps N mounts
 * in one tick to one request; `invalidateCalculatedFields()` stays as the
 * hard reset the admin page calls after each mutation.
 */
let _cache: CalculatedFieldsMap | null = null;
let _inflight: Promise<CalculatedFieldsMap> | null = null;
const _listeners = new Set<(m: CalculatedFieldsMap) => void>();

function notify(m: CalculatedFieldsMap) {
  _cache = m;
  for (const fn of _listeners) fn(m);
}

function fetchCalculatedFields(): Promise<CalculatedFieldsMap> {
  if (_inflight) return _inflight;
  _inflight = api
    .get<CalculatedFieldsMap>("/calculations/calculated-fields")
    .then((r) => {
      notify(r);
      return r;
    })
    .catch(() => {
      // Keep whatever we had rather than blanking every lock on a blip.
      const fallback = _cache ?? {};
      notify(fallback);
      return fallback;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

export function invalidateCalculatedFields() {
  _cache = null;
  _inflight = null;
}

export function useCalculatedFields() {
  const [fields, setFields] = useState<CalculatedFieldsMap>(_cache || {});
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    _listeners.add(setFields);
    let active = true;
    fetchCalculatedFields().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      _listeners.delete(setFields);
    };
  }, []);

  const isCalculated = useCallback(
    (typeKey: string, fieldKey: string): boolean => {
      return (fields[typeKey] || []).includes(fieldKey);
    },
    [fields],
  );

  return { calculatedFields: fields, loading, isCalculated };
}
