import { describe, expect, it } from "vitest";

import type { ArchitectureDecision } from "@/types";
import {
  adrFactRows,
  adrFileNames,
  adrHeading,
  adrLinkHeaders,
  adrLinkRows,
  adrRecordedLine,
  peopleNames,
} from "./adrDocumentFacts";

/** A stand-in `t` that shows the key and its options. */
const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}${JSON.stringify(opts)}` : key;
const date = (iso: string | null | undefined) => (iso ? `D(${iso})` : "");

function adr(over: Partial<ArchitectureDecision> = {}): ArchitectureDecision {
  return {
    id: "a1",
    reference_number: "ADR-012",
    title: "Use Kafka",
    status: "signed",
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

describe("adrHeading", () => {
  it("names the decision with its revision from 2 on", () => {
    expect(adrHeading(adr(), t)).toBe("ADR-012 — Use Kafka");
    expect(adrHeading(adr({ revision_number: 2 }), t)).toBe(
      'adr.revision.reference{"reference":"ADR-012","number":2} — Use Kafka',
    );
  });
});

describe("peopleNames", () => {
  it("joins names and skips blank ones", () => {
    expect(
      peopleNames([
        { user_id: "u1", display_name: "Ann" },
        { user_id: null, display_name: "" },
        { user_id: null, display_name: "Board" },
      ]),
    ).toBe("Ann, Board");
    expect(peopleNames(undefined)).toBe("");
  });
});

describe("adrFactRows", () => {
  it("lists status, standing, dates, people and signing facts in order", () => {
    const rows = adrFactRows(
      adr({
        standing: "amended",
        decided_on: "2026-01-02",
        effective_from: "2026-01-03",
        valid_until: "2027-01-01",
        decision_makers: [{ user_id: "u1", display_name: "Ann" }],
        participants: [{ user_id: null, display_name: "Bob" }],
        creator_name: "Cat",
        created_at: "2025-12-01",
        updated_at: "2025-12-02",
        signed_at: "2026-01-02T09:00:00Z",
        signatories: [
          { user_id: "u1", display_name: "Ann", status: "signed", signed_at: null },
          { user_id: "u2", display_name: "Dan", status: "pending", signed_at: null },
        ],
      }),
      t,
      date,
    );
    expect(rows).toEqual([
      ["adr.grid.status", "status.signed"],
      ["adr.grid.standing", "adr.standing.amended"],
      ["adr.dates.decidedOn", "D(2026-01-02)"],
      ["adr.dates.effectiveFrom", "D(2026-01-03)"],
      ["adr.dates.validUntil", "D(2027-01-01)"],
      ["adr.people.decisionMakers", "Ann"],
      ["adr.people.participants", "Bob"],
      ["adr.grid.createdBy", "Cat"],
      ["adr.grid.created", "D(2025-12-01)"],
      ["adr.grid.lastModified", "D(2025-12-02)"],
      ["adr.grid.signed", "D(2026-01-02T09:00:00Z)"],
      ["adr.grid.signedBy", "Ann"],
    ]);
  });

  it("reads Recorded and leaves the absent facts empty", () => {
    const rows = adrFactRows(adr({ recorded_at: "2026-01-05T00:00:00Z" }), t, date);
    expect(rows[0]).toEqual(["adr.grid.status", "status.recorded"]);
    expect(rows[1]).toEqual(["adr.grid.standing", ""]);
    expect(rows.slice(2).every(([, v]) => v === "")).toBe(true);
  });
});

describe("adrLinkRows", () => {
  it("lists outgoing then incoming links with their verb, decision and note", () => {
    const decision = (id: string, ref: string, rev: number, title: string) => ({
      id,
      reference_number: ref,
      revision_number: rev,
      title,
      status: "signed" as const,
      standing: null,
    });
    const rows = adrLinkRows(
      adr({
        links: {
          outgoing: [
            { id: "l1", kind: "replaces", note: "§3 only", decision: decision("b", "ADR-003", 1, "Old") },
          ],
          incoming: [
            { id: null, kind: "amends", note: null, decision: decision("c", "ADR-020", 2, "Patch") },
          ],
        },
      }),
      t,
    );
    expect(rows).toEqual([
      ["adr.links.outgoing.replaces", "ADR-003 — Old", "§3 only"],
      [
        "adr.links.incoming.amends",
        'adr.revision.reference{"reference":"ADR-020","number":2} — Patch',
        "",
      ],
    ]);
  });

  it("is empty for a row without links", () => {
    expect(adrLinkRows(adr(), t)).toEqual([]);
  });

  it("names its three columns", () => {
    expect(adrLinkHeaders(t)).toEqual([
      "adr.export.linkRelation",
      "adr.export.linkDecision",
      "adr.export.linkNote",
    ]);
  });
});

describe("adrFileNames", () => {
  it("lists the file names the detail carries", () => {
    const file = (name: string) => ({
      id: name,
      name,
      mime_type: "application/pdf",
      size: 1,
      created_at: null,
      created_by: null,
    });
    expect(adrFileNames(adr({ files: [file("a.pdf"), file(""), file("b.png")] }))).toEqual([
      "a.pdf",
      "b.png",
    ]);
    expect(adrFileNames(adr())).toEqual([]);
  });
});

describe("adrRecordedLine", () => {
  it("names who recorded the decision and when", () => {
    expect(
      adrRecordedLine(
        adr({
          recorded_at: "2026-01-05T00:00:00Z",
          recorded_by: { user_id: "u1", display_name: "Ann" },
        }),
        t,
        date,
      ),
    ).toBe('adr.banner.recorded{"name":"Ann","date":"D(2026-01-05T00:00:00Z)"}');
  });

  it("falls back to the date alone when the recorder is unknown", () => {
    expect(
      adrRecordedLine(
        adr({ recorded_at: "2026-01-05T00:00:00Z", recorded_by: { user_id: "u1", display_name: null } }),
        t,
        date,
      ),
    ).toBe('adr.banner.recordedNoName{"date":"D(2026-01-05T00:00:00Z)"}');
  });

  it("is null for a decision signed in Turbo EA or not signed", () => {
    expect(adrRecordedLine(adr({ signed_at: "2026-01-05T00:00:00Z" }), t, date)).toBeNull();
    expect(adrRecordedLine(adr({ status: "draft", recorded_at: "x" }), t, date)).toBeNull();
  });
});
