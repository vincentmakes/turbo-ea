/**
 * Pure helpers behind the decision register grid (`AdrGrid.tsx`): the group-by
 * keys and vocabularies, and the plain-text values of the register columns.
 * Labels and colours come from `decisionStanding.ts`, the one home of that
 * vocabulary; nothing here re-declares a status or a standing.
 */
import type { GroupVocabEntry } from "@/components/grid/rowGrouping";
import type { ArchitectureDecision } from "@/types";
import {
  DECISION_STANDINGS,
  DECISION_STATUSES,
  NO_STANDING,
  NO_STANDING_LABEL_KEY,
  RECORDED_CHIP,
  STANDING_CHIP,
  STATUS_CHIP,
  isRecorded,
  type Translate,
} from "./decisionStanding";

/** Group key of the "Recorded" status group (a signed decision recorded as
 *  decided outside Turbo EA). */
export const RECORDED_GROUP_KEY = "recorded";

/** A decision's status group: its workflow status, "recorded" for a
 *  recorded decision, so the group reads like the Status column. */
export function statusGroupKey(adr: Pick<ArchitectureDecision, "status" | "recorded_at">): string {
  return isRecorded(adr) ? RECORDED_GROUP_KEY : adr.status;
}

/** The status groups, in workflow order, "Recorded" after "Signed". */
export function statusGroupVocab(t: Translate): GroupVocabEntry[] {
  return [
    ...DECISION_STATUSES.map((status) => ({
      key: status,
      label: t(STATUS_CHIP[status].labelKey),
      color: STATUS_CHIP[status].dot,
    })),
    { key: RECORDED_GROUP_KEY, label: t(RECORDED_CHIP.labelKey), color: RECORDED_CHIP.dot },
  ];
}

/** A decision's standing group; {@link NO_STANDING} for a decision not signed. */
export function standingGroupKey(adr: Pick<ArchitectureDecision, "standing">): string {
  return adr.standing ?? NO_STANDING;
}

/** The standing groups in reading order, then "Not signed yet". */
export function standingGroupVocab(t: Translate): GroupVocabEntry[] {
  return [
    ...DECISION_STANDINGS.map((standing) => ({
      key: standing,
      label: t(STANDING_CHIP[standing].labelKey),
      color: STANDING_CHIP[standing].dot,
    })),
    { key: NO_STANDING, label: t(NO_STANDING_LABEL_KEY), color: STATUS_CHIP.draft.dot },
  ];
}

/** The decision makers' names, joined for a cell, a filter and a tooltip. */
export function decisionMakerNames(adr: Pick<ArchitectureDecision, "decision_makers">): string {
  return (adr.decision_makers ?? [])
    .map((p) => p.display_name)
    .filter(Boolean)
    .join(", ");
}

/** CSS class of a row showing an earlier revision (muted in the grid). */
export const EARLIER_REVISION_ROW_CLASS = "adr-row-earlier-revision";

/** Whether a row shows an earlier revision of its decision. */
export function isEarlierRevisionRow(
  adr: Pick<ArchitectureDecision, "is_earlier_revision"> | undefined,
): boolean {
  return adr?.is_earlier_revision === true;
}
