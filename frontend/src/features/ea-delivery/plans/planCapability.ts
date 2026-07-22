import { useExtensionCapabilities } from "@/hooks/useExtensionCapabilities";

/**
 * Grant key that unlocks Transition Planning *authoring* (create / edit /
 * commit). Mirrors CAP_TRANSITION_PLANNING in the backend
 * (app/api/v1/transition_plans.py). Rendering existing plans is never gated —
 * a licence lapse degrades to read-only, it never hides or destroys data.
 */
export const TRANSITION_PLANNING_CAP = "delivery.transition_planning";

/**
 * Whether Transition Planning authoring is unlocked by an installed, enabled,
 * licensed extension. `granted` is false until `loaded` — callers that show a
 * locked state (rather than just hiding a button) should wait for `loaded`.
 */
export function useTransitionPlanningGranted(): {
  granted: boolean;
  loaded: boolean;
} {
  const caps = useExtensionCapabilities();
  return { granted: caps.has(TRANSITION_PLANNING_CAP), loaded: caps.loaded };
}
