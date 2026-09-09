/**
 * A relation field's label is a snapshot taken when the survey was built, in
 * the author's language — and, before #1091, with a lineage verb that read the
 * inverse of the side it collects. Resolving against the live metamodel is what
 * retro-fixes both.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RelationType, SurveyField } from "@/types";

const LINEAGE = {
  key: "relAppSuccessor",
  label: "succeeds",
  reverse_label: "is succeeded by",
  source_type_key: "Application",
  target_type_key: "Application",
  built_in: true,
  is_hidden: false,
  sort_order: 0,
  translations: {},
} as unknown as RelationType;

const CROSS_TYPE = {
  key: "relAppToItc",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  is_hidden: false,
  sort_order: 1,
  translations: {},
} as unknown as RelationType;

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({ types: [], relationTypes: [LINEAGE, CROSS_TYPE] }),
}));

import { useSurveyRelationFieldLabel } from "./surveyFieldLabel";

function field(over: Partial<SurveyField>): SurveyField {
  return {
    key: "rel:x:outgoing",
    section: "",
    label: "stale label",
    type: "relation",
    kind: "relation",
    action: "maintain",
    ...over,
  } as SurveyField;
}

function resolve(f: SurveyField) {
  return renderHook(() => useSurveyRelationFieldLabel()).result.current(f);
}

describe("useSurveyRelationFieldLabel", () => {
  it("renames a lineage field's outgoing side to Predecessors", () => {
    expect(
      resolve(field({ relation_type_key: "relAppSuccessor", direction: "outgoing" })),
    ).toBe("Predecessors");
  });

  it("renames a lineage field's incoming side to Successors", () => {
    expect(
      resolve(field({ relation_type_key: "relAppSuccessor", direction: "incoming" })),
    ).toBe("Successors");
  });

  it("re-resolves an ordinary relation's verb instead of the snapshot", () => {
    expect(resolve(field({ relation_type_key: "relAppToItc", direction: "outgoing" }))).toBe(
      "uses",
    );
    expect(resolve(field({ relation_type_key: "relAppToItc", direction: "incoming" }))).toBe(
      "is used by",
    );
  });

  it("falls back to the snapshot when the relation type is gone", () => {
    // Nothing live to resolve — the snapshot is the only record of what was asked.
    expect(resolve(field({ relation_type_key: "relDeleted", direction: "outgoing" }))).toBe(
      "stale label",
    );
  });

  it("falls back to the snapshot when the field carries no direction", () => {
    expect(resolve(field({ relation_type_key: "relAppToItc" }))).toBe("stale label");
  });
});
