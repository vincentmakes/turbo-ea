/**
 * The options `CardFilterSection` offers for one card type, shared by the
 * Lifecycle report and the web portal dialog.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { APPLICATION_TYPE, IT_COMPONENT_TYPE, makeCardType } from "@/test/fixtures/metamodel";
import { withMetamodel } from "@/test/hooks";
import { useCardFilterOptions, type CardFilterOptionsInput } from "./useCardFilterOptions";
import type { RelTypeDef } from "./portfolioHelpers";

const OWNS: RelTypeDef = {
  key: "relOrgOwnsApp",
  label: "owns",
  reverse_label: "is owned by",
  source_type_key: "Organization",
  target_type_key: "Application",
  other_type_key: "Organization",
  attributes_schema: [
    { key: "kind", label: "Kind", type: "single_select", options: [{ key: "legal", label: "Legal" }] },
  ],
} as RelTypeDef;
const USES: RelTypeDef = { ...OWNS, key: "relOrgUsesApp", label: "uses", reverse_label: "is used by", attributes_schema: [] } as RelTypeDef;

const GROUPABLE = {
  Organization: [
    { id: "org-1", name: "Corp", parent_id: null },
    { id: "org-0", name: "Holding", parent_id: null, ancestor_only: true },
  ],
};

function run(input: Partial<CardFilterOptionsInput> = {}) {
  return renderHook(() =>
    useCardFilterOptions({
      cardTypeKey: "Application",
      relationTypes: [OWNS, USES],
      groupableTypes: GROUPABLE,
      includeDescendants: false,
      ...input,
    }),
  ).result.current;
}

const ORGANIZATION_TYPE = makeCardType({ key: "Organization", label: "Organization", icon: "corporate_fare", has_hierarchy: true });

beforeEach(() => withMetamodel([APPLICATION_TYPE, IT_COMPONENT_TYPE, ORGANIZATION_TYPE]));

describe("useCardFilterOptions", () => {
  it("offers a related-by facet per card type, then one per relation side reaching it", () => {
    const { relationOptions } = run();
    expect(relationOptions.map((o) => [o.typeKey, o.label])).toEqual([
      ["Organization", "Organization"],
      ["relOrgOwnsApp", "Organization · is owned by"],
      ["relOrgUsesApp", "Organization · is used by"],
    ]);
    // A card that only completes the hierarchy is offered with sub-cards only.
    expect(relationOptions[0].options.map((o) => o.key)).toEqual(["org-1"]);
    expect(relationOptions[0]).toMatchObject({ icon: "corporate_fare", hierarchical: true });
  });

  it("includes hierarchy-only cards once sub-cards are included", () => {
    const { relationOptions } = run({ includeDescendants: true });
    expect(relationOptions[0].options.map((o) => o.key)).toEqual(["org-1", "org-0"]);
  });

  it("labels the relation subtypes by the verb read from the card's side", () => {
    const { relSubtypes } = run();
    expect(relSubtypes.map((s) => [s.composite, s.comboLabel])).toEqual([
      ["relOrgOwnsApp::kind", "is owned by · Kind"],
    ]);
    expect(relSubtypes[0].options.map((o) => o.label)).toEqual(["Legal"]);
  });

  it("lists the type's subtypes and only its facet fields, yes/no included", () => {
    const { subtypeOptions, facetFields } = run();
    expect(subtypeOptions).toEqual([
      { key: "businessApplication", label: "Business Application" },
      { key: "microservice", label: "Microservice" },
    ]);
    expect(facetFields.map((f) => f.key)).toEqual(["businessCriticality", "isCloud", "regions"]);
    const cloud = facetFields.find((f) => f.key === "isCloud")!;
    expect(cloud.options?.map((o) => o.key)).toEqual(["true", "false"]);
  });

  it("offers nothing without a card type", () => {
    expect(run({ cardTypeKey: "" })).toEqual({
      relationOptions: [],
      relSubtypes: [],
      subtypeOptions: [],
      facetFields: [],
    });
  });

  it("offers no fields or subtypes for a type the metamodel does not carry", () => {
    const out = run({ cardTypeKey: "Unknown", relationTypes: [] });
    expect(out.subtypeOptions).toEqual([]);
    expect(out.facetFields).toEqual([]);
  });
});
