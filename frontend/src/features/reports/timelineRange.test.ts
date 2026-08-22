import { describe, it, expect } from "vitest";
import {
  cardsChangingBetween,
  classifyTimelineChange,
  computeImpactedIds,
  computeTimelineMilestones,
  computeTimelineRange,
  isVisibleAtDate,
} from "./timelineRange";

const ms = (iso: string) => new Date(iso).getTime();
const YEAR = 365.25 * 86_400_000;
const TODAY = ms("2026-06-15");

describe("computeTimelineRange", () => {
  it("reports no lifecycle data for an empty list", () => {
    const r = computeTimelineRange([], TODAY);
    expect(r.hasLifecycleData).toBe(false);
    expect(r.yearMarks).toEqual([]);
    expect(r.dateRange.min).toBe(TODAY - 3 * YEAR);
    expect(r.dateRange.max).toBe(TODAY + 3 * YEAR);
  });

  it("ignores undefined lifecycles and empty maps", () => {
    expect(computeTimelineRange([undefined, {}], TODAY).hasLifecycleData).toBe(false);
  });

  it("pads the observed span by a year on each side", () => {
    const r = computeTimelineRange(
      [{ active: "2020-01-01" }, { endOfLife: "2030-01-01" }],
      TODAY,
    );
    expect(r.hasLifecycleData).toBe(true);
    expect(r.dateRange.min).toBe(ms("2020-01-01") - YEAR);
    expect(r.dateRange.max).toBe(ms("2030-01-01") + YEAR);
  });

  it("emits one mark per January 1 inside the padded range", () => {
    const r = computeTimelineRange([{ active: "2024-06-01" }, { endOfLife: "2026-06-01" }], TODAY);
    expect(r.yearMarks.map((m) => m.label)).toEqual(["2024", "2025", "2026", "2027"]);
  });

  it("spans every phase key, not just active", () => {
    const r = computeTimelineRange([{ plan: "2019-03-01", phaseOut: "2028-09-01" }], TODAY);
    expect(r.dateRange.min).toBe(ms("2019-03-01") - YEAR);
    expect(r.dateRange.max).toBe(ms("2028-09-01") + YEAR);
  });

  it("skips unparseable dates", () => {
    expect(computeTimelineRange([{ active: "not-a-date" }], TODAY).hasLifecycleData).toBe(false);
  });
});

describe("classifyTimelineChange", () => {
  const future = ms("2028-01-01");

  it("flags a card that starts after today but before the target date as arriving", () => {
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, future)).toBe("arriving");
  });

  it("flags a card whose end of life is at or before the date as retired — whenever it retired", () => {
    // Retirement is a state, not a window: a card dead since 2015 is retired at
    // every later date, so a persisted retired card never pops back to normal.
    expect(
      classifyTimelineChange({ active: "2020-01-01", endOfLife: "2027-01-01" }, TODAY, future),
    ).toBe("retired");
    expect(
      classifyTimelineChange({ active: "2010-01-01", endOfLife: "2015-01-01" }, TODAY, future),
    ).toBe("retired");
    expect(
      classifyTimelineChange({ active: "2010-01-01", endOfLife: "2015-01-01" }, TODAY, TODAY),
    ).toBe("retired");
  });

  it("classifies retirement in the past too", () => {
    const past = ms("2020-01-01");
    expect(
      classifyTimelineChange({ active: "2010-01-01", endOfLife: "2015-01-01" }, TODAY, past),
    ).toBe("retired");
    // ...but not before the card actually retired.
    expect(
      classifyTimelineChange({ active: "2010-01-01", endOfLife: "2022-01-01" }, TODAY, past),
    ).toBeNull();
  });

  it("returns null for a card that is unchanged across the window", () => {
    expect(classifyTimelineChange({ active: "2020-01-01" }, TODAY, future)).toBeNull();
  });

  it("returns null for a card with no lifecycle dates", () => {
    expect(classifyTimelineChange(undefined, TODAY, future)).toBeNull();
    expect(classifyTimelineChange({}, TODAY, future)).toBeNull();
  });

  it("flags a card that has not started by the date as planned, at any date", () => {
    const past = ms("2020-01-01");
    // Not yet started at the viewed date — whether viewed from the past,
    // today, or a future date before its start.
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, past)).toBe("planned");
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, TODAY)).toBe("planned");
    expect(classifyTimelineChange({ active: "2035-01-01" }, TODAY, future)).toBe("planned");
    // Started by the viewed date: an in-window ARRIVAL, not a plan.
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, future)).toBe("arriving");
  });

  it("flags a card that both arrives and retires inside the window as retired", () => {
    // By the viewed date it is dead; the retired state wins.
    expect(
      classifyTimelineChange({ plan: "2027-01-01", endOfLife: "2027-06-01" }, TODAY, future),
    ).toBe("retired");
  });
});

