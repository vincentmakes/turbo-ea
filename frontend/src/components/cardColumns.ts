/**
 * Shared column-count model for the card grids in the reports and the BPM
 * Process Navigator.
 *
 * These views used to hard-code their responsive grid (3 columns at `md`,
 * 4 at `lg` when at level 1). The count is now a user preference, so the
 * grid literal lives here once instead of being copy-pasted per view.
 */

export type ColumnCount = 1 | 2 | 3;

export const COLUMN_COUNTS: readonly ColumnCount[] = [1, 2, 3];

export const DEFAULT_COLUMNS: ColumnCount = 3;

/**
 * Trust boundary for column counts read back from a saved report, from
 * localStorage, or from a URL param. Rejects anything that is not one of the
 * supported counts — including a stale `4` written by an older build, which a
 * plain `!= null` guard would let through as an undefined grid template.
 */
export function isColumnCount(value: unknown): value is ColumnCount {
  return value === 1 || value === 2 || value === 3;
}

/**
 * The chosen count is a *maximum*, reached at `md` and up. Narrow viewports
 * always degrade, so a 3-column pick is never 3 columns on a phone.
 */
export function columnGridTemplate(cols: ColumnCount): {
  xs: string;
  sm: string;
  md: string;
  lg: string;
} {
  const tracks = (n: number) => Array(n).fill("1fr").join(" ");
  return {
    xs: tracks(1),
    sm: tracks(Math.min(cols, 2)),
    md: tracks(cols),
    lg: tracks(cols),
  };
}

/**
 * Print class for the chosen count. MUI's responsive breakpoints collapse in
 * the narrower print viewport, so `print.css` re-asserts the count from this
 * class — see the `.report-print-grid-*` rules there.
 */
export function columnPrintClass(cols: ColumnCount): string {
  return `report-print-grid-${cols}`;
}

/**
 * The one thing top-level call sites spread onto their grid `<Box>`.
 *
 * Top level only — the container here *is* the page, so viewport breakpoints
 * are the right thing to size against. Inside a card, use `nestedGridProps`.
 */
export function columnGridProps(
  cols: ColumnCount,
  opts?: { gap?: number; sx?: Record<string, unknown> },
): { className: string; sx: Record<string, unknown> } {
  return {
    className: columnPrintClass(cols),
    sx: {
      display: "grid",
      gridTemplateColumns: columnGridTemplate(cols),
      gap: opts?.gap ?? 2,
      ...opts?.sx,
    },
  };
}

/** MUI spacing unit, for turning a `gap` prop into the px the CSS calc needs. */
const SPACING_PX = 8;

/** Below this a card stops being readable, so the taper yields to it. */
export const NESTED_MIN_TRACK = 180;

/**
 * How many columns a *nested* level gets, tapering from the top-level pick.
 *
 * Each step down, and each extra column at the top, costs one column — so
 * picking one column at L1 buys three at L2, while picking three leaves the
 * levels below it stacked. `depth` is 1-based and **relative to the rendered
 * root**: drilling in (Navigator zoom, Capability Map scope) re-roots the tree
 * without re-levelling its nodes, so tapering from an absolute node level
 * would start from the wrong origin after a drill-in.
 */
export function nestedColumns(pick: ColumnCount, depth: number): ColumnCount {
  if (depth <= 1) return pick;
  const n = 4 - pick - (depth - 2);
  return Math.max(1, Math.min(3, n)) as ColumnCount;
}

/**
 * Container-relative grid for a nested level: exactly `cols` tracks while they
 * fit, fewer when the parent is genuinely too narrow.
 *
 * `auto-fill` with a percentage minimum resolves against the *grid container*,
 * not the viewport, which is what makes this safe inside a card — a viewport
 * breakpoint would happily put three tracks in a 390px card. The `max()` floor
 * is what preserves the graceful degradation the flex-wrap code it replaces
 * had for free.
 *
 * Deliberately carries no `report-print-grid-*` class: percentages are already
 * parent-relative so print needs no override, and inheriting that rule's
 * `gap: 8px !important` would flatten the nested gaps.
 */
export function nestedGridProps(
  cols: ColumnCount,
  opts?: { gap?: number; minTrack?: number; sx?: Record<string, unknown> },
): { sx: Record<string, unknown>; "data-nested-cols": number } {
  const gap = opts?.gap ?? 1;
  const gutters = (cols - 1) * gap * SPACING_PX;
  const share = `calc((100% - ${gutters}px) / ${cols})`;
  const minTrack = opts?.minTrack ?? NESTED_MIN_TRACK;
  return {
    "data-nested-cols": cols,
    sx: {
      display: "grid",
      gridTemplateColumns: `repeat(auto-fill, minmax(max(${minTrack}px, ${share}), 1fr))`,
      gap,
      ...opts?.sx,
    },
  };
}
