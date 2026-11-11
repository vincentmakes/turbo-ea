import { describe, expect, it } from "vitest";

import { STATUS_COLORS } from "@/theme/tokens";
import {
  EARLIER_REVISION_ROW_CLASS,
  RECORDED_GROUP_KEY,
  decisionMakerNames,
  isEarlierRevisionRow,
  standingGroupKey,
  standingGroupVocab,
  statusGroupKey,
  statusGroupVocab,
} from "./adrGridModel";

const t = (key: string) => `t:${key}`;

describe("status grouping", () => {
  it("groups a recorded decision apart from a signed one", () => {
    expect(RECORDED_GROUP_KEY).toBe("recorded");
    expect(statusGroupKey({ status: "signed", recorded_at: "2026-01-01T00:00:00Z" })).toBe(
      "recorded",
    );
    expect(statusGroupKey({ status: "signed", recorded_at: null })).toBe("signed");
    expect(statusGroupKey({ status: "draft" })).toBe("draft");
    expect(statusGroupKey({ status: "in_review" })).toBe("in_review");
  });

  it("lists the statuses in workflow order, Recorded last, with token colours", () => {
    expect(statusGroupVocab(t)).toEqual([
      { key: "draft", label: "t:status.draft", color: STATUS_COLORS.neutral },
      { key: "in_review", label: "t:status.inReview", color: STATUS_COLORS.warning },
      { key: "signed", label: "t:status.signed", color: STATUS_COLORS.success },
      { key: "recorded", label: "t:status.recorded", color: STATUS_COLORS.success },
    ]);
  });
});

describe("standing grouping", () => {
  it("puts a decision with no standing in the 'none' group", () => {
    expect(standingGroupKey({ standing: "revoked" })).toBe("revoked");
    expect(standingGroupKey({ standing: null })).toBe("none");
    expect(standingGroupKey({})).toBe("none");
  });

  it("lists the standings in reading order, then 'Not signed yet'", () => {
    expect(standingGroupVocab(t)).toEqual([
      { key: "scheduled", label: "t:adr.standing.scheduled", color: STATUS_COLORS.info },
      { key: "in_force", label: "t:adr.standing.inForce", color: STATUS_COLORS.success },
      { key: "amended", label: "t:adr.standing.amended", color: STATUS_COLORS.warning },
      { key: "superseded", label: "t:adr.standing.superseded", color: STATUS_COLORS.neutral },
      { key: "revoked", label: "t:adr.standing.revoked", color: STATUS_COLORS.error },
      { key: "expired", label: "t:adr.standing.expired", color: STATUS_COLORS.neutral },
      { key: "none", label: "t:adr.standing.none", color: STATUS_COLORS.neutral },
    ]);
  });
});

describe("decisionMakerNames", () => {
  it("joins the names, skipping blank ones", () => {
    expect(
      decisionMakerNames({
        decision_makers: [
          { user_id: "u1", display_name: "Ann" },
          { user_id: null, display_name: "" },
          { user_id: null, display_name: "Board" },
        ],
      }),
    ).toBe("Ann, Board");
    expect(decisionMakerNames({})).toBe("");
  });
});

describe("isEarlierRevisionRow", () => {
  it("is true only for a row flagged as an earlier revision", () => {
    expect(EARLIER_REVISION_ROW_CLASS).toBe("adr-row-earlier-revision");
    expect(isEarlierRevisionRow({ is_earlier_revision: true })).toBe(true);
    expect(isEarlierRevisionRow({ is_earlier_revision: false })).toBe(false);
    expect(isEarlierRevisionRow({})).toBe(false);
    expect(isEarlierRevisionRow(undefined)).toBe(false);
  });
});
