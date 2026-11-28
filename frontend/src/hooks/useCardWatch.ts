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

/** The server accepts at most this many ids per watch set. */
export const MAX_WATCHED_CARDS = 10;
/** Re-send the watch at this share of its lifetime. */
const REFRESH_AT = 0.8;
/** A reconnect re-reads every watched card, spread over this window. */
const RECONNECT_JITTER_MS = 1500;

const CARD_CHANGED = "event.stream.card_changed";
const HELLO = "event.stream.hello";

type Subscriber = () => void;

/** Watched id → subscribers. Map order is registration order: last = newest. */
const watched = new Map<string, Set<Subscriber>>();
let streamId: string | null = null;
let ttlSeconds = 1800;
/** The hello last adopted, so a cached one is never adopted twice. */
let adoptedSeq = 0;
/** `${streamId}|${ids}` last registered, so an unchanged set is not re-sent. */
let lastSent: string | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;
let syncAgain = false;
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
  inflight = true;
  try {
    await api.put(`/events/stream/${encodeURIComponent(sid)}/watch`, { card_ids: ids });
    lastSent = key;
    armRefresh();
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      // The connection is gone or was never ours (it reconnected): wait for
      // the next hello, which brings the new id and re-registers.
      if (streamId === sid) {
        streamId = null;
        lastSent = null;
        clearRefresh();
      }
    } else {
      // Anything else is swallowed: the page just behaves as it did before
      // live updates. Remember the attempt so it is not retried in a loop;
      // the refresh timer tries again later.
      lastSent = key;
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
  if (watched.size === 0) {
    unsubscribe?.();
    unsubscribe = null;
    clearRefresh();
    for (const timer of jitterTimers) clearTimeout(timer);
    jitterTimers.clear();
  }
  scheduleSync();
}

/** Test seam: forget every watcher, timer and stream id. */
export function resetCardWatch(): void {
  watched.clear();
  streamId = null;
  ttlSeconds = 1800;
  adoptedSeq = 0;
  lastSent = null;
  inflight = false;
  syncAgain = false;
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
 * viewer's own saves (the server does not tell them apart). A reconnect of the
 * stream calls it once too, jittered, because pings may have been missed.
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
