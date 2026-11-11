import { describe, expect, it } from "vitest";

import type { ArchitectureDecision, DecisionLinks, DecisionRevision } from "@/types";
import {
  buildSavePayload,
  canRecord,
  chainIds,
  contentFromDetail,
  currentRevisionId,
  editorAccess,
  linksFromDetail,
  linksPayload,
  storedPayload,
  type EditorContent,
} from "./adrEditorModel";

const EMPTY: EditorContent = {
  title: "T",
  context: "",
  decision: "",
  consequences: "",
  alternatives: "",
  decidedOn: "",
  effectiveFrom: "",
  validUntil: "",
  decisionMakers: [],
  participants: [],
  links: [],
  changeSummary: "",
};

describe("buildSavePayload", () => {
  it("sends empty text and dates as null, and no change summary on a first revision", () => {
    expect(buildSavePayload(EMPTY, false)).toEqual({
      title: "T",
      context: null,
      decision: null,
      consequences: null,
      alternatives_considered: null,
      decided_on: null,
      effective_from: null,
      valid_until: null,
      decision_makers: [],
      participants: [],
      links: [],
    });
  });

  it("sends every field as entered, people and links in the write shape", () => {
    const payload = buildSavePayload(
      {
        title: "Use Kafka",
        context: "<p>c</p>",
        decision: "<p>d</p>",
        consequences: "<p>q</p>",
        alternatives: "<p>a</p>",
        decidedOn: "2026-05-01",
        effectiveFrom: "2026-06-01",
        validUntil: "2027-06-01",
        decisionMakers: [
          { user_id: "u1", display_name: "Ada" },
          { user_id: null, display_name: "Board" },
        ],
        participants: [{ user_id: "u2", display_name: "Grace" }],
        links: [
          { decision_id: "d1", kind: "replaces", note: "  §3 only " },
          { decision_id: "", kind: "relates", note: "dropped" },
          { decision_id: "d2", kind: "relates", note: "   " },
        ],
        changeSummary: "  Tightened scope  ",
      },
      true,
    );
    expect(payload).toEqual({
      title: "Use Kafka",
      context: "<p>c</p>",
      decision: "<p>d</p>",
      consequences: "<p>q</p>",
      alternatives_considered: "<p>a</p>",
      decided_on: "2026-05-01",
      effective_from: "2026-06-01",
      valid_until: "2027-06-01",
      decision_makers: [{ user_id: "u1" }, { name: "Board" }],
      participants: [{ user_id: "u2" }],
      links: [
        { decision_id: "d1", kind: "replaces", note: "§3 only" },
        { decision_id: "d2", kind: "relates", note: null },
      ],
      change_summary: "Tightened scope",
    });
  });

  it("clears the change summary of a revision with null", () => {
    expect(buildSavePayload({ ...EMPTY, changeSummary: "  " }, true).change_summary).toBeNull();
    expect("change_summary" in buildSavePayload({ ...EMPTY, changeSummary: "x" }, false)).toBe(false);
  });
});

describe("links", () => {
  const LINKS: DecisionLinks = {
    outgoing: [
      {
        id: "l1",
        kind: "amends",
        note: "n",
        decision: {
          id: "d1",
          reference_number: "ADR-001",
          revision_number: 1,
          title: "One",
          status: "signed",
          standing: "in_force",
        },
      },
    ],
    incoming: [
      {
        id: "l2",
        kind: "relates",
        note: null,
        decision: {
          id: "d9",
          reference_number: "ADR-009",
          revision_number: 1,
          title: "Nine",
          status: "draft",
          standing: null,
        },
      },
    ],
  };

  it("takes the outgoing links only, in the write shape", () => {
    expect(linksFromDetail(LINKS)).toEqual([{ decision_id: "d1", kind: "amends", note: "n" }]);
    expect(linksFromDetail(undefined)).toEqual([]);
  });

  it("drops unpicked rows and blank notes", () => {
    expect(linksPayload([{ decision_id: "", kind: "relates" }])).toEqual([]);
    expect(linksPayload([{ decision_id: "a", kind: "revokes" }])).toEqual([
      { decision_id: "a", kind: "revokes", note: null },
    ]);
  });
});

describe("editorAccess", () => {
  it("a saved draft is fully editable", () => {
    expect(editorAccess("draft", false)).toEqual({
      locked: false,
      cardsEditable: true,
      filesEditable: true,
      panelReadOnly: false,
    });
  });

  it("a new decision has no files to edit yet", () => {
    expect(editorAccess("draft", true).filesEditable).toBe(false);
  });

  it("in review the content locks but cards stay editable", () => {
    expect(editorAccess("in_review", false)).toEqual({
      locked: true,
      cardsEditable: true,
      filesEditable: false,
      panelReadOnly: true,
    });
  });

  it("signed locks everything, cards included", () => {
    expect(editorAccess("signed", false)).toEqual({
      locked: true,
      cardsEditable: false,
      filesEditable: false,
      panelReadOnly: true,
    });
  });
});

