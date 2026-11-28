import { useEffect, useRef } from "react";
import { ApiError, api } from "@/api/client";
import { getLastStreamHello, subscribeEventStream } from "@/hooks/useEventStream";

// ---------------------------------------------------------------------------
// Live card updates over the shared event stream
// ---------------------------------------------------------------------------
//
// The server sends a minimal "this card changed" ping on the tab's existing
// event stream, for the cards the tab has registered as watched. Registration
// is per connection: every connection opens with `event.stream.hello` carrying
// its `stream_id`, and `PUT /events/stream/{stream_id}/watch` replaces that
// connection's watch set. A watch expires unless it is re-sent.
//
// All of this is module state shared by every `useCardWatch` in the tab, so a
// card shown twice (the page and a side panel) is one registration, and the
// tab keeps ONE EventSource — this listens on `useEventStream`'s shared
// connection (one listener while anything is watched) and never opens its
// own. Against a backend that sends no hello, nothing here ever calls out.
//
// Two moments where a change could otherwise go unseen:
// - The page reads the card BEFORE it registers the watch, so a change
//   committed in between pings nobody. The first successful registration of a
//   newly watched id therefore calls its subscribers once (a catch-up read) —
//   once per id while it stays watched, never again on a refresh, a re-send
//   or a second hook on the same card.
// - A registration that fails for a passing reason (a network blip, a 5xx) is
//   retried after 1 s, 2 s and 5 s, then left until the next hello, refresh
//   or change of the watched set. A 404 means the connection is gone: the next
//   hello brings a new one.

/** The server accepts at most this many ids per watch set. */
export const MAX_WATCHED_CARDS = 10;
/** Re-send the watch at this share of its lifetime. */
const REFRESH_AT = 0.8;
/** A reconnect re-reads every watched card, spread over this window. */
const RECONNECT_JITTER_MS = 1500;
/** Waits before re-sending a registration that failed for a passing reason. */
export const WATCH_RETRY_DELAYS_MS = [1000, 2000, 5000] as const;
/** Until a hello names one: the server's own watch lifetime (five minutes). */
const DEFAULT_TTL_SECONDS = 300;

const CARD_CHANGED = "event.stream.card_changed";
const HELLO = "event.stream.hello";

type Subscriber = () => void;

/** Watched id → subscribers. Map order is registration order: last = newest. */
const watched = new Map<string, Set<Subscriber>>();
let streamId: string | null = null;
let ttlSeconds = DEFAULT_TTL_SECONDS;
/** The hello last adopted, so a cached one is never adopted twice. */
let adoptedSeq = 0;
/** `${streamId}|${ids}` last registered, so an unchanged set is not re-sent. */
let lastSent: string | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;
let syncAgain = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Failed attempts at registering `retryKey`. */
let retryAttempt = 0;
let retryKey: string | null = null;
/** Watched ids the server has accepted at least once (their catch-up is done). */
const confirmed = new Set<string>();
const jitterTimers = new Set<ReturnType<typeof setTimeout>>();
/** The stream listener, held while anything is watched. */
let unsubscribe: (() => void) | null = null;

/** The ids to register: the most recently registered ones, at most ten. */
function currentIds(): string[] {
  const ids = [...watched.keys()];
  return ids.slice(Math.max(0, ids.length - MAX_WATCHED_CARDS));
}

function clearRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function resetRetry(): void {
  clearRetry();
  retryAttempt = 0;
  retryKey = null;
}

/** Call every subscriber of `id` now; one throwing must not stop the others. */
function callSubscribers(id: string): void {
  const subs = watched.get(id);
  if (!subs) return;
  for (const sub of [...subs]) {
    try {
      sub();
    } catch {
      // one subscriber must not break the others
    }
  }
}

/** The server accepted `accepted`: the ids registered for the first time
 *  catch up on what changed between the page's own read and now. */
function confirm(accepted: string[]): void {
  for (const id of accepted) {
    if (!watched.has(id) || confirmed.has(id)) continue;
    confirmed.add(id);
    callSubscribers(id);
  }
}

function armRefresh(): void {
  clearRefresh();
  if (watched.size === 0) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void sync(true);
  }, ttlSeconds * 1000 * REFRESH_AT);
}

/** Coalesce a burst of mounts and unmounts into one registration. */
function scheduleSync(): void {
  if (syncTimer !== null) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void sync(false);
  }, 0);
}

