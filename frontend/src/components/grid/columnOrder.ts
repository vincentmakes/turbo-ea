/**
 * Column ordering for every AG Grid in the app — the pure half.
 *
 * Order is a per-user preference, exactly like visibility, width and freeze,
 * and it is owned the same way freeze is: as a plain list of colIds that the
 * page persists and stamps back onto its column defs. `sortColumnsByOrder()`
 * is to order what `applyFrozen()` is to `pinned` — AG Grid rebuilds its
 * columns in whatever order the `columnDefs` array arrives in, so no
 * imperative grid call is needed.
 *
 * Three rules here are load-bearing and easy to get wrong:
 *
 *  1. **A stored id is never pruned just because it isn't on screen.** On the
 *     inventory the first render carries only the core columns — attribute,
 *     relation and stakeholder columns arrive once the metamodel loads, and
 *     they change again whenever the user switches card type. A merge that
 *     dropped unknown ids would therefore wipe every one of those positions on
 *     mount. Keeping them as placeholders also means switching type away and
 *     back restores that type's arrangement. `MAX_ORDER_IDS` is the only bound.
 *  2. **A column the user cannot drag still has to be held in place.**
 *     `suppressMovable` stops the *user* moving a column; it does not stop a
 *     `columnDefs` reorder from moving it. The trailing action columns on the
 *     audit-log, resources and compliance grids are `suppressMovable`, so
 *     `sortColumnsByOrder` permutes only the orderable columns and re-splices
 *     the fixed ones at their original index.
 *  3. **Reordering the visible columns must not disturb the hidden ones.**
 *     `applyVisibleOrder` keeps every hidden id attached to the visible id it
 *     currently follows, so unhiding a column later returns it to the slot the
 *     user last saw it in.
 */
import type { ColDef } from "ag-grid-community";

/**
 * Prefix of AG Grid's own generated columns (the row-selection checkbox
 * column, `CONTROLS_COLUMN_ID_PREFIX`). They are positioned by AG Grid itself
 * and must never enter a stored order.
 */
export const AG_INTERNAL_COL_PREFIX = "ag-Grid-";

/**
 * Upper bound on a stored order. Placeholders for columns that aren't
 * currently on screen are kept deliberately (see the module docblock), so this
 * is the safety valve that stops a pref growing without limit on an instance
 * with a very large metamodel. Well above any realistic column count.
 */
export const MAX_ORDER_IDS = 500;

/** Stable id of a column def — what AG Grid reports back as `colId`. */
export function colIdOf(col: ColDef): string {
  return col.colId ?? col.field ?? "";
}

export function isInternalColId(colId: string): boolean {
  return colId.startsWith(AG_INTERNAL_COL_PREFIX);
}

/**
 * A column whose position is not the user's to choose — an action column
 * (`suppressMovable`) or one AG Grid locks to an edge (`lockPosition`).
 */
export function isFixedColumn(col: ColDef): boolean {
  return !!col.suppressMovable || col.lockPosition != null;
}

export function isOrderableColumn(col: ColDef): boolean {
  const id = colIdOf(col);
  return !!id && !isInternalColId(id) && !isFixedColumn(col);
}

/** Do two orders hold the same ids in the same sequence? */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

/**
 * Fold the columns currently present into a stored order.
 *
 * The stored order wins for everything it already knows, including ids that
 * are not currently present (kept as placeholders — see the module docblock).
 * A genuinely new id is inserted after the last id that precedes it *in the
 * natural order* and is already placed, so a block of newly-arrived attribute
 * columns lands in its natural neighbourhood rather than being appended past
 * the metadata columns.
 */
export function mergeOrder(naturalIds: string[], stored: readonly string[]): string[] {
  const result = [...stored];
  const seen = new Set(stored);

  naturalIds.forEach((id, i) => {
    if (!id || seen.has(id)) return;
    // Nearest preceding natural sibling that already has a home.
    let anchor: string | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (seen.has(naturalIds[j])) {
        anchor = naturalIds[j];
        break;
      }
    }
    if (anchor === null) result.unshift(id);
    else result.splice(result.indexOf(anchor) + 1, 0, id);
    seen.add(id);
  });

  if (result.length <= MAX_ORDER_IDS) return result;

  // Over budget: drop the *stalest* entries — ids not currently present,
  // furthest from the front — never one the grid is actually showing.
  const natural = new Set(naturalIds);
  const trimmed = [...result];
  for (let i = trimmed.length - 1; i >= 0 && trimmed.length > MAX_ORDER_IDS; i--) {
    if (!natural.has(trimmed[i])) trimmed.splice(i, 1);
  }
  return trimmed;
}

/**
 * Stamp a stored order onto column defs. Only orderable columns are permuted;
 * fixed and id-less columns keep the array index they arrived at, so an action
 * column pinned to the end of the builder stays at the end.
 *
 * Unknown ids sort last among the movable columns, and stably, so a column
 * that has never been ordered keeps its natural position relative to its
 * unordered peers.
 */
export function sortColumnsByOrder<T extends ColDef>(cols: T[], order: readonly string[]): T[] {
  const rank = new Map<string, number>();
  order.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });

  const slots: number[] = [];
  cols.forEach((col, i) => {
    if (isOrderableColumn(col)) slots.push(i);
  });
  if (slots.length < 2) return cols;

  const movable = slots.map((i) => cols[i]);
  const sorted = movable
    .map((col, i) => ({ col, i, rank: rank.get(colIdOf(col)) ?? Number.POSITIVE_INFINITY }))
    // Tie-break on the original index so the sort is stable across engines.
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.col);

  const out = cols.slice();
  slots.forEach((slot, k) => {
    out[slot] = sorted[k];
  });
  return out;
}

/**
 * Fold a reordered *visible* sequence back into the full order.
 *
 * Every hidden id stays attached to the visible id it currently follows, and
 * hidden ids that precede every visible one stay at the head. So hiding a
 * column, rearranging its neighbours and unhiding it again returns it to the
 * slot the user last saw it in, rather than dumping it at one end.
 */
export function applyVisibleOrder(
  fullOrder: readonly string[],
  nextVisible: readonly string[],
): string[] {
  const visible = new Set(nextVisible);
  const leading: string[] = [];
  const trailing = new Map<string, string[]>();
  let current: string | null = null;

  for (const id of fullOrder) {
    if (visible.has(id)) {
      current = id;
      if (!trailing.has(id)) trailing.set(id, []);
    } else if (current === null) {
      leading.push(id);
    } else {
      trailing.get(current)!.push(id);
    }
  }

  const out = [...leading];
  for (const id of nextVisible) {
    out.push(id, ...(trailing.get(id) ?? []));
  }
  return out;
}
