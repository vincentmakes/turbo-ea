import { describe, it, expect } from "vitest";
import {
  classifyTimelineChange,
  computeAtRiskIds,
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
  it("returns nothing for cards with no lifecycle dates", () => {
    expect(computeTimelineMilestones([])).toEqual([]);
    expect(computeTimelineMilestones([undefined, {}, { active: "nope" }])).toEqual([]);
  });

  it("marks an arrival at the earliest START-phase date only", () => {
    expect(computeTimelineMilestones([{ plan: "2027-01-01" }])).toEqual([
      { value: ms("2027-01-01"), appearing: 1, activating: 0, disappearing: 0 },
    ]);
    // phaseOut is not a birthday candidate.
    expect(computeTimelineMilestones([{ phaseOut: "2023-01-01", active: "2024-01-01" }])).toEqual([
      { value: ms("2024-01-01"), appearing: 1, activating: 0, disappearing: 0 },
    ]);
  });

  it("marks only the retirement for a card with an endOfLife and no start dates", () => {
    // Such a card (the endoflife.date mass-link shape) is always present until
    // it dies — so its death is a transition, its (nonexistent) birth is not.
    expect(computeTimelineMilestones([{ endOfLife: "2030-01-01" }])).toEqual([
      { value: ms("2030-01-01"), appearing: 0, activating: 0, disappearing: 1 },
    ]);
  });

  it("marks both ends for a card with a start and an end of life", () => {
    expect(
      computeTimelineMilestones([{ active: "2020-01-01", endOfLife: "2030-01-01" }]),
    ).toEqual([
      { value: ms("2020-01-01"), appearing: 1, activating: 0, disappearing: 0 },
      { value: ms("2030-01-01"), appearing: 0, activating: 0, disappearing: 1 },
    ]);
  });

  it("ignores a card that is never alive", () => {
    // End of life on or before its start date: it was never in the landscape,
    // so marking an arrival and a departure would both be lies.
    expect(
      computeTimelineMilestones([{ active: "2020-01-01", endOfLife: "2019-01-01" }]),
    ).toEqual([]);
    expect(
      computeTimelineMilestones([{ active: "2020-01-01", endOfLife: "2020-01-01" }]),
    ).toEqual([]);
  });

  it("marks a go-live when the active date follows the appearing date", () => {
    expect(
      computeTimelineMilestones([{ plan: "2026-10-01", active: "2027-06-01" }]),
    ).toEqual([
      { value: ms("2026-10-01"), appearing: 1, activating: 0, disappearing: 0 },
      { value: ms("2027-06-01"), appearing: 0, activating: 1, disappearing: 0 },
    ]);
  });

  it("does not double-mark a card whose active date IS its earliest date", () => {
    expect(computeTimelineMilestones([{ active: "2027-06-01" }])).toEqual([
      { value: ms("2027-06-01"), appearing: 1, activating: 0, disappearing: 0 },
    ]);
  });

  it("skips a go-live at or after the card's end of life", () => {
    // Data noise: an active date the card never reaches must not mark.
    expect(
      computeTimelineMilestones([
        { plan: "2026-01-01", active: "2028-01-01", endOfLife: "2027-06-01" },
      ]),
    ).toEqual([
      { value: ms("2026-01-01"), appearing: 1, activating: 0, disappearing: 0 },
      { value: ms("2027-06-01"), appearing: 0, activating: 0, disappearing: 1 },
    ]);
  });

  it("aggregates cards that change on the same date", () => {
    const result = computeTimelineMilestones([
      { active: "2025-01-01" },
      { active: "2025-01-01" },
      { active: "2010-01-01", endOfLife: "2025-01-01" },
    ]);
    expect(result).toContainEqual({ value: ms("2025-01-01"), appearing: 2, activating: 0, disappearing: 1 });
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

describe("computeAtRiskIds", () => {
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

  it("flags survivors linked to a hidden window-retiring card, either direction", () => {
    const atRisk = computeAtRiskIds(
      nodes,
      [
        { source: "windowGone", target: "dependent" },
        { source: "other", target: "windowGone" },
      ],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect([...atRisk].sort()).toEqual(["dependent", "other"]);
  });

  it("does not badge when the retiring card is displayed — its ghost tells the story", () => {
    const atRisk = computeAtRiskIds(
      nodes,
      [{ source: "windowGone", target: "dependent" }],
      TODAY,
      at,
      new Set(["windowGone", "dependent"]),
    );
    expect(atRisk.size).toBe(0);
  });

  it("ignores cards retired before today — a dependency lost years ago is history", () => {
    const atRisk = computeAtRiskIds(
      nodes,
      [{ source: "longGone", target: "dependent" }],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect(atRisk.size).toBe(0);
  });

  it("never flags a card that is itself retired at the date", () => {
    const atRisk = computeAtRiskIds(
      nodes,
      [{ source: "windowGone", target: "alsoGone" }],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect(atRisk.size).toBe(0);
  });

  it("flags nothing at today or in the past — no window, no transformation", () => {
    const edges = [{ source: "windowGone", target: "dependent" }];
    expect(computeAtRiskIds(nodes, edges, TODAY, TODAY, NONE_SHOWN).size).toBe(0);
    expect(computeAtRiskIds(nodes, edges, TODAY, ms("2020-01-01"), NONE_SHOWN).size).toBe(0);
  });

  it("ignores edges with an unknown endpoint", () => {
    const atRisk = computeAtRiskIds(
      nodes,
      [{ source: "windowGone", target: "elsewhere" }],
      TODAY,
      at,
      NONE_SHOWN,
    );
    expect(atRisk.size).toBe(0);
  });
});
