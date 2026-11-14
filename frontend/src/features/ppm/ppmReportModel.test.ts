import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alpha } from "@mui/material/styles";
import { RAG_COLORS } from "@/theme/tokens";
import type { PpmRisk, PpmTask, PpmWbs } from "@/types";
import {
  HEAT_STEPS,
  MATRIX_IMPACTS,
  MATRIX_LEGEND_BANDS,
  MATRIX_PROBABILITIES,
  REPORT_EXPORT_ROWS,
  REPORT_PREFS_KEY,
  REPORT_SECTIONS,
  exportableSections,
  heatMapCounts,
  loadReportSections,
  milestonePosition,
  orderedSections,
  pairFigures,
  riskBandSwatch,
  riskMatrixCellColor,
  riskMatrixCounts,
  riskStatusCounts,
  saveReportSections,
  scheduleRows,
  taskSpan,
  timelineModel,
  timelinePosition,
  wbsSpan,
} from "./ppmReportModel";

const wbs = (o: Partial<PpmWbs> = {}): PpmWbs => ({
  id: "w",
  initiative_id: "i1",
  parent_id: null,
  title: "Package",
  description: null,
  start_date: "2026-01-05",
  end_date: "2026-02-05",
  sort_order: 0,
  is_milestone: false,
  completion: 42,
  assignee_id: null,
  assignee_name: null,
  progress: 0,
  task_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...o,
});

const task = (o: Partial<PpmTask> = {}): PpmTask => ({
  id: "t",
  initiative_id: "i1",
  title: "Task",
  description: null,
  status: "in_progress",
  priority: "high",
  assignee_id: null,
  assignee_name: null,
  start_date: "2026-01-10",
  due_date: "2026-01-20",
  sort_order: 0,
  tags: [],
  wbs_id: null,
  comment_count: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...o,
});

describe("sections and the remembered choice", () => {
  const ALL = ["overview", "reports", "costs", "risks", "schedule"];

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("lists the five sections in report order under the report's own key", () => {
    expect(REPORT_SECTIONS).toEqual(ALL);
    expect(REPORT_PREFS_KEY).toBe("turboea.ppm.projectReport.prefs");
  });

  it("keeps known names in report order, once each", () => {
    expect(orderedSections(["risks", "x", "overview", "risks", 3])).toEqual(["overview", "risks"]);
    expect(orderedSections([])).toEqual([]);
  });

  it("means every section when nothing is stored", () => {
    expect(loadReportSections()).toEqual(ALL);
  });

  it.each([
    ["garbage", "{not json"],
    ["an object", JSON.stringify({ sections: ["risks"] })],
    ["an empty list", "[]"],
    ["only unknown names", JSON.stringify(["nope", 3, null])],
    ["null", "null"],
    ["a string", JSON.stringify("risks")],
  ])("means every section for %s", (_label, raw) => {
    localStorage.setItem(REPORT_PREFS_KEY, raw);
    expect(loadReportSections()).toEqual(ALL);
  });

  it("drops unknown names and non-strings and returns report order", () => {
    localStorage.setItem(REPORT_PREFS_KEY, JSON.stringify(["schedule", 7, "nope", "reports"]));
    expect(loadReportSections()).toEqual(["reports", "schedule"]);
  });

  it("round-trips a choice in report order", () => {
    saveReportSections(["risks", "overview", "bogus"]);
    expect(localStorage.getItem(REPORT_PREFS_KEY)).toBe('["overview","risks"]');
    expect(loadReportSections()).toEqual(["overview", "risks"]);
  });

  it("hands each caller a fresh list", () => {
    const a = loadReportSections();
    a.pop();
    expect(loadReportSections()).toEqual(ALL);
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => saveReportSections(["risks"])).not.toThrow();
    expect(loadReportSections()).toEqual(ALL);
  });
});

