import { useEffect, useRef } from "react";

export function useEventStream(onEvent: (event: Record<string, unknown>) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    const token = sessionStorage.getItem("token");
    if (!token) return;

    const es = new EventSource(`/api/v1/events/stream?token=${encodeURIComponent(token)}`);
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
