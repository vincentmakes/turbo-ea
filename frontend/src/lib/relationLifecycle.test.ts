import { describe, expect, it } from "vitest";
import {
  cleanRelationLifecycle,
  hasLifecycleDates,
  isRelationInEffect,
  relationLifecycleState,
  relationPhaseNote,
  todayLifecycleMs,
} from "./relationLifecycle";
import * as leaf from "./lifecycleAtDate";
import * as portfolio from "@/features/reports/portfolioHelpers";

const day = (iso: string) => Date.parse(iso);

describe("the moved rule", () => {
  it("is the same functions portfolioHelpers re-exports", () => {
    expect(portfolio.isAliveAtDate).toBe(leaf.isAliveAtDate);
    expect(portfolio.hasStartedByDate).toBe(leaf.hasStartedByDate);
    expect(portfolio.isRetiredByDate).toBe(leaf.isRetiredByDate);
    expect(portfolio.parseDate).toBe(leaf.parseDate);
  });
});

describe("todayLifecycleMs", () => {
  // Instants given in UTC, so the expectation does not depend on the zone the
  // runner is in: whatever the local day is at these instants, the UTC day wins.
  it("is UTC midnight of the UTC day just before UTC midnight", () => {
    // 23:30 UTC on 5 March: already the 6th in Sydney, Tokyo, Auckland.
    expect(todayLifecycleMs(new Date(Date.UTC(2027, 2, 5, 23, 30)))).toBe(day("2027-03-05"));
    expect(todayLifecycleMs(new Date("2027-03-05T23:59:59.999Z"))).toBe(day("2027-03-05"));
  });

  it("is the next UTC day just after UTC midnight", () => {
    // 00:01 UTC on 6 March: still the 5th in New York, Los Angeles.
    expect(todayLifecycleMs(new Date(Date.UTC(2027, 2, 6, 0, 1)))).toBe(day("2027-03-06"));
    expect(todayLifecycleMs(new Date("2027-03-06T00:00:00.000Z"))).toBe(day("2027-03-06"));
  });

  it("reads the UTC day of a zone-explicit instant, not that zone's day", () => {
    // A zone-explicit instant whose local (+10:00) day is the 6th and UTC day the 5th.
    const sydneyLateEvening = new Date("2027-03-06T08:30:00+10:00");
    expect(todayLifecycleMs(sydneyLateEvening)).toBe(day("2027-03-05"));
    // A relation ending on the 6th (UTC) is still in effect at that instant.
    expect(isRelationInEffect({ endOfLife: "2027-03-06" }, todayLifecycleMs(sydneyLateEvening))).toBe(
      true,
    );
  });

  it("defaults to now", () => {
    const now = new Date();
    const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    expect(todayLifecycleMs()).toBe(expected);
  });
});

describe("relationLifecycleState", () => {
  it("treats an empty or absent lifecycle as in effect", () => {
    expect(relationLifecycleState(undefined, day("2027-01-01"))).toBe("inEffect");
    expect(relationLifecycleState({}, day("2027-01-01"))).toBe("inEffect");
  });

  it("starts on its active date, inclusive", () => {
    const lc = { active: "2027-03-01" };
    expect(relationLifecycleState(lc, day("2027-02-28"))).toBe("planned");
    expect(relationLifecycleState(lc, day("2027-03-01"))).toBe("inEffect");
    expect(relationLifecycleState(lc, day("2027-03-02"))).toBe("inEffect");
  });

  it("ends on its end-of-life date, inclusive", () => {
    const lc = { active: "2020-01-01", endOfLife: "2027-03-01" };
    expect(relationLifecycleState(lc, day("2027-02-28"))).toBe("inEffect");
    expect(relationLifecycleState(lc, day("2027-03-01"))).toBe("ended");
    expect(relationLifecycleState(lc, day("2027-03-02"))).toBe("ended");
  });

  it("is planned with only a plan or phase-in date (no go-live yet)", () => {
    expect(relationLifecycleState({ plan: "2000-01-01" }, day("2027-01-01"))).toBe("planned");
    expect(relationLifecycleState({ phaseIn: "2000-01-01" }, day("2027-01-01"))).toBe("planned");
  });

  it("is in effect with only an end date still ahead, and ended once it arrives", () => {
    expect(relationLifecycleState({ endOfLife: "2030-01-01" }, day("2027-01-01"))).toBe("inEffect");
    expect(relationLifecycleState({ endOfLife: "2030-01-01" }, day("2030-01-01"))).toBe("ended");
  });

  it("says ended over planned when the end has arrived before any start", () => {
    expect(
      relationLifecycleState({ plan: "2026-01-01", endOfLife: "2026-06-01" }, day("2027-01-01")),
    ).toBe("ended");
  });

  it("ignores a malformed date as if absent", () => {
    expect(relationLifecycleState({ endOfLife: "not a date" }, day("2027-01-01"))).toBe("inEffect");
    expect(relationLifecycleState({ active: "garbage" }, day("2027-01-01"))).toBe("inEffect");
    expect(relationLifecycleState({ active: "garbage", plan: "2000-01-01" }, day("2027-01-01"))).toBe(
      "planned",
    );
  });
});

