/**
 * Custom EOL products — the organisation's own end-of-life data for products
 * endoflife.date does not track.
 *
 * A card links one exactly like an endoflife.date product, through the same
 * two attributes, with the product stored as `custom:<key>`. The prefix is
 * the only thing that tells the two apart (`eol_custom_service.py` on the
 * backend), so every surface that names a linked product goes through
 * {@link eolProductLabel} rather than printing the raw value.
 */

import { toIsoDate, todayIsoDate } from "@/lib/dates";
import type { EolMilestone } from "@/types";

export const CUSTOM_EOL_PREFIX = "custom:";

/** True for a link to a custom EOL product. */
export function isCustomEolProduct(product: string | null | undefined): boolean {
  return !!product && product.startsWith(CUSTOM_EOL_PREFIX);
}

/** The custom product key inside a `custom:<key>` link (the value itself otherwise). */
export function customEolKey(product: string): string {
  return isCustomEolProduct(product) ? product.slice(CUSTOM_EOL_PREFIX.length) : product;
}

/** What a card stores for the custom product `key`. */
export function customEolRef(key: string): string {
  return `${CUSTOM_EOL_PREFIX}${key}`;
}

/**
 * How a linked product is named on screen: a custom product's title when it
 * is known, else its key without the prefix; an endoflife.date slug as is.
 */
export function eolProductLabel(product: string, title?: string | null): string {
  if (title) return title;
  return customEolKey(product);
}

/** Mirrors `PRODUCT_KEY_RE` in `backend/app/schemas/eol_custom.py`. */
export const CUSTOM_EOL_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export function isValidCustomEolKey(key: string): boolean {
  return CUSTOM_EOL_KEY_RE.test(key);
}

/**
 * A key suggested from a title: "Acme ERP 2" → "acme-erp-2". Accents are
 * folded, anything outside the key alphabet becomes one hyphen, and leading
 * or trailing separators are dropped, so the result always validates (or is
 * empty when the title holds nothing usable).
 */
export function suggestCustomEolKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-._]+$/, "")
    .slice(0, 100)
    .replace(/[-._]+$/, "");
}

/** An `<input type=url>`-free check matching the backend's `check_link`. */
export function isValidEolLink(link: string): boolean {
  return /^https?:\/\/\S+$/i.test(link.trim());
}

/**
 * The four states an EOL / end-of-support value can be in, independent of
 * which boolean encodes them: `ended` (the end has passed), `ongoing` (no end
 * announced / still supported), a known `date`, or `unset`.
 */
export type MilestoneMode = "unset" | "ongoing" | "ended" | "date";

/** Which milestone a value belongs to — they encode booleans oppositely. */
export type MilestoneKind = "eol" | "support";

/**
 * The boolean that means "ended" for each milestone. endoflife.date's API
 * serves `eol: true` for a cycle that *is* end of life but `support: true`
 * for one that is *still* supported — the existing card section reads them
 * that way (`formatSupportField`), and a stored custom cycle follows the API.
 */
const ENDED_VALUE: Record<MilestoneKind, boolean> = { eol: true, support: false };

export function milestoneMode(value: EolMilestone | undefined, kind: MilestoneKind): MilestoneMode {
  if (typeof value === "boolean") return value === ENDED_VALUE[kind] ? "ended" : "ongoing";
  if (typeof value === "string" && value) return "date";
  return "unset";
}

/** The stored value for a mode (and the date, when the mode is `date`). */
export function milestoneValue(mode: MilestoneMode, kind: MilestoneKind, date = ""): EolMilestone {
  if (mode === "ended") return ENDED_VALUE[kind];
  if (mode === "ongoing") return !ENDED_VALUE[kind];
  if (mode === "date") return date || null;
  return null;
}

/** Same window as `APPROACHING_DAYS` in `eol_service.py`. */
export const APPROACHING_DAYS = 182;

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIsoDate(new Date(y, m - 1, d + days));
}

/**
 * A cycle's status — the same rule as `eol_status` on the backend, so the
 * admin grid and the card agree. Compared as ISO strings in local time.
 */
export function customCycleStatus(
  eol: EolMilestone | undefined,
  support: EolMilestone | undefined,
  today: string = todayIsoDate(),
): "eol" | "approaching" | "supported" | "unknown" {
  if (eol === true) return "eol";
  if (typeof eol === "string" && eol) {
    if (eol <= today) return "eol";
    if (eol <= addDays(today, APPROACHING_DAYS)) return "approaching";
  }
  if (typeof support === "string" && support && support <= today) return "approaching";
  // A known end — "none announced" or a date far enough away — is supported;
  // only a cycle with no EOL value at all is unknown.
  return eol === false || (typeof eol === "string" && eol !== "") ? "supported" : "unknown";
}
