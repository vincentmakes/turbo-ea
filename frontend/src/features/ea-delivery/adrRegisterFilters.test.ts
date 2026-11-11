import { describe, expect, it } from "vitest";

import type { ArchitectureDecision } from "@/types";
import {
  EMPTY_ADR_FILTERS,
  adrExportPath,
  countActiveAdrFilters,
  filterAdrs,
  inDayRange,
  isInForcePreset,
  toggleInForcePreset,
  visibleSelection,
  type AdrFilters,
} from "./adrRegisterFilters";

function adr(id: string, over: Partial<ArchitectureDecision> = {}): ArchitectureDecision {
  return {
    id,
    reference_number: `ADR-${id}`,
    title: `Decision ${id}`,
    status: "draft",
    context: null,
    decision: null,
    consequences: null,
    alternatives_considered: null,
    related_decisions: [],
    created_by: null,
    signatories: [],
    signed_at: null,
    revision_number: 1,
    parent_id: null,
    created_at: null,
    updated_at: null,
    ...over,
  };
}

const f = (over: Partial<AdrFilters> = {}): AdrFilters => ({ ...EMPTY_ADR_FILTERS, ...over });
const ids = (rows: ArchitectureDecision[]) => rows.map((r) => r.id);

describe("EMPTY_ADR_FILTERS", () => {
  it("starts with no standing and earlier revisions hidden", () => {
    expect(EMPTY_ADR_FILTERS.standings).toEqual([]);
    expect(EMPTY_ADR_FILTERS.showEarlierRevisions).toBe(false);
  });
});

describe("the In force preset", () => {
  it("is active only for exactly the in-force standings, in any order", () => {
    expect(isInForcePreset(["in_force", "amended"])).toBe(true);
    expect(isInForcePreset(["amended", "in_force"])).toBe(true);
    expect(isInForcePreset(["in_force"])).toBe(false);
    expect(isInForcePreset(["in_force", "amended", "revoked"])).toBe(false);
    expect(isInForcePreset(["in_force", "revoked"])).toBe(false);
    expect(isInForcePreset([])).toBe(false);
  });

  it("selects the in-force standings, and clears them when clicked again", () => {
    expect(toggleInForcePreset([])).toEqual(["in_force", "amended"]);
    expect(toggleInForcePreset(["revoked"])).toEqual(["in_force", "amended"]);
    expect(toggleInForcePreset(["amended", "in_force"])).toEqual([]);
  });
});

describe("countActiveAdrFilters", () => {
  it("counts nothing for the empty filters", () => {
    expect(countActiveAdrFilters(EMPTY_ADR_FILTERS)).toBe(0);
  });

  it("counts each standing and the revisions switch", () => {
    expect(countActiveAdrFilters(f({ standings: ["in_force", "amended"] }))).toBe(2);
    expect(countActiveAdrFilters(f({ showEarlierRevisions: true }))).toBe(1);
  });

  it("counts every other filter one per value or bound", () => {
    expect(
      countActiveAdrFilters(
        f({
          cardTypes: ["Application"],
          linkedCards: ["c1", "c2"],
          statuses: ["draft"],
          signedBy: ["u1"],
          dateCreatedFrom: "2026-01-01",
          dateCreatedTo: "2026-01-31",
          dateModifiedFrom: "2026-02-01",
          dateModifiedTo: "2026-02-28",
          dateSignedFrom: "2026-03-01",
          dateSignedTo: "2026-03-31",
          dateDecidedFrom: "2025-01-01",
          dateDecidedTo: "2025-12-31",
        }),
      ),
    ).toBe(13);
  });
});

describe("inDayRange", () => {
  it("is inclusive on both bounds and open when a bound is empty", () => {
    expect(inDayRange("2026-03-10", "2026-03-10", "2026-03-10")).toBe(true);
    expect(inDayRange("2026-03-09", "2026-03-10", "")).toBe(false);
    expect(inDayRange("2026-03-11", "", "2026-03-10")).toBe(false);
    expect(inDayRange("2026-03-11", "", "")).toBe(true);
    expect(inDayRange(null, "", "")).toBe(false);
  });
});

