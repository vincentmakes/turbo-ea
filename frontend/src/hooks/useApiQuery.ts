import { useCallback, useEffect, useRef, useState } from "react";
import { api, isAbortError } from "@/api/client";
import { useLatestRequest } from "./useLatestRequest";

export interface ApiQueryOptions<T, S> {
  /**
   * Map the payload before it lands in state. Held in a ref, so passing a fresh
   * arrow function on every render never triggers a refetch.
   */
  select?: (raw: T) => S;
  /**
   * Keep the last successful data on screen while a new request is in flight.
   * Defaults to true — blanking to a spinner on every picker change is jarring
   * and hides a perfectly good previous render.
   */
  keepPreviousData?: boolean;
  /** Bump to force a refetch while `path` is unchanged (e.g. after a mutation). */
  refetchKey?: string | number;
}

export interface ApiQueryResult<S> {
  data: S | undefined;
  loading: boolean;
  /** Never an abort — a superseded request is not an error. */
  error: Error | null;
  refetch: () => void;
}

/**
 * A `GET` keyed on user-controlled state, with ordering guaranteed: the request
 * for the previous value can never overwrite the one for the current value
 * (#882).
 *
 * Pass `null` as the path to stay idle (a closed dropdown, an unselected type);
 * that cancels anything in flight and clears the data.
 *
 * One payload feeding one piece of state is the case this covers. When the
 * effect writes several states, or fans out over `Promise.all`, use
 * `useAbortableEffect` instead of contorting `select`.
 */
export function useApiQuery<T, S = T>(
  path: string | null,
  opts: ApiQueryOptions<T, S> = {},
): ApiQueryResult<S> {
  const { keepPreviousData = true, refetchKey } = opts;
  const selectRef = useRef(opts.select);
  selectRef.current = opts.select;

  const [data, setData] = useState<S | undefined>(undefined);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const { run, cancel } = useLatestRequest();

  useEffect(() => {
    if (path === null) {
      cancel();
      setData(undefined);
      setLoading(false);
      setError(null);
      return;
    }
    void run(async ({ signal, isCurrent }) => {
      setLoading(true);
      setError(null);
      if (!keepPreviousData) setData(undefined);
      try {
        const raw = await api.get<T>(path, { signal });
        if (!isCurrent()) return;
        const select = selectRef.current;
        setData(select ? select(raw) : (raw as unknown as S));
      } catch (err) {
        if (!isCurrent() || isAbortError(err)) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        // Only the winner may clear the spinner. An aborted predecessor
        // rejecting first would otherwise flash "done" over stale data while
        // the real request is still in flight.
        if (isCurrent()) setLoading(false);
      }
    });
  }, [path, refetchKey, nonce, keepPreviousData, run, cancel]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, refetch };
}
