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

  describe("quality mode", () => {
    it("mirrors a band onto the data_quality axis, with no value filter", () => {
      const url = buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "quality" },
        group: { key: "partial", label: "Partial" },
      });
      const p = paramsOf(url);
      expect(p.get("type")).toBe("Application");
      expect(p.get("group_by")).toBe("data_quality");
      expect(p.get("expand_group")).toBe("partial");
      // The other bands must stay visible as collapsed headers with counts,
      // so the clicked band is focused, never filtered to.
      expect(p.has("dq")).toBe(false);
    });

    it("groups without expanding when no band was clicked", () => {
      const url = buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "quality" },
        group: null,
      });
      const p = paramsOf(url);
      expect(p.get("group_by")).toBe("data_quality");
      expect(p.has("expand_group")).toBe(false);
    });

    it("carries the report's own filters through", () => {
      const url = buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "quality" },
        group: { key: "minimal", label: "Minimal" },
        filters: {
          search: "erp",
          attributes: { timeModel: ["invest", "tolerate"] },
          relations: { Organization: ["Finance"] },
          tagIds: ["t1", "t2"],
        },
      });
      const p = paramsOf(url);
      expect(p.get("search")).toBe("erp");
      expect(p.getAll("attr_timeModel")).toEqual(["invest", "tolerate"]);
      expect(p.getAll("rel_Organization")).toEqual(["Finance"]);
      expect(p.getAll("tag")).toEqual(["t1", "t2"]);
      expect(p.get("expand_group")).toBe("minimal");
    });
  });

  it("omits the relation filter entirely when no group was clicked", () => {
    const url = buildInventorySliceUrl({
      cardType: "Application",
      mode: { kind: "relation", typeKey: "Organization" },
      group: null,
      filters: { relations: { Organization: ["Finance"] } },
    });
    // With nothing focused there is no group to substitute, so the report's
    // own filter on that type survives instead of being dropped.
    expect(paramsOf(url).getAll("rel_Organization")).toEqual(["Finance"]);
  });
});
