import { useEffect, useRef } from "react";
import { isAuthenticated } from "@/api/client";

export function useEventStream(onEvent: (event: Record<string, unknown>) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    if (!isAuthenticated()) return;

    // Cookie is sent automatically for same-origin EventSource requests
    const es = new EventSource("/api/v1/events/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        cbRef.current(data);
      } catch {
        // ignore parse errors
      }
    };
    es.onerror = () => {
      // Will auto-reconnect
    };
    return () => es.close();
  }, []);
}
