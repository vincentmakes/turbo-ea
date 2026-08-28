import { useEffect, useState } from "react";

import type { CardLabelSettings } from "@/lib/cardDisplayFields";
import type { LdvEdgeLineStyle } from "./ldvLineStyle";

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
  /** Show the card's subtype ("Microservice", "SaaS", …) under its name. */
  showSubtype: boolean;
  showLifecycle: boolean;
  /**
   * Show a minimalistic marker on each card indicating it has a hierarchical
   * parent and/or children that aren't currently on the diagram (a hint to use
   * the Reveal parent / Reveal children toolbar tools). Does not pull any cards
   * into view — exploration is driven by the toolbar.
   */
  showHierarchyMarkers: boolean;
  /**
   * Show each card's custom logo, when it has one. Cards without a logo — and
   * every card of a type whose logos an admin switched off — are unaffected:
   * the backend simply does not send them one.
   */
  showCardLogos: boolean;
  /** Show related cards whose current lifecycle phase is End of Life. The centered card is always shown. */
  showEndOfLife: boolean;
  /** Show the verb on each relation edge ("supports", "uses", …). Off leaves
   *  the line and its arrowhead, which still carry the direction. */
  showRelationLabels: boolean;
  /** Append a relation's single-select attribute value to its label (e.g. "supports [Leading]"). */
  showRelationValues: boolean;
  /** Idle look of a relation line. Hover and severed keep their own styles. */
  edgeLineStyle: LdvEdgeLineStyle;
  extraFields: string[];
  background: LdvBackgroundStyle;
}

// Adding a *new* key needs no version bump: `read()` spreads the defaults over
// whatever is stored, so an older blob simply picks up the default.
const KEY = "tea.ldv.display.v3";

export const LDV_DEFAULT_SETTINGS: LdvDisplaySettings = {
  showType: true,
  showSubtype: false,
  showLifecycle: true,
  showHierarchyMarkers: true,
  showCardLogos: true,
  showEndOfLife: false,
  showRelationLabels: true,
  showRelationValues: true,
  edgeLineStyle: "dashed",
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

/**
 * The subset of these settings that describes what a card *says*, in the shape
 * the shared card-display vocabulary uses.
 *
 * Two callers need exactly this projection and must not disagree: the
 * "Show on card" picker, and the Create-diagram export that seeds a new DrawIO
 * diagram's `cardLabels` so it opens showing the rows that were on screen.
 */
export function toCardLabels(s: LdvDisplaySettings): CardLabelSettings {
  return { showType: s.showType, showSubtype: s.showSubtype, fields: s.extraFields };
}
