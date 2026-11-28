import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/api/client";
import { useCardWatch } from "@/hooks/useCardWatch";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { markLiveCardUpdate } from "@/features/cards/gamification/useScoreGain";
import type { Card, LiveCardUpdates } from "@/types";

/** A burst of change pings is one re-read, this long after the last one... */
export const LIVE_DEBOUNCE_MS = 400;
/** ...but never later than this after the first. */
export const LIVE_MAX_WAIT_MS = 2000;

/** A re-read that failed for a passing reason is tried again after these. */
export const LIVE_RETRY_DELAYS_MS = [1000, 2000, 5000] as const;

/** A live re-read applied this long after an own write succeeded is still own. */
export const OWN_WRITE_GRACE_MS = 5000;

/** One write tracked through `trackOwnWrite`. */
interface OwnWrite {
  anchor: string | null;
  /** `null` while the write is out. */
  succeededAt: number | null;
}

/**
 * Keep an open card current while somebody else changes it.
 *
 * Watches `cardId` on the event stream (`useCardWatch`); each change ping is
 * debounced, then ONE `GET /cards/{id}` replaces the card through
 * `onCardUpdate` and `onReloaded` lets the caller reload the lists that hang
 * off the card.
 *
 * The server pings the viewer's own writes too. A section that writes
 * something of the card and stores the card later, or never (a relation
 * picked in the add dialog, a tag), wraps the request in `trackOwnWrite`. A
 * re-read whose result is applied while such a write is still out, or within
 * `OWN_WRITE_GRACE_MS` of one succeeding, is the viewer's own: its score change
 * plays like a save, from the anchor of the most recent of those writes
 * (reported through `onOwnOrigin`). Any other re-read is marked with
 * `markLiveCardUpdate` — the score moves silently: the viewer did not earn a
 * change somebody else made. Nothing is consumed: several re-reads inside the
 * window are all own, and only one that actually raises the score shows
 * anything. A failed write counts for nothing. The host's own writes whose
 * result it stores run through `ownWrite`, which holds re-reads while the
 * write is out and drops one in flight; it records no own write (the stored
 * card plays its own gain) and never touches what `trackOwnWrite` recorded.
 *
 * Held — the read waits, and runs once the hold clears — while any section
 * reports edit mode, while `paused`, while an `ownWrite` is out, and while the
 * tab is hidden. Edit mode, not dirtiness: replacing the card under an open,
 * untouched form would make its draft differ from the card and arm the leave
 * guard. A 404 or 403 stops watching the card; any other failure is retried
 * after 1 s, 2 s and 5 s, then left until the next ping.
 */
