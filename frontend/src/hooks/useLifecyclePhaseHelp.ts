/**
 * Admin-written help per lifecycle phase (`{phase: {locale: text}}`), edited
 * under Admin -> Metamodel -> Lifecycle phases. Singleton cache shared
 * process-wide, primed by /settings/bootstrap on boot so the Lifecycle section
 * of every card skips its own GET.
 *
 * The five phases are fixed keys, not metamodel data, which is why their help
 * is an app setting rather than a `translations` column.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { LifecyclePhaseHelp } from "@/types";

const EMPTY: LifecyclePhaseHelp = {};

let _cache: LifecyclePhaseHelp | null = null;
let _inflight: Promise<void> | null = null;
const _listeners = new Set<(help: LifecyclePhaseHelp) => void>();

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Keep only `{phase: {locale: string}}`; anything else is dropped. */
function normalise(raw: unknown): LifecyclePhaseHelp | null {
  if (!isPlainObject(raw)) return null;
  const out: LifecyclePhaseHelp = {};
  for (const [phase, texts] of Object.entries(raw)) {
    if (!isPlainObject(texts)) continue;
    const clean: Record<string, string> = {};
    for (const [locale, text] of Object.entries(texts)) {
      if (typeof text === "string" && text) clean[locale] = text;
    }
    if (Object.keys(clean).length > 0) out[phase] = clean;
  }
  return out;
}

function notify(help: LifecyclePhaseHelp) {
  _cache = help;
  for (const fn of _listeners) fn(help);
}

/**
 * Prime or refresh the cache from outside the hook (/settings/bootstrap on
 * boot, the admin panel after a save). A malformed payload is ignored.
 */
export function invalidateLifecyclePhaseHelp(help: unknown) {
  const valid = normalise(help);
  if (valid !== null) notify(valid);
}

function _fetchOnce(): Promise<void> {
  // The hook's effect only calls this while the cache is empty; the guard is
  // the singleton pattern's contract (frontend-patterns rule), not a branch a
  // test can reach.
  // Stryker disable next-line ConditionalExpression: only ever called with an empty cache, so the guard cannot be observed from a test
  if (_cache !== null) return Promise.resolve();
  if (_inflight) return _inflight;
  // Started inside a promise so a client that throws synchronously (or a test
  // double that returns nothing) lands in `.catch`, not in the caller's render.
  _inflight = Promise.resolve()
    .then(() => api.get<{ phases: LifecyclePhaseHelp }>("/settings/lifecycle-phase-help"))
    .then((r) => invalidateLifecyclePhaseHelp(r.phases))
    .catch(() => {
      /* no help is a fine default */
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/** The help of `phase` in `locale`, falling back to English, then to `""`. */
export function phaseHelpText(help: LifecyclePhaseHelp, phase: string, locale: string): string {
  return help[phase]?.[locale] || help[phase]?.en || "";
}

export function useLifecyclePhaseHelp() {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const [help, setHelp] = useState<LifecyclePhaseHelp>(_cache ?? EMPTY);

  useEffect(
    () => {
      _listeners.add(setHelp);
      // A value primed between the first render and this effect.
      if (_cache !== null) setHelp(_cache);
      else void _fetchOnce();
      return () => {
        _listeners.delete(setHelp);
      };
    },
    // Stryker disable next-line ArrayDeclaration: a constant dependency never changes between renders, so `[]` and `["…"]` both run the effect exactly once.
    [],
  );

  const phaseHelp = useCallback(
    (phase: string) => phaseHelpText(help, phase, locale),
    [help, locale],
  );

  return { help, phaseHelp };
}

/** How many mounted hooks listen for a refresh (tests only). */
export function lifecyclePhaseHelpListenerCount(): number {
  return _listeners.size;
}

/** Reset for tests. */
export function resetLifecyclePhaseHelp() {
  _cache = null;
  _inflight = null;
}
