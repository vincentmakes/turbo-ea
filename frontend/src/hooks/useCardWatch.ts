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
// A change can go unseen in three ways, and each ends in the same rule: when
// the server accepts a registration of an id, the page re-reads that card once
// (a catch-up) if the id may have been unwatched for a while before —
// - it is the id's first accepted registration on the CURRENT stream id: the
//   page read the card before the watch existed (first mount), or the stream
//   reconnected and pings were lost while it was down (a new hello clears the
//   per-stream confirmations, so every id catches up once its new watch
//   exists — never before);
// - or more than the announced lifetime has passed since the id's last
//   accepted registration: the renewal came too late (failed retries, a
//   throttled background-tab timer, a suspended laptop), so the server let the
//   watch lapse.
// A renewal accepted in time, a second hook on the same card or a refused id
// gets no catch-up.
//
// Renewal runs at half the announced lifetime, which leaves the other half as
// margin for browsers that fire timers in a hidden tab once a minute or less,
// and the tab re-checks when it becomes visible again. A registration that
// fails for a passing reason (a network blip, a 5xx) is retried after 1 s, 2 s
// and 5 s, then every 30 s while anything is watched. A 404 means the
// connection is gone: the next hello brings a new one. After a reconnect hello
// the registration waits a random 0–1.5 s, so many tabs coming back at once do
// not all re-register and re-read at the same instant.

/** The server accepts at most this many ids per watch set. */
export const MAX_WATCHED_CARDS = 10;
/** Re-send the watch at this share of its lifetime. */
export const WATCH_RENEW_AT = 0.5;
/** After a reconnect hello the registration waits up to this long. */
export const RECONNECT_JITTER_MS = 1500;
/** Waits before re-sending a registration that failed for a passing reason. */
export const WATCH_RETRY_DELAYS_MS = [1000, 2000, 5000] as const;
/** ...and once those are spent, this long between attempts while anything is watched. */
export const WATCH_RETRY_INTERVAL_MS = 30_000;
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
/** Id → when (send time) its last accepted registration on THIS stream went out. */
const registeredAt = new Map<string, number>();
/** When the last accepted registration on this stream went out, or `null`. */
let lastAcceptedAt: number | null = null;
/** The stream listener, held while anything is watched. */
let unsubscribe: (() => void) | null = null;
let visibilityListening = false;

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

/** The server accepted `accepted` from a registration sent at `sentAt`: each
 *  id that may have been unwatched before catches up (see the rule above). */
function confirm(accepted: string[], sentAt: number): void {
  const now = Date.now();
  const lifetimeMs = ttlSeconds * 1000;
  const acceptedSet = new Set(accepted);
  // An id left out of this set (refused, or past the ten newest) is not
  // watched server-side any more: its next acceptance starts over.
  for (const id of [...registeredAt.keys()]) {
    if (!acceptedSet.has(id)) registeredAt.delete(id);
  }
  lastAcceptedAt = sentAt;
  const catchUp: string[] = [];
  for (const id of accepted) {
    if (!watched.has(id)) continue;
    const prev = registeredAt.get(id);
    registeredAt.set(id, sentAt);
    if (prev === undefined || now - prev > lifetimeMs) catchUp.push(id);
  }
  for (const id of catchUp) callSubscribers(id);
}

function armRefresh(): void {
  clearRefresh();
  if (watched.size === 0) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void sync(true);
  }, ttlSeconds * 1000 * WATCH_RENEW_AT);
}

/** Coalesce a burst of mounts and unmounts into one registration. */
function scheduleSync(delay = 0): void {
  if (syncTimer !== null) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void sync(false);
  }, delay);
}