export function useLiveCardUpdates(
  cardId: string,
  onCardUpdate: (card: Card) => void,
  paused: boolean,
  onReloaded: () => void,
  onOwnOrigin?: (anchor: string) => void,
): LiveCardUpdates {
  const request = useLatestRequest();
  const onCardUpdateRef = useRef(onCardUpdate);
  const onReloadedRef = useRef(onReloaded);
  const onOwnOriginRef = useRef(onOwnOrigin);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onCardUpdateRef.current = onCardUpdate;
    onReloadedRef.current = onReloaded;
    onOwnOriginRef.current = onOwnOrigin;
  });

  const editingRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPingRef = useRef<number | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  /** Section writes (`trackOwnWrite`) out, or succeeded within the grace window. */
  const ownWritesRef = useRef<Set<OwnWrite>>(new Set());
  /** Host writes (`ownWrite`) out right now. */
  const ownInFlightRef = useRef(0);
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);

  const held = () =>
    editingRef.current.size > 0 ||
    pausedRef.current ||
    ownInFlightRef.current > 0 ||
    document.hidden;

  /** The most recent own write that is out or inside the grace window, if any;
   *  forgets the ones that left it. */
  const currentOwnWrite = (): OwnWrite | null => {
    const now = Date.now();
    let latest: OwnWrite | null = null;
    for (const w of [...ownWritesRef.current]) {
      if (w.succeededAt !== null && now - w.succeededAt > OWN_WRITE_GRACE_MS) {
        ownWritesRef.current.delete(w);
      } else {
        latest = w;
      }
    }
    return latest;
  };

  const clearRetry = () => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };

  // `read` and `schedule` call each other (a retry re-reads); through a ref.
  const readRef = useRef<() => void>(() => {});

  const read = useCallback(() => {
    clearRetry();
    if (held()) {
      pendingRef.current = true;
      return;
    }
    pendingRef.current = false;
    inFlightRef.current = true;
    void request.run(async ({ signal, isCurrent }) => {
      try {
        const fresh = await api.get<Card>(`/cards/${cardId}`, { signal });
        if (!isCurrent()) return;
        inFlightRef.current = false;
        retryAttemptRef.current = 0;
        // Editing began while the read was out: keep the form's card as it
        // is and read again once editing ends.
        if (held()) {
          pendingRef.current = true;
          return;
        }
        const own = currentOwnWrite();
        if (own?.anchor) onOwnOriginRef.current?.(own.anchor);
        onCardUpdateRef.current(own ? fresh : markLiveCardUpdate(fresh));
        onReloadedRef.current();
      } catch (err) {
        // A superseded or unmounted read is never current (an abort is one).
        if (!isCurrent()) return;
        inFlightRef.current = false;
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setStoppedFor(cardId);
          return;
        }
        // A passing failure: try again shortly, a bounded number of times.
        const attempt = retryAttemptRef.current;
        if (attempt >= LIVE_RETRY_DELAYS_MS.length) {
          retryAttemptRef.current = 0;
          return;
        }
        retryAttemptRef.current = attempt + 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          readRef.current();
        }, LIVE_RETRY_DELAYS_MS[attempt]);
      }
    });
  }, [request, cardId]);
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  const schedule = useCallback(
    (delay: number) => {
      const now = Date.now();
      if (firstPingRef.current === null) firstPingRef.current = now;
      const wait = Math.max(0, Math.min(delay, firstPingRef.current + LIVE_MAX_WAIT_MS - now));
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        firstPingRef.current = null;
        read();
      }, wait);
    },
    [read],
  );

  const onPing = useCallback(() => {
    // A new change: a retry series still waiting starts over from this ping.
    retryAttemptRef.current = 0;
    schedule(LIVE_DEBOUNCE_MS);
  }, [schedule]);
  // Run a held re-read. Through a timer, so a hold that clears and re-arms in
  // one commit (a section's effect re-running) is still a hold when it runs.
  const flush = useCallback(() => {
    if (pendingRef.current) schedule(0);
  }, [schedule]);

  useCardWatch(stoppedFor === cardId ? undefined : cardId, onPing);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) flush();
  }, [paused, flush]);

  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [flush]);

  // A different card (or unmount): nothing held, scheduled or retried carries
  // over.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
      retryAttemptRef.current = 0;
      firstPingRef.current = null;
      pendingRef.current = false;
      inFlightRef.current = false;
      // A write still out for the previous card settles into the old set.
      ownWritesRef.current = new Set();
      request.cancel();
    },
    [cardId, request],
  );

  const supersede = useCallback(() => {
    if (!inFlightRef.current) return;
    request.cancel();
    inFlightRef.current = false;
    pendingRef.current = true;
    schedule(LIVE_DEBOUNCE_MS);
  }, [request, schedule]);

  const trackOwnWrite = useCallback(
    async <T>(run: () => Promise<T>, anchor: string | null = null): Promise<T> => {
      const entry: OwnWrite = { anchor, succeededAt: null };
      // Insertion order is start order: the last entry is the newest write.
      const writes = ownWritesRef.current;
      writes.add(entry);
      try {
        const result = await run();
        entry.succeededAt = Date.now();
        return result;
      } catch (err) {
        writes.delete(entry);
        throw err;
      }
    },
    [],
  );

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const ownWrite = useCallback(
    async <T>(write: () => Promise<T>): Promise<T> => {
      supersede();
      ownInFlightRef.current += 1;
      try {
        return await write();
      } finally {
        ownInFlightRef.current -= 1;
        supersede();
        // A re-read held while the write was out runs after the usual
        // debounce, so it coalesces with the write's own ping.
        if (ownInFlightRef.current === 0 && pendingRef.current) schedule(LIVE_DEBOUNCE_MS);
      }
    },
    [supersede, schedule],
  );

  const editingCbs = useRef<Map<string, (editing: boolean) => void>>(new Map());
  const editingCb = useCallback((key: string) => {
    let cb = editingCbs.current.get(key);
    if (!cb) {
      cb = (editing: boolean) => {
        const set = editingRef.current;
        const before = set.size;
        if (editing) set.add(key);
        else set.delete(key);
        if (before > 0 && set.size === 0) flushRef.current();
      };
      editingCbs.current.set(key, cb);
    }
    return cb;
  }, []);

  return useMemo(
    () => ({ supersede, trackOwnWrite, ownWrite, editingCb }),
    [supersede, trackOwnWrite, ownWrite, editingCb],
  );
}
