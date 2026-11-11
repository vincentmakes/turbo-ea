/**
 * The decision register's sidebar filters as pure functions: what the panel's
 * filter memo keeps (`filterAdrs`), how many filters are active, and the
 * "In force" one-click preset. `AdrFilterSidebar` renders the controls;
 * `DecisionsPanel` applies them to the rows it loaded once.
 */
import { toIsoDate, toLocalDate } from "@/lib/dates";
import type { ArchitectureDecision } from "@/types";
import { IN_FORCE_STANDINGS, matchesStanding } from "./decisionStanding";

export interface AdrFilters {
  cardTypes: string[];
  linkedCards: string[];
  statuses: string[];
  /** Standings to keep (`decisionStanding.ts` values, `"none"` for unsigned). */
  standings: string[];
  signedBy: string[];
  dateCreatedFrom: string;
  dateCreatedTo: string;
  dateModifiedFrom: string;
  dateModifiedTo: string;
  dateSignedFrom: string;
  dateSignedTo: string;
  /** The decided-on day (signed and recorded decisions alike). */
  dateDecidedFrom: string;
  dateDecidedTo: string;
  /** Keep the earlier revisions of a decision (off: current and open only). */
  showEarlierRevisions: boolean;
}

export const EMPTY_ADR_FILTERS: AdrFilters = {
  cardTypes: [],
  linkedCards: [],
  statuses: [],
  standings: [],
  signedBy: [],
  dateCreatedFrom: "",
  dateCreatedTo: "",
  dateModifiedFrom: "",
  dateModifiedTo: "",
  dateSignedFrom: "",
  dateSignedTo: "",
  dateDecidedFrom: "",
  dateDecidedTo: "",
  showEarlierRevisions: false,
};

/** Whether the standing selection is exactly the "In force" preset. */
export function isInForcePreset(standings: readonly string[]): boolean {
  return (
    standings.length === IN_FORCE_STANDINGS.length &&
    IN_FORCE_STANDINGS.every((s) => standings.includes(s))
  );
}

/** The preset button: selects the in-force standings, or clears them when it
 *  is already what is selected. */
export function toggleInForcePreset(standings: readonly string[]): string[] {
  return isInForcePreset(standings) ? [] : [...IN_FORCE_STANDINGS];
}

/** Active filters, for the rail chip and the tab dot. The revisions switch
 *  counts when on: it widens what the register shows. */
export function countActiveAdrFilters(filters: AdrFilters): number {
  return (
    filters.cardTypes.length +
    filters.linkedCards.length +
    filters.statuses.length +
    filters.standings.length +
    filters.signedBy.length +
    (filters.dateCreatedFrom ? 1 : 0) +
    (filters.dateCreatedTo ? 1 : 0) +
    (filters.dateModifiedFrom ? 1 : 0) +
    (filters.dateModifiedTo ? 1 : 0) +
    (filters.dateSignedFrom ? 1 : 0) +
    (filters.dateSignedTo ? 1 : 0) +
    (filters.dateDecidedFrom ? 1 : 0) +
    (filters.dateDecidedTo ? 1 : 0) +
    (filters.showEarlierRevisions ? 1 : 0)
  );
}

/**
 * A timestamp's local calendar day as `YYYY-MM-DD` — the day the grid shows
 * it on. The From / To filters compare on this, so both days are inclusive
 * whatever offset or fraction the stored timestamp carries.
 */
function dayOf(value: string | null | undefined): string | null {
  const d = toLocalDate(value);
  return d ? toIsoDate(d) : null;
}

/** Whether `value` falls on or after `from` and on or before `to` (empty = unbounded). */
export function inDayRange(value: string | null | undefined, from: string, to: string): boolean {
  const day = dayOf(value);
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
}

/** The rows the register shows for `filters`, in their loaded order. */
export function filterAdrs(
  adrs: ArchitectureDecision[],
  filters: AdrFilters,
): ArchitectureDecision[] {
  let list = adrs;
  if (!filters.showEarlierRevisions) {
    list = list.filter((a) => a.is_earlier_revision !== true);
  }
  if (filters.statuses.length > 0) {
    list = list.filter((a) => filters.statuses.includes(a.status));
  }
  if (filters.standings.length > 0) {
    list = list.filter((a) => matchesStanding(a, filters.standings));
  }
  if (filters.cardTypes.length > 0) {
    list = list.filter((a) =>
      (a.linked_cards ?? []).some((c) => filters.cardTypes.includes(c.type)),
    );
  }
  if (filters.linkedCards.length > 0) {
    list = list.filter((a) =>
      (a.linked_cards ?? []).some((c) => filters.linkedCards.includes(c.id)),
    );
  }
  const { dateCreatedFrom, dateCreatedTo, dateModifiedFrom, dateModifiedTo } = filters;
  const { dateSignedFrom, dateSignedTo, dateDecidedFrom, dateDecidedTo } = filters;
  if (dateCreatedFrom || dateCreatedTo) {
    list = list.filter((a) => inDayRange(a.created_at, dateCreatedFrom, dateCreatedTo));
  }
  if (dateModifiedFrom || dateModifiedTo) {
    list = list.filter((a) => inDayRange(a.updated_at, dateModifiedFrom, dateModifiedTo));
  }
  if (dateSignedFrom || dateSignedTo) {
    list = list.filter((a) => inDayRange(a.signed_at, dateSignedFrom, dateSignedTo));
  }
  // A recorded decision has no signing date: the decided-on day is what dates it.
  if (dateDecidedFrom || dateDecidedTo) {
    list = list.filter((a) => inDayRange(a.decided_on, dateDecidedFrom, dateDecidedTo));
  }
  if (filters.signedBy.length > 0) {
    list = list.filter((a) =>
      a.signatories.some((s) => s.status === "signed" && filters.signedBy.includes(s.user_id)),
    );
  }
  return list;
}

/** The register export query: the earlier revisions only when they are shown. */
export function adrExportPath(showEarlierRevisions: boolean): string {
  return `/adr?include_content=true&include_earlier=${showEarlierRevisions ? "true" : "false"}`;
}

/** The selected rows that the filters still show (a selection made before a
 *  filter change never exports a row that is no longer on screen). */
export function visibleSelection(
  selected: ArchitectureDecision[],
  visible: ArchitectureDecision[],
): ArchitectureDecision[] {
  const ids = new Set(visible.map((a) => a.id));
  return selected.filter((a) => ids.has(a.id));
}
