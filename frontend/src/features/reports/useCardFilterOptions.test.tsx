/**
 * The options `CardFilterSection` offers for one card type, shared by the
 * Lifecycle report and the web portal dialog.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import {
  APPLICATION_TYPE,
  IT_COMPONENT_TYPE,
  makeCardType,
  makeField,
  makeSection,
} from "@/test/fixtures/metamodel";
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
      canViewCosts: false,
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
      catalog: [],
      kindByKey: new Map(),
    });
  });

  it("offers no fields or subtypes for a type the metamodel does not carry", () => {
    const out = run({ cardTypeKey: "Unknown", relationTypes: [] });
    expect(out.subtypeOptions).toEqual([]);
    expect(out.facetFields).toEqual([]);
    expect(out.catalog).toEqual([]);
  });

  it("builds the filter catalog: sections labelled, hidden ones offered but not shown (#1425)", () => {
    const risk = makeField({
      key: "risk",
      label: "Risk",
      type: "single_select",
      options: [{ key: "high", label: "High", translations: { de: "Hoch" } }],
      translations: { de: "Risiko" },
    });
    const flag = makeField({ key: "flag", label: "Flag", type: "boolean" });
    withMetamodel([
      makeCardType({
        key: "Gadget",
        label: "Gadget",
        fields_schema: [
          makeSection({ section: "__description", fields: [flag] }),
          makeSection({
            section: "Compliance",
            hideInFilters: true,
            translations: { de: "Konformität" },
            fields: [risk, makeField({ key: "note", label: "Note", type: "text" })],
          }),
        ],
      }),
    ]);
    const { catalog, facetFields } = run({ cardTypeKey: "Gadget", relationTypes: [] });
    expect(catalog.map((s) => [s.key, s.label, s.hidden])).toEqual([
      ["__description", "Description", false],
      ["Compliance", "Compliance", true],
    ]);
    expect(catalog[0].fields[0].shownByDefault).toBe(true);
    // A yes/no field gains its Yes / No options, as everywhere else.
    expect(catalog[0].fields[0].field.options?.map((o) => o.label)).toEqual(["Yes", "No"]);
    // The text field is added through "Add filter", never shown by default.
    expect(catalog[1].fields.map((f) => [f.field.key, f.kind, f.shownByDefault])).toEqual([
      ["risk", "facet", false],
      ["note", "text", false],
    ]);
    // The matcher still reads every facet field, the hidden section's included,
    // and no text field.
    expect(facetFields.map((f) => f.key)).toEqual(["flag", "risk"]);
  });

  it("offers a cost field only when told the reader may see costs, and maps every kind", () => {
    const keysOf = (canViewCosts: boolean) =>
      run({ canViewCosts }).catalog.flatMap((s) => s.fields.map((f) => f.field.key));
    expect(keysOf(false)).not.toContain("costTotalAnnual");
    expect(keysOf(true)).toContain("costTotalAnnual");
    const { kindByKey, facetFields } = run({ canViewCosts: true });
    expect(kindByKey.get("alias")).toBe("text");
    expect(kindByKey.get("costTotalAnnual")).toBe("number");
    expect(kindByKey.get("goLiveDate")).toBe("date");
    expect(kindByKey.get("businessCriticality")).toBe("facet");
    expect(facetFields.every((f) => kindByKey.get(f.key) === "facet")).toBe(true);
    expect(facetFields.map((f) => f.key)).not.toContain("alias");
  });
});
