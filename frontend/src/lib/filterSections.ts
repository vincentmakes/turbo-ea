/**
 * Pure helpers behind the grid filter sidebars' section headers
 * (`components/FilterSidebarSection.tsx`). Kept out of the component file so
 * it exports components only (React fast refresh).
 */

/**
 * A section's clear: `filters` with exactly the named keys put back to their
 * value in `empty`, every other key untouched. The sidebars are controlled,
 * so each passes the result to its own `onFiltersChange`.
 */
export function resetFilterKeys<T extends object>(
  filters: T,
  empty: T,
  keys: readonly (keyof T)[],
): T {
  const next = { ...filters };
  for (const key of keys) next[key] = empty[key];
  return next;
}

/**
 * Whether a section header shows its per-section clear button: only when the
 * section holds something to clear AND the sidebar wired a handler for it.
 */
export function showsSectionClear(count: number | undefined, onClear?: () => void): boolean {
  return !!onClear && count != null && count > 0;
}

/** Enter and Space fold / unfold a section, as on a native button. */
export function isToggleKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
