/**
 * Pure helpers for lifecycle phases an installed extension maintains on a
 * card (`Card.lifecycle_maintained`): the save payload of the card's Lifecycle
 * section and the bounds of the phases still set by hand. A leaf like
 * `@/lib/lifecyclePhases`, so `LifecycleSection` (on the extension UI SDK)
 * stays free of a cycle back to `extensionHost`.
 */
import { PHASES } from "@/lib/lifecyclePhases";

/** Phases an installed extension maintains on a card, and its display name. */
export type MaintainedLifecycle = { phases: readonly string[]; name: string };

/**
 * The lifecycle to save: the draft, without any maintained phase. The backend
 * carries an absent maintained phase over at its CURRENT stored value, so a
 * save never echoes the copy of a maintained date this client loaded — which
 * the extension may have moved since and the backend would read as a change.
 */
export function lifecyclePayload(
  draft: Record<string, string>,
  lockedPhases: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [phase, value] of Object.entries(draft)) {
    if (!lockedPhases.has(phase)) out[phase] = value;
  }
  return out;
}

/**
 * The extension and phases of a 403 `lifecycle_maintained` refusal, read from
 * an `ApiError`'s `detail`; `null` for any other error.
 */
export function maintainedRefusal(
  err: unknown,
): { extension: string; phases: string[] } | null {
  const detail = (err as { detail?: unknown } | null)?.detail;
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  if (d.error !== "lifecycle_maintained" || !Array.isArray(d.phases)) return null;
  return {
    extension: typeof d.extension === "string" ? d.extension : "",
    phases: d.phases.filter((p): p is string => typeof p === "string"),
  };
}

/**
 * The bounds a hand-set phase must stay within: the date of the nearest
 * earlier maintained phase and of the nearest later one. Phases without a
 * date are skipped, so a bound is found across a blank phase too.
 */
export function manualPhaseBounds(
  phase: string,
  lifecycle: Record<string, string>,
  locked: ReadonlySet<string>,
): { min?: string; max?: string } {
  const i = PHASES.indexOf(phase as (typeof PHASES)[number]);
  if (i < 0 || locked.has(phase)) return {};
  const before = PHASES.slice(0, i)
    .reverse()
    .find((p) => locked.has(p) && lifecycle[p]);
  const after = PHASES.slice(i + 1).find((p) => locked.has(p) && lifecycle[p]);
  return {
    ...(before ? { min: lifecycle[before] } : {}),
    ...(after ? { max: lifecycle[after] } : {}),
  };
}
