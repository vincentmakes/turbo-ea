import { useCallback, useEffect, useState } from "react";
import { api } from "@/api/client";

const DEFAULT_APP_TITLE = "Turbo EA";

let _cache: string | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(title: string) => void>();

function notify(title: string) {
  _cache = title;
  for (const fn of _listeners) fn(title);
}

function loadOnce() {
  if (_cache !== null) return;
  if (_inflight) return;
  _inflight = api
    .get<{ app_title: string }>("/settings/app-title")
    .then((r) => {
      notify((r.app_title || "").trim() || DEFAULT_APP_TITLE);
    })
    .catch(() => {
      notify(DEFAULT_APP_TITLE);
    })
    .finally(() => {
      _inflight = null;
    });
}

/**
 * Subscribe to the current app title. Returns the default `"Turbo EA"` until
 * the first fetch resolves. Admin screens should call `invalidateAppTitle(new)`
 * after a successful PATCH to broadcast the new value to all consumers.
 */
export function useAppTitle(): string {
  const [title, setTitle] = useState(_cache || DEFAULT_APP_TITLE);

  useEffect(() => {
    _listeners.add(setTitle);
    loadOnce();
    return () => {
      _listeners.delete(setTitle);
    };
  }, []);

  return title;
}

/** Broadcast a freshly saved app title to all mounted consumers. */
export function invalidateAppTitle(title: string) {
  notify(title.trim() || DEFAULT_APP_TITLE);
}

/** Hook variant that also exposes the setter (for admin screens). */
export function useAppTitleWithSetter(): {
  title: string;
  set: (t: string) => void;
} {
  const title = useAppTitle();
  const set = useCallback((t: string) => invalidateAppTitle(t), []);
  return { title, set };
}
