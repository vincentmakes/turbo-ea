/**
 * Which optional modules are on, for the dashboard's module widgets (risks,
 * compliance, PPM, BPM). A flag that has not loaded yet counts as off — the
 * hooks default GRC and BPM to `true` before their fetch lands, and a module
 * tile must never flash in and then vanish (the `ModuleGate` rule).
 */
import { useMemo } from "react";
import { useBpmEnabled } from "@/hooks/useBpmEnabled";
import { useGrcEnabled } from "@/hooks/useGrcEnabled";
import { usePpmEnabled } from "@/hooks/usePpmEnabled";
import type { DashboardModules } from "./widgets/widgetMeta";

export function useDashboardModules(): DashboardModules {
  const { bpmEnabled, bpmLoaded } = useBpmEnabled();
  const { ppmEnabled, ppmLoaded } = usePpmEnabled();
  const { grcEnabled, grcLoaded } = useGrcEnabled();
  const bpm = bpmLoaded && bpmEnabled;
  const ppm = ppmLoaded && ppmEnabled;
  const grc = grcLoaded && grcEnabled;
  return useMemo(() => ({ bpm, ppm, grc }), [bpm, ppm, grc]);
}
