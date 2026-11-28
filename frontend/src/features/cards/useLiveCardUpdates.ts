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

/**
 * Keep an open card current while somebody else changes it.
 *
 * Watches `cardId` on the event stream (`useCardWatch`); each change ping is
 * debounced, then ONE `GET /cards/{id}` replaces the card through
 * `onCardUpdate` and `onReloaded` lets the caller reload the lists that hang
 * off the card.
 *
 * The server pings the viewer's own writes too. A re-read is marked with
 * `markLiveCardUpdate` (the score moves silently: the viewer did not earn a
 * change somebody else made) only when no own write happened on the page
 * since the card was last stored: a section that writes something of the card
 * and stores the card later, or never (a relation picked in the add dialog, a
 * tag), calls `noteOwnWrite` first, and the re-read that brings that write
 * back plays its score change like a save — from the section's anchor,
 * reported through `onOwnOrigin`. The host's own writes whose result it stores
 * run through `ownWrite`, which holds re-reads while the write is out and
 * clears what `noteOwnWrite` recorded (the stored card carries it).
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
  /** An own write not yet stored as a card: the next re-read brings it back. */
  const ownRef = useRef<{ anchor: string | null } | null>(null);
  /** Host writes (`ownWrite`) out right now. */
  const ownInFlightRef = useRef(0);
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);

  const held = () =>
    editingRef.current.size > 0 ||
    pausedRef.current ||
    ownInFlightRef.current > 0 ||
    document.hidden;

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
        const own = ownRef.current;
        ownRef.current = null;
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
      ownRef.current = null;
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

  const noteOwnWrite = useCallback(
    (anchor?: string | null) => {
      supersede();
      ownRef.current = { anchor: anchor ?? null };
    },
    [supersede],
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
        // The caller stores what came back, which carries every own write so
        // far: the next re-read is somebody else's again.
        ownRef.current = null;
        if (ownInFlightRef.current === 0) flushRef.current();
      }
    },
    [supersede],
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
    () => ({ supersede, noteOwnWrite, ownWrite, editingCb }),
    [supersede, noteOwnWrite, ownWrite, editingCb],
  );
}
