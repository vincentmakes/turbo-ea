import { describe, expect, it } from "vitest";
import type { PpmBudgetLine, PpmCostLine } from "@/types";
import { currentFiscalYear } from "./costChartData";
import {
  defaultExpandedKey,
  grandTotals,
  groupBudgetLines,
  groupCostLines,
  type LineGroup,
} from "./costTableGroups";

function budget(id: string, fiscal_year: number, category: string, amount: number): PpmBudgetLine {
  return {
    id,
    initiative_id: "i1",
    fiscal_year,
    category: category as PpmBudgetLine["category"],
    description: null,
    amount,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
  };
}

function cost(id: string, date: string | null, category: string, actual: number): PpmCostLine {
  return {
    id,
    initiative_id: "i1",
    description: id,
    category: category as PpmCostLine["category"],
    planned: 0,
    actual,
    date,
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
  };
}

const ids = <T extends { id: string }>(g: LineGroup<T>) => g.lines.map((l) => l.id);

describe("groupBudgetLines", () => {
  it("groups by fiscal year ascending, keeping the API order inside a year", () => {
    const groups = groupBudgetLines([
      budget("a", 2027, "capex", 1),
      budget("b", 2025, "opex", 2),
      budget("c", 2027, "opex", 4),
      budget("d", 2026, "capex", 8),
    ]);
    expect(groups.map((g) => g.key)).toEqual([2025, 2026, 2027]);
    expect(groups.map(ids)).toEqual([["b"], ["d"], ["a", "c"]]);
  });

  it("subtotals each year's CapEx, OpEx and Total", () => {
    const [g2025, g2026] = groupBudgetLines([
      budget("a", 2025, "capex", 100),
      budget("b", 2025, "capex", 50),
      budget("c", 2025, "opex", 30),
      budget("d", 2026, "opex", 7),
    ]);
    expect(g2025.totals).toEqual({ capex: 150, opex: 30, total: 180 });
    expect(g2026.totals).toEqual({ capex: 0, opex: 7, total: 7 });
  });

  it("counts a line of any other category in the total only", () => {
    const [g] = groupBudgetLines([
      budget("a", 2026, "capex", 10),
      budget("b", 2026, "other", 5),
      budget("c", 2026, " OpEx ", 3),
    ]);
    expect(g.totals).toEqual({ capex: 10, opex: 3, total: 18 });
  });

  it("reads a numeric string amount and treats a non-number as zero", () => {
    const [g] = groupBudgetLines([
      budget("a", 2026, "capex", "12.5" as unknown as number),
      budget("b", 2026, "capex", "n/a" as unknown as number),
    ]);
    expect(g.totals).toEqual({ capex: 12.5, opex: 0, total: 12.5 });
  });

  it("returns no group for no lines", () => {
    expect(groupBudgetLines([])).toEqual([]);
  });
});

describe("groupCostLines", () => {
  it("groups by the fiscal year of the date, with the undated group last", () => {
    for (const order of [
      [cost("u", null, "capex", 1), cost("x", "2027-02-01", "capex", 1), cost("y", "2025-05-01", "opex", 1)],
      [cost("x", "2027-02-01", "capex", 1), cost("u", null, "capex", 1), cost("y", "2025-05-01", "opex", 1)],
      [cost("x", "2027-02-01", "capex", 1), cost("y", "2025-05-01", "opex", 1), cost("u", null, "capex", 1)],
    ]) {
      expect(groupCostLines(order, 1).map((g) => g.key)).toEqual([2025, 2027, "undated"]);
    }
  });

  it("files a line with an unparseable date as undated", () => {
    const groups = groupCostLines([cost("a", "soon", "capex", 1), cost("b", "", "capex", 1)], 1);
    expect(groups.map((g) => g.key)).toEqual(["undated"]);
    expect(ids(groups[0])).toEqual(["a", "b"]);
  });

  it("uses the fiscal-year start month", () => {
    const groups = groupCostLines(
      [cost("mar", "2026-03-31", "capex", 1), cost("apr", "2026-04-01", "capex", 1)],
      4,
    );
    expect(groups.map((g) => [g.key, ids(g)])).toEqual([
      [2026, ["mar"]],
      [2027, ["apr"]],
    ]);
  });

  it("orders a year's lines by date, equal dates keeping their input order", () => {
    const [g] = groupCostLines(
      [
        cost("late", "2026-09-01", "capex", 1),
        cost("same1", "2026-03-01", "capex", 1),
        cost("early", "2026-01-15", "capex", 1),
        cost("same2", "2026-03-01", "capex", 1),
      ],
      1,
    );
    expect(ids(g)).toEqual(["early", "same1", "same2", "late"]);
  });

  it("subtotals the actuals, an unknown category in the total only", () => {
    const [g2026, undated] = groupCostLines(
      [
        cost("a", "2026-02-01", "capex", 100),
        cost("b", "2026-03-01", "opex", 40),
        cost("c", "2026-04-01", "misc", 5),
        cost("d", null, "opex", 9),
      ],
      1,
    );
    expect(g2026.totals).toEqual({ capex: 100, opex: 40, total: 145 });
    expect(undated.totals).toEqual({ capex: 0, opex: 9, total: 9 });
  });
});

describe("grandTotals", () => {
  it("adds every group's subtotals", () => {
    const groups = groupBudgetLines([
      budget("a", 2025, "capex", 100),
      budget("b", 2026, "opex", 20),
      budget("c", 2026, "other", 3),
    ]);
    expect(grandTotals(groups)).toEqual({ capex: 100, opex: 20, total: 123 });
  });

  it("is zero for no groups", () => {
    expect(grandTotals([])).toEqual({ capex: 0, opex: 0, total: 0 });
  });
});

describe("currentFiscalYear", () => {
  it("is the calendar year with a January start", () => {
    expect(currentFiscalYear(new Date(2026, 0, 1), 1)).toBe(2026);
    expect(currentFiscalYear(new Date(2026, 11, 31), 1)).toBe(2026);
  });

  it("is named after the year it ends in with a later start", () => {
    expect(currentFiscalYear(new Date(2026, 2, 15), 4)).toBe(2026);
    expect(currentFiscalYear(new Date(2026, 2, 31), 4)).toBe(2026);
    expect(currentFiscalYear(new Date(2026, 3, 1), 4)).toBe(2027);
    expect(currentFiscalYear(new Date(2026, 5, 1), 4)).toBe(2027);
  });
});

describe("defaultExpandedKey", () => {
  const groups = (...dates: (string | null)[]) =>
    groupCostLines(dates.map((d, i) => cost(`l${i}`, d, "capex", 1)), 1);

  it("opens the current fiscal year when it has lines", () => {
    expect(defaultExpandedKey(groups("2025-01-01", "2026-01-01", "2027-01-01", null), 2026)).toBe(2026);
  });

  it("falls back to the latest year when the current one has no lines", () => {
    expect(defaultExpandedKey(groups("2027-01-01", "2023-01-01", null), 2026)).toBe(2027);
    expect(
      defaultExpandedKey(groupBudgetLines([budget("a", 2030, "capex", 1), budget("b", 2024, "capex", 1)]), 2026),
    ).toBe(2030);
  });

  it("opens the undated group when it is the only one", () => {
    expect(defaultExpandedKey(groups(null, null), 2026)).toBe("undated");
  });

  it("opens nothing when there are no lines", () => {
    expect(defaultExpandedKey([], 2026)).toBeNull();
  });
});
