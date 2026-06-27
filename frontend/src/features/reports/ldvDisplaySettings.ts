import { useEffect, useState } from "react";

/**
 * Shared, persisted display settings for the Layered Dependency View.
 *
 * Lives in a tiny module-level store (not a per-component useState) because
 * two unrelated trees need the same values: the view's own toolbar AND the
 * card-detail dependency section. Mirrors the singleton-hook pattern used
 * by `useMetamodel` / `useCurrency`.
 */

export type LdvBackgroundStyle = "lines" | "dots" | "none";

export interface LdvDisplaySettings {
  showType: boolean;
  showLifecycle: boolean;
  /**
   * Show a minimalistic marker on each card indicating it has a hierarchical
   * parent and/or children that aren't currently on the diagram (a hint to use
   * the Reveal parent / Reveal children toolbar tools). Does not pull any cards
   * into view — exploration is driven by the toolbar.
   */
  showHierarchyMarkers: boolean;
  /** Show related cards whose current lifecycle phase is End of Life. The centered card is always shown. */
  showEndOfLife: boolean;
  /** Append a relation's single-select attribute value to its label (e.g. "supports [Leading]"). */
  showRelationValues: boolean;
  extraFields: string[];
  background: LdvBackgroundStyle;
}

const KEY = "tea.ldv.display.v3";

export const LDV_DEFAULT_SETTINGS: LdvDisplaySettings = {
  showType: true,
  showLifecycle: true,
  showHierarchyMarkers: true,
  showEndOfLife: false,
  showRelationValues: true,
  extraFields: [],
  background: "dots",
};

let _cache: LdvDisplaySettings | null = null;
const _subs = new Set<(s: LdvDisplaySettings) => void>();

function read(): LdvDisplaySettings {
  if (_cache) return _cache;
  let value: LdvDisplaySettings;
  try {
    const raw = localStorage.getItem(KEY);
    value = raw ? { ...LDV_DEFAULT_SETTINGS, ...JSON.parse(raw) } : LDV_DEFAULT_SETTINGS;
  } catch {
    value = LDV_DEFAULT_SETTINGS;
  }
  _cache = value;
  return value;
}

export function getLdvSettings(): LdvDisplaySettings {
  return read();
}

export function setLdvSettings(patch: Partial<LdvDisplaySettings>): void {
  const next = { ...read(), ...patch };
  _cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  for (const fn of _subs) fn(next);
}

function subscribe(fn: (s: LdvDisplaySettings) => void): () => void {
  _subs.add(fn);
  return () => {
    _subs.delete(fn);
  };
}

/** Hook returning `[settings, update]` backed by the shared store. */
export function useLdvSettings(): [LdvDisplaySettings, (patch: Partial<LdvDisplaySettings>) => void] {
  const [s, setS] = useState<LdvDisplaySettings>(read);
  useEffect(() => {
    setS(read());
    return subscribe(setS);
  }, []);
  return [s, setLdvSettings];
}
