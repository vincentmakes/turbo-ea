import { describe, expect, it } from "vitest";
import type { DataQualityFactor } from "@/types";
import {
  SECTION_SCROLL_MARGIN_TOP,
  customSectionAnchor,
  jumpTargetFor,
  relationGroupAnchor,
  sectionAnchor,
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

  it("keeps the app bar clearance", () => {
    expect(SECTION_SCROLL_MARGIN_TOP).toBe(72);
  });
});

describe("jumpTargetFor", () => {
  it("sends a field to its attribute section", () => {
    expect(jumpTargetFor(factor({ kind: "field", key: "cost", section: "Cost Data" }))).toEqual({
      tab: "card",
      anchor: "card-section-custom-cost-data",
      sectionAnchor: "card-section-custom-cost-data",
    });
  });

  it("sends a field without a section to the empty slug", () => {
    expect(jumpTargetFor(factor({ kind: "field", section: null }))).toEqual({
      tab: "card",
      anchor: "card-section-custom-",
      sectionAnchor: "card-section-custom-",
    });
  });

  it("sends a __description field to the Description section", () => {
    expect(jumpTargetFor(factor({ kind: "field", section: "__description" }))).toEqual({
      tab: "card",
      anchor: "card-section-description",
      sectionAnchor: "card-section-description",
    });
  });

  it("sends description, lifecycle and tag groups to their sections", () => {
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
    });
  });

  it("sends a relation to its group, falling back to the Relations section", () => {
    expect(jumpTargetFor(factor({ kind: "relation", key: "relX", side: "target" }))).toEqual({
      tab: "card",
      anchor: "card-relation-relX-target",
      sectionAnchor: "card-section-relations",
    });
    expect(jumpTargetFor(factor({ kind: "relation", key: "relX", side: "source" }))).toEqual({
      tab: "card",
      anchor: "card-relation-relX-source",
      sectionAnchor: "card-section-relations",
    });
    expect(jumpTargetFor(factor({ kind: "relation", key: "relX", side: null }))).toEqual({
      tab: "card",
      anchor: "card-relation-relX-source",
      sectionAnchor: "card-section-relations",
    });
  });

  it("sends stakeholders to the Stakeholders tab", () => {
    expect(jumpTargetFor(factor({ kind: "stakeholders", key: "stakeholders" }))).toEqual({
      tab: "stakeholders",
    });
  });
});
