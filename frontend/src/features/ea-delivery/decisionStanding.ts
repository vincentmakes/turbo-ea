/**
 * The one home of the decision (ADR) status and standing vocabulary: the
 * ordered value lists, their translation keys (`delivery` namespace), the chip
 * colours, and the small predicates every register view shares.
 *
 * The standing itself is derived by the backend (`decision_standing.py`); this
 * module only names and colours it. A grid, a filter sidebar, a picker and a
 * banner reading the same vocabulary is what keeps them from drifting apart.
 */
import { STATUS_COLORS } from "@/theme/tokens";
import type {
  ArchitectureDecision,
  DecisionLinkKind,
  DecisionStanding,
} from "@/types";

/** A `t` bound to the `delivery` namespace. */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

export type DecisionStatus = ArchitectureDecision["status"];

/** MUI palette colours a status/standing chip may take. */
export type ChipColor = "default" | "info" | "success" | "warning" | "error";

export interface ChipStyle {
  labelKey: string;
  color: ChipColor;
  variant: "filled" | "outlined";
  /** Token colour for a dot or a group-by swatch (AG Grid, ECharts). */
  dot: string;
}

// --- status ------------------------------------------------------------------

/** Workflow statuses, in workflow order. */
export const DECISION_STATUSES: readonly DecisionStatus[] = ["draft", "in_review", "signed"];

/** The key a "Recorded" decision (signed outside Turbo EA) is labelled with. */
export const RECORDED_LABEL_KEY = "status.recorded";

export const STATUS_CHIP: Record<DecisionStatus, ChipStyle> = {
  draft: { labelKey: "status.draft", color: "default", variant: "filled", dot: STATUS_COLORS.neutral },
  in_review: {
    labelKey: "status.inReview",
    color: "warning",
    variant: "filled",
    dot: STATUS_COLORS.warning,
  },
  signed: {
    labelKey: "status.signed",
    color: "success",
    variant: "filled",
    dot: STATUS_COLORS.success,
  },
};

/** A recorded decision is locked like a signed one, but was not signed here:
 *  same hue, outlined. */
export const RECORDED_CHIP: ChipStyle = {
  labelKey: RECORDED_LABEL_KEY,
  color: "success",
  variant: "outlined",
  dot: STATUS_COLORS.success,
};

type StatusFields = Pick<ArchitectureDecision, "status"> & {
  recorded_at?: string | null;
};

/** Signed by being recorded as decided outside Turbo EA (no signatures). */
export function isRecorded(adr: StatusFields): boolean {
  return adr.status === "signed" && Boolean(adr.recorded_at);
}

/** The chip style for a decision's status; "Recorded" for a recorded decision. */
export function statusChip(adr: StatusFields): ChipStyle {
  if (isRecorded(adr)) return RECORDED_CHIP;
  return STATUS_CHIP[adr.status] ?? STATUS_CHIP.draft;
}

/** The status label key; "Recorded" for a recorded decision. */
export function statusLabelKey(adr: StatusFields): string {
  return statusChip(adr).labelKey;
}

/**
 * The content of a decision (or a SoAW) is locked from the moment it is sent
 * for review: editing means recalling the signatures first.
 */
export function isLocked(status: string | null | undefined): boolean {
  return status === "in_review" || status === "signed";
}

// --- standing ----------------------------------------------------------------

/** Standings, in the order a reader meets them over a decision's life. */
export const DECISION_STANDINGS: readonly DecisionStanding[] = [
  "scheduled",
  "in_force",
  "amended",
  "superseded",
  "revoked",
  "expired",
];

/** Filter value for decisions with no standing (not signed yet). */
export const NO_STANDING = "none";

/** The standings the "In force" preset selects. */
export const IN_FORCE_STANDINGS: readonly DecisionStanding[] = ["in_force", "amended"];