describe("isVisibleAtDate", () => {
  const future = ms("2028-01-01");
  const PERSIST = { persistRetired: true, previewPlanned: false };
  const ALIVE_ONLY = { persistRetired: false, previewPlanned: false };
  const PREVIEW = { persistRetired: false, previewPlanned: true };

  it("hides a card that has not started by the date, unless previewed", () => {
    expect(isVisibleAtDate({ plan: "2035-01-01" }, future, PERSIST)).toBe(false);
    expect(isVisibleAtDate({ plan: "2035-01-01" }, future, ALIVE_ONLY)).toBe(false);
    // Preview shows it at any date before its start — past, today or future.
    expect(isVisibleAtDate({ plan: "2035-01-01" }, future, PREVIEW)).toBe(true);
    expect(isVisibleAtDate({ plan: "2035-01-01" }, TODAY, PREVIEW)).toBe(true);
    expect(isVisibleAtDate({ plan: "2035-01-01" }, ms("2020-01-01"), PREVIEW)).toBe(true);
  });

  it("shows a card that is alive on the date, either way", () => {
    expect(isVisibleAtDate({ active: "2020-01-01" }, future, ALIVE_ONLY)).toBe(true);
  });

  it("shows a card with no lifecycle at all", () => {
    expect(isVisibleAtDate(undefined, future, ALIVE_ONLY)).toBe(true);
    expect(isVisibleAtDate({}, future, ALIVE_ONLY)).toBe(true);
  });

  it("persists a retired card at ANY date after its retirement", () => {
    const lc = { active: "2010-01-01", endOfLife: "2015-01-01" };
    // Long after retirement, at today, and in the past — it stays.
    expect(isVisibleAtDate(lc, future, PERSIST)).toBe(true);
    expect(isVisibleAtDate(lc, TODAY, PERSIST)).toBe(true);
    expect(isVisibleAtDate(lc, ms("2016-01-01"), PERSIST)).toBe(true);
    // ...and disappears everywhere when persistence is off.
    expect(isVisibleAtDate(lc, future, ALIVE_ONLY)).toBe(false);
    expect(isVisibleAtDate(lc, TODAY, ALIVE_ONLY)).toBe(false);
  });

  it("treats a card with only end-phase dates as already started", () => {
    // The endoflife.date mass-link writes endOfLife alone; such a card exists
    // now and retires later — it must not be invisible until its death.
    const lc = { endOfLife: "2030-01-01" };
    expect(isVisibleAtDate(lc, TODAY, ALIVE_ONLY)).toBe(true);
    expect(isVisibleAtDate(lc, ms("2031-01-01"), ALIVE_ONLY)).toBe(false);
    expect(isVisibleAtDate(lc, ms("2031-01-01"), PERSIST)).toBe(true);
  });
});

