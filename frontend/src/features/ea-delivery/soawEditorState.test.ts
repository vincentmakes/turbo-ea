import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";
import type { SoAW } from "@/types";
import {
  EMPTY_DOC_INFO,
  EMPTY_VERSION_ROW,
  canRequestSoawSignatures,
  canReviseSoaw,
  canSaveSoaw,
  reviseRefusal,
  soawCurrentRevisionId,
  soawEditorFields,
  soawSavePayload,
  soawStateFromLoaded,
  type SoawEditorFields,
} from "./soawEditorState";
import { buildDefaultSections } from "./soawTemplate";

const fields: SoawEditorFields = {
  name: "Doc",
  initiative_id: "init-1",
  document_info: { prepared_by: "A", reviewed_by: "B", review_date: "" },
  version_history: [],
  sections: { s1: { content: "x" } },
};

describe("soawSavePayload", () => {
  it("sends only the initiative link while in review", () => {
    expect(soawSavePayload("in_review", fields)).toEqual({ initiative_id: "init-1" });
    expect(soawSavePayload("in_review", { ...fields, initiative_id: null })).toEqual({
      initiative_id: null,
    });
  });

  it("sends everything in any other status", () => {
    expect(soawSavePayload("draft", fields)).toBe(fields);
    expect(soawSavePayload("approved", fields)).toBe(fields);
  });
});

describe("canRequestSoawSignatures", () => {
  it("is offered on a draft or an approved document only", () => {
    expect(canRequestSoawSignatures("draft")).toBe(true);
    expect(canRequestSoawSignatures("approved")).toBe(true);
    expect(canRequestSoawSignatures("in_review")).toBe(false);
    expect(canRequestSoawSignatures("signed")).toBe(false);
  });
});

describe("canReviseSoaw", () => {
  it("is offered on a signed document that is not an earlier revision", () => {
    expect(canReviseSoaw("signed", { is_earlier_revision: false })).toBe(true);
    expect(canReviseSoaw("signed", null)).toBe(true);
    expect(canReviseSoaw("signed", { is_earlier_revision: true })).toBe(false);
    expect(canReviseSoaw("draft", { is_earlier_revision: false })).toBe(false);
    expect(canReviseSoaw("in_review", undefined)).toBe(false);
  });
});

describe("reviseRefusal", () => {
  it("reads an open revision and its id", () => {
    const err = new ApiError("x", 409, { error: "open_revision_exists", revision_id: "r2" });
    expect(reviseRefusal(err)).toEqual({ kind: "open_revision_exists", revisionId: "r2" });
  });

  it("reads a not-revisable refusal", () => {
    const err = new ApiError("x", 409, { error: "not_revisable", reason: "not_latest" });
    expect(reviseRefusal(err)).toEqual({ kind: "not_revisable" });
  });

  it("is null for anything else", () => {
    expect(reviseRefusal(new ApiError("x", 400, { error: "not_revisable" }))).toBeNull();
    expect(reviseRefusal(new ApiError("x", 409, "Conflict"))).toBeNull();
    expect(reviseRefusal(new ApiError("x", 409, null))).toBeNull();
    expect(reviseRefusal(new ApiError("x", 409, { error: "open_revision_exists" }))).toBeNull();
    expect(reviseRefusal(new ApiError("x", 409, { error: "other" }))).toBeNull();
    expect(reviseRefusal(new Error("boom"))).toBeNull();
    expect(reviseRefusal(null)).toBeNull();
    expect(reviseRefusal("409")).toBeNull();
  });
});

describe("soawCurrentRevisionId", () => {
  const revisions = [
    { id: "r1", name: "D", revision_number: 1, status: "signed" as const },
    { id: "r2", name: "D", revision_number: 2, status: "signed" as const },
    { id: "r3", name: "D", revision_number: 3, status: "draft" as const },
  ];

  it("is the document itself when it is current", () => {
    expect(soawCurrentRevisionId({ id: "r2", is_current: true, revisions })).toBe("r2");
  });

  it("is the successor on an earlier revision", () => {
    expect(
      soawCurrentRevisionId({
        id: "r1",
        is_current: false,
        is_earlier_revision: true,
        superseded_by: { id: "r2", name: "D", revision_number: 2 },
        revisions,
      }),
    ).toBe("r2");
  });

  it("is the last signed revision on an open revision, null without one", () => {
    expect(soawCurrentRevisionId({ id: "r3", is_current: false, revisions })).toBe("r2");
    expect(
      soawCurrentRevisionId({
        id: "r3",
        is_current: false,
        revisions: [{ id: "r3", name: "D", revision_number: 3, status: "draft" }],
      }),
    ).toBeNull();
    expect(soawCurrentRevisionId({ id: "x", is_current: false })).toBeNull();
  });
});

