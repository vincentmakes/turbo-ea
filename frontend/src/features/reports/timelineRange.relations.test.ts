/**
 * A relation's own dates in time travel: the slider's range, the transition
 * marks, the connection changes at a mark and the planned / ended visibility
 * rule. Every input is optional — without relation dates each helper returns
 * exactly what it returned before (the suites in `timelineRange.test.ts` run
 * unchanged against the same functions).
 */
import { describe, it, expect } from "vitest";
import {
  computeConnectionChanges,
  computeTimelineMilestones,
  computeTimelineRange,
  relationAtDate,
} from "./timelineRange";

const ms = (iso: string) => new Date(iso).getTime();
const YEAR = 365.25 * 86_400_000;
const TODAY = ms("2026-06-15");
const DAY = 86_400_000;

describe("computeTimelineRange with relation dates", () => {
  it("reaches a relation's active and end dates beyond the cards'", () => {
    const r = computeTimelineRange(
      [{ active: "2026-01-01" }],
      TODAY,
      [{ active: "2024-03-01", endOfLife: "2030-09-01" }],
    );
    expect(r.hasLifecycleData).toBe(true);
    expect(r.dateRange.min).toBe(ms("2024-03-01") - YEAR);
    expect(r.dateRange.max).toBe(ms("2030-09-01") + YEAR);
  });

  it("finds lifecycle data in relations alone", () => {
    const r = computeTimelineRange([undefined, {}], TODAY, [{ active: "2027-01-01" }]);
    expect(r.hasLifecycleData).toBe(true);
    expect(r.dateRange.min).toBe(ms("2027-01-01") - YEAR);
    expect(r.dateRange.max).toBe(ms("2027-01-01") + YEAR);
  });

  it("ignores a relation's plan date, as it does a card's", () => {
    const r = computeTimelineRange([], TODAY, [{ plan: "2020-01-01" }]);
    expect(r.hasLifecycleData).toBe(false);
  });

  it("never stretches the axis to a Plan / Phase In date without Active — relation or card alike", () => {
    const cards = [{ active: "2026-01-01" }, { plan: "2019-01-01", phaseIn: "2033-01-01" }];
    const withRelation = computeTimelineRange(cards, TODAY, [
      { plan: "2018-01-01", phaseIn: "2035-01-01" },
    ]);
    expect(withRelation).toEqual(computeTimelineRange([{ active: "2026-01-01" }], TODAY));
    expect(withRelation.dateRange).toEqual({
      min: ms("2026-01-01") - YEAR,
      max: ms("2026-01-01") + YEAR,
    });
  });

  it("is unchanged when no relation dates are passed", () => {
    const cards = [{ active: "2025-01-01", endOfLife: "2028-01-01" }];
    expect(computeTimelineRange(cards, TODAY, [])).toEqual(computeTimelineRange(cards, TODAY));
  });
});

