import { relationLabel } from "@/hooks/useResolveLabel";
import { expandSides, orderRelationTypesByOtherEnd, sideKey } from "@/lib/relationSort";
import type { ColumnLayoutItem } from "@/types";

/**
 * The Inventory grid's relation columns: one per relation-type SIDE.
 *
 * Several relation types may share an ordered card-type pair (an Application
 * that *uses* an IT Component and one that *consumes* it), and a
 * self-referencing type is two sides ("has site" / "is site of"). The grid used
 * to build one column per *related card type* whose cell was the union of all
 * of them; it now builds one column per side, headed "<verb> <Card type>", so
 * each relationship reads on its own.
 *
 * The column id is always direction-qualified — `rel_<key>__out` when the
 * selected card type is the relation's source, `rel_<key>__in` when it is the
 * target — for a cross-type relation as much as for a self-pair (the scheme
 * the mass-edit keys already use). The column selection, order, freeze and
 * layout are ONE set shared by every card type's inventory, so a cross-type
 * relation must not carry the same id at both of its ends: unticking "uses
 * Application" on Organization would hide "is used by Organization" on
 * Application. The `rel_` prefix is shared with the old per-card-type ids
 * (`rel_<CardType>`), which the migration helpers below translate; a new id
 * always ends in `__out` / `__in`, so the two cannot be confused. The relation
 * *filter* vocabulary (`rel_<CardType>=` deep links, `filters.relations`) is a
 * separate namespace and is not touched here.
 */

export const RELATION_COLUMN_PREFIX = "rel_";

type RelTypeLike = { key: string; source_type_key: string; target_type_key: string };

/** One relation column: a relation type as seen from one end. */
export interface RelationColumnSide<T extends RelTypeLike = RelTypeLike> {
  /** Grid column id, `rel_<key>__out` / `rel_<key>__in`. */
  colId: string;
  /** `sideKey(rt, isSource)` — also the `relationsMap` entry the cell reads. */
  sideKey: string;
  rt: T;
  /** True when the selected card type sits at the relation's SOURCE end. */
  isSource: boolean;
  /** The card type at the other end. */
  otherTypeKey: string;
}

/** The grid column id of one relation-type side, qualified by direction. */
export function relationColumnId(rt: { key: string }, isSource: boolean): string {
  return `${RELATION_COLUMN_PREFIX}${rt.key}__${isSource ? "out" : "in"}`;
}

/**
 * Every relation column for `selectedType`, ordered so the columns reaching the
 * same card type sit together (`orderRelationTypesByOtherEnd`) and a
 * self-pair's two sides are adjacent (`expandSides`). The grid, its default
 * column set and the Columns tab all consume this one list.
 */
export function relationColumnSides<T extends RelTypeLike>(
  relTypes: T[],
  selectedType: string,
): RelationColumnSide<T>[] {
  if (!selectedType) return [];
  return expandSides(orderRelationTypesByOtherEnd(relTypes, selectedType), selectedType).map(
    ({ rt, isSource }) => ({
      colId: relationColumnId(rt, isSource),
      sideKey: sideKey(rt, isSource),
      rt,
      isSource,
      otherTypeKey: isSource ? rt.target_type_key : rt.source_type_key,
    }),
  );
}

/** The side a relation column stands for, or undefined for any other column. */
export function relationSideOfColumn<T extends RelTypeLike>(
  colId: string,
  sides: RelationColumnSide<T>[],
): RelationColumnSide<T> | undefined {
  return sides.find((s) => s.colId === colId);
}

/**
 * "<verb> <Card type>" for one side — the verb read from the side under view
 * (the reverse verb when the selected type is at the target end). The column
 * header, the Columns tab row and the query path strip's hop menu share it.
 */
export function relationSideLabel(
  rt: NonNullable<Parameters<typeof relationLabel>[0]>,
  isSource: boolean,
  otherTypeLabel: string,
  locale?: string,
): string {
  return `${relationLabel(rt, locale, !isSource)} ${otherTypeLabel}`;
}

// --- Legacy column ids ------------------------------------------------------
//
// Layouts, column selections, column filters and sorts persisted before
// 2.198.0 (localStorage prefs and server-stored saved views alike) name a
// relation column `rel_<CardType>`, meaning "the <CardType> column" on EVERY
// card type related to it. The shared slices (selection, order, freeze, column
// widths) are therefore translated metamodel-wide, independent of the selected
// type; the sort and the column filters describe the grid on screen and are
// resolved against the selected type's own sides. An id that resolves to
// nothing is left exactly as it is. Every helper returns its input unchanged
// (same reference) when there is nothing to translate, so a caller can compare
// by identity and never loop.

