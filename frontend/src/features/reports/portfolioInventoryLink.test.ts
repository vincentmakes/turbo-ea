import { describe, it, expect } from "vitest";
import {
  INVENTORY_EMPTY_VALUE,
  buildInventorySliceUrl,
} from "./portfolioInventoryLink";
import { EMPTY_VALUE } from "@/features/inventory/InventoryFilterSidebar";

describe("buildInventorySliceUrl", () => {
  it("builds attribute-group links from the raw option key", () => {
    expect(
      buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "attribute", fieldKey: "businessCriticality" },
        group: { key: "missionCritical", label: "Mission Critical" },
      }),
    ).toBe("/inventory?type=Application&attr_businessCriticality=missionCritical");
  });

  it("builds relation-group links from the related card NAME (the inventory relation filter is name-based)", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "relation", typeKey: "Organization" },
      group: { key: "uuid-123", label: "Sales & Marketing" },
    });
    expect(url).toBe("/inventory?type=Application&rel_Organization=Sales+%26+Marketing");
    // The name round-trips through URLSearchParams parsing intact.
    expect(new URLSearchParams(url.split("?")[1]).get("rel_Organization")).toBe(
      "Sales & Marketing",
    );
  });

  it("links the ungrouped bucket to the (empty) sentinel on either axis", () => {
    expect(
      buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "attribute", fieldKey: "timeModel" },
        group: "ungrouped",
      }),
    ).toBe(`/inventory?type=Application&attr_timeModel=${INVENTORY_EMPTY_VALUE}`);
    expect(
      buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "relation", typeKey: "Organization" },
        group: "ungrouped",
      }),
    ).toBe(`/inventory?type=Application&rel_Organization=${INVENTORY_EMPTY_VALUE}`);
  });

  it("keeps the local sentinel in sync with the inventory's EMPTY_VALUE", () => {
    expect(INVENTORY_EMPTY_VALUE).toBe(EMPTY_VALUE);
  });
});