describe("filterAdrs", () => {
  const rows = [
    adr("current", { status: "signed", standing: "in_force", is_current: true }),
    adr("earlier", { status: "signed", standing: "superseded", is_earlier_revision: true }),
    adr("open", { status: "draft", standing: null, is_earlier_revision: false }),
    adr("amended", { status: "signed", standing: "amended" }),
    adr("revoked", { status: "signed", standing: "revoked" }),
  ];

  it("drops earlier revisions unless the switch is on", () => {
    expect(ids(filterAdrs(rows, EMPTY_ADR_FILTERS))).toEqual([
      "current",
      "open",
      "amended",
      "revoked",
    ]);
    expect(ids(filterAdrs(rows, f({ showEarlierRevisions: true })))).toEqual([
      "current",
      "earlier",
      "open",
      "amended",
      "revoked",
    ]);
  });

  it("keeps the selected standings, 'none' matching an unsigned decision", () => {
    expect(ids(filterAdrs(rows, f({ standings: ["in_force", "amended"] })))).toEqual([
      "current",
      "amended",
    ]);
    expect(ids(filterAdrs(rows, f({ standings: ["none"] })))).toEqual(["open"]);
    expect(
      ids(filterAdrs(rows, f({ standings: ["superseded"], showEarlierRevisions: true }))),
    ).toEqual(["earlier"]);
  });

  it("combines status, standing and revisions", () => {
    expect(ids(filterAdrs(rows, f({ statuses: ["draft"] })))).toEqual(["open"]);
    expect(ids(filterAdrs(rows, f({ statuses: ["signed"], standings: ["revoked"] })))).toEqual([
      "revoked",
    ]);
  });

  it("filters on linked card types and cards", () => {
    const linked = [
      adr("a", { linked_cards: [{ id: "c1", name: "CRM", type: "Application" }] }),
      adr("b", { linked_cards: [{ id: "c2", name: "Kafka", type: "ITComponent" }] }),
      adr("c"),
    ];
    expect(ids(filterAdrs(linked, f({ cardTypes: ["ITComponent"] })))).toEqual(["b"]);
    expect(ids(filterAdrs(linked, f({ linkedCards: ["c1"] })))).toEqual(["a"]);
  });

  it("filters on the three date ranges", () => {
    const dated = [
      adr("a", {
        created_at: "2026-01-05T10:00:00",
        updated_at: "2026-02-05T10:00:00",
        signed_at: "2026-03-05T10:00:00",
      }),
      adr("b", {
        created_at: "2026-01-20T10:00:00",
        updated_at: "2026-02-20T10:00:00",
        signed_at: null,
      }),
    ];
    expect(ids(filterAdrs(dated, f({ dateCreatedFrom: "2026-01-10" })))).toEqual(["b"]);
    expect(ids(filterAdrs(dated, f({ dateCreatedTo: "2026-01-10" })))).toEqual(["a"]);
    expect(ids(filterAdrs(dated, f({ dateModifiedFrom: "2026-02-10" })))).toEqual(["b"]);
    expect(ids(filterAdrs(dated, f({ dateModifiedTo: "2026-02-10" })))).toEqual(["a"]);
    expect(ids(filterAdrs(dated, f({ dateSignedFrom: "2026-03-01" })))).toEqual(["a"]);
    expect(ids(filterAdrs(dated, f({ dateSignedTo: "2026-03-01" })))).toEqual([]);
  });

  it("filters on the decided date, which a recorded decision carries without a signing date", () => {
    const decided = [
      adr("recorded", { status: "signed", signed_at: null, decided_on: "2025-06-15" }),
      adr("signed", { status: "signed", signed_at: "2026-03-05T10:00:00", decided_on: "2026-03-05" }),
      adr("draft", { status: "draft", decided_on: null }),
    ];
    expect(ids(filterAdrs(decided, f({ dateDecidedFrom: "2025-06-15" })))).toEqual([
      "recorded",
      "signed",
    ]);
    expect(ids(filterAdrs(decided, f({ dateDecidedFrom: "2025-06-16" })))).toEqual(["signed"]);
    expect(ids(filterAdrs(decided, f({ dateDecidedTo: "2025-06-15" })))).toEqual(["recorded"]);
    expect(ids(filterAdrs(decided, f({ dateDecidedTo: "2025-06-14" })))).toEqual([]);
    expect(
      ids(filterAdrs(decided, f({ dateDecidedFrom: "2025-01-01", dateDecidedTo: "2025-12-31" }))),
    ).toEqual(["recorded"]);
    // The signing-date filter misses the recorded decision the decided filter finds.
    expect(ids(filterAdrs(decided, f({ dateSignedFrom: "2025-01-01" })))).toEqual(["signed"]);
  });

  it("filters on who signed, ignoring pending signatories", () => {
    const signed = [
      adr("a", {
        signatories: [{ user_id: "u1", display_name: "Ann", status: "signed", signed_at: null }],
      }),
      adr("b", {
        signatories: [{ user_id: "u1", display_name: "Ann", status: "pending", signed_at: null }],
      }),
    ];
    expect(ids(filterAdrs(signed, f({ signedBy: ["u1"] })))).toEqual(["a"]);
  });
});

describe("adrExportPath", () => {
  it("follows the earlier-revisions switch", () => {
    expect(adrExportPath(false)).toBe("/adr?include_content=true&include_earlier=false");
    expect(adrExportPath(true)).toBe("/adr?include_content=true&include_earlier=true");
  });
});

describe("visibleSelection", () => {
  it("keeps the selected rows that are still shown, in selection order", () => {
    const a = adr("a");
    const b = adr("b");
    const c = adr("c");
    expect(ids(visibleSelection([c, a, b], [a, c]))).toEqual(["c", "a"]);
    expect(visibleSelection([b], [a])).toEqual([]);
  });
});
