/**
 * useAnalysisPolling — polls an analysis run until it completes or fails.
 * Returns the run status so the caller can reload data when done.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";

interface AnalysisRun {
  id: string;
  status: string;
  analysis_type: string;
  completed_at?: string | null;
  error_message?: string | null;
}

const POLL_INTERVAL_MS = 3_000;

export function useAnalysisPolling(onComplete?: () => void) {
  const [runId, setRunId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
    setRunId(null);
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      setRunId(id);
      setPolling(true);
    },
    [stopPolling],
  );

  useEffect(() => {
    if (!runId || !polling) return;

    const check = async () => {
      try {
        const run = await api.get<AnalysisRun>(`/archlens/analysis-runs/${runId}`);
        if (run.status !== "running") {
          stopPolling();
          onCompleteRef.current?.();
        }
      } catch {
        stopPolling();
      }
    };

    timerRef.current = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [runId, polling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => stopPolling, [stopPolling]);

  return { startPolling, stopPolling, polling };
}
