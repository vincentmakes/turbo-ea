import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import type { SavedReport } from "@/types";

const STORAGE_PREFIX = "turboea-report:";

/**
 * Hook for loading and saving report configurations.
 *
 * Supports three layers of persistence (in priority order):
 *   1. URL saved report (?saved_report_id=...) — fetched from backend
 *   2. localStorage auto-save — persisted on every config change
 *   3. Component defaults — used when neither of the above exists
 *
 * Usage in a report component:
 *   const saved = useSavedReport("portfolio");
 *   // On mount: cfg = saved.consumeConfig()  — returns saved or local config
 *   // On change: saved.persistConfig(getConfig()) — auto-saves to localStorage
 *   // On reset:  saved.resetAll() — clears localStorage + URL saved report
 */
export function useSavedReport(reportType: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [savedReport, setSavedReport] = useState<SavedReport | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadedConfig, setLoadedConfig] = useState<Record<string, unknown> | null>(null);
  const appliedRef = useRef(false);
  const persistReadyRef = useRef(false);

  const STORAGE_KEY = STORAGE_PREFIX + reportType;
  const savedReportId = searchParams.get("saved_report_id");

  // Load localStorage config synchronously during initial state
  const [localConfig] = useState<Record<string, unknown> | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore corrupt data */ }
    return null;
  });

  // Fetch URL saved report from backend
  useEffect(() => {
    if (!savedReportId) {
      setSavedReport(null);
      setLoadedConfig(null);
      appliedRef.current = false;
      return;
    }
    api.get<SavedReport>(`/saved-reports/${savedReportId}`)
      .then((r) => {
        setSavedReport(r);
        setLoadedConfig(r.config);
        appliedRef.current = false;
      })
      .catch(() => {
        setSavedReport(null);
        setLoadedConfig(null);
      });
  }, [savedReportId]);

  const resetSavedReport = useCallback(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("saved_report_id");
    setSearchParams(newParams, { replace: true });
    setSavedReport(null);
    setLoadedConfig(null);
    appliedRef.current = false;
  }, [searchParams, setSearchParams]);

  /**
   * Call this in your component to consume the loaded config exactly once.
   * Priority: URL saved report > localStorage > null.
   * Returns null if already consumed or if waiting for a URL saved report.
   */
  const consumeConfig = useCallback((): Record<string, unknown> | null => {
    if (appliedRef.current) return null;

    // If we have a URL saved report ID but the API hasn't returned yet, wait
    if (savedReportId && !loadedConfig) return null;

    appliedRef.current = true;
    persistReadyRef.current = true;

    // URL saved report takes precedence
    if (loadedConfig) return loadedConfig;

    // Fall back to localStorage
    if (localConfig) return localConfig;

    return null;
  }, [loadedConfig, localConfig, savedReportId]);

  /**
   * Auto-persist config to localStorage. Only writes after consumeConfig
   * has been called (prevents overwriting stored config with defaults on mount).
   */
  const persistConfig = useCallback((config: Record<string, unknown>) => {
    if (!persistReadyRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch { /* quota exceeded or private browsing */ }
  }, [STORAGE_KEY]);

  /**
   * Clear both localStorage and URL saved report. Used by the reset button.
   */
  const resetAll = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
    // Also clear URL saved report if present
    if (savedReportId) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("saved_report_id");
      setSearchParams(newParams, { replace: true });
    }
    setSavedReport(null);
    setLoadedConfig(null);
    appliedRef.current = false;
    persistReadyRef.current = false;
  }, [STORAGE_KEY, savedReportId, searchParams, setSearchParams]);

  return {
    savedReport,
    savedReportName: savedReport?.name || null,
    saveDialogOpen,
    setSaveDialogOpen,
    loadedConfig,
    consumeConfig,
    resetSavedReport,
    persistConfig,
    resetAll,
    reportType,
  };
}
