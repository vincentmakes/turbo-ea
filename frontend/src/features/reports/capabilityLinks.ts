/**
 * Whether a capability and an application are linked at a date.
 *
 * `GET /reports/capability-heatmap` lists every application ever linked to a
 * capability and, per capability, `app_link_lifecycles`: for an application
 * whose every linking relation is dated, the lifecycles of those relations. An
 * application absent from it is linked by at least one undated relation, so it
 * is linked at every date; one present is linked while any of its relations is
 * in effect (`isAliveAtDate`, the one rule — `lib/relationLifecycle.ts`).
 *
 * Pure, so the Capability Map's tree and its split cost share read one answer.
 */
import { isAliveAtDate, type Lifecycle } from "@/lib/lifecycleAtDate";

export interface CapabilityLinks {
  id: string;
  /** Application id → the lifecycles of the relations linking it here. */
  app_link_lifecycles?: Record<string, Lifecycle[]>;
}

/** Whether `appId` is linked to `cap` at `dateMs`. */
export function capabilityLinkInEffect(
  cap: Pick<CapabilityLinks, "app_link_lifecycles">,
  appId: string,
  dateMs: number,
): boolean {
  const lifecycles = cap.app_link_lifecycles?.[appId];
  if (!lifecycles) return true;
  return lifecycles.some((lc) => isAliveAtDate(lc, dateMs));
}

/**
 * The capabilities among `capabilityIds` the application is linked to at
 * `dateMs`. A capability the caller holds no row for (outside a scope) is kept:
 * nothing here says its link is not in effect.
 */
export function capabilityIdsAtDate(
  capabilityIds: readonly string[],
  appId: string,
  capById: ReadonlyMap<string, Pick<CapabilityLinks, "app_link_lifecycles">>,
  dateMs: number,
): string[] {
  return capabilityIds.filter((id) => {
    const cap = capById.get(id);
    return !cap || capabilityLinkInEffect(cap, appId, dateMs);
  });
}
