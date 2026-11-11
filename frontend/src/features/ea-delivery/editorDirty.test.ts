import { describe, expect, it } from "vitest";

import type { ArchitectureDecision, SoAW } from "@/types";
import { buildSavePayload, contentFromDetail, storedPayload } from "./adrEditorModel";
import { hasUnsavedEdits, isEmptyEditorValue, stableJson } from "./editorDirty";
import { soawEditorFields, soawStateFromLoaded } from "./soawEditorState";

describe("stableJson", () => {
  it("sorts object keys at every level and keeps array order", () => {
    expect(stableJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
    expect(stableJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("writes plain values as JSON does", () => {
    expect(stableJson("x")).toBe('"x"');
    expect(stableJson(null)).toBe("null");
    expect(stableJson(3)).toBe("3");
  });
});

describe("hasUnsavedEdits", () => {
  it("is false for the same content, whatever the key order", () => {
    expect(hasUnsavedEdits({ title: "T", links: [] }, { links: [], title: "T" })).toBe(false);
  });

  it("is true for any difference, nested ones and array order included", () => {
    expect(hasUnsavedEdits({ title: "T2" }, { title: "T" })).toBe(true);
    expect(hasUnsavedEdits({ p: [{ id: "a" }] }, { p: [{ id: "b" }] })).toBe(true);
    expect(hasUnsavedEdits({ p: ["a", "b"] }, { p: ["b", "a"] })).toBe(true);
    expect(hasUnsavedEdits({ v: "x" }, { v: "" })).toBe(true);
    expect(hasUnsavedEdits({ v: "<p>x</p>" }, { v: null })).toBe(true);
  });

  it("treats a missing baseline as unsaved", () => {
    expect(hasUnsavedEdits({ title: "T" }, null)).toBe(true);
    expect(hasUnsavedEdits({ title: "T" }, undefined)).toBe(true);
  });
});

// --- mentions: what the server fills in for the reader is not an edit --------

const CARD = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";
const OTHER = "1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02";
const span = (label: string, extra = "") =>
  `<span data-type="mention" data-kind="card" data-id="${CARD}"${extra}>${label}</span>`;

const DECISION: ArchitectureDecision = {
  id: "adr-1",
  reference_number: "ADR-001",
  title: "Adopt Kafka",
  status: "draft",
  context: `<p>uses ${span("@SAP ERP", ' data-archived="true"')}</p>`,
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
};

describe("hasUnsavedEdits with mentions (decision editor)", () => {
  it("a decision just loaded and re-serialised by the editor has no edits", () => {
    const stored = storedPayload(DECISION);
    // The editor writes the archived flag in its own place in the tag.
    const editor = {
      ...contentFromDetail(DECISION),
      context: `<p>uses <span data-type="mention" data-archived="true" data-id="${CARD}" data-kind="card">@SAP ERP</span></p>`,
    };
    expect(hasUnsavedEdits(buildSavePayload(editor, false), stored)).toBe(false);
  });

  it("a card renamed since the load is not an edit", () => {
    const stored = storedPayload({ ...DECISION, context: `<p>uses ${span("@SAP S/4HANA")}</p>` });
    const editor = buildSavePayload(contentFromDetail(DECISION), false);
    expect(hasUnsavedEdits(editor, stored)).toBe(false);
  });

  it("adding, retargeting or removing a mention is an edit", () => {
    const stored = storedPayload(DECISION);
    const base = contentFromDetail(DECISION);
    const added = { ...base, context: `${base.context}<p>${span("@SAP ERP")}</p>` };
    const retargeted = { ...base, context: base.context.replace(CARD, OTHER) };
    const removed = { ...base, context: "<p>uses </p>" };
    expect(hasUnsavedEdits(buildSavePayload(added, false), stored)).toBe(true);
    expect(hasUnsavedEdits(buildSavePayload(retargeted, false), stored)).toBe(true);
    expect(hasUnsavedEdits(buildSavePayload(removed, false), stored)).toBe(true);
  });

  it("a restricted mention compares on its token", () => {
    const tok = (t: string) =>
      `<p><span data-type="mention" data-kind="card" data-restricted="true" data-token="${t}"></span></p>`;
    expect(hasUnsavedEdits({ c: tok("ab12cd34") }, { c: tok("ab12cd34") })).toBe(false);
    expect(hasUnsavedEdits({ c: tok("ab12cd34") }, { c: tok("ef56ab78") })).toBe(true);
  });
});

describe("hasUnsavedEdits with mentions (SoAW editor)", () => {
  const soaw = (content: string): SoAW => ({
    id: "s1",
    name: "Doc",
    initiative_id: null,
    status: "draft",
    document_info: { prepared_by: "", reviewed_by: "", review_date: "" },
    version_history: [],
    sections: {
      "1.1": { content, hidden: false },
      custom_1: { content, hidden: false, title: "Extra", insertAfter: "1.1" } as never,
    },
    revision_number: 1,
    parent_id: null,
    signatories: [],
    signed_at: null,
  });
  const fields = (doc: SoAW) => soawEditorFields(soawStateFromLoaded(doc));

  it("a loaded document has no edits, and a rename is not one", () => {
    const stored = fields(soaw(`<p>${span("@SAP ERP")}</p>`));
    expect(hasUnsavedEdits(fields(soaw(`<p>${span("@SAP ERP")}</p>`)), stored)).toBe(false);
    expect(hasUnsavedEdits(fields(soaw(`<p>${span("@SAP S/4HANA")}</p>`)), stored)).toBe(false);
  });

  it("a mention added in a custom section is an edit", () => {
    const stored = fields(soaw("<p>x</p>"));
    const state = soawStateFromLoaded(soaw("<p>x</p>"));
    state.customSections[0] = { ...state.customSections[0], content: `<p>x ${span("@SAP ERP")}</p>` };
    expect(hasUnsavedEdits(soawEditorFields(state), stored)).toBe(true);
  });
});

// --- empty is empty: what the editor writes for a section never filled -------

describe("isEmptyEditorValue", () => {
  it("is true for no value and for empty paragraphs, breaks and spaces", () => {
    for (const v of [null, undefined, "", "   ", "<p></p>", "<p><br></p>", "<p> </p><p></p>", "<p>&nbsp;</p>", "<br/>", "<P class=\"x\"></P>"]) {
      expect(isEmptyEditorValue(v), String(v)).toBe(true);
    }
  });

  it("is false for text, a mention, any other markup, and non-strings", () => {
    for (const v of [
      "x",
      "<p>x</p>",
      '<p><span data-type="mention" data-kind="card" data-id="c"></span></p>',
      "<hr>",
      "<ul><li></li></ul>",
      "<pre></pre>",
      0,
      false,
      [],
      {},
    ]) {
      expect(isEmptyEditorValue(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe("hasUnsavedEdits with empty sections", () => {
  it("treats null, a missing value, an empty string and an empty paragraph alike", () => {
    expect(hasUnsavedEdits({ v: null }, { v: "" })).toBe(false);
    expect(hasUnsavedEdits({ v: "<p></p>" }, { v: null })).toBe(false);
    expect(hasUnsavedEdits({ v: "<p><br></p>" }, { v: "" })).toBe(false);
    expect(hasUnsavedEdits({ v: "  " }, { v: undefined })).toBe(false);
    expect(hasUnsavedEdits({ a: ["<p></p>"] }, { a: [null] })).toBe(false);
  });

  it("an untouched decision whose sections the editor wrote as empty paragraphs has no edits", () => {
    const stored = storedPayload(DECISION);
    const editor = { ...contentFromDetail(DECISION), decision: "<p></p>", consequences: "<p></p>", alternatives: "<p></p>" };
    expect(hasUnsavedEdits(buildSavePayload(editor, false), stored)).toBe(false);
    const typed = { ...editor, decision: "<p>Go</p>" };
    expect(hasUnsavedEdits(buildSavePayload(typed, false), stored)).toBe(true);
  });

  it("an untouched SoAW whose sections, custom ones included, the editor wrote as empty paragraphs has no edits", () => {
    const doc: SoAW = {
      id: "s1",
      name: "Doc",
      initiative_id: null,
      status: "draft",
      document_info: { prepared_by: "", reviewed_by: "", review_date: "" },
      version_history: [],
      sections: {
        "1.1": { content: "", hidden: false },
        custom_1: { content: null, hidden: false, title: "Extra", insertAfter: "1.1" } as never,
      },
      revision_number: 1,
      parent_id: null,
      signatories: [],
      signed_at: null,
    };
    const stored = soawEditorFields(soawStateFromLoaded(doc));
    const state = soawStateFromLoaded(doc);
    for (const key of Object.keys(state.sections)) {
      state.sections[key] = { ...state.sections[key], content: "<p></p>" };
    }
    state.customSections[0] = { ...state.customSections[0], content: "<p></p>" };
    expect(hasUnsavedEdits(soawEditorFields(state), stored)).toBe(false);
    state.customSections[0] = { ...state.customSections[0], content: "<p>x</p>" };
    expect(hasUnsavedEdits(soawEditorFields(state), stored)).toBe(true);
  });
});