describe("exportableSections", () => {
  const FULL = { reports: 2, costLines: 4, risks: 1, scheduleItems: 3 };

  it("keeps every shown section with something to show, in report order", () => {
    expect(exportableSections(["schedule", "overview", "risks", "costs", "reports"], FULL)).toEqual([
      ...REPORT_SECTIONS,
    ]);
    expect(exportableSections(["risks", "costs"], FULL)).toEqual(["costs", "risks"]);
    expect(exportableSections([], FULL)).toEqual([]);
  });

  it("leaves out the sections the page shows as nothing recorded or a failed read", () => {
    const none = { reports: 0, costLines: 0, risks: 0, scheduleItems: 0 };
    expect(exportableSections([...REPORT_SECTIONS], none)).toEqual(["overview"]);
    expect(exportableSections(["schedule"], { ...FULL, scheduleItems: null })).toEqual([]);
    const one = { reports: 1, costLines: 1, risks: 1, scheduleItems: 1 };
    expect(exportableSections(["reports", "costs", "risks", "schedule"], one)).toEqual([
      "reports",
      "costs",
      "risks",
      "schedule",
    ]);
  });

  it("cuts slides between marked blocks and table rows", () => {
    expect(REPORT_EXPORT_ROWS).toBe("[data-export-row], [data-export-keep], tbody > tr, tfoot > tr");
  });
});

describe("pairFigures", () => {
  it("formats both figures of a pair in one scale, as the bar caption does", () => {
    // 4,350,000 reads 4.3 in the bar caption; the figure beside it must not say 4.4.
    expect(pairFigures(2_520_000, 4_350_000, "USD")).toEqual({
      actual: "2.5 MUSD",
      budget: "4.3 MUSD",
    });
    expect(pairFigures(4_350_000, 4_350_000, "USD")).toEqual({
      actual: "4.3 MUSD",
      budget: "4.3 MUSD",
    });
    expect(pairFigures(653_000, 1_350_000, "USD")).toEqual({
      actual: "0.7 MUSD",
      budget: "1.4 MUSD",
    });
    expect(pairFigures(578_000, 900_000, "CHF")).toEqual({ actual: "578 kCHF", budget: "900 kCHF" });
    expect(pairFigures(40, 50, "USD")).toEqual({ actual: "40 USD", budget: "50 USD" });
  });
});

describe("risk heat map", () => {
  const risk = (probability: number, impact: number, status = "open"): PpmRisk =>
    ({
      id: `${probability}-${impact}`,
      probability,
      impact,
      risk_score: probability * impact,
      status,
    }) as PpmRisk;

  it("counts risks into their probability × impact cell, ignoring off-grid ones", () => {
    const counts = heatMapCounts([
      risk(4, 5),
      risk(4, 5),
      risk(1, 1),
      risk(5, 2),
      risk(5, 5),
      risk(0, 3),
      risk(6, 1),
      risk(2.5, 2),
      risk(3, 0),
      risk(3, 6),
      risk(3, 1.5),
    ]);
    expect(counts[3][4]).toBe(2);
    expect(counts[0][0]).toBe(1);
    expect(counts[4][1]).toBe(1);
    expect(counts[4][4]).toBe(1);
    expect(counts.flat().reduce((a, b) => a + b, 0)).toBe(5);
    expect(counts).toHaveLength(5);
    for (const row of counts) expect(row).toHaveLength(5);
    // An off-grid impact writes nowhere, not even beside a row's five cells.
    for (const row of counts) expect(Object.keys(row)).toEqual(["0", "1", "2", "3", "4"]);
    expect(counts).toStrictEqual([
      [1, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 2],
      [0, 1, 0, 0, 1],
    ]);
    expect(HEAT_STEPS).toEqual([1, 2, 3, 4, 5]);
  });

  it("runs both axes 5 down to 1, the register's most-severe-first reading", () => {
    expect(MATRIX_PROBABILITIES).toEqual([5, 4, 3, 2, 1]);
    expect(MATRIX_IMPACTS).toEqual([5, 4, 3, 2, 1]);
  });

  it("puts the counts in display order: top-left is probability 5, impact 5", () => {
    const m = riskMatrixCounts([risk(5, 5), risk(4, 1), risk(4, 1), risk(1, 2)]);
    expect(m[0][0]).toBe(1); // p5 i5
    expect(m[1][4]).toBe(2); // p4 i1
    expect(m[4][3]).toBe(1); // p1 i2
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(4);
    expect(riskMatrixCounts([])).toEqual(MATRIX_PROBABILITIES.map(() => [0, 0, 0, 0, 0]));
  });

  it("tints a cell by the band of p × i at the GRC matrix's strengths, edges at 5, 6 and 15", () => {
    expect(riskMatrixCellColor(1, 5)).toBe(alpha(RAG_COLORS.green, 0.18)); // 5 low
    expect(riskMatrixCellColor(2, 3)).toBe(alpha(RAG_COLORS.amber, 0.24)); // 6 medium
    expect(riskMatrixCellColor(3, 4)).toBe(alpha(RAG_COLORS.amber, 0.24)); // 12 medium
    expect(riskMatrixCellColor(3, 5)).toBe(alpha(RAG_COLORS.red, 0.28)); // 15 high
    expect(riskMatrixCellColor(1, 1)).toBe(alpha(RAG_COLORS.green, 0.18));
  });

  it("lists the three bands highest first, with the legend's swatches", () => {
    expect(MATRIX_LEGEND_BANDS).toEqual(["high", "medium", "low"]);
    expect(riskBandSwatch("high")).toBe(alpha(RAG_COLORS.red, 0.7));
    expect(riskBandSwatch("medium")).toBe(alpha(RAG_COLORS.amber, 0.7));
    expect(riskBandSwatch("low")).toBe(alpha(RAG_COLORS.green, 0.6));
  });

  it("counts risks per status in the tab's order, unknown statuses in none", () => {
    expect(
      riskStatusCounts([risk(1, 1, "open"), risk(1, 1, "open"), risk(1, 1, "closed"), risk(1, 1, "parked")]),
    ).toEqual([
      { status: "open", count: 2 },
      { status: "mitigating", count: 0 },
      { status: "mitigated", count: 0 },
      { status: "closed", count: 1 },
      { status: "accepted", count: 0 },
    ]);
  });
});