describe("computeTimelineMilestones", () => {
  it("returns nothing for cards with no active or end-of-life date", () => {
    expect(computeTimelineMilestones([])).toEqual([]);
    expect(computeTimelineMilestones([undefined, {}, { active: "nope" }])).toEqual([]);
    // Plan and phase-in are milestones on paper, not changes to the landscape.
    expect(computeTimelineMilestones([{ plan: "2027-01-01", phaseIn: "2027-06-01" }])).toEqual([]);
  });

  it("marks a go-live at the active date", () => {
    expect(computeTimelineMilestones([{ active: "2027-06-01" }])).toEqual([
      { value: ms("2027-06-01"), activating: 1, disappearing: 0 },
    ]);
    // ...and only there, whatever else the card carries.
    expect(
      computeTimelineMilestones([{ plan: "2026-10-01", phaseIn: "2027-01-01", active: "2027-06-01" }]),
    ).toEqual([{ value: ms("2027-06-01"), activating: 1, disappearing: 0 }]);
  });

  it("marks the go-live of a card that carries every phase", () => {
    // The shape a planned-then-delivered card ends up with once someone fills
    // the lifecycle in by hand. Its retirement mark was never in doubt; the
    // arrival is the one that has to come with it.
    expect(
      computeTimelineMilestones([
        {
          plan: "2026-10-01",
          phaseIn: "2027-01-01",
          active: "2027-04-01",
          phaseOut: "2029-01-01",
          endOfLife: "2029-06-30",
        },
      ]),
    ).toEqual([
      { value: ms("2027-04-01"), activating: 1, disappearing: 0 },
      { value: ms("2029-06-30"), activating: 0, disappearing: 1 },
    ]);
  });

  it("marks both ends for a card that goes live and later retires", () => {
    expect(
      computeTimelineMilestones([{ active: "2020-01-01", endOfLife: "2030-01-01" }]),
    ).toEqual([
      { value: ms("2020-01-01"), activating: 1, disappearing: 0 },
      { value: ms("2030-01-01"), activating: 0, disappearing: 1 },
    ]);
  });

  it("marks the retirement of a card that carries no active date", () => {
    expect(computeTimelineMilestones([{ endOfLife: "2030-01-01" }])).toEqual([
      { value: ms("2030-01-01"), activating: 0, disappearing: 1 },
    ]);
  });

  it("ignores a card that is never alive", () => {
    expect(
      computeTimelineMilestones([{ active: "2020-01-01", endOfLife: "2019-01-01" }]),
    ).toEqual([]);
    expect(
      computeTimelineMilestones([{ active: "2020-01-01", endOfLife: "2020-01-01" }]),
    ).toEqual([]);
  });

  it("aggregates cards that change on the same date", () => {
    const result = computeTimelineMilestones([
      { active: "2025-01-01" },
      { active: "2025-01-01" },
      { active: "2010-01-01", endOfLife: "2025-01-01" },
    ]);
    expect(result).toContainEqual({
      value: ms("2025-01-01"),
      activating: 2,
      disappearing: 1,
    });
  });

  it("returns milestones sorted ascending", () => {
    const result = computeTimelineMilestones([
      { active: "2030-01-01" },
      { active: "2010-01-01" },
      { active: "2020-01-01" },
    ]);
    expect(result.map((m) => m.value)).toEqual([
      ms("2010-01-01"),
      ms("2020-01-01"),
      ms("2030-01-01"),
    ]);
  });
});