export const STANDING_CHIP: Record<DecisionStanding, ChipStyle> = {
  scheduled: {
    labelKey: "adr.standing.scheduled",
    color: "info",
    variant: "outlined",
    dot: STATUS_COLORS.info,
  },
  in_force: {
    labelKey: "adr.standing.inForce",
    color: "success",
    variant: "filled",
    dot: STATUS_COLORS.success,
  },
  // Still in force, but the reader has to read the amendment too.
  amended: {
    labelKey: "adr.standing.amended",
    color: "warning",
    variant: "outlined",
    dot: STATUS_COLORS.warning,
  },
  superseded: {
    labelKey: "adr.standing.superseded",
    color: "default",
    variant: "outlined",
    dot: STATUS_COLORS.neutral,
  },
  revoked: {
    labelKey: "adr.standing.revoked",
    color: "error",
    variant: "outlined",
    dot: STATUS_COLORS.error,
  },
  expired: {
    labelKey: "adr.standing.expired",
    color: "default",
    variant: "filled",
    dot: STATUS_COLORS.neutral,
  },
};

/** Label key of the "no standing" filter value. */
export const NO_STANDING_LABEL_KEY = "adr.standing.none";

/** The label key of a standing, or of {@link NO_STANDING} for null. */
export function standingLabelKey(standing: DecisionStanding | null | undefined): string {
  if (!standing) return NO_STANDING_LABEL_KEY;
  return STANDING_CHIP[standing]?.labelKey ?? NO_STANDING_LABEL_KEY;
}

/**
 * Whether a decision passes a standing filter. An empty selection keeps
 * everything; a decision with no standing matches {@link NO_STANDING}.
 */
export function matchesStanding(
  adr: { standing?: DecisionStanding | null },
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  return selected.includes(adr.standing ?? NO_STANDING);
}

// --- references --------------------------------------------------------------

/**
 * "ADR-012 · Rev 2": the reference, with the revision only from 2 on (the
 * backend's `adr_service.reference_label`). `t` is the `delivery` namespace's.
 */
export function decisionRefLabel(
  ref: { reference_number: string; revision_number?: number | null },
  t: Translate,
): string {
  const rev = ref.revision_number ?? 1;
  if (rev > 1) {
    return t("adr.revision.reference", { reference: ref.reference_number, number: rev });
  }
  return ref.reference_number;
}

/** "Rev 2": a revision on its own (a strip, a SoAW pointer). */
export function revisionLabel(revisionNumber: number, t: Translate): string {
  return t("adr.revision.short", { number: revisionNumber });
}

// --- links -------------------------------------------------------------------

/** Link kinds, strongest effect first. */
export const DECISION_LINK_KINDS: readonly DecisionLinkKind[] = [
  "replaces",
  "revokes",
  "amends",
  "consolidates",
  "relates",
];

/** Verb labels: an outgoing link reads from the decision that holds it
 *  ("Replaces ADR-003"), an incoming one from its target ("Replaced by ADR-012"). */
export const LINK_KIND_LABEL_KEYS: Record<
  "outgoing" | "incoming",
  Record<DecisionLinkKind, string>
> = {
  outgoing: {
    replaces: "adr.links.outgoing.replaces",
    amends: "adr.links.outgoing.amends",
    revokes: "adr.links.outgoing.revokes",
    relates: "adr.links.outgoing.relates",
    consolidates: "adr.links.outgoing.consolidates",
  },
  incoming: {
    replaces: "adr.links.incoming.replaces",
    amends: "adr.links.incoming.amends",
    revokes: "adr.links.incoming.revokes",
    relates: "adr.links.incoming.relates",
    consolidates: "adr.links.incoming.consolidates",
  },
};

// --- dates -------------------------------------------------------------------

/** Labels of the decision's own dates, in reading order. */
export const DATE_LABEL_KEYS = {
  decided_on: "adr.dates.decidedOn",
  effective_from: "adr.dates.effectiveFrom",
  valid_until: "adr.dates.validUntil",
} as const;