const LOADED: SoAW = {
  id: "s1",
  name: "Doc",
  initiative_id: "init-1",
  status: "draft",
  document_info: { prepared_by: "A", reviewed_by: "B", review_date: "2026-01-01" },
  version_history: [{ version: "1", date: "d", revised_by: "r", description: "x" }],
  sections: {
    "1.1": { content: "<p>Background</p>", hidden: true },
    custom_9: { content: "<p>c</p>", hidden: true, title: "Glossary", insertAfter: "1.1" } as never,
    custom_8: { content: "<p>bare</p>", hidden: false } as never,
  },
  revision_number: 1,
  parent_id: null,
  signatories: [],
  signed_at: null,
};

describe("soawStateFromLoaded", () => {
  it("merges stored sections over the template and splits off custom ones", () => {
    const state = soawStateFromLoaded(LOADED);
    const defaults = buildDefaultSections();
    expect(Object.keys(state.sections).sort()).toEqual(Object.keys(defaults).sort());
    expect(state.sections["1.1"]).toEqual({ ...defaults["1.1"], content: "<p>Background</p>", hidden: true });
    expect(state.sections["1.2"]).toEqual(defaults["1.2"]);
    expect(state.customSections).toEqual([
      { id: "custom_9", title: "Glossary", content: "<p>c</p>", insertAfter: "1.1" },
      { id: "custom_8", title: "custom_8", content: "<p>bare</p>", insertAfter: "" },
    ]);
    expect(state.name).toBe("Doc");
    expect(state.initiativeId).toBe("init-1");
    expect(state.docInfo).toEqual(LOADED.document_info);
    expect(state.versionHistory).toEqual(LOADED.version_history);
  });

  it("fills what the document lacks with the empty defaults", () => {
    const state = soawStateFromLoaded({
      ...LOADED,
      initiative_id: null,
      document_info: null as never,
      version_history: [],
      sections: undefined as never,
    });
    expect(state.initiativeId).toBe("");
    expect(state.docInfo).toEqual(EMPTY_DOC_INFO);
    expect(state.versionHistory).toEqual([EMPTY_VERSION_ROW]);
    expect(state.customSections).toEqual([]);
    expect(state.sections).toEqual(buildDefaultSections());
    expect(EMPTY_DOC_INFO).toEqual({ prepared_by: "", reviewed_by: "", review_date: "" });
    expect(EMPTY_VERSION_ROW).toEqual({ version: "", date: "", revised_by: "", description: "" });
  });
});

describe("soawEditorFields", () => {
  it("folds custom sections back, trims the name and sends no initiative as null", () => {
    const out = soawEditorFields({
      name: "  Doc  ",
      initiativeId: "",
      docInfo: EMPTY_DOC_INFO,
      versionHistory: [EMPTY_VERSION_ROW],
      sections: { "1.1": { content: "a", hidden: false } },
      customSections: [{ id: "custom_1", title: "G", content: "<p>g</p>", insertAfter: "1.1" }],
    });
    expect(out).toEqual({
      name: "Doc",
      initiative_id: null,
      document_info: EMPTY_DOC_INFO,
      version_history: [EMPTY_VERSION_ROW],
      sections: {
        "1.1": { content: "a", hidden: false },
        custom_1: { content: "<p>g</p>", hidden: false, title: "G", insertAfter: "1.1" },
      },
    });
  });

  it("round-trips a loaded document to what it stores", () => {
    const out = soawEditorFields(soawStateFromLoaded(LOADED));
    expect(out.initiative_id).toBe("init-1");
    expect(out.sections.custom_9).toEqual({ content: "<p>c</p>", hidden: false, title: "Glossary", insertAfter: "1.1" });
  });
});

describe("canSaveSoaw", () => {
  it("never on a signed document", () => {
    expect(canSaveSoaw("signed", true)).toBe(false);
    expect(canSaveSoaw("signed", false)).toBe(false);
  });

  it("in review only when the initiative link changed", () => {
    expect(canSaveSoaw("in_review", true)).toBe(true);
    expect(canSaveSoaw("in_review", false)).toBe(false);
  });

  it("always on a draft or an approved document", () => {
    expect(canSaveSoaw("draft", false)).toBe(true);
    expect(canSaveSoaw("approved", false)).toBe(true);
  });
});
