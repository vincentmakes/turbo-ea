import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { STATUS_COLORS } from "@/theme/tokens";
import {
  DATE_LABEL_KEYS,
  DECISION_LINK_KINDS,
  DECISION_STANDINGS,
  DECISION_STATUSES,
  IN_FORCE_STANDINGS,
  LINK_KIND_LABEL_KEYS,
  NO_STANDING,
  RECORDED_CHIP,
  STANDING_CHIP,
  STATUS_CHIP,
  decisionRefLabel,
  isLocked,
  isRecorded,
  matchesStanding,
  revisionLabel,
  standingLabelKey,
  statusChip,
  statusLabelKey,
} from "./decisionStanding";

const t = i18n.getFixedT("en", "delivery");

describe("decisionStanding vocabulary", () => {
  it("lists statuses and standings in their fixed order", () => {
    expect(DECISION_STATUSES).toEqual(["draft", "in_review", "signed"]);
    expect(DECISION_STANDINGS).toEqual([
      "scheduled",
      "in_force",
      "amended",
      "superseded",
      "revoked",
      "expired",
    ]);
    expect(IN_FORCE_STANDINGS).toEqual(["in_force", "amended"]);
    expect(DECISION_LINK_KINDS).toEqual(["replaces", "revokes", "amends", "consolidates", "relates"]);
  });

  it("has an English label for every status, standing, link kind and date", () => {
    const keys = [
      ...Object.values(STATUS_CHIP).map((c) => c.labelKey),
      RECORDED_CHIP.labelKey,
      ...Object.values(STANDING_CHIP).map((c) => c.labelKey),
      standingLabelKey(null),
      ...Object.values(LINK_KIND_LABEL_KEYS.outgoing),
      ...Object.values(LINK_KIND_LABEL_KEYS.incoming),
      ...Object.values(DATE_LABEL_KEYS),
    ];
    for (const key of keys) {
      expect(i18n.exists(key, { ns: "delivery", lng: "en" }), key).toBe(true);
    }
  });

  it("labels the link verbs in both directions", () => {
    expect(t(LINK_KIND_LABEL_KEYS.outgoing.relates)).toBe("Relates to");
    expect(t(LINK_KIND_LABEL_KEYS.incoming.replaces)).toBe("Replaced by");
    expect(t(LINK_KIND_LABEL_KEYS.outgoing.consolidates)).toBe("Consolidates the amendment of");
    expect(t(LINK_KIND_LABEL_KEYS.incoming.consolidates)).toBe("Consolidated into");
  });

  it("colours every chip from the status tokens", () => {
    expect(STATUS_CHIP.draft).toEqual({
      labelKey: "status.draft",
      color: "default",
      variant: "filled",
      dot: STATUS_COLORS.neutral,
    });
    expect(STATUS_CHIP.in_review.dot).toBe(STATUS_COLORS.warning);
    expect(STATUS_CHIP.signed.color).toBe("success");
    expect(STANDING_CHIP.in_force).toEqual({
      labelKey: "adr.standing.inForce",
      color: "success",
      variant: "filled",
      dot: STATUS_COLORS.success,
    });
    expect(STANDING_CHIP.revoked.color).toBe("error");
    expect(STANDING_CHIP.revoked.dot).toBe(STATUS_COLORS.error);
    expect(STANDING_CHIP.scheduled.dot).toBe(STATUS_COLORS.info);
    expect(STANDING_CHIP.amended.variant).toBe("outlined");
  });
});

describe("isRecorded / statusChip / statusLabelKey", () => {
  it("is recorded only when signed AND recorded_at is set", () => {
    expect(isRecorded({ status: "signed", recorded_at: "2026-01-02T10:00:00Z" })).toBe(true);
    expect(isRecorded({ status: "signed", recorded_at: null })).toBe(false);
    expect(isRecorded({ status: "signed" })).toBe(false);
    expect(isRecorded({ status: "draft", recorded_at: "2026-01-02T10:00:00Z" })).toBe(false);
  });

  it("labels a recorded decision Recorded and others by status", () => {
    expect(statusLabelKey({ status: "signed", recorded_at: "2026-01-02" })).toBe("status.recorded");
    expect(statusLabelKey({ status: "signed" })).toBe("status.signed");
    expect(statusLabelKey({ status: "in_review" })).toBe("status.inReview");
    expect(statusLabelKey({ status: "draft" })).toBe("status.draft");
    expect(statusChip({ status: "signed", recorded_at: "x" })).toBe(RECORDED_CHIP);
    expect(RECORDED_CHIP.variant).toBe("outlined");
    expect(t("status.recorded")).toBe("Recorded");
  });

  it("falls back to the draft chip for an unknown status", () => {
    expect(statusChip({ status: "bogus" as never })).toBe(STATUS_CHIP.draft);
  });
});

describe("isLocked", () => {
  it("locks in review and signed only", () => {
    expect(isLocked("in_review")).toBe(true);
    expect(isLocked("signed")).toBe(true);
    expect(isLocked("draft")).toBe(false);
    expect(isLocked("approved")).toBe(false);
    expect(isLocked(null)).toBe(false);
    expect(isLocked(undefined)).toBe(false);
  });
});

describe("standingLabelKey / matchesStanding", () => {
  it("names each standing and the missing one", () => {
    expect(standingLabelKey("amended")).toBe("adr.standing.amended");
    expect(standingLabelKey(undefined)).toBe("adr.standing.none");
    expect(standingLabelKey("bogus" as never)).toBe("adr.standing.none");
    expect(t(standingLabelKey("in_force"))).toBe("In force");
  });

  it("keeps everything on an empty selection", () => {
    expect(matchesStanding({ standing: null }, [])).toBe(true);
    expect(matchesStanding({ standing: "revoked" }, [])).toBe(true);
  });

  it("matches the selected standings only", () => {
    expect(matchesStanding({ standing: "in_force" }, IN_FORCE_STANDINGS)).toBe(true);
    expect(matchesStanding({ standing: "amended" }, IN_FORCE_STANDINGS)).toBe(true);
    expect(matchesStanding({ standing: "revoked" }, IN_FORCE_STANDINGS)).toBe(false);
    expect(matchesStanding({ standing: null }, IN_FORCE_STANDINGS)).toBe(false);
    expect(matchesStanding({}, IN_FORCE_STANDINGS)).toBe(false);
  });

  it("matches an unsigned decision through NO_STANDING", () => {
    expect(NO_STANDING).toBe("none");
    expect(matchesStanding({ standing: null }, [NO_STANDING])).toBe(true);
    expect(matchesStanding({}, [NO_STANDING, "expired"])).toBe(true);
    expect(matchesStanding({ standing: "expired" }, [NO_STANDING])).toBe(false);
  });
});

describe("decisionRefLabel / revisionLabel", () => {
  it("shows the revision only from 2 on", () => {
    expect(decisionRefLabel({ reference_number: "ADR-012", revision_number: 1 }, t)).toBe("ADR-012");
    expect(decisionRefLabel({ reference_number: "ADR-012", revision_number: 2 }, t)).toBe(
      "ADR-012 · Rev 2",
    );
    expect(decisionRefLabel({ reference_number: "ADR-012", revision_number: 0 }, t)).toBe("ADR-012");
    expect(decisionRefLabel({ reference_number: "ADR-012" }, t)).toBe("ADR-012");
    expect(decisionRefLabel({ reference_number: "ADR-012", revision_number: null }, t)).toBe(
      "ADR-012",
    );
  });

  it("formats a bare revision", () => {
    expect(revisionLabel(3, t)).toBe("Rev 3");
  });
});
