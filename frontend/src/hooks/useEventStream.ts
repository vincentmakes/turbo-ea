import { useEffect, useRef } from "react";
import { isAuthenticated } from "@/api/client";
import type { StreamHello } from "@/types";

// ---------------------------------------------------------------------------
// Per-tab SSE singleton
// ---------------------------------------------------------------------------
//
// Every consumer of this hook used to open its own EventSource. With two
// always-mounted consumers (AppLayout + NotificationBell) that meant two
// long-lived SSE connections per tab. Over HTTP/1.1 browsers cap ~6
// connections per host and SSE connections never close, so 3 tabs × 2 = 6
// saturated the pool and all further XHR/fetch requests stalled until a tab
// was closed (issue #654).
//
// This module now keeps a single EventSource per tab, shared by every
// consumer, halving the per-tab connection footprint (and the backend
// event_bus subscriber count).

type Listener = (event: Record<string, unknown>) => void;

const STREAM_URL = "/api/v1/events/stream";
const listeners = new Set<Listener>();
const reconnectListeners = new Set<() => void>();
let es: EventSource | null = null;
//: Whether this tab's stream has ever been open. The first `onopen` is the
//: initial connection; every later one means it dropped and came back.
let hasConnected = false;

//: The newest `event.stream.hello`, kept here because it is the first message
//: of a connection: a consumer that mounts later (a card page opened after the
//: layout started the stream) would otherwise never learn the stream's id. An
//: older backend sends no hello, and this stays `null`.
let lastHello: StreamHello | null = null;
/** Used only when a hello names no lifetime: the server's own default. */
const DEFAULT_WATCH_TTL_SECONDS = 300;
let helloSeq = 0;
let hellosThisStream = 0;

function noteHello(event: Record<string, unknown>): void {
  if (event.event !== "event.stream.hello") return;
  const streamId = event.stream_id;
  if (typeof streamId !== "string" || streamId === "") return;
  const ttl = Number(event.watch_ttl_seconds);
  hellosThisStream += 1;
  helloSeq += 1;
  lastHello = {
    streamId,
    watchTtlSeconds: Number.isFinite(ttl) && ttl > 0 ? ttl : DEFAULT_WATCH_TTL_SECONDS,
    seq: helloSeq,
    reconnect: hellosThisStream > 1,
  };
}

/** The current connection's hello, or `null` (none yet, or an older backend). */
export function getLastStreamHello(): StreamHello | null {
  return lastHello;
}

function dispatch(event: Record<string, unknown>): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // a misbehaving listener must not break the others
    }
  }
}

function startStream(): void {
  if (es) return;
  // Cookie is sent automatically for same-origin EventSource requests.
  es = new EventSource(STREAM_URL);
  es.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data) as Record<string, unknown>;
      // Recorded before the fan-out, so a listener reacting to the hello reads
      // it through `getLastStreamHello()` already.
      noteHello(event);
      dispatch(event);
    } catch {
      // ignore parse errors
    }
  };
  es.onopen = () => {
    // SSE has no replay: anything published while the stream was down is gone
    // for good. A reconnect therefore means "you may have missed events" —
    // consumers resync from the API rather than drifting until the next full
    // page load. The common cause is not a network blip but an upgrade: the
    // announcement is written during backend startup, before the app serves,
    // so there is no subscriber to publish to and the bell badge would
    // otherwise sit at its old count until the user reloaded (#1002).
    if (hasConnected) {
      for (const listener of reconnectListeners) {
        try {
          listener();
        } catch {
          // a misbehaving listener must not break the others
        }
      }
    }
    hasConnected = true;
  };
  es.onerror = () => {
    // EventSource auto-reconnects on its own.
  };
}

/**
 * Listen to the shared stream from outside React (a module that keeps its own
 * state across components). Returns the unsubscribe. It does not open the
 * stream: the always-mounted layout consumers own that, and a listener added
 * before the stream opens simply hears it from the first message.
 */
export function subscribeEventStream(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Close the shared connection (e.g. on logout). A later login re-arms it on
 * the next mounted consumer. Listeners are owned by mounted hooks and are not
 * touched here.
 */
export function stopEventStream(): void {
  if (es) {
    es.close();
    es = null;
  }
  // A later login opens a fresh stream, and that open is an initial
  // connection, not a reconnect — nothing was missed in between.
  hasConnected = false;
  lastHello = null;
  hellosThisStream = 0;
}

/**
 * Subscribe to the shared per-tab event stream.
 *
 * `onReconnect` fires when the stream comes back after a drop — never on the
 * initial connection. Give it to anything whose state is built up from events
 * (an unread count, a badge) so it re-reads the truth from the API instead of
 * silently missing whatever was published while the tab was disconnected.
 */
export function useEventStream(
  onEvent: (event: Record<string, unknown>) => void,
  onReconnect?: () => void,
) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;
  const reconnectRef = useRef(onReconnect);
  reconnectRef.current = onReconnect;

  useEffect(() => {
    if (!isAuthenticated()) return;

    const listener: Listener = (event) => cbRef.current(event);
    listeners.add(listener);
    const onReconnected = () => reconnectRef.current?.();
    reconnectListeners.add(onReconnected);
    startStream();

    return () => {
      listeners.delete(listener);
      reconnectListeners.delete(onReconnected);
      // The connection is intentionally left open for the tab's lifetime — the
      // two consumers (AppLayout, NotificationBell) are always mounted, and
      // logout tears it down explicitly via stopEventStream().
    };
  }, []);
}
