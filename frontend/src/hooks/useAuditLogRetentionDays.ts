/**
 * useAuditLogRetentionDays — module-level singleton that caches the two
 * retention windows the Audit log shows:
 *
 *  - `auditLogRetentionDays` — how long a Security & admin entry is kept
 *    before the daily purge deletes it (admin-adjustable at Admin → Settings →
 *    Data management; 0 = keep indefinitely).
 *  - `mutationBatchRetentionDays` — how long a mutation batch (the **Changes**
 *    sub-tab) is kept; an operator setting (`MUTATION_BATCH_RETENTION_DAYS`),
 *    read-only here.
 *
 * Both are primed from `/settings/bootstrap` (see `api/bootstrap.ts`). The
 * fallback fetch only knows the audit-log window, so the batch window keeps
 * its default until bootstrap supplies it. Same singleton/inflight pattern as
 * `useArchiveRetentionDays`.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";

export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365;
/** Upper bound the server accepts for the audit-log window (10 years). */
export const MAX_AUDIT_LOG_RETENTION_DAYS = 3650;
export const DEFAULT_MUTATION_BATCH_RETENTION_DAYS = 15;

export interface AuditRetention {
  auditLogRetentionDays: number;
  mutationBatchRetentionDays: number;
}

const DEFAULTS: AuditRetention = {
  auditLogRetentionDays: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  mutationBatchRetentionDays: DEFAULT_MUTATION_BATCH_RETENTION_DAYS,
};

let _cached: AuditRetention | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: AuditRetention) => void> = [];

function _notify(patch: Partial<AuditRetention>) {
  const next: AuditRetention = { ...(_cached ?? DEFAULTS) };
  if (typeof patch.auditLogRetentionDays === "number") {
    next.auditLogRetentionDays = patch.auditLogRetentionDays;
  }
  if (typeof patch.mutationBatchRetentionDays === "number") {
    next.mutationBatchRetentionDays = patch.mutationBatchRetentionDays;
  }
  _cached = next;
  _listeners.forEach((fn) => fn(next));
}

/**
 * Prime or update the cache from outside the hook — `/settings/bootstrap` on
 * app boot, or the Settings page after an admin saves a new window. A bare
 * number is the audit-log window.
 */
export function invalidateAuditLogRetentionDays(v: number | Partial<AuditRetention>) {
  _notify(typeof v === "number" ? { auditLogRetentionDays: v } : v);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<{ days: number }>("/settings/audit-log-retention-days");
      _notify({ auditLogRetentionDays: res.days });
    } catch {
      if (_cached === null) _notify({});
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useAuditLogRetentionDays() {
  const [value, setValue] = useState<AuditRetention>(_cached ?? DEFAULTS);
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: AuditRetention) => {
      setValue(v);
      setLoaded(true);
    };
    _listeners.push(listener);
    if (_cached === null) {
      _fetch();
    } else {
      setValue(_cached);
      setLoaded(true);
    }
    return () => {
      _listeners = _listeners.filter((fn) => fn !== listener);
    };
  }, []);

  const invalidate = useCallback((newVal?: number) => {
    if (newVal !== undefined) {
      _notify({ auditLogRetentionDays: newVal });
    } else {
      // Re-read the audit-log window; the batch window only comes from
      // bootstrap, so the cached one is kept rather than reset to its default.
      _fetch();
    }
  }, []);

  return {
    auditLogRetentionDays: value.auditLogRetentionDays,
    mutationBatchRetentionDays: value.mutationBatchRetentionDays,
    auditLogRetentionLoaded: loaded,
    invalidateAuditLogRetention: invalidate,
  };
}
