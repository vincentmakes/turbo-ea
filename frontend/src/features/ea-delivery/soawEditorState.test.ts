import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/client";
import {
  canRequestSoawSignatures,
  canReviseSoaw,
  reviseRefusal,
  soawCurrentRevisionId,
  soawSavePayload,
  type SoawEditorFields,
} from "./soawEditorState";

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