describe("scheduleRows", () => {
  const W = [
    wbs({ id: "w2", title: "Second root", sort_order: 2 }),
    wbs({ id: "w1", title: "First root", sort_order: 1 }),
    wbs({ id: "w1b", parent_id: "w1", title: "Child B", sort_order: 5 }),
    wbs({ id: "w1a", parent_id: "w1", title: "Child A", sort_order: 3 }),
    wbs({ id: "orphan", parent_id: "gone", title: "Orphan", sort_order: 9 }),
  ];
  const T = [
    task({ id: "t2", wbs_id: "w1", title: "Task two", sort_order: 2 }),
    task({ id: "t1", wbs_id: "w1", title: "Task one", sort_order: 1 }),
    task({ id: "t3", wbs_id: "w1a", title: "Deep task" }),
    task({ id: "t5", wbs_id: null, title: "Loose B", sort_order: 2 }),
    task({ id: "t4", wbs_id: "missing", title: "Loose A", sort_order: 1 }),
  ];

  it("nests depth first: packages in sort order, each one's tasks, then its child packages", () => {
    const { rows } = scheduleRows(W, T);
    expect(rows.map((r) => `${r.kind}:${r.item.id}:${r.depth}`)).toEqual([
      "wbs:w1:0",
      "task:t1:1",
      "task:t2:1",
      "wbs:w1a:1",
      "task:t3:2",
      "wbs:w1b:1",
      "wbs:w2:0",
      "wbs:orphan:0",
    ]);
  });

  it("returns tasks with no package or an unknown one apart, in sort order", () => {
    const { unassigned } = scheduleRows(W, T);
    expect(unassigned.map((t) => t.id)).toEqual(["t4", "t5"]);
  });

  it("leaves its inputs alone", () => {
    const w = [...W];
    const t = [...T];
    scheduleRows(w, t);
    expect(w.map((x) => x.id)).toEqual(W.map((x) => x.id));
    expect(t.map((x) => x.id)).toEqual(T.map((x) => x.id));
  });

  it("has no rows for nothing", () => {
    expect(scheduleRows([], [])).toEqual({ rows: [], unassigned: [] });
    expect(scheduleRows([], [task({ id: "a", wbs_id: "w1" })]).unassigned).toHaveLength(1);
  });

  it("reads each item's span from its own fields", () => {
    expect(wbsSpan(wbs({ start_date: "2026-01-01", end_date: "2026-02-01" }))).toEqual({
      start: "2026-01-01",
      end: "2026-02-01",
    });
    expect(taskSpan(task({ start_date: null, due_date: "2026-03-01" }))).toEqual({
      start: null,
      end: "2026-03-01",
    });
  });
});

