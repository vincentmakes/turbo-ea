/**
 * Pure helpers behind the grid's drag-fill handle (see `useDragFill`).
 *
 * Kept free of React and of any live grid so the geometry, the range maths and
 * the write scheduling can be unit-tested without mounting one — the same
 * split as `cellContextMenu.ts` / `useCellContextMenu.tsx`.
 *
 * Every AG Grid DOM selector the feature depends on lives in this file and
 * nowhere else, so an AG Grid upgrade has exactly one place to audit.
 */
import type { ColDef, GridApi, IRowNode } from "ag-grid-community";

/** Painted on every rendered cell inside the live preview range. */
export const FILL_PREVIEW_CLASS = "tea-fill-preview";
/** The handle itself — the wrapper `sx` keys its hit area off this. */
export const FILL_HANDLE_CLASS = "tea-fill-handle";
/** The marquee outlining the range while dragging. */
export const FILL_MARQUEE_CLASS = "tea-fill-marquee";

/** How close to a viewport edge the pointer must get before auto-scroll kicks in. */
export const AUTOSCROLL_EDGE_PX = 48;
/** Ceiling on a single auto-scroll frame, so a pinned finger stays controllable. */
export const AUTOSCROLL_MAX_STEP_PX = 24;

/** Which way the user dragged the handle. */
export type FillDirection = "down" | "up";

/**
 * The displayed row indices a fill covers, in display order.
 *
 * The anchor is excluded — it is the source, not a target — and both ends are
 * clamped to the row model, so a drag that runs off the end of the grid fills
 * to the last row rather than producing indices that resolve to nothing.
 * Dragging back onto the anchor yields an empty range, which is what cancels
 * the gesture without opening a dialog.
 */
export function fillRowIndices(
  anchorIndex: number,
  targetIndex: number,
  rowCount: number,
): number[] {
  if (rowCount <= 0) return [];
  const anchor = clamp(anchorIndex, 0, rowCount - 1);
  const target = clamp(targetIndex, 0, rowCount - 1);
  if (target === anchor) return [];
  const indices: number[] = [];
  if (target > anchor) {
    for (let i = anchor + 1; i <= target; i++) indices.push(i);
  } else {
    // Still emitted top-to-bottom. Every consumer — the marquee, the confirm
    // dialog's count, the write loop — wants display order, not the order the
    // finger happened to travel in.
    for (let i = target; i < anchor; i++) indices.push(i);
  }
  return indices;
}

/** Which way a range runs relative to its anchor. */
export function fillDirection(anchorIndex: number, targetIndex: number): FillDirection {
  return targetIndex < anchorIndex ? "up" : "down";
}

/**
 * The `.ag-cell` element for one (rowIndex, colId), or null when that row is
 * virtualised away or the column is scrolled out horizontally.
 *
 * AG Grid renders a *separate* `.ag-row` per region — left-pinned, centre,
 * right-pinned — and all of them carry the **same** `row-index`. Column freeze
 * is mandatory on every grid in this app, so the pinned regions are always
 * populated and a naive `[row-index="N"] [col-id="X"]` would routinely find
 * the wrong region's row and return null for a column that is on screen.
 * Hence: walk every row carrying the index and return the one that actually
 * holds the column.
 */
export function findCellElement(
  container: HTMLElement,
  rowIndex: number,
  colId: string,
): HTMLElement | null {
  const rows = container.querySelectorAll<HTMLElement>(`[row-index="${cssEscape(rowIndex)}"]`);
  for (const row of rows) {
    const cell = row.querySelector<HTMLElement>(`[col-id="${cssEscape(colId)}"]`);
    if (cell) return cell;
  }
  return null;
}

/**
 * The displayed row index under a viewport point, or null when the point is
 * not over a row.
 *
 * Uses the DOM idiom `useCellContextMenu`'s long-press path already relies on:
 * AG Grid stamps `row-index` onto every rendered row, so a hit test plus one
 * `closest()` is enough. No api call, and it keeps working while rows
 * virtualize in and out under the finger.
 *
 * `elementFromPoint` is optional-chained because **jsdom does not implement
 * it** — without the guard every page test that so much as mounts the hook
 * would throw on the first pointer move.
 */
