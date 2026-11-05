/**
 * End-of-Life vocabulary shared by every surface that shows it.
 *
 * A card stores only the *link* — `attributes.eol_product` +
 * `attributes.eol_cycle` — or a hand-entered `lifecycle.endOfLife` date. The
 * dates behind the link live on endoflife.date and are resolved by the
 * backend (`services/eol_service.py`), which is also where the four statuses
 * below are decided. This module holds the pieces the client needs to render
 * them, so the card's EOL section, the inventory column and the EOL report
 * agree on which types can carry EOL data and what each status looks like.
 */

import { EOL_COVERAGE_COLORS, STATUS_COLORS } from "@/theme";

/**
 * The card types that track End of Life when their metamodel says nothing.
 * Which types track it is each type's own End of Life section toggle in the
 * Card Layout editor ({@link typeTracksEol}); these two are the shipped
 * default. Mirrors `card_flags.DEFAULT_EOL_TYPES` on the backend.
 */
export const DEFAULT_EOL_TYPES = ["Application", "ITComponent"] as const;

/** The `section_config` key of the card-detail End of Life section. */
export const EOL_SECTION_KEY = "eol";

/**
 * Whether cards of a type carry End-of-Life information — the card section,
 * the inventory column, the EOL report and every coverage figure.
 *
 * One switch decides it: the `hidden` flag of the type's `eol` section. An
 * explicit boolean always wins; when none is stored, the shipped default
 * applies ({@link DEFAULT_EOL_TYPES}). A legacy bare boolean under `eol` (the
 * old "expanded" flag) or a config without `hidden` reads as absent.
 * Mirrors `card_flags.type_tracks_eol` on the backend.
 */
export function typeTracksEol(
  type: { key: string; section_config?: Record<string, unknown> } | undefined | null,
): boolean {
  if (!type) return false;
  const cfg = type.section_config?.[EOL_SECTION_KEY];
  const hidden =
    cfg && typeof cfg === "object" ? (cfg as { hidden?: unknown }).hidden : undefined;
  if (typeof hidden === "boolean") return !hidden;
  return (DEFAULT_EOL_TYPES as readonly string[]).includes(type.key);
}

/**
 * {@link typeTracksEol} for a type known only by key: the metamodel's row when
 * it has one, else the shipped default for the key — so a surface rendered
 * before the metamodel arrives behaves as it always did rather than hiding
 * End of Life everywhere for a moment.
 */
export function typeKeyTracksEol(
  key: string | null | undefined,
  types: { key: string; section_config?: Record<string, unknown> }[] = [],
): boolean {
  if (!key) return false;
  return typeTracksEol(types.find((t) => t.key === key) ?? { key });
}

/** The keys of the visible types that track End of Life, in metamodel order. */
export function eolTypeKeys(
  types: { key: string; is_hidden?: boolean; section_config?: Record<string, unknown> }[],
): string[] {
  return types.filter((t) => !t.is_hidden && typeTracksEol(t)).map((t) => t.key);
}

/** The statuses `GET /eol/card-status` and `GET /reports/eol` return. */
export const EOL_STATUSES = ["eol", "approaching", "supported", "unknown"] as const;
export type EolStatusKey = (typeof EOL_STATUSES)[number];

/**
 * One colour per status, used by the EOL report's chart, legend and table and
 * by the inventory's End of life column — a card must not read amber in one
 * place and green in the other.
 */
export const EOL_STATUS_COLORS: Record<string, string> = {
  eol: STATUS_COLORS.error,
  approaching: STATUS_COLORS.warning,
  supported: STATUS_COLORS.success,
  unknown: STATUS_COLORS.neutral,
  // Not a status the backend classifies but a state it reports: nothing has
  // been recorded at all. Deliberately grey rather than red — it is a gap in
  // the inventory, not a risk anyone has established.
  missing: STATUS_COLORS.neutral,
};

/** i18n keys for each status, in the `reports` namespace. */
export const EOL_STATUS_LABEL_KEYS: Record<string, string> = {
  eol: "eol.statusEol",
  approaching: "eol.statusApproaching",
  supported: "eol.statusSupported",
  unknown: "eol.statusUnknown",
  missing: "eol.statusMissing",
};

/**
 * Where a card's End-of-Life data comes from — the EOL coverage buckets of
 * the data-quality report and the dashboards' `eol_coverage` dimension
 * (`card_flags.EOL_BUCKETS` on the backend): linked to endoflife.date, a date
 * entered by hand, or nothing recorded.
 */
export const EOL_COVERAGE_BUCKETS = ["linked", "manual", "missing"] as const;
export type EolCoverageBucket = (typeof EOL_COVERAGE_BUCKETS)[number];

export { EOL_COVERAGE_COLORS };

/** i18n keys for each coverage bucket, in the `reports` namespace. */
export const EOL_COVERAGE_LABEL_KEYS: Record<EolCoverageBucket, string> = {
  linked: "dataQuality.eolLinked",
  manual: "dataQuality.eolManual",
  missing: "dataQuality.eolMissing",
};
