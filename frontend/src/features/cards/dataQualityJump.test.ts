import { describe, expect, it } from "vitest";
import type { DataQualityFactor } from "@/types";
import {
  SECTION_SCROLL_MARGIN,
  SECTION_SCROLL_MARGIN_TOP,
  SECTION_SCROLL_MARGIN_VAR,
  customSectionAnchor,
  jumpTargetFor,
  relationGroupAnchor,
  sectionAnchor,
  tabAnchor,
} from "./dataQualityJump";

function factor(over: Partial<DataQualityFactor>): DataQualityFactor {
  return {
    kind: "field",
    key: "k",
    weight: 1,
    filled: false,
    score_if_filled: 50,
    gain: 10,
    ...over,
  };
}

describe("anchor builders", () => {
  it("names the built-in sections", () => {
    expect(sectionAnchor("description")).toBe("card-section-description");
    expect(sectionAnchor("lifecycle")).toBe("card-section-lifecycle");
    expect(sectionAnchor("tags")).toBe("card-section-tags");
    expect(sectionAnchor("relations")).toBe("card-section-relations");
    expect(sectionAnchor("hierarchy")).toBe("card-section-hierarchy");
  });

  it("names a card tab's panel", () => {
    expect(tabAnchor("stakeholders")).toBe("card-tab-stakeholders");
  });

  it("slugs a custom section name", () => {
    expect(customSectionAnchor("Business Details")).toBe("card-section-custom-business-details");
    expect(customSectionAnchor("Coût total")).toBe("card-section-custom-co-t-total");
    expect(customSectionAnchor("Risk & / Compliance")).toBe("card-section-custom-risk-compliance");
    expect(customSectionAnchor("keep_this-ONE9")).toBe("card-section-custom-keep_this-one9");
    expect(customSectionAnchor("")).toBe("card-section-custom-");
  });

  it("names a relation group by type and side", () => {
    expect(relationGroupAnchor("relAppToITC", "source")).toBe("card-relation-relAppToITC-source");
    expect(relationGroupAnchor("relAppToITC", "target")).toBe("card-relation-relAppToITC-target");
  });

  it("keeps the app bar clearance, which a page can widen through one CSS variable", () => {
    expect(SECTION_SCROLL_MARGIN_TOP).toBe(72);
    expect(SECTION_SCROLL_MARGIN_VAR).toBe("--card-section-scroll-margin");
    expect(SECTION_SCROLL_MARGIN).toBe("var(--card-section-scroll-margin, 72px)");
  });
});

describe("jumpTargetFor", () => {
  it("sends a field to its attribute section, naming the field to focus", () => {
    expect(jumpTargetFor(factor({ kind: "field", key: "cost", section: "Cost Data" }))).toEqual({
      tab: "card",
      anchor: "card-section-custom-cost-data",
      sectionAnchor: "card-section-custom-cost-data",
      fieldKey: "cost",
    });
  });

  it("sends a field without a section to the empty slug", () => {
    expect(jumpTargetFor(factor({ kind: "field", section: null }))).toEqual({
      tab: "card",
      anchor: "card-section-custom-",
      sectionAnchor: "card-section-custom-",
      fieldKey: "k",
    });
  });

  it("sends a __description field to the Description section, naming the field", () => {
    expect(
      jumpTargetFor(factor({ kind: "field", key: "businessCriticality", section: "__description" })),
    ).toEqual({
      tab: "card",
      anchor: "card-section-description",
      sectionAnchor: "card-section-description",
      fieldKey: "businessCriticality",
    });
  });

  it("sends description, lifecycle and tag groups to their sections, a tag group by id", () => {
    expect(jumpTargetFor(factor({ kind: "description", key: "description" }))).toEqual({
      tab: "card",
      anchor: "card-section-description",
      sectionAnchor: "card-section-description",
    });
    expect(jumpTargetFor(factor({ kind: "lifecycle", key: "lifecycle" }))).toEqual({
      tab: "card",
      anchor: "card-section-lifecycle",
      sectionAnchor: "card-section-lifecycle",
    });
    expect(jumpTargetFor(factor({ kind: "tag_group", key: "g1", name: "Domain" }))).toEqual({
      tab: "card",
      anchor: "card-section-tags",
      sectionAnchor: "card-section-tags",
      tagGroupId: "g1",
    });
  });

  it("sends a relation to its group, falling back to the Relations section, with its type and side", () => {
    expect(jumpTargetFor(factor({ kind: "relation", key: "relX", side: "target" }))).toEqual({
      tab: "card",
      anchor: "card-relation-relX-target",
      sectionAnchor: "card-section-relations",
      relation: { type: "relX", side: "target" },
    });
    expect(jumpTargetFor(factor({ kind: "relation", key: "relX", side: "source" }))).toEqual({
      tab: "card",
      anchor: "card-relation-relX-source",
      sectionAnchor: "card-section-relations",
      relation: { type: "relX", side: "source" },
    });
    expect(jumpTargetFor(factor({ kind: "relation", key: "relX", side: null }))).toEqual({
      tab: "card",
      anchor: "card-relation-relX-source",
      sectionAnchor: "card-section-relations",
      relation: { type: "relX", side: "source" },
    });
  });

  it("sends stakeholders to the Stakeholders tab", () => {
    expect(jumpTargetFor(factor({ kind: "stakeholders", key: "stakeholders" }))).toEqual({
      tab: "stakeholders",
    });
  });
});
