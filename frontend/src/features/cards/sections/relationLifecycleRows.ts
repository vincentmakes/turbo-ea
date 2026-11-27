/**
 * What card detail's "Relation lifecycles" panel lists: the card's dated
 * relations, one block per relation-type SIDE (a self-referencing type is two
 * blocks), the ended ones behind a toggle and the whole list capped.
 *
 * Pure: the panel hands in the relation rows (`GET /relations?card_id=`) and
 * the relation types, and renders what comes back.
 */
import { expandSides, onSide, orderRelationTypesByOtherEnd } from "@/lib/relationSort";
import {
  hasLifecycleDates,
  relationLifecycleState,
  type RelationLifecycleState,
} from "@/lib/relationLifecycle";
import type { Relation, RelationRef } from "@/types";

/** How many relation rows the panel shows before "Show all". */
export const RELATION_LIFECYCLE_CAP = 8;

export interface LifecycleRow {
  relation: Relation;
  /** The card at the other end, as `GET /relations` embeds it. */
  other: RelationRef | undefined;
  state: RelationLifecycleState;
  /** Still in effect after the card's own End of Life (see `outlastsCard`). */
  outlasts: boolean;
}

export interface LifecycleGroup<T> {
  rt: T;
  /** True when the card under view is the relation's source on this side. */
  isSource: boolean;
  rows: LifecycleRow[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/**
 * Whether a relation runs on past the card's own End of Life: the card has an
 * End of Life date and the relation either has none or ends later. A
 * relation that has already ended by the card's End of Life never does.
 */
export function outlastsCard(
  relation: Record<string, string> | undefined,
  card: Record<string, string> | undefined,
): boolean {
  const cardEnd = card?.endOfLife;
  if (!cardEnd || !ISO_DAY.test(cardEnd)) return false;
  const relEnd = relation?.endOfLife;
  if (!relEnd || !ISO_DAY.test(relEnd)) return true;
  return relEnd.slice(0, 10) > cardEnd.slice(0, 10);
}

/**
 * The card's dated relations, grouped per relation-type side in the Relations
 * section's order (`orderRelationTypesByOtherEnd`, then `expandSides`), each
 * group sorted by the other card's name. The side is read per row
 * (`onSide`), never off the type, so both blocks of a self-pair are right.
 * Groups with no dated relation are left out.
 */
export function groupRelationLifecycles<
  T extends { key: string; source_type_key: string; target_type_key: string },
>(opts: {
  relations: readonly Relation[];
  relationTypes: readonly T[];
  cardId: string;
  cardTypeKey: string;
  cardLifecycle: Record<string, string> | undefined;
  todayMs: number;
  locale?: string;
}): LifecycleGroup<T>[] {
  const touching = opts.relationTypes.filter(
    (rt) => rt.source_type_key === opts.cardTypeKey || rt.target_type_key === opts.cardTypeKey,
  );
  const sides = expandSides(orderRelationTypesByOtherEnd([...touching], opts.cardTypeKey), opts.cardTypeKey);
  const dated = opts.relations.filter((r) => hasLifecycleDates(r.lifecycle));
  const groups: LifecycleGroup<T>[] = [];
  for (const { rt, isSource } of sides) {
    const rows = dated
      .filter((r) => onSide(r, rt.key, opts.cardId, isSource))
      .map((r) => ({
        relation: r,
        other: isSource ? r.target : r.source,
        state: relationLifecycleState(r.lifecycle, opts.todayMs),
        outlasts: outlastsCard(r.lifecycle, opts.cardLifecycle),
      }))
      .sort((a, b) => (a.other?.name ?? "").localeCompare(b.other?.name ?? "", opts.locale));
    if (rows.length > 0) groups.push({ rt, isSource, rows });
  }
  return groups;
}

export interface StateCounts {
  inEffect: number;
  planned: number;
  ended: number;
}

export function stateCounts(groups: readonly LifecycleGroup<unknown>[]): StateCounts {
  const counts: StateCounts = { inEffect: 0, planned: 0, ended: 0 };
  for (const g of groups) for (const row of g.rows) counts[row.state] += 1;
  return counts;
}

/**
 * The groups as shown: ended rows dropped unless `showEnded`, then at most
 * `cap` rows in all (in group order) unless `showAll`. `shownTotal` is how
 * many rows there are before the cap; `hidden` how many the cap holds back.
 */
export function visibleGroups<T>(
  groups: readonly LifecycleGroup<T>[],
  opts: { showEnded: boolean; showAll: boolean; cap?: number },
): { groups: LifecycleGroup<T>[]; shownTotal: number; hidden: number } {
  const cap = opts.cap ?? RELATION_LIFECYCLE_CAP;
  const filtered = groups
    .map((g) => ({ ...g, rows: opts.showEnded ? g.rows : g.rows.filter((r) => r.state !== "ended") }))
    .filter((g) => g.rows.length > 0);
  const shownTotal = filtered.reduce((n, g) => n + g.rows.length, 0);
  if (opts.showAll || shownTotal <= cap) return { groups: filtered, shownTotal, hidden: 0 };
  let left = cap;
  const out: LifecycleGroup<T>[] = [];
  for (const g of filtered) {
    if (left === 0) break;
    const rows = g.rows.slice(0, left);
    left -= rows.length;
    out.push({ ...g, rows });
  }
  return { groups: out, shownTotal, hidden: shownTotal - cap };
}