export function rowIndexAtPoint(x: number, y: number): number | null {
  const el = document.elementFromPoint?.(x, y) as HTMLElement | null;
  const row = el?.closest?.("[row-index]");
  if (!row) return null;
  const raw = row.getAttribute("row-index");
  if (raw === null) return null;
  const index = Number(raw);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/**
 * Pixels to scroll this frame while the pointer sits near a viewport edge.
 *
 * Negative scrolls up, positive down, zero anywhere in the middle. The
 * magnitude ramps with how deep into the edge band the pointer is, so nudging
 * the boundary creeps and pinning the finger to the edge moves fast.
 */
export function autoScrollStep(
  pointerY: number,
  viewportTop: number,
  viewportBottom: number,
  edgePx: number = AUTOSCROLL_EDGE_PX,
  maxStep: number = AUTOSCROLL_MAX_STEP_PX,
): number {
  if (edgePx <= 0 || maxStep <= 0) return 0;
  const overTop = viewportTop + edgePx - pointerY;
  if (overTop > 0) return -ramp(overTop, edgePx, maxStep);
  const overBottom = pointerY - (viewportBottom - edgePx);
  if (overBottom > 0) return ramp(overBottom, edgePx, maxStep);
  return 0;
}

function ramp(depth: number, edge: number, max: number): number {
  return Math.max(1, Math.round((Math.min(depth, edge) / edge) * max));
}

/**
 * Deep-copy a cell value so a filled row never shares array or object identity
 * with the source row.
 *
 * `InventoryPage.tsx`'s header comment records what sharing costs: the
 * `valueSetter`s mutate `p.data` in place, so one array handed to several rows
 * keeps a single identity and the post-setter re-read sees a stale value. Tags,
 * stakeholders and multi-select attributes are all arrays of plain objects,
 * hence a structural copy rather than a shallow one.
 */
export function cloneFillValue<V>(value: V): V {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as V;
  if (Array.isArray(value)) return value.map((item) => cloneFillValue(item)) as unknown as V;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = cloneFillValue(item);
  }
  return out as V;
}

/**
 * Whether this column can be edited on this row right now.
 *
 * Prefers the grid's own answer (`Column.isCellEditable`), which already folds
 * in a callable `editable` and the row's data — that is what excludes
 * Inventory's Parent column outside a single hierarchical type, its readonly
 * attributes, and its stakeholder columns without the manage permission, at
 * zero cost here. Falls back to reading the colDef so a page test running
 * against a stubbed api still gets a sane answer.
 */
export function isCellEditableAt<TData>(
  api: GridApi<TData>,
  colId: string,
  node: IRowNode<TData>,
): boolean {
  const column = api.getColumn?.(colId);
  if (column?.isCellEditable) return Boolean(column.isCellEditable(node));
  const colDef = column?.getColDef?.() as ColDef<TData> | undefined;
  const editable = colDef?.editable;
  if (typeof editable === "function") {
    // The callable form wants a full params object we cannot fabricate
    // faithfully here; treat "has a predicate" as editable and let the grid
    // reject the write. The preferred path above is what runs in production.
    return true;
  }
  return editable === true;
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * Results keep **input order**, so a failure list maps 1:1 onto the targets the
 * way `handleMassEdit`'s `results.forEach((r, i) => …)` blocker report does.
 * Never rejects — a throwing worker lands as a `rejected` settlement, matching
 * `Promise.allSettled`.
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<PromiseSettledResult<R>[]> {
  const total = items.length;
  const results = new Array<PromiseSettledResult<R>>(total);
  if (total === 0) {
    onProgress?.(0, 0);
    return results;
  }
  const width = Math.max(1, Math.min(limit, total));
  let next = 0;
  let done = 0;

  const runner = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= total) return;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
      done++;
      onProgress?.(done, total);
    }
  };

  await Promise.all(Array.from({ length: width }, runner));
  return results;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Minimal attribute-selector escaping. colIds are metamodel-derived
 * (`attr_<key>`, `rel_<key>`, `stakeholder_<role>`) so they can carry
 * characters a bare selector would choke on.
 */
function cssEscape(value: string | number): string {
  return String(value).replace(/["\\]/g, "\\$&");
}
