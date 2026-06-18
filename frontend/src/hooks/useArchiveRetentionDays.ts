/**
 * useArchiveRetentionDays — module-level singleton that caches how many days an
 * archived card is kept before it is permanently auto-purged. A value of 0
 * means archived cards are kept indefinitely (auto-purge disabled). Same
 * singleton/inflight pattern as usePpmEnabled.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";

export const DEFAULT_ARCHIVE_RETENTION_DAYS = 30;

let _cached: number | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: number) => void> = [];

function _notify(v: number) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/**
 * Prime the cache from outside the hook (e.g. /settings/bootstrap on app boot)
 * so first-mount consumers skip their own GET.
 */
export function invalidateArchiveRetentionDays(v: number) {
  _notify(v);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<{ days: number }>("/settings/archive-retention-days");
      _notify(res.days);
    } catch {
      if (_cached === null) _notify(DEFAULT_ARCHIVE_RETENTION_DAYS);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useArchiveRetentionDays() {
  const [days, setDays] = useState<number>(_cached ?? DEFAULT_ARCHIVE_RETENTION_DAYS);
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: number) => {
      setDays(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setDays(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const invalidate = useCallback((newVal?: number) => {
    if (newVal !== undefined) {
      _notify(newVal);
    } else {
      _cached = null;
      _fetch();
    }
  }, []);

  return { archiveRetentionDays: days, archiveRetentionLoaded: loaded, invalidateArchiveRetention: invalidate };
}