describe("timeline", () => {
  const NOW = new Date(2026, 1, 15);

  it("widens the range to whole quarters and lays out the quarters", () => {
    const m = timelineModel([{ start: "2025-11-20", end: "2026-02-10" }], NOW)!;
    expect(m.start).toEqual(new Date(2025, 9, 1));
    expect(m.end).toEqual(new Date(2026, 3, 1));
    // Q4 2025 (92 days) then Q1 2026 (90 days) of 182.
    expect(m.quarters.map((q) => q.label)).toEqual(["Q4'25", "Q1'26"]);
    expect(m.quarters.map((q) => q.yearStart)).toEqual([false, true]);
    expect(m.quarters[0].startPct).toBe(0);
    expect(m.quarters[0].widthPct).toBeCloseTo((92 / 182) * 100, 10);
    expect(m.quarters[1].startPct).toBeCloseTo((92 / 182) * 100, 10);
    expect(m.quarters[1].widthPct).toBeCloseTo((90 / 182) * 100, 10);
    // 15 Feb 2026 is day 137 of 182.
    expect(m.todayPct).toBeCloseTo((137 / 182) * 100, 10);
  });

  it("keeps no quarter past the range", () => {
    const m = timelineModel([{ start: "2025-01-01", end: "2025-12-31" }], NOW)!;
    expect(m.quarters.map((q) => q.label)).toEqual(["Q1'25", "Q2'25", "Q3'25", "Q4'25"]);
    expect(m.end).toEqual(new Date(2026, 0, 1));
  });

  it("uses the earliest and latest date of any span, start or end alone", () => {
    const m = timelineModel(
      [{ start: null, end: "2026-08-01" }, { start: "2025-02-01", end: null }, { start: null, end: null }, {}],
      NOW,
    )!;
    expect(m.start).toEqual(new Date(2025, 0, 1));
    expect(m.end).toEqual(new Date(2026, 9, 1));
  });

  it("has no scale when nothing has a date", () => {
    expect(timelineModel([{ start: null, end: null }, {}], NOW)).toBeNull();
    expect(timelineModel([], NOW)).toBeNull();
  });

  it("places today only when it is inside the range", () => {
    const span = [{ start: "2025-01-10", end: "2025-03-01" }];
    expect(timelineModel(span, new Date(2025, 0, 1))!.todayPct).toBe(0);
    expect(timelineModel(span, new Date(2024, 11, 31))!.todayPct).toBeNull();
    expect(timelineModel(span, new Date(2025, 3, 1))!.todayPct).toBeNull();
    expect(timelineModel(span, new Date(2025, 2, 31, 23, 0))!.todayPct).toBeCloseTo((89 / 90) * 100, 10);
  });

  // Q1 2025: 90 days, so one day is 100 / 90 %.
  const Q1 = timelineModel([{ start: "2025-01-01", end: "2025-03-31" }], new Date(2030, 0, 1))!;
  const day = 100 / 90;

  it("positions a bar from its start to the end of its last day", () => {
    expect(timelinePosition(Q1, { start: "2025-01-11", end: "2025-01-20" })).toEqual({
      startPct: expect.closeTo(10 * day, 10),
      widthPct: expect.closeTo(10 * day, 10),
    });
    expect(timelinePosition(Q1, { start: "2025-01-01", end: "2025-03-31" })).toEqual({
      startPct: 0,
      widthPct: expect.closeTo(100, 10),
    });
    // A one-day bar is one day wide.
    expect(timelinePosition(Q1, { start: "2025-01-11", end: "2025-01-11" })).toEqual({
      startPct: expect.closeTo(10 * day, 10),
      widthPct: expect.closeTo(day, 10),
    });
  });

  it("orders reversed dates, and gives a one-date item a point", () => {
    expect(timelinePosition(Q1, { start: "2025-01-20", end: "2025-01-11" })).toEqual(
      timelinePosition(Q1, { start: "2025-01-11", end: "2025-01-20" }),
    );
    expect(timelinePosition(Q1, { start: null, end: "2025-01-31" })).toEqual({
      atPct: expect.closeTo(30 * day, 10),
    });
    expect(timelinePosition(Q1, { start: "2025-01-31", end: null })).toEqual({
      atPct: expect.closeTo(30 * day, 10),
    });
    expect(timelinePosition(Q1, { start: null, end: null })).toBeNull();
    expect(timelinePosition(Q1, {})).toBeNull();
  });

  it("puts a milestone at its end date, else its start, else nowhere", () => {
    expect(
      milestonePosition(Q1, wbs({ start_date: "2025-01-11", end_date: "2025-01-31" })),
    ).toBeCloseTo(30 * day, 10);
    expect(milestonePosition(Q1, wbs({ start_date: "2025-01-11", end_date: null }))).toBeCloseTo(
      10 * day,
      10,
    );
    expect(milestonePosition(Q1, wbs({ start_date: null, end_date: null }))).toBeNull();
  });
});
