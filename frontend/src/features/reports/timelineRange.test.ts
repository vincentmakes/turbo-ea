import { describe, it, expect } from "vitest";
import {
  cardsChangingBetween,
  classifyTimelineChange,
  computeConnectionChanges,
  computeTimelineMilestones,
  computeTimelineRange,
  isPresentAtDate,
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

  it("is bounded by go-live and end of life, not by every phase key", () => {
    // A phase-out date changes nothing on the canvas and carries no mark, so
    // letting it bound the axis only bought empty labelled years of dead track.
    const r = computeTimelineRange(
      [{ plan: "2019-03-01", active: "2020-01-01", phaseOut: "2028-09-01" }],
      TODAY,
    );
    expect(r.dateRange.min).toBe(ms("2020-01-01") - YEAR);
    expect(r.dateRange.max).toBe(ms("2020-01-01") + YEAR);
  });

  it("carries no timeline when nothing can change the view", () => {
    // Nothing reads plan / phaseIn / phaseOut, so such a landscape looks
    // identical at every date and the slider is hidden entirely.
    expect(computeTimelineRange([{ phaseOut: "2028-09-01" }], TODAY).hasLifecycleData).toBe(false);
    expect(
      computeTimelineRange([{ plan: "2019-03-01", phaseIn: "2019-09-01" }], TODAY)
        .hasLifecycleData,
    ).toBe(false);
  });

  it("stops the axis a year after the last real change", () => {
    // The reported shape: a phase-out date years past the last go-live or
    // retirement used to stretch the axis into 2033/2034.
    const r = computeTimelineRange(
      [{ active: "2018-01-01", endOfLife: "2031-01-01", phaseOut: "2033-06-01" }],
      TODAY,
    );
    const labels = r.yearMarks.map((m) => m.label);
    expect(labels.at(-1)).toBe("2032");
    expect(labels).not.toContain("2033");
    expect(labels).not.toContain("2034");
  });

  it("skips unparseable dates", () => {
    expect(computeTimelineRange([{ active: "not-a-date" }], TODAY).hasLifecycleData).toBe(false);
  });
});

describe("computeTimelineRange contains computeTimelineMilestones", () => {
  // The slider drops any milestone outside the range it was given
  // (`useMilestoneClusters` filters on it), and a dropped milestone renders as
  // a mark that is simply missing — silently. So the two must be kept in step:
  // sweep every combination of the five phases against a fixed date pool.
  const PHASES = ["plan", "phaseIn", "active", "phaseOut", "endOfLife"] as const;
  const POOL = ["2012-04-01", "2018-01-01", "2024-09-15", "2031-06-30", "2040-12-01"];

  it("never places a milestone outside the axis", () => {
    for (let mask = 0; mask < 1 << PHASES.length; mask++) {
      for (let rotation = 0; rotation < POOL.length; rotation++) {
        const lc: Record<string, string> = {};
        PHASES.forEach((p, i) => {
          if (mask & (1 << i)) lc[p] = POOL[(i + rotation) % POOL.length];
        });
        const lifecycles = [lc];
        const { dateRange, hasLifecycleData, yearMarks } = computeTimelineRange(
          lifecycles,
          TODAY,
        );
        const milestones = computeTimelineMilestones(lifecycles);

        for (const m of milestones) {
          expect(m.value).toBeGreaterThanOrEqual(dateRange.min);
          expect(m.value).toBeLessThanOrEqual(dateRange.max);
        }
        // No axis means nothing can change, so there is nothing to mark.
        if (!hasLifecycleData) expect(milestones).toEqual([]);
        expect(dateRange.min).toBeLessThan(dateRange.max);
        if (hasLifecycleData) {
          expect(yearMarks.length).toBeGreaterThan(0);
          for (let i = 1; i < yearMarks.length; i++)
            expect(yearMarks[i].value).toBeGreaterThan(yearMarks[i - 1].value);
        }
      }
    }
  });
});

describe("classifyTimelineChange", () => {
  const future = ms("2028-01-01");

  it("flags a card that goes live after today but before the target date as arriving", () => {
    expect(classifyTimelineChange({ active: "2027-01-01" }, TODAY, future)).toBe("arriving");
    // The go-live date is what counts, not an earlier plan: the card arrives
    // on the date its mark sits on.
    expect(
      classifyTimelineChange({ plan: "2020-01-01", active: "2027-01-01" }, TODAY, future),
    ).toBe("arriving");
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
    expect(classifyTimelineChange({ active: "2027-01-01" }, TODAY, past)).toBe("planned");
    expect(classifyTimelineChange({ active: "2027-01-01" }, TODAY, TODAY)).toBe("planned");
    expect(classifyTimelineChange({ active: "2035-01-01" }, TODAY, future)).toBe("planned");
    // Live by the viewed date: an in-window ARRIVAL, not a plan.
    expect(classifyTimelineChange({ active: "2027-01-01" }, TODAY, future)).toBe("arriving");
    // No go-live date at all: it never entered the landscape, so it is planned
    // at every date rather than arriving at whichever phase date came first.
    expect(classifyTimelineChange({ plan: "2027-01-01" }, TODAY, future)).toBe("planned");
    expect(classifyTimelineChange({ plan: "2020-01-01" }, TODAY, future)).toBe("planned");
  });

  it("flags a card that both arrives and retires inside the window as retired", () => {
    // By the viewed date it is dead; the retired state wins.
    expect(
      classifyTimelineChange({ plan: "2027-01-01", endOfLife: "2027-06-01" }, TODAY, future),
    ).toBe("retired");
  });
});

