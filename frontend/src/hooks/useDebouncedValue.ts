import { useEffect, useRef, useState } from "react";

/**
 * Settles a rapidly-changing value before anything expensive keys off it —
 * typically a search box, so typing "SAP ERP" issues one request instead of
 * seven (#882).
 *
 * Returns `[debounced, pending]`. `pending` goes true on the FIRST change and
 * stays true until the value settles, so callers can OR it into a loading flag:
 * a grid must never look finished while it is still showing rows for the
 * previous query.
 *
 * There is no debounce on mount, and `delayMs <= 0` passes through
 * synchronously.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): [T, boolean] {
  const [debounced, setDebounced] = useState(value);
  const [pending, setPending] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    // Typed and deleted back to where we started — nothing to wait for.
    if (Object.is(value, debounced)) {
      setPending(false);
      return;
    }
    if (delayMs <= 0) {
      setDebounced(value);
      setPending(false);
      return;
    }
    setPending(true);
    const timer = setTimeout(() => {
      setDebounced(value);
      setPending(false);
    }, delayMs);
    return () => clearTimeout(timer);
    // `debounced` is read only for the equality short-circuit above; keying the
    // effect on it would re-run on every settle and loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delayMs]);

  return [debounced, pending];
}