/**
 * Legacy `rel_<CardType>` id → every column id that replaces it, metamodel-wide
 * and in relation-type list order: for each relation type with that card type
 * at one end, the id as seen from the OTHER end's type (the card type is the
 * target → `__out`; the source → `__in`; a self-pair → both, out then in).
 */
export function legacyRelationColumnMap(relTypes: RelTypeLike[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const add = (cardType: string, colId: string) => {
    const legacy = RELATION_COLUMN_PREFIX + cardType;
    const ids = map.get(legacy);
    if (ids) ids.push(colId);
    else map.set(legacy, [colId]);
  };
  for (const rt of relTypes) {
    add(rt.target_type_key, relationColumnId(rt, true));
    add(rt.source_type_key, relationColumnId(rt, false));
  }
  return map;
}

/** Legacy `rel_<CardType>` id → the selected type's side columns reaching it. */
export function legacySideColumnMap(sides: RelationColumnSide[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const s of sides) {
    const legacy = RELATION_COLUMN_PREFIX + s.otherTypeKey;
    const ids = map.get(legacy);
    if (ids) ids.push(s.colId);
    else map.set(legacy, [s.colId]);
  }
  return map;
}

/**
 * Replace every legacy item in place with the items `expand` makes for its
 * ids. The legacy item's position wins: an id it produces is dropped wherever
 * else it appears (the column-order hook may already have folded the
 * newly-arrived columns in at their natural place), and emitted once.
 */
function replaceLegacy<T>(
  items: T[],
  idOf: (item: T) => string,
  legacy: Map<string, string[]>,
  expand: (item: T, ids: string[]) => T[],
): T[] {
  if (!items.some((item) => legacy.has(idOf(item)))) return items;
  const produced = new Set<string>();
  for (const item of items) {
    for (const id of legacy.get(idOf(item)) ?? []) produced.add(id);
  }
  const emitted = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const ids = legacy.get(idOf(item));
    if (!ids) {
      if (!produced.has(idOf(item))) out.push(item);
      continue;
    }
    for (const next of expand(item, ids)) {
      if (emitted.has(idOf(next))) continue;
      emitted.add(idOf(next));
      out.push(next);
    }
  }
  return out;
}

/**
 * A list of column ids (selection, order, frozen) with every legacy id replaced
 * in place by every column it stood for, on every card type.
 */
export function migrateLegacyRelationColumnIds(ids: string[], relTypes: RelTypeLike[]): string[] {
  return replaceLegacy(ids, (id) => id, legacyRelationColumnMap(relTypes), (_id, next) => next);
}

/**
 * A column layout snapshot with every legacy entry replaced in place by one
 * entry per column it stood for (metamodel-wide), each keeping the width. A
 * sort stays on one entry only — the selected type's first side for that card
 * type, or the first id when the selected type does not reach it: sorting
 * every column by the same key would add sort levels nobody chose.
 */
export function migrateLegacyRelationColumnState(
  state: ColumnLayoutItem[],
  relTypes: RelTypeLike[],
  sides: RelationColumnSide[],
): ColumnLayoutItem[] {
  const onScreen = legacySideColumnMap(sides);
  return replaceLegacy(state, (c) => c.colId, legacyRelationColumnMap(relTypes), (item, ids) => {
    const sortedId = onScreen.get(item.colId)?.[0] ?? ids[0];
    return ids.map((colId) => {
      const next: ColumnLayoutItem = { ...item, colId };
      if (colId !== sortedId) {
        delete next.sort;
        delete next.sortIndex;
      }
      return next;
    });
  });
}

/**
 * A column-filter model with each legacy key renamed when the selected type
 * reaches its card type through exactly one side, and dropped when through
 * several: one text filter over a merged cell cannot be split across columns
 * without changing which rows match. A key the selected type does not reach
 * is left alone.
 */
export function migrateLegacyRelationFilterModel<V>(
  model: Record<string, V>,
  sides: RelationColumnSide[],
): Record<string, V> {
  const legacy = legacySideColumnMap(sides);
  if (!Object.keys(model).some((k) => legacy.has(k))) return model;
  const out: Record<string, V> = {};
  for (const [key, value] of Object.entries(model)) {
    const replacement = legacy.get(key);
    if (!replacement) {
      out[key] = value;
    } else if (replacement.length === 1 && !(replacement[0] in model)) {
      out[replacement[0]] = value;
    }
  }
  return out;
}

/** A sort model with each legacy entry moved, in place, to the selected type's first side. */
export function migrateLegacyRelationSortModel<S extends { colId: string }>(
  sortModel: S[],
  sides: RelationColumnSide[],
): S[] {
  return replaceLegacy(sortModel, (s) => s.colId, legacySideColumnMap(sides), (s, ids) => [
    { ...s, colId: ids[0] },
  ]);
}
