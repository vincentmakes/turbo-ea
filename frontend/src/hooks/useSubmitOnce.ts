import { useCallback, useMemo, useRef, useState } from "react";

export interface SubmitOnce {
  /** True while a submit is in flight — bind it to the control's `disabled`. */
  busy: boolean;
  /**
   * The same answer read at once, for a handler that must step aside while a
   * submit is in flight (Back while Next saves): `busy` is state, so a click
   * that lands before the re-render still sees it false.
   */
  isBusy: () => boolean;
  /**
   * Runs `fn` unless a submit is already in flight, in which case it resolves
   * `undefined` without calling `fn`. The guard is a ref, so a second click
   * that lands before `busy` has re-rendered the control disabled is ignored
   * too. A rejection from `fn` propagates to the caller.
   */
  run: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

/**
 * One in-flight submit per call site — the double-click guard every dialog
 * and action button with a request behind it needs.
 *
 * Two things are routinely got wrong when this is hand-rolled, which is why
 * it is a hook: disabling the button on a `useState` flag alone leaves the
 * window between the click and the re-render open (that is how a survey and
 * a decision each got created twice), and a ref alone gives the user no
 * feedback that the first click took. `run` closes the window, `busy` gives
 * the feedback.
 */
export function useSubmitOnce(): SubmitOnce {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  // Stryker disable next-line ArrayDeclaration: a ref read needs no deps; any list is equivalent
  const isBusy = useCallback(() => busyRef.current, []);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    // Stryker disable next-line ArrayDeclaration: refs and state setters are stable; any list is equivalent
  }, []);

  // Identity-stable, so a caller may put it in a dependency array.
  return useMemo(() => ({ busy, isBusy, run }), [busy, isBusy, run]);
}