function scheduleRetry(): void {
  const delay =
    retryAttempt < WATCH_RETRY_DELAYS_MS.length
      ? WATCH_RETRY_DELAYS_MS[retryAttempt]
      : WATCH_RETRY_INTERVAL_MS;
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void sync(true);
  }, delay);
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
  // This send replaces any retry or renewal still waiting.
  clearRetry();
  clearRefresh();
  if (key !== retryKey) {
    retryKey = key;
    retryAttempt = 0;
  }
  inflight = true;
  const sentAt = Date.now();
  try {
    const res = await api.put<{ card_ids?: unknown } | undefined>(
      `/events/stream/${encodeURIComponent(sid)}/watch`,
      { card_ids: ids },
    );
    if (streamId === sid) {
      lastSent = key;
      resetRetry();
      armRefresh();
      const accepted = Array.isArray(res?.card_ids)
        ? res.card_ids.filter((id): id is string => typeof id === "string")
        : ids;
      confirm(accepted, sentAt);
    }
  } catch (err) {
    if (streamId !== sid) {
      // A newer stream took over meanwhile; its own registration is under way.
    } else if (err instanceof ApiError && err.status === 404) {
      // The connection is gone or was never ours (it reconnected): wait for
      // the next hello, which brings the new id and re-registers.
      streamId = null;
      lastSent = null;
      clearRefresh();
      resetRetry();
    } else if (retryAttempt < WATCH_RETRY_DELAYS_MS.length || watched.size > 0) {
      // A passing failure: the short series first, then a steady interval
      // while anything is watched. A late success catches up (rule (b)).
      scheduleRetry();
    } else {
      resetRetry();
    }
  } finally {
    inflight = false;
    if (syncAgain) {
      syncAgain = false;
      scheduleSync();
    }
  }
}

/** The tab is visible again: a renewal a throttled timer left overdue goes now. */
function onVisibilityChange(): void {
  if (document.hidden || streamId === null || watched.size === 0 || inflight) return;
  const overdue =
    lastAcceptedAt === null
      ? retryTimer !== null
      : Date.now() - lastAcceptedAt > ttlSeconds * 1000 * WATCH_RENEW_AT;
  if (overdue) void sync(true);
}

function listenVisibility(on: boolean): void {
  if (typeof document === "undefined" || on === visibilityListening) return;
  visibilityListening = on;
  if (on) document.addEventListener("visibilitychange", onVisibilityChange);
  else document.removeEventListener("visibilitychange", onVisibilityChange);
}

/** Adopt the newest hello, if it is one not seen yet. */
function adoptHello(fromStream: boolean): void {
  const hello = getLastStreamHello();
  if (!hello || hello.seq === adoptedSeq) return;
  adoptedSeq = hello.seq;
  if (hello.streamId !== streamId) {
    // A new connection: no watch of the old one carries over, so every id's
    // next acceptance is a first one and catches up.
    registeredAt.clear();
    lastAcceptedAt = null;
  }
  streamId = hello.streamId;
  ttlSeconds = hello.watchTtlSeconds;
  lastSent = null;
  clearRefresh();
  resetRetry();
  if (watched.size === 0) return;
  // After a reconnect, spread the re-registration (and so the catch-up reads)
  // of many tabs. A hello merely read from the cache on mount is not news.
  if (fromStream && hello.reconnect) {
    if (syncTimer !== null) clearTimeout(syncTimer);
    syncTimer = null;
    scheduleSync(Math.random() * RECONNECT_JITTER_MS);
  } else {
    scheduleSync();
  }
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
  listenVisibility(true);
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
  registeredAt.delete(id);
  if (watched.size === 0) {
    unsubscribe?.();
    unsubscribe = null;
    listenVisibility(false);
    clearRefresh();
    resetRetry();
  }
  scheduleSync();
}

/** Test seam: forget every watcher, timer and stream id. */
export function resetCardWatch(): void {
  watched.clear();
  registeredAt.clear();
  lastAcceptedAt = null;
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
  unsubscribe?.();
  unsubscribe = null;
  listenVisibility(false);
}

/**
 * Call `onChanged` whenever the server says card `cardId` changed — after
 * another user, an integration or an automation wrote it, and also after the
 * viewer's own saves (the server does not tell them apart). It is also called
 * once when the server accepts a watch that may have missed changes: the
 * first one on the current stream (on mount, and again once the watch is
 * back after a reconnect) and one accepted later than the watch's lifetime
 * after the previous one.
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
