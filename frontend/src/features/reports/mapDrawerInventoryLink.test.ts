import { describe, it, expect } from "vitest";
import { buildInventorySliceUrl } from "./portfolioInventoryLink";

/**
 * The Capability Map and Process Map drawers link into the inventory the same
 * way the portfolio does, but only from a LEAF node — see the
 * `drawerInventoryHref` memo in each report for why. These pin the URL shape
 * those two build, so a change to the link builder can't silently retarget
 * them.
 */
function paramsOf(url: string) {
  return new URLSearchParams(url.split("?")[1]);
}

describe("capability drawer inventory link", () => {
  it("filters applications by the clicked capability", () => {
    const p = paramsOf(
      buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "relation", typeKey: "BusinessCapability" },
        group: { key: "cap-1", label: "Order Management" },
      }),
    );
    expect(p.get("type")).toBe("Application");
    // Name-based, matching the sidebar's relation filter values.
    expect(p.getAll("rel_BusinessCapability")).toEqual(["Order Management"]);
    // Relation mode cannot mirror, so it must NOT try to group.
    expect(p.has("group_by")).toBe(false);
  });

  it("carries the report's attribute and tag filters", () => {
    const p = paramsOf(
      buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "relation", typeKey: "BusinessCapability" },
        group: { key: "cap-1", label: "Order Management" },
        filters: { attributes: { timeModel: ["invest"] }, tagIds: ["t1"] },
      }),
    );
    expect(p.getAll("attr_timeModel")).toEqual(["invest"]);
    expect(p.getAll("tag")).toEqual(["t1"]);
  });

  it("lets the clicked capability replace a carried filter on the same type", () => {
    const p = paramsOf(
      buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "relation", typeKey: "BusinessCapability" },
        group: { key: "cap-1", label: "Order Management" },
        filters: { relations: { BusinessCapability: ["Billing"], Organization: ["Finance"] } },
      }),
    );
    expect(p.getAll("rel_BusinessCapability")).toEqual(["Order Management"]);
    expect(p.getAll("rel_Organization")).toEqual(["Finance"]);
  });
});

describe("process drawer inventory link", () => {
  it("filters applications by the clicked process", () => {
    const p = paramsOf(
      buildInventorySliceUrl({
        cardType: "Application",
        mode: { kind: "relation", typeKey: "BusinessProcess" },
        group: { key: "proc-1", label: "Order to Cash" },
      }),
    );
    expect(p.get("type")).toBe("Application");
    expect(p.getAll("rel_BusinessProcess")).toEqual(["Order to Cash"]);
  });
});
