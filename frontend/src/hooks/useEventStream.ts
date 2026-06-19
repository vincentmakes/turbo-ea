import { useEffect, useRef } from "react";
import { isAuthenticated } from "@/api/client";

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
let es: EventSource | null = null;

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
      dispatch(JSON.parse(e.data) as Record<string, unknown>);
    } catch {
      // ignore parse errors
    }
  };
  es.onerror = () => {
    // EventSource auto-reconnects on its own.
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
}

export function useEventStream(onEvent: (event: Record<string, unknown>) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    if (!isAuthenticated()) return;

    const listener: Listener = (event) => cbRef.current(event);
    listeners.add(listener);
    startStream();

    return () => {
      listeners.delete(listener);
      // The connection is intentionally left open for the tab's lifetime — the
      // two consumers (AppLayout, NotificationBell) are always mounted, and
      // logout tears it down explicitly via stopEventStream().
    };
  }, []);
}
