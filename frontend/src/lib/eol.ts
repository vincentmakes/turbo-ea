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

import { STATUS_COLORS } from "@/theme";

/**
 * The card types that can carry End-of-Life information. EOL is not a
 * metamodel concept — `eol_product` is a free-form attribute key, not a
 * `fields_schema` field — so there is no data-driven way to derive this.
 * Mirrors `card_flags.EOL_TYPES` on the backend.
 */
export const EOL_TYPES = ["Application", "ITComponent"] as const;

export function isEolType(cardTypeKey: string | undefined | null): boolean {
  return !!cardTypeKey && (EOL_TYPES as readonly string[]).includes(cardTypeKey);
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
