import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/api/client";
import { useCardWatch } from "@/hooks/useCardWatch";
import { useLatestRequest } from "@/hooks/useLatestRequest";
import { markLiveCardUpdate } from "@/features/cards/gamification/useScoreGain";
import type { Card } from "@/types";

/** A burst of change pings is one re-read, this long after the last one... */
export const LIVE_DEBOUNCE_MS = 400;
/** ...but never later than this after the first. */
export const LIVE_MAX_WAIT_MS = 2000;

export interface LiveCardUpdates {
  /**
   * The viewer is about to write the card (or just did): a live re-read in
   * flight may have read the card before that write landed, so it is dropped
   * and asked again — the next one reads after the write.
   */
  supersede: () => void;
  /** A stable per-key callback for a section's `onEditingChange`. */
  editingCb: (key: string) => (editing: boolean) => void;
}

/**
 * Keep an open card current while somebody else changes it.
 *
 * Watches `cardId` on the event stream (`useCardWatch`); each change ping is
 * debounced, then ONE `GET /cards/{id}` replaces the card through
 * `onCardUpdate` (marked with `markLiveCardUpdate`, so no score gain plays) and
 * `onReloaded` lets the caller reload lists that hang off the card.
 *
 * Held — the read waits, and runs once the hold clears — while any section
 * reports edit mode, while `paused`, and while the tab is hidden. Edit mode,
 * not dirtiness: replacing the card under an open, untouched form would make
 * its draft differ from the card and arm the leave guard. A 404 or 403 stops
 * watching the card; any other failure is ignored.
 */
export function useLiveCardUpdates(
  cardId: string,
  onCardUpdate: (card: Card) => void,
  paused: boolean,
  onReloaded: () => void,
): LiveCardUpdates {
  const request = useLatestRequest();
  const onCardUpdateRef = useRef(onCardUpdate);
  const onReloadedRef = useRef(onReloaded);
  const pausedRef = useRef(paused);
  useEffect(() => {
    onCardUpdateRef.current = onCardUpdate;
    onReloadedRef.current = onReloaded;
  });

  const editingRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstPingRef = useRef<number | null>(null);
  const [stoppedFor, setStoppedFor] = useState<string | null>(null);

  const held = () =>
    editingRef.current.size > 0 || pausedRef.current || document.hidden;

  const read = useCallback(() => {
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
        // Editing began while the read was out: keep the form's card as it
        // is and read again once editing ends.
        if (held()) {
          pendingRef.current = true;
          return;
        }
        onCardUpdateRef.current(markLiveCardUpdate(fresh));
        onReloadedRef.current();
      } catch (err) {
        // A superseded or unmounted read is never current (an abort is one).
        if (!isCurrent()) return;
        inFlightRef.current = false;
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setStoppedFor(cardId);
        }
      }
    });
  }, [request, cardId]);

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

  const onPing = useCallback(() => schedule(LIVE_DEBOUNCE_MS), [schedule]);
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

  // A different card (or unmount): nothing held or scheduled carries over.
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = null;
      firstPingRef.current = null;
      pendingRef.current = false;
      inFlightRef.current = false;
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

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
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

  return useMemo(() => ({ supersede, editingCb }), [supersede, editingCb]);
}
