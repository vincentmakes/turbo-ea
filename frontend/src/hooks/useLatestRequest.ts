import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DependencyList } from "react";
import { isAbortError } from "@/api/client";

/**
 * Context handed to a request body. Forward `signal` to every `api.get` the
 * body issues, and check `isCurrent()` before every `setState`.
 */
export interface RequestCtx {
  /** Aborted when a newer run starts, or when the component unmounts. */
  signal: AbortSignal;
  /**
   * False once a newer run has started (or the component unmounted).
   *
   * The generation token — not the abort — is the real guard: a response that
   * has already resolved cannot be aborted, and test doubles ignore `signal`
   * entirely. Check it before EVERY `setState`, including the one that clears
   * a loading flag.
   */
  isCurrent: () => boolean;
}

export interface LatestRequest {
  /**
   * Runs `fn` as the newest request, aborting and invalidating any predecessor.
   *
   * Always settles, even when superseded, so `await run(...)` never hangs.
   * Aborts and rejections from superseded runs are swallowed; a real error from
   * the current run is rethrown for the caller's own `try`/`catch`.
   */
  run: (fn: (ctx: RequestCtx) => Promise<void>) => Promise<void>;
  /** Abort and invalidate whatever is in flight without starting anything new. */
  cancel: () => void;
}

/**
 * Serialises overlapping requests so that only the most recent one may write
 * state — the fix for #882, where clearing an inventory filter (a slow
 * whole-repository fetch) and then picking a type let the slow response land
 * last and overwrite the grid.
 *
 * Aborts the predecessor AND compares a monotonic generation token. Both are
 * needed: the abort saves the download and the re-render, the token is what
 * actually guarantees ordering.
 *
 * Use this directly only when the fetch must also be callable imperatively
 * (`InventoryPage`'s `loadData`, which 13 mutation handlers refresh through).
 * Otherwise prefer `useAbortableEffect` below, or `useApiQuery`.
 */
export function useLatestRequest(): LatestRequest {
  const genRef = useRef(0);
  const ctrlRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    genRef.current += 1;
    ctrlRef.current?.abort();
    ctrlRef.current = null;
  }, []);

  const run = useCallback(async (fn: (ctx: RequestCtx) => Promise<void>) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const gen = ++genRef.current;
    const ctx: RequestCtx = {
      signal: ctrl.signal,
      isCurrent: () => gen === genRef.current,
    };
    try {
      await fn(ctx);
    } catch (err) {
      // A superseded run owns none of the state, and an abort is not a failure.
      if (isAbortError(err) || gen !== genRef.current) return;
      throw err;
    } finally {
      if (gen === genRef.current) ctrlRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  // MUST be identity-stable: callers put this in `useCallback` dependency
  // arrays, so a fresh object each render would rebuild their fetch callback
  // and turn the effect that calls it into an infinite request loop.
  return useMemo(() => ({ run, cancel }), [run, cancel]);
}

/**
 * `useLatestRequest` wired to a dependency array — the drop-in replacement for
 * `useEffect(() => { api.get(...).then(setX) }, deps)`.
 *
 * Use it when the effect writes several pieces of state, or fans out over
 * `Promise.all`; use `useApiQuery` when one payload feeds one state.
 */
export function useAbortableEffect(
  effect: (ctx: RequestCtx) => Promise<void>,
  deps: DependencyList,
): void {
  const { run } = useLatestRequest();
  // Read the effect from a ref so a fresh closure each render isn't a dependency.
  const effectRef = useRef(effect);
  effectRef.current = effect;

  useEffect(() => {
    run((ctx) => effectRef.current(ctx)).catch((err) => {
      // The effect body owns its own error UI; this is the last-resort net so a
      // failed fetch is never an unhandled rejection.
      console.error(err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
