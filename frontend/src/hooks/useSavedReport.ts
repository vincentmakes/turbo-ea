import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import type { SavedReport } from "@/types";

/**
 * Hook for loading and saving report configurations.
 *
 * Usage in a report component:
 *   const { savedReport, saveDialogOpen, setSaveDialogOpen, getConfig, applyConfig, resetSavedReport } = useSavedReport("portfolio");
 *
 * - On mount, if URL has ?saved_report_id=..., fetches and returns the config
 * - `applyConfig` is called once after the saved config is fetched
 * - `getConfig` should be called when user wants to save
 */
export function useSavedReport(reportType: string) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [savedReport, setSavedReport] = useState<SavedReport | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [loadedConfig, setLoadedConfig] = useState<Record<string, unknown> | null>(null);
  const appliedRef = useRef(false);

  const savedReportId = searchParams.get("saved_report_id");

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
   * Returns the config if not yet applied, or null otherwise.
   */
  const consumeConfig = useCallback((): Record<string, unknown> | null => {
    if (loadedConfig && !appliedRef.current) {
      appliedRef.current = true;
      return loadedConfig;
    }
    return null;
  }, [loadedConfig]);

  return {
    savedReport,
    savedReportName: savedReport?.name || null,
    saveDialogOpen,
    setSaveDialogOpen,
    loadedConfig,
    consumeConfig,
    resetSavedReport,
    reportType,
  };
}
