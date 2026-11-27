/**
 * The one home of the review-outcome vocabulary shared by decisions and
 * SoAWs: how a review ended without a signature. Mirrors the backend's
 * `services/review_outcome.py`; nothing else decides what "closed" means.
 *
 * The set is fixed, not configurable. `changes_requested` marks an editable
 * draft sent back by a signatory (it clears when signatures are requested
 * again); `rejected` and `withdrawn` close the document: it stays a draft but
 * is locked, hidden from the register until "Show closed", and is reopened to
 * be worked on again. The three-value `status` never changes meaning.
 */
import { STATUS_COLORS } from "@/theme/tokens";
import type { ReviewOutcome, ReviewOutcomeKind } from "@/types";
import type { ChipStyle, Translate } from "./decisionStanding";

/** Outcomes, in the order a reader meets them (filter rows, group-by). */
export const REVIEW_OUTCOMES: readonly ReviewOutcomeKind[] = [
  "changes_requested",
  "rejected",
  "withdrawn",
];

/** The outcomes that close a document. */
export const CLOSED_OUTCOMES: readonly ReviewOutcomeKind[] = ["rejected", "withdrawn"];

type WithOutcome = { outcome?: ReviewOutcome | null } | null | undefined;

/** Whether a value is one of the outcome kinds. */
export function isReviewOutcome(value: unknown): value is ReviewOutcomeKind {
  return typeof value === "string" && (REVIEW_OUTCOMES as readonly string[]).includes(value);
}

/** The document's outcome kind, or null. An unknown kind reads as none. */
export function outcomeKind(doc: WithOutcome): ReviewOutcomeKind | null {
  const kind = doc?.outcome?.kind;
  return isReviewOutcome(kind) ? kind : null;
}

/** Whether an outcome kind closes the document. */
export function isClosedOutcome(kind: ReviewOutcomeKind | null | undefined): boolean {
  return kind != null && CLOSED_OUTCOMES.includes(kind);
}

/** Closed: rejected or withdrawn (locked until reopened). */
export function isClosed(doc: WithOutcome): boolean {
  return isClosedOutcome(outcomeKind(doc));
}

export const OUTCOME_CHIP: Record<ReviewOutcomeKind, ChipStyle> = {
  // Still an editable draft: the warning hue, outlined.
  changes_requested: {
    labelKey: "outcome.changesRequested",
    color: "warning",
    variant: "outlined",
    dot: STATUS_COLORS.warning,
  },
  rejected: {
    labelKey: "outcome.rejected",
    color: "error",
    variant: "filled",
    dot: STATUS_COLORS.error,
  },
  withdrawn: {
    labelKey: "outcome.withdrawn",
    color: "default",
    variant: "outlined",
    dot: STATUS_COLORS.neutral,
  },
};

/** The "… by {{name}} on {{date}}:" sentence keys of each outcome (banners, exports). */
export const OUTCOME_SENTENCE_KEYS: Record<ReviewOutcomeKind, { named: string; unnamed: string }> = {
  changes_requested: {
    named: "adr.banner.changesRequested",
    unnamed: "adr.banner.changesRequestedNoName",
  },
  rejected: { named: "adr.banner.rejected", unnamed: "adr.banner.rejectedNoName" },
  withdrawn: { named: "adr.banner.withdrawn", unnamed: "adr.banner.withdrawnNoName" },
};

/**
 * "Rejected by Ada on 27 Nov 2026:" — who and when, without the reason (a
 * renderer adds the reason as free text). Null when the document has no
 * outcome or is not a draft.
 */
export function outcomeSentence(
  doc: { status?: string | null; outcome?: ReviewOutcome | null } | null | undefined,
  t: Translate,
  formatDate: (value: string | null | undefined) => string,
): string | null {
  const kind = outcomeKind(doc);
  if (!doc || !kind || doc.status !== "draft" || !doc.outcome) return null;
  const keys = OUTCOME_SENTENCE_KEYS[kind];
  const name = doc.outcome.by?.display_name;
  const date = formatDate(doc.outcome.at);
  return name ? t(keys.named, { name, date }) : t(keys.unnamed, { date });
}

/** The label key of an outcome kind. */
export function outcomeLabelKey(kind: ReviewOutcomeKind): string {
  return OUTCOME_CHIP[kind].labelKey;
}

/** The chip style of a document's outcome, or null when it has none. */
export function outcomeChip(doc: WithOutcome): ChipStyle | null {
  const kind = outcomeKind(doc);
  return kind ? OUTCOME_CHIP[kind] : null;
}

/**
 * What a status chip shows for a draft with an outcome — the six SoAW status
 * maps and any other chip ask this first, and keep their own mapping when it
 * answers null (no outcome, or a document that is not a draft).
 */
export function outcomeChipProps(
  doc: { status?: string | null; outcome?: ReviewOutcome | null } | null | undefined,
  t: Translate,
): { label: string; color: ChipStyle["color"]; variant: ChipStyle["variant"]; dot: string } | null {
  if (!doc || doc.status !== "draft") return null;
  const style = outcomeChip(doc);
  if (!style) return null;
  return { label: t(style.labelKey), color: style.color, variant: style.variant, dot: style.dot };
}

/** The review actions the editor offers. */
export interface ReviewActions {
  /** Sign, Request changes and Reject: a pending signatory of a document in review. */
  signatory: boolean;
  /** Withdraw: a saved open draft, or a document in review, for a manager. */
  withdraw: boolean;
  /** Reopen: a closed document, for a manager. */
  reopen: boolean;
}

/**
 * Which review actions a decision or a SoAW offers the reader (the rules are
 * the same). `canManage` is `adr.manage` on a decision, `soaw.manage` on a SoAW.
 */
export function reviewActions({
  status,
  isNew,
  closed,
  isPendingSignatory,
  canManage,
}: {
  status: string;
  isNew: boolean;
  closed: boolean;
  isPendingSignatory: boolean;
  canManage: boolean;
}): ReviewActions {
  const saved = !isNew;
  return {
    signatory: saved && status === "in_review" && isPendingSignatory,
    withdraw: saved && canManage && ((status === "draft" && !closed) || status === "in_review"),
    reopen: saved && canManage && closed,
  };
}
