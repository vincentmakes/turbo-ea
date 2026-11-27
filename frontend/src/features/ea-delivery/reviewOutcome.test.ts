import { describe, expect, it } from "vitest";

import { STATUS_COLORS } from "@/theme/tokens";
import type { ReviewOutcome, ReviewOutcomeKind } from "@/types";
import {
  CLOSED_OUTCOMES,
  OUTCOME_CHIP,
  REVIEW_OUTCOMES,
  isClosed,
  isClosedOutcome,
  isReviewOutcome,
  outcomeChip,
  outcomeKind,
  outcomeChipProps,
  outcomeLabelKey,
  reviewActions,
} from "./reviewOutcome";
import { isLocked, statusChip, statusLabelKey } from "./decisionStanding";

const outcome = (kind: ReviewOutcomeKind): ReviewOutcome => ({
  kind,
  at: "2026-11-27T10:00:00Z",
  by: { id: "u1", display_name: "Ada" },
  note: "why",
});

describe("review outcome vocabulary", () => {
  it("is the fixed three kinds, two of them closing", () => {
    expect(REVIEW_OUTCOMES).toEqual(["changes_requested", "rejected", "withdrawn"]);
    expect(CLOSED_OUTCOMES).toEqual(["rejected", "withdrawn"]);
  });

  it("recognises only the known kinds", () => {
    expect(isReviewOutcome("rejected")).toBe(true);
    expect(isReviewOutcome("cancelled")).toBe(false);
    expect(isReviewOutcome(null)).toBe(false);
  });

  it("reads a document's kind, an unknown one as none", () => {
    expect(outcomeKind({ outcome: outcome("withdrawn") })).toBe("withdrawn");
    expect(outcomeKind({ outcome: null })).toBeNull();
    expect(outcomeKind({})).toBeNull();
    expect(outcomeKind(null)).toBeNull();
    expect(
      outcomeKind({ outcome: { ...outcome("rejected"), kind: "bogus" as ReviewOutcomeKind } }),
    ).toBeNull();
  });

  it("closes on rejected and withdrawn only", () => {
    expect(isClosed({ outcome: outcome("rejected") })).toBe(true);
    expect(isClosed({ outcome: outcome("withdrawn") })).toBe(true);
    expect(isClosed({ outcome: outcome("changes_requested") })).toBe(false);
    expect(isClosed({ outcome: null })).toBe(false);
    expect(isClosed(undefined)).toBe(false);
    expect(isClosedOutcome(null)).toBe(false);
    expect(isClosedOutcome("changes_requested")).toBe(false);
  });

  it("colours each outcome from the tokens", () => {
    expect(OUTCOME_CHIP.changes_requested).toMatchObject({
      color: "warning",
      variant: "outlined",
      dot: STATUS_COLORS.warning,
    });
    expect(OUTCOME_CHIP.rejected).toMatchObject({ color: "error", dot: STATUS_COLORS.error });
    expect(OUTCOME_CHIP.withdrawn).toMatchObject({ color: "default", dot: STATUS_COLORS.neutral });
    expect(outcomeLabelKey("withdrawn")).toBe("outcome.withdrawn");
    expect(outcomeChip({ outcome: null })).toBeNull();
    expect(outcomeChip({ outcome: outcome("rejected") })?.labelKey).toBe("outcome.rejected");
  });

  it("hands a status chip the outcome's label and style on a draft only", () => {
    const t = (k: string) => `T(${k})`;
    expect(outcomeChipProps({ status: "draft", outcome: outcome("withdrawn") }, t)).toEqual({
      label: "T(outcome.withdrawn)",
      color: "default",
      variant: "outlined",
      dot: STATUS_COLORS.neutral,
    });
    expect(outcomeChipProps({ status: "in_review", outcome: outcome("rejected") }, t)).toBeNull();
    expect(outcomeChipProps({ status: "draft", outcome: null }, t)).toBeNull();
    expect(outcomeChipProps(null, t)).toBeNull();
  });
});

describe("status vocabulary with an outcome", () => {
  it("labels a draft by its outcome, other statuses as before", () => {
    expect(statusLabelKey({ status: "draft", outcome: outcome("rejected") })).toBe(
      "outcome.rejected",
    );
    expect(statusChip({ status: "draft", outcome: outcome("changes_requested") }).color).toBe(
      "warning",
    );
    expect(statusLabelKey({ status: "draft", outcome: null })).toBe("status.draft");
    expect(statusLabelKey({ status: "in_review", outcome: outcome("rejected") })).toBe(
      "status.inReview",
    );
  });

  it("locks a closed document, not one with changes requested", () => {
    expect(isLocked("draft", true)).toBe(true);
    expect(isLocked("draft")).toBe(false);
    expect(isLocked("draft", isClosed({ outcome: outcome("withdrawn") }))).toBe(true);
    expect(isLocked("draft", isClosed({ outcome: outcome("changes_requested") }))).toBe(false);
    expect(isLocked("in_review", false)).toBe(true);
  });
});

describe("reviewActions", () => {
  const base = { status: "in_review", isNew: false, closed: false, isPendingSignatory: true, canManage: true };

  it("offers a pending signatory sign / request changes / reject in review only", () => {
    expect(reviewActions(base).signatory).toBe(true);
    expect(reviewActions({ ...base, isPendingSignatory: false }).signatory).toBe(false);
    expect(reviewActions({ ...base, status: "draft" }).signatory).toBe(false);
    expect(reviewActions({ ...base, isNew: true }).signatory).toBe(false);
  });

  it("offers withdraw on a saved open draft or in review, to a manager", () => {
    expect(reviewActions(base).withdraw).toBe(true);
    expect(reviewActions({ ...base, status: "draft" }).withdraw).toBe(true);
    expect(reviewActions({ ...base, status: "draft", closed: true }).withdraw).toBe(false);
    expect(reviewActions({ ...base, status: "signed" }).withdraw).toBe(false);
    expect(reviewActions({ ...base, status: "draft", isNew: true }).withdraw).toBe(false);
    expect(reviewActions({ ...base, canManage: false }).withdraw).toBe(false);
  });

  it("offers reopen on a closed document, to a manager", () => {
    expect(reviewActions({ ...base, status: "draft", closed: true }).reopen).toBe(true);
    expect(reviewActions({ ...base, status: "draft", closed: true, canManage: false }).reopen).toBe(
      false,
    );
    expect(reviewActions({ ...base, status: "draft" }).reopen).toBe(false);
  });
});
