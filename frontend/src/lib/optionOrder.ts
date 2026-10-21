/**
 * The order a `multiple_select` value's chips are shown in.
 *
 * A card stores a multi-select value as the option keys in the order the user
 * ticked them, so reordering a field's options in the metamodel (#1292) would
 * otherwise change every menu and filter but leave the chips on existing cards
 * as they were. Every surface that renders a stored value as chips — card
 * detail (view and edit) and the Inventory grid — sorts through this one
 * helper, so the field's option order is the reading order everywhere.
 *
 * Known values follow their option's index; a value no option declares (a
 * stale or hand-written key) keeps its relative order after the known ones, so
 * it stays visible and fixable. The sort is stable and never mutates `values`.
 *
 * Pure: no imports.
 */
export function orderByOptions<T>(
  values: readonly T[],
  options: readonly { key: string }[] | undefined,
): T[] {
  if (!options || options.length === 0 || values.length < 2) return [...values];
  const rank = new Map<string, number>();
  options.forEach((o, i) => {
    if (!rank.has(o.key)) rank.set(o.key, i);
  });
  return values
    .map((value, pos) => ({ value, pos, idx: rank.get(String(value)) ?? options.length }))
    .sort((a, b) => a.idx - b.idx || a.pos - b.pos)
    .map((e) => e.value);
}
