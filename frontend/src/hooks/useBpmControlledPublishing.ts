/**
 * useBpmControlledPublishing — module-level singleton caching the BPM
 * controlled-publishing settings (discussion #916). Same inflight-promise
 * pattern as useSponsorButtonEnabled / useGrcEnabled.
 *
 * Two values travel together because they are one settings block:
 *   enabled                  — master switch, OFF by default. While off, the
 *                              withdraw endpoint 403s regardless of permissions.
 *   requireSeparateApprover  — sub-option, only meaningful when the master is
 *                              on. ON by default so enabling controlled
 *                              publishing is safe by default.
 *
 * Note this hook is about *availability*, never authority: whether a given user
 * may actually withdraw comes from `can_withdraw` on
 * GET /bpm/processes/{id}/flow/permissions, which checks both gates server-side.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/api/client";

export interface ControlledPublishing {
  enabled: boolean;
  requireSeparateApprover: boolean;
}

const DEFAULTS: ControlledPublishing = { enabled: false, requireSeparateApprover: true };

let _cached: ControlledPublishing | null = null;
let _inflight: Promise<void> | null = null;
let _listeners: Array<(v: ControlledPublishing) => void> = [];

function _notify(v: ControlledPublishing) {
  _cached = v;
  _listeners.forEach((fn) => fn(v));
}

/**
 * Prime the cache from outside the hook (e.g. /settings/bootstrap on app boot)
 * so first-mount consumers skip their own GET.
 */
export function invalidateBpmControlledPublishing(v: ControlledPublishing) {
  _notify(v);
}

function _fetch(): Promise<void> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await api.get<{ enabled: boolean; require_separate_approver: boolean }>(
        "/settings/bpm-controlled-publishing",
      );
      _notify({
        enabled: res.enabled,
        requireSeparateApprover: res.require_separate_approver,
      });
    } catch {
      // Fail closed: controlled publishing is opt-in, so an unreachable
      // settings endpoint must not appear to enable it.
      if (_cached === null) _notify(DEFAULTS);
    }
  })().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

export function useBpmControlledPublishing() {
  const [value, setValue] = useState<ControlledPublishing>(_cached ?? DEFAULTS);
  const [loaded, setLoaded] = useState<boolean>(_cached !== null);

  useEffect(() => {
    const listener = (v: ControlledPublishing) => {
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

  const invalidate = useCallback((newVal?: ControlledPublishing) => {
    if (newVal !== undefined) {
      _notify(newVal);
    } else {
      _cached = null;
      _fetch();
    }
  }, []);

  return {
    controlledPublishing: value.enabled,
    requireSeparateApprover: value.requireSeparateApprover,
    controlledPublishingLoaded: loaded,
    invalidateControlledPublishing: invalidate,
  };
}
