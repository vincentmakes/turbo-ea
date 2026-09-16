import { describe, it, expect } from "vitest";
import { cardSearchRank, compareByRank, searchRank } from "./searchRank";

/**
 * This file pins the client half of a two-sided contract: the tiers here must
 * match `search_rank` in `backend/app/services/search_rank.py` — and, for
 * cards, `card_search_rank` in `card_search.py` — or the picker will reorder
 * itself when the debounced server response lands.
 */
describe("searchRank", () => {
  it("ranks an exact match first", () => {
    expect(searchRank("Work", "work")).toBe(0);
  });

  it("ranks a starts-with match above a substring match", () => {
    expect(searchRank("Workday", "work")).toBe(1);
    expect(searchRank("Network Monitor", "work")).toBe(3);
    expect(searchRank("Workday", "work")).toBeLessThan(searchRank("Network Monitor", "work"));
  });

  it("treats a term that starts a word as better than a mid-word match", () => {
    expect(searchRank("Cloud Work Hub", "work")).toBe(2);
    expect(searchRank("Reworked Portal", "work")).toBe(3);
  });

  it("counts punctuation as a word boundary, not just spaces", () => {
    expect(searchRank("SAP/Workday", "work")).toBe(2);
    expect(searchRank("Legacy-Workflow", "work")).toBe(2);
    expect(searchRank("Data.Warehouse", "warehouse")).toBe(2);
  });

  it("returns -1 when the term is absent", () => {
    expect(searchRank("Payroll", "work")).toBe(-1);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(searchRank("WORKDAY", "  work  ")).toBe(1);
  });

  it("matches everything for an empty query", () => {
    expect(searchRank("Anything", "")).toBe(3);
  });

  it("finds a later word-start occurrence even when the first hit is mid-word", () => {
    // "network" contains "work" mid-word; the second occurrence starts a word.
    expect(searchRank("Network Work Queue", "work")).toBe(2);
  });
});

describe("compareByRank", () => {
  it("orders by rank, then alphabetically within a rank", () => {
    const names = [
      { name: "Network Monitor" },
      { name: "Cloud Work Hub" },
      { name: "Workday Adaptive" },
      { name: "Workday" },
      { name: "Work" },
    ];
    expect([...names].sort(compareByRank("work")).map((o) => o.name)).toEqual([
      "Work",
      "Workday",
      "Workday Adaptive",
      "Cloud Work Hub",
      "Network Monitor",
    ]);
  });

  it("sorts a non-match last, not first", () => {
    // `searchRank` reports no-match as -1, so a raw subtraction would float
    // exactly the rows that don't match to the top. Callers that cannot
    // pre-filter — a tree keeping a match's ancestors for context, a
    // server-searched list where the hit was on the description — depend on
    // this.
    const names = [{ name: "Payroll" }, { name: "Workday" }, { name: "Ledger" }];
    expect([...names].sort(compareByRank("work")).map((o) => o.name)).toEqual([
      "Workday",
      "Ledger",
      "Payroll",
    ]);
  });

  it("keeps non-matches in alphabetical order among themselves", () => {
    const names = [{ name: "Zebra" }, { name: "Apple" }];
    expect([...names].sort(compareByRank("work")).map((o) => o.name)).toEqual(["Apple", "Zebra"]);
  });
});

describe("cardSearchRank", () => {
  it("falls back to the name when there is no alias", () => {
    expect(cardSearchRank({ name: "Workday" }, "work")).toBe(1);
    expect(cardSearchRank({ name: "Workday", alias: null }, "work")).toBe(1);
  });

  it("takes the better of the two texts", () => {
    // Exact on the alias beats starts-a-word on the name.
    expect(cardSearchRank({ name: "Legacy Workday Bridge", alias: "work" }, "work")).toBe(0);
    // …and the other way round.
    expect(cardSearchRank({ name: "work", alias: "Legacy Bridge" }, "work")).toBe(0);
  });

  it("matches on the alias alone", () => {
    expect(cardSearchRank({ name: "Human Capital Suite", alias: "CRM-v2" }, "crm-v2")).toBe(0);
  });

  it("reports no match only when neither text matches", () => {
    expect(cardSearchRank({ name: "Payroll", alias: "PAY" }, "work")).toBe(-1);
  });
});

describe("compareByRank with aliases", () => {
  it("floats an exact alias match above a name substring", () => {
    // The whole point of #1108: the server returns both rows, and the client
    // must not re-order them so the alias hit reads as the worse match.
    const cards = [
      { name: "Legacy Workday Bridge" },
      { name: "Human Capital Suite", alias: "Workday" },
    ];
    expect([...cards].sort(compareByRank("workday")).map((c) => c.name)).toEqual([
      "Human Capital Suite",
      "Legacy Workday Bridge",
    ]);
  });

  it("is a plain alphabetical sort for an empty query", () => {
    // `compareByRank("")` is how a browse-on-open list is ordered (#1107).
    const cards = [{ name: "Zebra" }, { name: "apple", alias: "ZZZ" }, { name: "Mango" }];
    expect([...cards].sort(compareByRank("")).map((c) => c.name)).toEqual([
      "apple",
      "Mango",
      "Zebra",
    ]);
  });
});
