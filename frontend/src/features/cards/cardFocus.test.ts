import { describe, expect, it } from "vitest";
import type { CardPanelFocus, CardType, RelationType } from "@/types";
import { cardFocusKey, resolveCardFocus } from "./cardFocus";
import { jumpTargetFor } from "./dataQualityJump";

const TYPE = {
  key: "Widget",
  fields_schema: [
    {
      section: "__description",
      fields: [{ key: "summaryLevel", label: "Summary level", type: "text" }],
    },
    {
      section: "Run Costs",
      fields: [
        { key: "alphaCost", label: "Alpha cost", type: "number" },
        { key: "betaOwner", label: "Beta owner", type: "text" },
      ],
    },
  ],
} as unknown as CardType;

const RELATIONS = [
  { key: "relWidgetToGadget", source_type_key: "Widget", target_type_key: "Gadget" },
  { key: "relGadgetToWidget", source_type_key: "Gadget", target_type_key: "Widget" },
  { key: "relWidgetToWidget", source_type_key: "Widget", target_type_key: "Widget" },
] as unknown as RelationType[];

const resolve = (focus: CardPanelFocus | null | undefined) =>
  resolveCardFocus(focus, TYPE, RELATIONS);

describe("resolveCardFocus — field", () => {
  it("sends a field to the attribute section that holds it, naming the field", () => {
    expect(resolve({ field: "betaOwner" })).toEqual({
      tab: "card",
      anchor: "card-section-custom-run-costs",
      sectionAnchor: "card-section-custom-run-costs",
      fieldKey: "betaOwner",
    });
  });

  it("sends a __description field to the Description section", () => {
    expect(resolve({ field: "summaryLevel" })).toEqual({
      tab: "card",
      anchor: "card-section-description",
      sectionAnchor: "card-section-description",
      fieldKey: "summaryLevel",
    });
  });

  it("lands where the field's data-quality row would", () => {
    const factor = {
      kind: "field" as const,
      key: "alphaCost",
      section: "Run Costs",
      weight: 1,
      filled: false,
      score_if_filled: 50,
      gain: 10,
    };
    expect(resolve({ field: "alphaCost" })).toEqual(jumpTargetFor(factor));
  });

  it("resolves nothing for a field the type does not carry", () => {
    expect(resolve({ field: "noSuchField" })).toBeNull();
    expect(resolve({ field: "" })).toBeNull();
  });

  it("resolves nothing without a loaded type, and tolerates a type without a schema", () => {
    expect(resolveCardFocus({ field: "alphaCost" }, undefined, RELATIONS)).toBeNull();
    expect(resolveCardFocus({ section: "tags" }, null, RELATIONS)).toBeNull();
    const bare = { key: "Widget" } as unknown as CardType;
    expect(resolveCardFocus({ field: "alphaCost" }, bare, RELATIONS)).toBeNull();
  });
});

describe("resolveCardFocus — relation", () => {
  it("sends a relation without a side to the source group of a source-end card", () => {
    expect(resolve({ relation: { type: "relWidgetToGadget" } })).toEqual({
      tab: "card",
      anchor: "card-relation-relWidgetToGadget-source",
      sectionAnchor: "card-section-relations",
      relation: { type: "relWidgetToGadget", side: "source" },
    });
  });

  it("honours the target side", () => {
    expect(resolve({ relation: { type: "relGadgetToWidget", side: "target" } })).toEqual({
      tab: "card",
      anchor: "card-relation-relGadgetToWidget-target",
      sectionAnchor: "card-section-relations",
      relation: { type: "relGadgetToWidget", side: "target" },
    });
  });

  it("infers the target side when the card's type is only the target", () => {
    expect(resolve({ relation: { type: "relGadgetToWidget" } })).toEqual({
      tab: "card",
      anchor: "card-relation-relGadgetToWidget-target",
      sectionAnchor: "card-section-relations",
      relation: { type: "relGadgetToWidget", side: "target" },
    });
  });

  it("infers the source side on a self-relation, and honours an explicit side there", () => {
    expect(resolve({ relation: { type: "relWidgetToWidget" } })?.relation).toEqual({
      type: "relWidgetToWidget",
      side: "source",
    });
    expect(
      resolve({ relation: { type: "relWidgetToWidget", side: "target" } })?.relation,
    ).toEqual({ type: "relWidgetToWidget", side: "target" });
  });

  it("resolves nothing for an unknown type or an explicit end the card's type is not on", () => {
    expect(resolve({ relation: { type: "relNope" } })).toBeNull();
    expect(resolve({ relation: { type: "relGadgetToWidget", side: "source" } })).toBeNull();
    expect(resolve({ relation: { type: "relWidgetToGadget", side: "target" } })).toBeNull();
    const elsewhere = [{ key: "relOther", source_type_key: "Gadget", target_type_key: "Gadget" }];
    expect(
      resolveCardFocus({ relation: { type: "relOther" } }, TYPE, elsewhere as never),
    ).toBeNull();
    expect(
      resolveCardFocus({ relation: { type: "relWidgetToGadget" } }, TYPE, undefined),
    ).toBeNull();
  });
});

