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

/** The filter maps of one application in the heatmap payload. */
export interface CapabilityAppRelations {
  org_ids: string[];
  related_by_type?: Record<string, string[]>;
  related_by_rel_type?: Record<string, string[]>;
  /** Relation-type key (per side, as in `related_by_rel_type`) → related card
   *  id → the lifecycles of the relations behind that entry, sent only when
   *  every one of them is dated. Absent = always in effect. */
  related_link_lifecycles?: Record<string, Record<string, Lifecycle[]>>;
}

/**
 * The application's filter maps as they stand at `dateMs`: a related card is
 * kept under a relation-type key while a relation behind that entry is in
 * effect, and under its card type while it is kept under any relation-type key
 * (every relation fills both maps, so the card-type list is the union of the
 * relation-type lists). An application with no dated link is returned as the
 * same object — the Portfolio report's `relationsAtDate`, over this payload's
 * shape.
 */
export function appRelationsAtDate<T extends CapabilityAppRelations>(app: T, dateMs: number): T {
  const dated = app.related_link_lifecycles;
  if (!dated) return app;
  const inEffect = (relKey: string, id: string) => {
    const lifecycles = dated[relKey]?.[id];
    return !lifecycles || lifecycles.some((lc) => isAliveAtDate(lc, dateMs));
  };
  const byRelType: Record<string, string[]> = {};
  const kept = new Set<string>();
  for (const [relKey, ids] of Object.entries(app.related_by_rel_type ?? {})) {
    byRelType[relKey] = ids.filter((id) => inEffect(relKey, id));
    for (const id of byRelType[relKey]) kept.add(id);
  }
  const byType: Record<string, string[]> = {};
  for (const [typeKey, ids] of Object.entries(app.related_by_type ?? {})) {
    byType[typeKey] = ids.filter((id) => kept.has(id));
  }
  return {
    ...app,
    related_by_type: byType,
    related_by_rel_type: byRelType,
    org_ids: app.org_ids.filter((id) => kept.has(id)),
  };
}