describe("isRelationInEffect", () => {
  it("is true only in effect", () => {
    expect(isRelationInEffect({}, day("2027-01-01"))).toBe(true);
    expect(isRelationInEffect({ active: "2028-01-01" }, day("2027-01-01"))).toBe(false);
    expect(isRelationInEffect({ endOfLife: "2026-01-01" }, day("2027-01-01"))).toBe(false);
  });

  it("defaults to today", () => {
    expect(isRelationInEffect({ endOfLife: "2000-01-01" })).toBe(false);
    expect(isRelationInEffect({ active: "2000-01-01", endOfLife: "2999-01-01" })).toBe(true);
    expect(isRelationInEffect({ active: "2999-01-01" })).toBe(false);
  });
});

describe("hasLifecycleDates", () => {
  it("is false for absent, empty and blank-valued maps", () => {
    expect(hasLifecycleDates(undefined)).toBe(false);
    expect(hasLifecycleDates({})).toBe(false);
    expect(hasLifecycleDates({ active: "" })).toBe(false);
    expect(hasLifecycleDates({ unknown: "2027-01-01" })).toBe(false);
  });

  it("is true when any phase carries a value", () => {
    expect(hasLifecycleDates({ endOfLife: "2027-01-01" })).toBe(true);
    expect(hasLifecycleDates({ plan: "2027-01-01" })).toBe(true);
  });
});

describe("cleanRelationLifecycle", () => {
  it("keeps the five phases, trimmed, and drops blanks and unknown keys", () => {
    expect(
      cleanRelationLifecycle({
        plan: " 2027-01-01 ",
        phaseIn: "",
        active: "2027-02-01",
        phaseOut: null,
        endOfLife: undefined,
        other: "2027-03-01",
      }),
    ).toEqual({ plan: "2027-01-01", active: "2027-02-01" });
  });

  it("returns an empty map for nothing at all", () => {
    expect(cleanRelationLifecycle(null)).toEqual({});
    expect(cleanRelationLifecycle(undefined)).toEqual({});
    expect(cleanRelationLifecycle({ active: "   " })).toEqual({});
  });
});

describe("relationPhaseNote", () => {
  const at = day("2027-06-01");

  it("says nothing for an undated relation or one in effect with no end", () => {
    expect(relationPhaseNote(undefined, at)).toBeNull();
    expect(relationPhaseNote({}, at)).toBeNull();
    expect(relationPhaseNote({ active: "2027-01-01" }, at)).toBeNull();
    expect(relationPhaseNote({ active: "2027-01-01", endOfLife: "bad" }, at)).toBeNull();
  });

  it("names the go-live date of a planned relation", () => {
    expect(relationPhaseNote({ plan: "2027-01-01", active: "2027-09-01" }, at)).toEqual({
      kind: "planned",
      date: "2027-09-01",
    });
  });

  it("is a bare planned note when no go-live date is set", () => {
    expect(relationPhaseNote({ plan: "2027-01-01" }, at)).toEqual({ kind: "planned" });
    expect(relationPhaseNote({ plan: "2027-01-01", active: "x" }, at)).toEqual({ kind: "planned" });
  });

  it("names the end of an in-effect relation", () => {
    expect(relationPhaseNote({ active: "2027-01-01", endOfLife: "2027-06-02" }, at)).toEqual({
      kind: "until",
      date: "2027-06-02",
    });
  });

  it("names the end of an ended relation, from the end date on", () => {
    expect(relationPhaseNote({ active: "2027-01-01", endOfLife: "2027-06-01" }, at)).toEqual({
      kind: "ended",
      date: "2027-06-01",
    });
  });

  it("defaults to today", () => {
    expect(relationPhaseNote({ endOfLife: "2000-01-01" })).toEqual({
      kind: "ended",
      date: "2000-01-01",
    });
  });
});