describe("canRecord", () => {
  it("needs a saved draft and adr.record (or the wildcard)", () => {
    expect(canRecord({ "adr.record": true }, "draft", false)).toBe(true);
    expect(canRecord({ "*": true }, "draft", false)).toBe(true);
    expect(canRecord({ "adr.manage": true }, "draft", false)).toBe(false);
    expect(canRecord({ "adr.record": true }, "draft", true)).toBe(false);
    expect(canRecord({ "adr.record": true }, "in_review", false)).toBe(false);
    expect(canRecord({ "adr.record": true }, "signed", false)).toBe(false);
    expect(canRecord(undefined, "draft", false)).toBe(false);
  });
});

const REV = (id: string, n: number, status: DecisionRevision["status"], standing: DecisionRevision["standing"]): DecisionRevision => ({
  id,
  reference_number: "ADR-001",
  revision_number: n,
  title: "T",
  status,
  standing,
});

describe("chainIds", () => {
  it("lists the chain, the decision itself always included", () => {
    expect(chainIds({ id: "b", revisions: [REV("a", 1, "signed", "superseded"), REV("b", 2, "draft", null)] })).toEqual([
      "a",
      "b",
    ]);
    expect(chainIds({ id: "x", revisions: [REV("a", 1, "signed", "in_force")] })).toEqual(["x", "a"]);
    expect(chainIds({ id: "x" })).toEqual(["x"]);
  });
});

describe("currentRevisionId", () => {
  const revisions = [
    REV("r1", 1, "signed", "superseded"),
    REV("r2", 2, "signed", "in_force"),
    REV("r3", 3, "signed", "scheduled"),
    REV("r4", 4, "draft", null),
  ];

  it("is the decision itself when current", () => {
    expect(currentRevisionId({ id: "r2", is_current: true, revisions })).toBe("r2");
  });

  it("is the pointer of an earlier revision", () => {
    expect(
      currentRevisionId({
        id: "r1",
        is_current: false,
        is_earlier_revision: true,
        superseded_by: { id: "r2", reference_number: "ADR-001", revision_number: 2, title: "T" },
        revisions,
      }),
    ).toBe("r2");
  });

  it("is otherwise the first signed revision neither superseded nor scheduled", () => {
    expect(currentRevisionId({ id: "r4", is_current: false, revisions })).toBe("r2");
    expect(currentRevisionId({ id: "r4", revisions: [REV("r3", 3, "signed", "scheduled")] })).toBeNull();
    expect(currentRevisionId({ id: "r4", is_earlier_revision: true, revisions: [] })).toBeNull();
  });
});

const DETAIL: ArchitectureDecision = {
  id: "adr-1",
  reference_number: "ADR-001",
  title: "Adopt Kafka",
  status: "draft",
  context: "<p>c</p>",
  decision: null,
  consequences: "<p>q</p>",
  alternatives_considered: null,
  related_decisions: [],
  created_by: null,
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  created_at: null,
  updated_at: null,
};

describe("contentFromDetail", () => {
  it("fills every field, missing ones as empty", () => {
    expect(contentFromDetail(DETAIL)).toEqual({
      title: "Adopt Kafka",
      context: "<p>c</p>",
      decision: "",
      consequences: "<p>q</p>",
      alternatives: "",
      decidedOn: "",
      effectiveFrom: "",
      validUntil: "",
      decisionMakers: [],
      participants: [],
      links: [],
      changeSummary: "",
    });
  });

  it("carries dates, people, outgoing links and the change summary", () => {
    const maker = { user_id: "u1", display_name: "Ada" };
    const guest = { user_id: null, name: "Bob" };
    const out = contentFromDetail({
      ...DETAIL,
      alternatives_considered: "<p>a</p>",
      decision: "<p>d</p>",
      decided_on: "2026-01-02",
      effective_from: "2026-02-03",
      valid_until: "2027-01-01",
      decision_makers: [maker],
      participants: [guest] as never,
      change_summary: "why",
      links: {
        outgoing: [
          {
            id: "l1",
            kind: "amends",
            note: "n",
            decision: { id: "t", reference_number: "ADR-002", revision_number: 1, title: "x" },
          },
        ],
        incoming: [],
      },
    });
    expect(out).toEqual({
      title: "Adopt Kafka",
      context: "<p>c</p>",
      decision: "<p>d</p>",
      consequences: "<p>q</p>",
      alternatives: "<p>a</p>",
      decidedOn: "2026-01-02",
      effectiveFrom: "2026-02-03",
      validUntil: "2027-01-01",
      decisionMakers: [maker],
      participants: [guest],
      links: [{ decision_id: "t", kind: "amends", note: "n" }],
      changeSummary: "why",
    });
  });
});

describe("storedPayload", () => {
  it("is the save payload for the detail, without a change summary on a first revision", () => {
    expect(storedPayload({ ...DETAIL, change_summary: "ignored" })).toEqual({
      title: "Adopt Kafka",
      context: "<p>c</p>",
      decision: null,
      consequences: "<p>q</p>",
      alternatives_considered: null,
      decided_on: null,
      effective_from: null,
      valid_until: null,
      decision_makers: [],
      participants: [],
      links: [],
    });
  });

  it("carries the change summary on a revision", () => {
    expect(storedPayload({ ...DETAIL, parent_id: "p", change_summary: " why " })).toMatchObject({
      change_summary: "why",
    });
    expect(storedPayload({ ...DETAIL, parent_id: "p" }).change_summary).toBeNull();
  });
});