async function sync(force: boolean): Promise<void> {
  const sid = streamId;
  if (sid === null) return;
  if (inflight) {
    // One registration at a time: the server replaces the set, so the
    // newest one must also be the last one to arrive.
    syncAgain = true;
    return;
  }
  const ids = currentIds();
  const key = `${sid}|${ids.join(",")}`;
  if (!force && key === lastSent) return;
  // Nothing registered on this connection yet and nothing to register.
  if (ids.length === 0 && (lastSent === null || !lastSent.startsWith(`${sid}|`))) return;
  // This send replaces any retry still waiting.
  clearRetry();
  if (key !== retryKey) {
    retryKey = key;
    retryAttempt = 0;
  }
  inflight = true;
  try {
    const res = await api.put<{ card_ids?: unknown } | undefined>(
      `/events/stream/${encodeURIComponent(sid)}/watch`,
      { card_ids: ids },
    );
    lastSent = key;
    resetRetry();
    armRefresh();
    const accepted = Array.isArray(res?.card_ids)
      ? res.card_ids.filter((id): id is string => typeof id === "string")
      : ids;
    if (streamId === sid) confirm(accepted);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // The connection is gone or was never ours (it reconnected): wait for
      // the next hello, which brings the new id and re-registers.
      if (streamId === sid) {
        streamId = null;
        lastSent = null;
        clearRefresh();
        resetRetry();
      }
    } else if (retryAttempt < WATCH_RETRY_DELAYS_MS.length && streamId === sid) {
      // A passing failure: try again shortly, a bounded number of times.
      const delay = WATCH_RETRY_DELAYS_MS[retryAttempt];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void sync(true);
      }, delay);
    } else {
      // Still failing: the page behaves as it did before live updates.
      // Remember the attempt so it is not retried in a loop; the refresh
      // timer, the next hello or a change of the watched set tries again.
      lastSent = key;
      resetRetry();
      armRefresh();
    }
  } finally {
    inflight = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

function notifyAll(): void {
  for (const [id, subs] of watched) {
    for (const sub of subs) {
      const timer = setTimeout(() => {
        jitterTimers.delete(timer);
        // Still watching? A card closed meanwhile is not re-read.
        if (watched.get(id)?.has(sub)) sub();
      }, Math.random() * RECONNECT_JITTER_MS);
      jitterTimers.add(timer);
    }
  }
}

/** Adopt the newest hello, if it is one not seen yet. */
function adoptHello(fromStream: boolean): void {
  const hello = getLastStreamHello();
  if (!hello || hello.seq === adoptedSeq) return;
  adoptedSeq = hello.seq;
  streamId = hello.streamId;
  ttlSeconds = hello.watchTtlSeconds;
  lastSent = null;
  clearRefresh();
  resetRetry();
  if (watched.size > 0) scheduleSync();
  // A reconnect means pings may have been missed while the stream was down.
  // A hello merely read from the cache on mount is not news.
  if (fromStream && hello.reconnect) notifyAll();
}

function handleStreamMessage(event: Record<string, unknown>): void {
  if (event.event === HELLO) {
    adoptHello(true);
    return;
  }
  // No stream adopted (no hello, or an older backend): nothing is registered,
  // so nothing a ping says can be ours.
  if (event.event !== CARD_CHANGED || streamId === null) return;
  const id = event.card_id;
  if (typeof id !== "string") return;
  callSubscribers(id);
}

function addWatcher(id: string, sub: Subscriber): void {
  if (unsubscribe === null) unsubscribe = subscribeEventStream(handleStreamMessage);
  adoptHello(false);
  const subs = watched.get(id);
  if (subs) {
    subs.add(sub);
    return;
  }
  watched.set(id, new Set([sub]));
  scheduleSync();
}

function removeWatcher(id: string, sub: Subscriber): void {
  const subs = watched.get(id);
  if (!subs) return;
  subs.delete(sub);
  if (subs.size > 0) return;
  watched.delete(id);
  confirmed.delete(id);
  if (watched.size === 0) {
    unsubscribe?.();
    unsubscribe = null;
    clearRefresh();
    resetRetry();
    for (const timer of jitterTimers) clearTimeout(timer);
    jitterTimers.clear();
  }
  scheduleSync();
}

/** Test seam: forget every watcher, timer and stream id. */
export function resetCardWatch(): void {
  watched.clear();
  confirmed.clear();
  streamId = null;
  ttlSeconds = DEFAULT_TTL_SECONDS;
  adoptedSeq = 0;
  lastSent = null;
  inflight = false;
  syncAgain = false;
  resetRetry();
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = null;
  clearRefresh();
  for (const timer of jitterTimers) clearTimeout(timer);
  jitterTimers.clear();
  unsubscribe?.();
  unsubscribe = null;
}

/**
 * Call `onChanged` whenever the server says card `cardId` changed — after
 * another user, an integration or an automation wrote it, and also after the
 * viewer's own saves (the server does not tell them apart). The first time the
 * server accepts the watch it is called once too (the page read the card
 * before the watch existed), and a reconnect of the stream calls it once,
 * jittered, because pings may have been missed.
 *
 * `undefined` watches nothing. The watch is shared: several hooks on the same
 * card are one registration with the server, dropped when the last unmounts.
 * Inert against a backend that sends no `event.stream.hello`.
 */
export function useCardWatch(cardId: string | undefined, onChanged: () => void): void {
  const cbRef = useRef(onChanged);
  useEffect(() => {
    cbRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    if (!cardId) return;
    // A fresh function per mount, so a StrictMode double mount registers and
    // unregisters symmetrically.
    const sub: Subscriber = () => cbRef.current();
    addWatcher(cardId, sub);
    return () => removeWatcher(cardId, sub);
  }, [cardId]);
}
