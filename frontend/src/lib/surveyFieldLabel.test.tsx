/**
 * A relation field's label is a snapshot taken when the survey was built, in
 * the author's language — and, before #1091, with a lineage verb that meant the
 * same thing in both directions. Resolving against the live metamodel is what
 * retro-fixes both: each reader gets their own language, and a survey saved
 * before the verb was corrected picks the correction up.
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

import i18n from "@/i18n";
import { useSurveyFieldLabel, useSurveyRelationFieldLabel } from "./surveyFieldLabel";

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
  it("labels a lineage field with its verb, like any other relation type", () => {
    // Not "Predecessors" / "Successors": those nouns belong to card detail's
    // dedicated Lineage section, not to a list of relation types.
    expect(
      resolve(field({ relation_type_key: "relAppSuccessor", direction: "outgoing" })),
    ).toBe("succeeds");
    expect(
      resolve(field({ relation_type_key: "relAppSuccessor", direction: "incoming" })),
    ).toBe("is succeeded by");
  });

  it("re-resolves a stale noun snapshot to the live verb", () => {
    // Surveys saved while the builder wrote nouns must not keep rendering them.
    expect(
      resolve(
        field({
          relation_type_key: "relAppSuccessor",
          direction: "outgoing",
          label: "Predecessors",
        }),
      ),
    ).toBe("succeeds");
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

describe("useSurveyFieldLabel (#1257)", () => {
  it("names a lifecycle field by its phase, not its stored label", () => {
    const { result } = renderHook(() => useSurveyFieldLabel());
    expect(result.current(field({ kind: "lifecycle", phase: "phaseOut", type: "date" }))).toBe(
      i18n.t("common:lifecycle.phaseOut"),
    );
    // No phase → the stored label.
    expect(result.current(field({ kind: "lifecycle", type: "date" }))).toBe("stale label");
  });

  it("names a stakeholder field by the live role label when the caller knows it", () => {
    const roles: Record<string, string> = { observer: "Watcher" };
    const { result } = renderHook(() => useSurveyFieldLabel((k) => roles[k]));
    expect(result.current(field({ kind: "stakeholder", role: "observer", label: "Observer" }))).toBe(
      "Watcher",
    );
    // A role the caller does not know falls back to the stored label …
    expect(result.current(field({ kind: "stakeholder", role: "gone", label: "Old role" }))).toBe(
      "Old role",
    );
    // … and, without one, to the role key.
    expect(result.current(field({ kind: "stakeholder", role: "gone", label: "" }))).toBe("gone");
  });

  it("uses the stored label translations without a role lookup", () => {
    const { result } = renderHook(() => useSurveyFieldLabel());
    expect(
      result.current(
        field({
          kind: "stakeholder",
          role: "observer",
          label: "Observer",
          translations: { [i18n.language]: "Beobachter" },
        }),
      ),
    ).toBe("Beobachter");
  });

  it("delegates relations to the live verb and attributes to the field label", () => {
    const { result } = renderHook(() => useSurveyFieldLabel());
    expect(
      result.current(field({ relation_type_key: "relAppToItc", direction: "incoming" })),
    ).toBe("is used by");
    expect(
      result.current(field({ kind: undefined, type: "text", key: "alias", label: "Alias" })),
    ).toBe("Alias");
  });
});
