/**
 * The text of a query view's matched-cards cell (a `via:<node key>` column of
 * the inventory): the cards at one step of the query that made the row match.
 */
import type { CardQueryMatchCell } from "@/types";

/** Ends a matched-cards cell holding more cards than the hundred it lists. */
export const VIA_MORE_MARK = "…";

/** Separator of the names in a relation or matched-cards cell. */
export const NAMES_SEPARATOR = "; ";

/**
 * A matched-cards cell's text: the names joined like a relation cell's, with
 * `VIA_MORE_MARK` as a last value when the server cut the list. This is the
 * column's value, so sort, filter and export all read the cell as shown.
 */
export function viaCellText(cell: CardQueryMatchCell | undefined): string {
  if (!cell || cell.cards.length === 0) return "";
  const names = cell.cards.map((c) => c.name);
  if (cell.more) names.push(VIA_MORE_MARK);
  return names.join(NAMES_SEPARATOR);
}
