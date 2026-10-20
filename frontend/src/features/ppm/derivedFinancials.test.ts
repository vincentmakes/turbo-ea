import { describe, expect, it } from "vitest";
import type { PpmBudgetLine, PpmCostLine, PpmRollupOut, PpmRollupYear } from "@/types";
import { derivedYearGroups, financialTotals, ownTotals, sumRows } from "./derivedFinancials";

const year = (y: number | null, cb: number, ob: number, ca: number, oa: number): PpmRollupYear => ({
  year: y,
  capex_budget: cb,
  opex_budget: ob,
  capex_actual: ca,
  opex_actual: oa,
});

const rollup = (byYear: PpmRollupYear[]): PpmRollupOut => ({
  descendant_count: 3,
  capex_planned: 9999,
  capex_actual: 9999,
  opex_planned: 9999,
  opex_actual: 9999,
  total_planned: 9999,
  total_actual: 9999,
  start_date: null,
  end_date: null,
  has_budget_lines: false,
  has_cost_lines: false,
  by_year: byYear,
});

const budgetLine = (amount: number, category: string): PpmBudgetLine =>
  ({ id: `b${amount}`, initiative_id: "i", fiscal_year: 2026, category, amount }) as PpmBudgetLine;
const costLine = (actual: number, category: string): PpmCostLine =>
  ({ id: `c${actual}`, initiative_id: "i", description: "", category, planned: 0, actual }) as PpmCostLine;

const BENEATH = rollup([
  year(2025, 100, 10, 0, 0),
  year(2026, 0, 0, 40, 4),
  year(2027, 0, 0, 0, 0),
  year(null, 0, 0, 7, 0),
]);

describe("derivedYearGroups", () => {
  it("draws the budget side's years, leaving out a year with no budget", () => {
    expect(derivedYearGroups(BENEATH, "budget")).toEqual([
      { key: 2025, capex: 100, opex: 10, total: 110 },
    ]);
  });

  it("draws the cost side's years with the undated row last", () => {
    expect(derivedYearGroups(BENEATH, "cost")).toEqual([
      { key: 2026, capex: 40, opex: 4, total: 44 },
      { key: "undated", capex: 7, opex: 0, total: 7 },
    ]);
  });

  it("keeps a year with OpEx alone", () => {
    expect(derivedYearGroups(rollup([year(2024, 0, 5, 0, 3)]), "budget")).toEqual([
      { key: 2024, capex: 0, opex: 5, total: 5 },
    ]);
    expect(derivedYearGroups(rollup([year(2024, 0, 5, 0, 3)]), "cost")).toEqual([
      { key: 2024, capex: 0, opex: 3, total: 3 },
    ]);
  });

  it("is empty without a rollup or with nothing beneath", () => {
    expect(derivedYearGroups(null, "budget")).toEqual([]);
    expect(derivedYearGroups(rollup([]), "cost")).toEqual([]);
  });
});

describe("ownTotals", () => {
  it("splits by category and counts an odd category in the total only", () => {
    const lines = [budgetLine(100, "capex"), budgetLine(20, " OpEx "), budgetLine(5, "other")];
    expect(ownTotals(lines, (l) => l.amount, (l) => l.category)).toEqual({
      capex: 100,
      opex: 20,
      total: 125,
    });
  });

  it("reads a missing amount as zero", () => {
    const lines = [budgetLine(NaN, "capex"), budgetLine(3, "capex")];
    expect(ownTotals(lines, (l) => l.amount, (l) => l.category)).toEqual({
      capex: 3,
      opex: 0,
      total: 3,
    });
  });
});

describe("sumRows", () => {
  it("sums every column", () => {
    expect(
      sumRows([
        { key: 2025, capex: 1, opex: 2, total: 3 },
        { key: "undated", capex: 10, opex: 20, total: 30 },
      ]),
    ).toEqual({ capex: 11, opex: 22, total: 33 });
    expect(sumRows([])).toEqual({ capex: 0, opex: 0, total: 0 });
  });
});

describe("financialTotals", () => {
  it("derives both sides when the initiative has no lines of either kind", () => {
    expect(financialTotals([], [], BENEATH)).toEqual({
      budget: { capex: 100, opex: 10, total: 110, derived: true },
      actual: { capex: 47, opex: 4, total: 51, derived: true },
    });
  });

  it("derives only the budget when the initiative records its own costs", () => {
    expect(financialTotals([], [costLine(8, "opex")], BENEATH)).toEqual({
      budget: { capex: 100, opex: 10, total: 110, derived: true },
      actual: { capex: 0, opex: 8, total: 8, derived: false },
    });
  });

  it("derives only the actuals when the initiative holds its own budget", () => {
    expect(financialTotals([budgetLine(500, "capex")], [], BENEATH)).toEqual({
      budget: { capex: 500, opex: 0, total: 500, derived: false },
      actual: { capex: 47, opex: 4, total: 51, derived: true },
    });
  });

  it("keeps its own figures when it has both, even with figures beneath", () => {
    expect(
      financialTotals([budgetLine(0, "capex")], [costLine(0, "capex")], BENEATH),
    ).toEqual({
      budget: { capex: 0, opex: 0, total: 0, derived: false },
      actual: { capex: 0, opex: 0, total: 0, derived: false },
    });
  });

  it("never derives zeros: nothing beneath, or no rollup, keeps the own (empty) figures", () => {
    const empty = {
      budget: { capex: 0, opex: 0, total: 0, derived: false },
      actual: { capex: 0, opex: 0, total: 0, derived: false },
    };
    expect(financialTotals([], [], rollup([year(2026, 0, 0, 0, 0)]))).toEqual(empty);
    expect(financialTotals([], [], null)).toEqual(empty);
  });
});
