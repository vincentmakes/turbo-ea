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

export function getPhaseLabels(t: (key: string) => string): Record<string, string> {
  return {
    plan: t("common:lifecycle.plan"),
    phaseIn: t("common:lifecycle.phaseIn"),
    active: t("common:lifecycle.active"),
    phaseOut: t("common:lifecycle.phaseOut"),
    endOfLife: t("common:lifecycle.endOfLife"),
  };
}