describe("computeTimelineMilestones with relation dates", () => {
  it("counts a relation's start and end as linking / unlinking, apart from cards", () => {
    const m = computeTimelineMilestones(
      [{ active: "2027-01-01" }],
      [{ active: "2027-01-01", endOfLife: "2029-01-01" }, { active: "2028-01-01" }],
    );
    expect(m).toEqual([
      { value: ms("2027-01-01"), activating: 1, disappearing: 0, linking: 1, unlinking: 0 },
      { value: ms("2028-01-01"), activating: 0, disappearing: 0, linking: 1, unlinking: 0 },
      { value: ms("2029-01-01"), activating: 0, disappearing: 0, linking: 0, unlinking: 1 },
    ]);
  });

  it("skips a relation that ends at or before it starts", () => {
    expect(
      computeTimelineMilestones([], [{ active: "2027-01-01", endOfLife: "2027-01-01" }]),
    ).toEqual([]);
    expect(
      computeTimelineMilestones([], [{ active: "2027-01-01", endOfLife: "2026-01-01" }]),
    ).toEqual([]);
  });

  it("marks a relation ending a day after it starts", () => {
    const m = computeTimelineMilestones([], [{ active: "2027-01-01", endOfLife: "2027-01-02" }]);
    expect(m.map((x) => [x.linking, x.unlinking])).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it("ignores an undated relation and leaves the keys out without relation input", () => {
    expect(computeTimelineMilestones([], [undefined, {}])).toEqual([]);
    const cardsOnly = computeTimelineMilestones([{ active: "2027-01-01" }]);
    expect(cardsOnly).toEqual([{ value: ms("2027-01-01"), activating: 1, disappearing: 0 }]);
    expect("linking" in cardsOnly[0]).toBe(false);
    // Undated relations passed in change nothing either, keys included.
    expect(computeTimelineMilestones([{ active: "2027-01-01" }], [undefined, {}, { plan: "2026-01-01" }])).toEqual(cardsOnly);
  });

  it("gives a card's mark the relation keys once any relation marks a date", () => {
    const m = computeTimelineMilestones([{ active: "2027-01-01" }], [{ active: "2029-01-01" }]);
    expect(m[0]).toEqual({
      value: ms("2027-01-01"),
      activating: 1,
      disappearing: 0,
      linking: 0,
      unlinking: 0,
    });
  });
});

describe("computeConnectionChanges with relation dates", () => {
  const nodes = [
    { id: "org", lifecycle: {} },
    { id: "app", lifecycle: {} },
  ];
  const span = { from: ms("2027-01-01"), to: ms("2027-01-01") };

  it("gains both cards a connection on the day the relation starts", () => {
    const r = computeConnectionChanges(
      nodes,
      [{ source: "org", target: "app", lifecycle: { active: "2027-01-01" } }],
      span.from,
      span.to,
    );
    expect([...r.gained].sort()).toEqual(["app", "org"]);
    expect(r.lost.size).toBe(0);
  });

  it("loses both cards the connection on the day the relation ends", () => {
    const r = computeConnectionChanges(
      nodes,
      [{ source: "org", target: "app", lifecycle: { active: "2020-01-01", endOfLife: "2027-01-01" } }],
      span.from,
      span.to,
    );
    expect([...r.lost].sort()).toEqual(["app", "org"]);
    expect(r.gained.size).toBe(0);
  });

  it("says nothing on a day the relation neither starts nor ends", () => {
    const r = computeConnectionChanges(
      nodes,
      [{ source: "org", target: "app", lifecycle: { active: "2026-12-31", endOfLife: "2027-01-02" } }],
      span.from,
      span.to,
    );
    expect(r.gained.size + r.lost.size).toBe(0);
  });

  it("ignores a relation that is never in effect", () => {
    const r = computeConnectionChanges(
      nodes,
      [{ source: "org", target: "app", lifecycle: { active: "2027-01-01", endOfLife: "2027-01-01" } }],
      span.from,
      span.to,
    );
    expect(r.gained.size + r.lost.size).toBe(0);
  });

  it("does not credit an arriving neighbour through a relation not yet in effect", () => {
    const withNewcomer = [
      { id: "hub", lifecycle: {} },
      { id: "new", lifecycle: { active: "2027-01-01" } },
    ];
    const planned = computeConnectionChanges(
      withNewcomer,
      [{ source: "hub", target: "new", lifecycle: { active: "2028-01-01" } }],
      span.from,
      span.to,
    );
    expect(planned.gained.size).toBe(0);
    const inEffect = computeConnectionChanges(
      withNewcomer,
      [{ source: "hub", target: "new", lifecycle: { active: "2027-01-01" } }],
      span.from,
      span.to,
    );
    expect([...inEffect.gained]).toEqual(["hub"]);
  });

  it("does not charge a retiring neighbour through a relation already ended", () => {
    const withLeaver = [
      { id: "hub", lifecycle: {} },
      { id: "old", lifecycle: { endOfLife: "2027-01-01" } },
    ];
    const ended = computeConnectionChanges(
      withLeaver,
      [{ source: "hub", target: "old", lifecycle: { endOfLife: "2026-12-31" } }],
      span.from,
      span.to,
    );
    expect(ended.lost.size).toBe(0);
    // Still in effect the day before the neighbour retires: that is a loss.
    const live = computeConnectionChanges(
      withLeaver,
      [{ source: "hub", target: "old", lifecycle: { endOfLife: "2027-01-02" } }],
      span.from,
      span.to,
    );
    expect([...live.lost]).toEqual(["hub"]);
  });

  it("does not mark a card the relation runs to when that card is itself moving", () => {
    const r = computeConnectionChanges(
      [
        { id: "org", lifecycle: {} },
        { id: "app", lifecycle: { active: "2027-01-01" } },
      ],
      [{ source: "org", target: "app", lifecycle: { active: "2027-01-01" } }],
      span.from,
      span.to,
    );
    // The arriving app says so itself; only the org that stays is marked.
    expect([...r.gained]).toEqual(["org"]);
  });

  it("does not mark a relation to a card missing from the graph", () => {
    const r = computeConnectionChanges(
      [{ id: "org", lifecycle: {} }],
      [{ source: "org", target: "gone", lifecycle: { active: "2027-01-01" } }],
      span.from,
      span.to,
    );
    expect(r.gained.size).toBe(0);
  });

  it("moves a card a relation brings into the view like one going live", () => {
    // `app` is alive throughout, but arrives in the centred view on the day the
    // relation from `org` starts: `org` gains the connection, `app` carries no
    // mark of its own — it says so by arriving.
    const r = computeConnectionChanges(
      nodes,
      [{ source: "org", target: "app", lifecycle: { active: "2027-01-01" } }],
      span.from,
      span.to,
      { arriving: new Map([["app", span.from]]), leaving: new Map() },
    );
    expect([...r.gained]).toEqual(["org"]);
    expect(r.lost.size).toBe(0);
  });

  it("moves a card whose last path ends like one retiring", () => {
    const r = computeConnectionChanges(
      nodes,
      [{ source: "org", target: "app", lifecycle: { endOfLife: "2027-01-01" } }],
      span.from,
      span.to,
      { arriving: new Map(), leaving: new Map([["app", span.from]]) },
    );
    expect([...r.lost]).toEqual(["org"]);
    expect(r.gained.size).toBe(0);
  });

  it("loses a leaving card's connection only through a relation in effect the day before", () => {
    const r = computeConnectionChanges(
      [...nodes, { id: "hub", lifecycle: {} }],
      [
        { source: "org", target: "app", lifecycle: { endOfLife: "2026-01-01" } },
        { source: "hub", target: "app" },
      ],
      span.from,
      span.to,
      { arriving: new Map(), leaving: new Map([["app", span.from]]) },
    );
    expect([...r.lost]).toEqual(["hub"]);
  });

  it("prefers the card's own end of life inside the span to the move's date", () => {
    const r = computeConnectionChanges(
      [
        { id: "org", lifecycle: {} },
        { id: "app", lifecycle: { endOfLife: "2027-01-01" } },
      ],
      [{ source: "org", target: "app", lifecycle: { active: "2026-06-01" } }],
      span.from - DAY,
      span.to,
      // A move dated before the relation started would lose nothing.
      { arriving: new Map(), leaving: new Map([["app", ms("2026-01-01")]]) },
    );
    expect([...r.lost]).toEqual(["org"]);
  });

  it("reads an undated edge exactly as before", () => {
    const r = computeConnectionChanges(
      [
        { id: "hub", lifecycle: {} },
        { id: "new", lifecycle: { active: "2027-01-01" } },
      ],
      [{ source: "hub", target: "new" }],
      span.from - DAY,
      span.to,
    );
    expect([...r.gained]).toEqual(["hub"]);
  });
});

describe("relationAtDate", () => {
  const at = ms("2027-06-01");
  const both = { persistRetired: true, previewPlanned: true };
  const neither = { persistRetired: false, previewPlanned: false };

  it("draws a relation in effect plainly, whatever the toggles", () => {
    expect(relationAtDate({ active: "2027-01-01" }, at, neither)).toEqual({ visible: true });
    expect(relationAtDate(undefined, at, neither)).toEqual({ visible: true });
  });

  it("follows preview planned for one not started", () => {
    const lc = { plan: "2026-01-01", active: "2027-06-02" };
    expect(relationAtDate(lc, at, { ...neither, previewPlanned: true })).toEqual({
      visible: true,
      state: "planned",
    });
    expect(relationAtDate(lc, at, { ...both, previewPlanned: false })).toEqual({
      visible: false,
      state: "planned",
    });
  });

  it("is in effect from its active day itself", () => {
    expect(relationAtDate({ active: "2027-06-01" }, at, neither)).toEqual({ visible: true });
  });

  it("follows keep retired for one ended, from its end day itself", () => {
    const lc = { active: "2020-01-01", endOfLife: "2027-06-01" };
    expect(relationAtDate(lc, at, { ...neither, persistRetired: true })).toEqual({
      visible: true,
      state: "ended",
    });
    expect(relationAtDate(lc, at, { ...both, persistRetired: false })).toEqual({
      visible: false,
      state: "ended",
    });
    expect(relationAtDate({ endOfLife: "2027-06-02" }, at, neither)).toEqual({ visible: true });
  });
});
