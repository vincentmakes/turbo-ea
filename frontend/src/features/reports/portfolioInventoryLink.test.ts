import { describe, it, expect } from "vitest";
import {
  INVENTORY_EMPTY_VALUE,
  INVENTORY_NOT_SET_KEY,
  buildInventorySliceUrl,
} from "./portfolioInventoryLink";
import { EMPTY_VALUE } from "@/features/inventory/InventoryFilterSidebar";
import { NOT_SET_KEY } from "@/components/grid/rowGrouping";

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.split("?")[1]);
}

describe("buildInventorySliceUrl", () => {
  it("mirrors attribute groups: group_by + expand_group, NO value filter for the clicked group", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "attribute", fieldKey: "timeModel" },
      group: { key: "invest", label: "Invest" },
    });
    const p = paramsOf(url);
    expect(p.get("type")).toBe("Application");
    expect(p.get("group_by")).toBe("attr_timeModel");
    expect(p.get("expand_group")).toBe("invest");
    expect(p.get("attr_timeModel")).toBeNull();
  });

  it("maps the attribute-mode ungrouped bucket to the Not set group", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "attribute", fieldKey: "timeModel" },
      group: "ungrouped",
    });
    expect(paramsOf(url).get("expand_group")).toBe(INVENTORY_NOT_SET_KEY);
  });

  it("carries report filters as repeated params in attribute mode", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "attribute", fieldKey: "timeModel" },
      group: { key: "invest", label: "Invest" },
      filters: {
        search: "erp",
        attributes: { businessCriticality: ["missionCritical", "businessCritical"] },
        relations: { Organization: ["Sales & Marketing"] },
        tagIds: ["t1", "t2"],
      },
    });
    const p = paramsOf(url);
    expect(p.get("search")).toBe("erp");
    expect(p.getAll("attr_businessCriticality")).toEqual([
      "missionCritical",
      "businessCritical",
    ]);
    expect(p.getAll("rel_Organization")).toEqual(["Sales & Marketing"]);
    expect(p.getAll("tag")).toEqual(["t1", "t2"]);
  });

  it("carries a report filter on the grouped field itself (faithful to what the report showed)", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "attribute", fieldKey: "timeModel" },
      group: { key: "invest", label: "Invest" },
      filters: { attributes: { timeModel: ["invest", "migrate"] } },
    });
    const p = paramsOf(url);
    expect(p.getAll("attr_timeModel")).toEqual(["invest", "migrate"]);
    expect(p.get("group_by")).toBe("attr_timeModel");
  });

  it("relation groups fall back to a name-based filter, no grouping", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "relation", typeKey: "Organization" },
      group: { key: "uuid-123", label: "Sales & Marketing" },
    });
    const p = paramsOf(url);
    expect(p.get("group_by")).toBeNull();
    expect(p.get("expand_group")).toBeNull();
    expect(p.get("rel_Organization")).toBe("Sales & Marketing");
  });

  it("the clicked relation group replaces a carried filter on the same type, others survive", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "relation", typeKey: "Organization" },
      group: { key: "uuid-123", label: "Sales & Marketing" },
      filters: {
        relations: { Organization: ["Finance"], BusinessCapability: ["Billing"] },
      },
    });
    const p = paramsOf(url);
    expect(p.getAll("rel_Organization")).toEqual(["Sales & Marketing"]);
    expect(p.getAll("rel_BusinessCapability")).toEqual(["Billing"]);
  });

  it("links the relation-mode ungrouped bucket to the (empty) sentinel", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "relation", typeKey: "Organization" },
      group: "ungrouped",
    });
    expect(paramsOf(url).get("rel_Organization")).toBe(INVENTORY_EMPTY_VALUE);
  });

  it("keeps the local sentinels in sync with their sources of truth", () => {
    expect(INVENTORY_EMPTY_VALUE).toBe(EMPTY_VALUE);
    expect(INVENTORY_NOT_SET_KEY).toBe(NOT_SET_KEY);
  });
});