describe("isPresentAtDate", () => {
  it("counts an unchanged card and an arrived one as part of the landscape", () => {
    // Nothing to say about a card that is simply there: time travel draws the
    // state as it will be, and what arrived is the timeline's job to report.
    expect(isPresentAtDate(undefined)).toBe(true);
    expect(isPresentAtDate(null)).toBe(true);
    expect(isPresentAtDate("arriving")).toBe(true);
  });

  it("counts a retired or not-yet-live card as absent", () => {
    // These are drawn DESPITE not being in the landscape at the viewed date —
    // kept by persistRetired / previewPlanned — so they are ghosted and badged.
    expect(isPresentAtDate("retired")).toBe(false);
    expect(isPresentAtDate("planned")).toBe(false);
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

describe("computeConnectionChanges", () => {
  // A mark spanning the first week of 2028.
  const FROM = ms("2028-01-01");
  const TO = ms("2028-01-07");
  const nodes = [
    // Retires inside the mark's span, and goes live inside it.
    { id: "goesHere", lifecycle: { active: "2020-01-01", endOfLife: "2028-01-03" } },
    { id: "arrivesHere", lifecycle: { active: "2028-01-04" } },
    // Changes outside the span: their own marks, not this one.
    { id: "goneEarlier", lifecycle: { active: "2010-01-01", endOfLife: "2015-01-01" } },
    { id: "goesLater", lifecycle: { active: "2020-01-01", endOfLife: "2030-01-01" } },
    // Bystanders: here throughout.
    { id: "dependent", lifecycle: { active: "2020-01-01" } },
    { id: "other", lifecycle: { active: "2020-01-01" } },
    // Alive back in 2015, so it can be a bystander at a mark in the past.
    { id: "oldTimer", lifecycle: { active: "2005-01-01" } },
  ];

  it("marks a bystander that loses a connection, either edge direction", () => {
    const a = computeConnectionChanges(nodes, [{ source: "goesHere", target: "dependent" }], FROM, TO);
    expect([...a.lost]).toEqual(["dependent"]);
    expect(a.gained.size).toBe(0);

    const b = computeConnectionChanges(nodes, [{ source: "other", target: "goesHere" }], FROM, TO);
    expect([...b.lost]).toEqual(["other"]);
  });

  it("marks a bystander that gains a connection when a neighbour goes live", () => {
    // The half that never existed: an arrival hands its neighbours a connection
    // exactly as a retirement takes one away.
    const r = computeConnectionChanges(
      nodes,
      [{ source: "arrivesHere", target: "dependent" }],
      FROM,
      TO,
    );
    expect([...r.gained]).toEqual(["dependent"]);
    expect(r.lost.size).toBe(0);
  });

  it("marks a card on both sides when it gains and loses at the same mark", () => {
    const r = computeConnectionChanges(
      nodes,
      [
        { source: "arrivesHere", target: "dependent" },
        { source: "goesHere", target: "dependent" },
      ],
      FROM,
      TO,
    );
    expect([...r.gained]).toEqual(["dependent"]);
    expect([...r.lost]).toEqual(["dependent"]);
  });

  it("never marks the card that is itself coming or going", () => {
    // The change belongs to the neighbour that stays; the mover says so itself
    // by appearing, or by being ghosted.
    const r = computeConnectionChanges(
      nodes,
      [{ source: "arrivesHere", target: "goesHere" }],
      FROM,
      TO,
    );
    expect(r.gained.size).toBe(0);
    expect(r.lost.size).toBe(0);
  });

  it("ignores changes outside the mark's span, before or after", () => {
    // The regression this exists for: scoped to today→viewed-date, a mark once
    // earned was earned at every later date and never expired.
    const before = computeConnectionChanges(
      nodes,
      [{ source: "goneEarlier", target: "dependent" }],
      FROM,
      TO,
    );
    expect(before.lost.size + before.gained.size).toBe(0);
    const after = computeConnectionChanges(
      nodes,
      [{ source: "goesLater", target: "dependent" }],
      FROM,
      TO,
    );
    expect(after.lost.size + after.gained.size).toBe(0);
    // ...and that card's own mark, later on, does mark it.
    const later = ms("2030-01-01");
    expect([
      ...computeConnectionChanges(nodes, [{ source: "goesLater", target: "dependent" }], later, later)
        .lost,
    ]).toEqual(["dependent"]);
  });

  it("marks at a mark in the past too", () => {
    // A retirement in 2015 is as real a change as one in 2030, and carries a
    // mark either way; the old forward-only guard hid it.
    const at = ms("2015-01-01");
    expect([
      ...computeConnectionChanges(nodes, [{ source: "goneEarlier", target: "oldTimer" }], at, at)
        .lost,
    ]).toEqual(["oldTimer"]);
    // ...but a card that does not exist yet at that date cannot lose anything.
    expect(
      computeConnectionChanges(nodes, [{ source: "goneEarlier", target: "dependent" }], at, at).lost
        .size,
    ).toBe(0);
  });

  it("never marks a card that is gone by the end of the span", () => {
    const r = computeConnectionChanges(
      nodes,
      [{ source: "arrivesHere", target: "goneEarlier" }],
      FROM,
      TO,
    );
    expect(r.gained.size).toBe(0);
  });

  it("ignores unknown endpoints and inverted spans", () => {
    const unknown = computeConnectionChanges(
      nodes,
      [{ source: "goesHere", target: "elsewhere" }],
      FROM,
      TO,
    );
    expect(unknown.lost.size + unknown.gained.size).toBe(0);

    const inverted = computeConnectionChanges(
      nodes,
      [{ source: "goesHere", target: "dependent" }],
      TO,
      FROM,
    );
    expect(inverted.lost.size + inverted.gained.size).toBe(0);
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
