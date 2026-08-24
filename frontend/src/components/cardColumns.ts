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
 * The one thing call sites spread onto their grid `<Box>`.
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
