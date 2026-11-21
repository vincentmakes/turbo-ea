/**
 * What the authenticated PPM portfolio board remembers between visits,
 * persisted in localStorage under the app-wide `turboea.<page>.prefs`
 * convention (see `costChartPrefs.ts`).
 *
 * The page link stays the board's state — a link that carries board settings
 * opens with them — and this remembers the last state, so a bare `/ppm` (the
 * PPM menu entry, the back arrow on an initiative) opens where the user left
 * off. `params` are the board's own link parameters, exactly as the view's
 * URL-sync effect writes them (`filterSearchParams`); `filtersCollapsed` is the
 * fold of the Filters section, folded until the user unfolds it.
 *
 * Used by the container only: the public portal board remembers nothing.
 */

const PREFS_KEY = "turboea.ppm.portfolio.prefs";

/** The link parameters the board owns — the ones `filterSearchParams` writes. */
export const BOARD_PARAMS = [
  "groupBy",
  "search",
  "subtype",
  "hierarchy",
  "depth",
  "bySubtype",
  "filters",
] as const;

export interface BoardPrefs {
  params: Record<string, string>;
  filtersCollapsed: boolean;
}

/** The board's own parameters out of a free-form record: known keys, non-empty strings. */
function onlyBoardParams(source: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of BOARD_PARAMS) {
    const value = source[key];
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function loadBoardPrefs(): BoardPrefs {
  try {
    // A missing key reads as `null`, which parses to `null`: the defaults below.
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFS_KEY) as string);
    const prefs = isRecord(parsed) ? parsed : {};
    return {
      params: isRecord(prefs.params) ? onlyBoardParams(prefs.params) : {},
      filtersCollapsed: prefs.filtersCollapsed !== false,
    };
  } catch {
    return { params: {}, filtersCollapsed: true };
  }
}

/**
 * Remember the board's state. The default state (nothing set, section folded)
 * is remembered as nothing at all, so a fresh board — after Reset too — leaves
 * no entry behind.
 */
export function saveBoardPrefs(prefs: BoardPrefs): void {
  const params = onlyBoardParams(prefs.params);
  if (Object.keys(params).length === 0 && prefs.filtersCollapsed) {
    clearBoardPrefs();
    return;
  }
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ params, filtersCollapsed: prefs.filtersCollapsed }),
    );
  } catch {
    // Storage unavailable (private mode) — the board just won't remember.
  }
}

export function clearBoardPrefs(): void {
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // Storage unavailable — there is nothing remembered to clear.
  }
}

/** The board's own parameters of a link; every other parameter is ignored. */
export function boardParams(search: URLSearchParams): Record<string, string> {
  return onlyBoardParams(Object.fromEntries(search));
}

/**
 * What to restore onto a link: the remembered parameters, or null when the
 * link carries a board parameter of its own (a shared link wins) or nothing is
 * remembered.
 */
export function restoreTarget(
  search: URLSearchParams,
  stored: Record<string, string>,
): Record<string, string> | null {
  if (Object.keys(boardParams(search)).length > 0) return null;
  return Object.keys(stored).length > 0 ? stored : null;
}

/** True when the two sets of board parameters are the same, key for key. */
export function sameBoardParams(a: Record<string, string>, b: Record<string, string>): boolean {
  return BOARD_PARAMS.every((key) => a[key] === b[key]);
}

/** `search` with the board's own parameters replaced by `params`, every other one kept. */
export function withBoardParams(
  search: URLSearchParams,
  params: Record<string, string>,
): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of BOARD_PARAMS) next.delete(key);
  for (const [key, value] of Object.entries(params)) next.set(key, value);
  return next;
}