describe("resolveCardFocus — section and precedence", () => {
  it("sends each built-in section to its anchor", () => {
    for (const key of ["description", "lifecycle", "tags", "relations", "hierarchy"] as const) {
      expect(resolve({ section: key })).toEqual({
        tab: "card",
        anchor: `card-section-${key}`,
        sectionAnchor: `card-section-${key}`,
      });
    }
  });

  it("resolves nothing for an unknown section, an empty focus or no focus", () => {
    expect(resolve({ section: "nope" as never })).toBeNull();
    expect(resolve({})).toBeNull();
    expect(resolve(null)).toBeNull();
    expect(resolve(undefined)).toBeNull();
  });

  it("prefers the field, then the relation, then the section", () => {
    const all: CardPanelFocus = {
      field: "alphaCost",
      relation: { type: "relWidgetToGadget" },
      section: "tags",
    };
    expect(resolve(all)?.anchor).toBe("card-section-custom-run-costs");
    expect(resolve({ relation: all.relation, section: "tags" })?.anchor).toBe(
      "card-relation-relWidgetToGadget-source",
    );
  });

  it("falls through to the next one when the preferred one does not resolve", () => {
    expect(
      resolve({ field: "noSuchField", relation: { type: "relWidgetToGadget" }, section: "tags" })
        ?.anchor,
    ).toBe("card-relation-relWidgetToGadget-source");
    expect(resolve({ field: "noSuchField", section: "tags" })?.anchor).toBe("card-section-tags");
  });
});

describe("cardFocusKey", () => {
  it("is null for no focus or one that names nothing", () => {
    expect(cardFocusKey(null)).toBeNull();
    expect(cardFocusKey(undefined)).toBeNull();
    expect(cardFocusKey({})).toBeNull();
    expect(cardFocusKey({ field: "", section: "nope" as never })).toBeNull();
    expect(cardFocusKey({ relation: { type: "" } })).toBeNull();
  });

  it("is equal for equal focuses whatever their identity or key order", () => {
    expect(cardFocusKey({ field: "a", section: "tags" })).toBe(
      cardFocusKey({ section: "tags", field: "a" }),
    );
    expect(cardFocusKey({ relation: { type: "r", side: "target" } })).toBe(
      cardFocusKey({ relation: { side: "target", type: "r" } }),
    );
  });

  it("differs when any part of the place differs", () => {
    const keys = [
      cardFocusKey({ field: "a" }),
      cardFocusKey({ field: "b" }),
      cardFocusKey({ section: "tags" }),
      cardFocusKey({ section: "lifecycle" }),
      cardFocusKey({ relation: { type: "r" } }),
      cardFocusKey({ relation: { type: "r", side: "source" } }),
      cardFocusKey({ relation: { type: "r", side: "target" } }),
      cardFocusKey({ relation: { type: "q" } }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => typeof k === "string")).toBe(true);
  });
});
