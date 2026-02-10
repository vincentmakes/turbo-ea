import { useEffect, useRef, useCallback } from "react";

interface EventData {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  changes?: Record<string, unknown>;
  created_at: string;
}

type EventHandler = (event: EventData) => void;

export function useEventStream(onEvent: EventHandler) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource("/api/v1/events/stream");

    es.onmessage = (event) => {
      try {
        const data: EventData = JSON.parse(event.data);
        handlerRef.current(data);
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      es.close();
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };

    eventSourceRef.current = es;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
    };
  }, [connect]);
}