describe("computeImpactedIds", () => {
  const at = ms("2028-06-01");
  const nodes = [
    // Retires inside the today→date window.
    { id: "windowGone", lifecycle: { active: "2020-01-01", endOfLife: "2027-01-01" } },
    // Was already dead before today — history, not this transformation.
    { id: "longGone", lifecycle: { active: "2010-01-01", endOfLife: "2015-01-01" } },
    { id: "dependent", lifecycle: { active: "2020-01-01" } },
    { id: "other", lifecycle: { active: "2020-01-01" } },
    // Also retires in the window — retired cards are never themselves at risk.
    { id: "alsoGone", lifecycle: { active: "2020-01-01", endOfLife: "2028-01-01" } },
  ];
  const NONE_SHOWN = new Set<string>();

  it("flags survivors impacted by a hidden window-retiring card, either direction", () => {
    const impacted = computeImpactedIds(
      nodes,
      [
        { source: "windowGone", target: "dependent" },
        { source: "other", target: "windowGone" },
      ],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect([...impacted].sort()).toEqual(["dependent", "other"]);
  });

  it("does not badge when the retiring card is displayed — its ghost tells the story", () => {
    const impacted = computeImpactedIds(
      nodes,
      [{ source: "windowGone", target: "dependent" }],
      TODAY,
      at,
      new Set(["windowGone", "dependent"]),
    );
    expect(impacted.size).toBe(0);
  });

  it("ignores cards retired before today — a dependency lost years ago is history", () => {
    const impacted = computeImpactedIds(
      nodes,
      [{ source: "longGone", target: "dependent" }],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect(impacted.size).toBe(0);
  });

  it("never flags a card that is itself retired at the date", () => {
    const impacted = computeImpactedIds(
      nodes,
      [{ source: "windowGone", target: "alsoGone" }],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect(impacted.size).toBe(0);
  });

  it("flags nothing at today or in the past — no window, no transformation", () => {
    const edges = [{ source: "windowGone", target: "dependent" }];
    expect(computeImpactedIds(nodes, edges, TODAY, TODAY, NONE_SHOWN).size).toBe(0);
    expect(computeImpactedIds(nodes, edges, TODAY, ms("2020-01-01"), NONE_SHOWN).size).toBe(0);
  });

  it("ignores edges with an unknown endpoint", () => {
    const impacted = computeImpactedIds(
      nodes,
      [{ source: "windowGone", target: "elsewhere" }],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect(impacted.size).toBe(0);
  });
});

describe("cardsChangingBetween", () => {
  const CARDS = [
    { id: "live", name: "Zulu Workbench", lifecycle: { active: "2027-03-01" } },
    { id: "gone", name: "Alpha Mainframe", lifecycle: { active: "2010-01-01", endOfLife: "2027-03-01" } },
    { id: "both", name: "Bravo Bridge", lifecycle: { active: "2027-03-02", endOfLife: "2027-03-05" } },
    { id: "outside", name: "Charlie CRM", lifecycle: { active: "2029-01-01" } },
    { id: "stillborn", name: "Delta Ghost", lifecycle: { active: "2027-03-03", endOfLife: "2027-03-03" } },
    { id: "dateless", name: "Echo Unknown" },
  ];
  const FROM = ms("2027-03-01");
  const TO = ms("2027-03-05");

  it("names the cards going live and retiring inside the span", () => {
    const got = cardsChangingBetween(CARDS, FROM, TO);
    // "both" arrives AND retires inside this span, so it appears on each side:
    // going live first (ordered by name, so Bravo before Zulu), then retiring
    // (Alpha before Bravo).
    expect(got.map((c) => c.id)).toEqual(["both", "live", "gone", "both"]);
  });

  it("orders cards going live first, then by name", () => {
    const got = cardsChangingBetween(CARDS, ms("2027-03-01"), ms("2027-03-02"));
    expect(got.map((c) => c.kind)).toEqual(["activating", "activating", "disappearing"]);
    expect(got.slice(0, 2).map((c) => c.name)).toEqual(["Bravo Bridge", "Zulu Workbench"]);
  });

  it("lists a card that arrives and retires inside one span on both sides", () => {
    // The mark above counts it twice — one date for the arrival, one for the
    // retirement — so naming it once made the pills contradict the count they
    // spell out. Both entries carry the same id, so consumers must key by id
    // AND kind.
    const got = cardsChangingBetween(CARDS, ms("2027-03-02"), ms("2027-03-05"));
    const both = got.filter((c) => c.id === "both");
    expect(both.map((c) => c.kind)).toEqual(["activating", "disappearing"]);
    expect(both.every((c) => c.name === "Bravo Bridge")).toBe(true);
  });

  it("skips a card that never lived — it carries no mark either", () => {
    expect(cardsChangingBetween(CARDS, FROM, TO).some((c) => c.id === "stillborn")).toBe(false);
  });

  it("skips dates outside the span and cards with no lifecycle at all", () => {
    const ids = cardsChangingBetween(CARDS, FROM, TO).map((c) => c.id);
    expect(ids).not.toContain("outside");
    expect(ids).not.toContain("dateless");
  });

  it("names exactly what the mark at the same date counts", () => {
    const marks = computeTimelineMilestones(CARDS.map((c) => c.lifecycle));
    const mark = marks.find((m) => m.value === FROM)!;
    const named = cardsChangingBetween(CARDS, FROM, FROM);
    expect(named.filter((c) => c.kind === "activating")).toHaveLength(mark.activating);
    expect(named.filter((c) => c.kind === "disappearing")).toHaveLength(mark.disappearing);
  });

  it("names exactly what a MERGED mark counts, across its whole span", () => {
    // The invariant that matters once marks cluster: the pills under a merged
    // mark have to add up to the numbers on it, dual-change cards included.
    const marks = computeTimelineMilestones(CARDS.map((c) => c.lifecycle)).filter(
      (m) => m.value >= FROM && m.value <= TO,
    );
    const named = cardsChangingBetween(CARDS, FROM, TO);
    const sum = (k: "activating" | "disappearing") => marks.reduce((n, m) => n + m[k], 0);
    expect(named.filter((c) => c.kind === "activating")).toHaveLength(sum("activating"));
    expect(named.filter((c) => c.kind === "disappearing")).toHaveLength(sum("disappearing"));
  });
});
