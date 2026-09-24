/**
 * The lifecycle phases, and their translated labels.
 *
 * A leaf on purpose. These live logically with the card-detail helpers, but
 * `cardDetailUtils` imports `extensionHost` (for the custom-field-type
 * registry), so anything `extensionHost` needs to re-export cannot come from
 * there without closing a module cycle. Lifting the two smallest pieces out
 * is the standard fix, and it costs nothing: neither has a dependency beyond
 * the `t` handed to it.
 */
export const PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;

export type LifecyclePhase = (typeof PHASES)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Phases dated after a phase that should follow them — Phase Out after End of
 * Life, say. Each out-of-order phase maps to the FIRST later phase whose date
 * is earlier than its own; phases without a date are skipped, so a conflict is
 * found across a blank phase too. Equal dates are not a conflict.
 *
 * Advisory only: the lifecycle section shows it as a warning and never blocks
 * a save. ISO `yyyy-mm-dd` strings compare correctly as strings, so the rule
 * does not depend on the display format.
 */
export function lifecycleOrderIssues(
  lifecycle: Record<string, string | null | undefined> | null | undefined,
): Partial<Record<LifecyclePhase, LifecyclePhase>> {
  const issues: Partial<Record<LifecyclePhase, LifecyclePhase>> = {};
  if (!lifecycle) return issues;
  const dateOf = (phase: LifecyclePhase) => {
    const v = lifecycle[phase];
    return typeof v === "string" && ISO_DATE.test(v) ? v : null;
  };
  PHASES.forEach((phase, i) => {
    const date = dateOf(phase);
    if (!date) return;
    const later = PHASES.slice(i + 1).find((p) => {
      const d = dateOf(p);
      return d !== null && d < date;
    });
    if (later) issues[phase] = later;
  });
  return issues;
}

export function getPhaseLabels(t: (key: string) => string): Record<string, string> {
  return {
    plan: t("common:lifecycle.plan"),
    phaseIn: t("common:lifecycle.phaseIn"),
    active: t("common:lifecycle.active"),
    phaseOut: t("common:lifecycle.phaseOut"),
    endOfLife: t("common:lifecycle.endOfLife"),
  };
}
