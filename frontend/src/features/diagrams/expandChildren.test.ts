import { describe, it, expect } from "vitest";
import { groupRelationsByOtherCard } from "./expandChildren";
import type { Relation } from "@/types";

const ORG = "org-1";
const CRM = { id: "app-crm", name: "CRM", type: "Application" };
const ERP = { id: "app-erp", name: "ERP", type: "Application" };

function rel(over: Partial<Relation> & { id: string; type: string }): Relation {
  return {
    source_id: ORG,
    target_id: CRM.id,
    source: { id: ORG, name: "Finance", type: "Organization" },
    target: CRM,
    attributes: {},
    ...over,
  } as Relation;
}

describe("groupRelationsByOtherCard", () => {
  it("yields one group per related card", () => {
    const groups = groupRelationsByOtherCard(
      [
        rel({ id: "r1", type: "relOrgToApp" }),
        rel({ id: "r2", type: "relOrgToApp", target_id: ERP.id, target: ERP }),
      ],
      ORG,
    );
    expect(groups.map((g) => g.other.id)).toEqual([CRM.id, ERP.id]);
    expect(groups.every((g) => g.extras.length === 0)).toBe(true);
  });

  it("folds several relation types to one card into extras, keeping order", () => {
    // The card is drawn once (a second vertex with the same cardId would trip
    // the canvas dedup); the extra relation becomes an extra edge.
    const groups = groupRelationsByOtherCard(
      [
        rel({ id: "r-uses", type: "relOrgToApp" }),
        rel({ id: "r-owns", type: "relOrgToAppOwns" }),
      ],
      ORG,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].primary.id).toBe("r-uses");
    expect(groups[0].extras.map((r) => r.id)).toEqual(["r-owns"]);
  });

  it("resolves the other end for an incoming relation", () => {
    const groups = groupRelationsByOtherCard(
      [
        rel({
          id: "r-in",
          type: "relAppToOrg",
          source_id: CRM.id,
          target_id: ORG,
          source: CRM,
          target: { id: ORG, name: "Finance", type: "Organization" },
        }),
      ],
      ORG,
    );
    expect(groups[0].other.id).toBe(CRM.id);
  });

  it("skips relations whose other end is missing", () => {
    const groups = groupRelationsByOtherCard(
      [rel({ id: "r-bad", type: "relOrgToApp", target: undefined })],
      ORG,
    );
    expect(groups).toEqual([]);
  });

  it("skips a card the caller rejects, and does not resurrect it via a later relation", () => {
    // "Already on the canvas" must stay skipped even when a second relation
    // type reaches it — otherwise the extras would attach to nothing.
    const groups = groupRelationsByOtherCard(
      [
        rel({ id: "r-uses", type: "relOrgToApp" }),
        rel({ id: "r-owns", type: "relOrgToAppOwns" }),
        rel({ id: "r-erp", type: "relOrgToApp", target_id: ERP.id, target: ERP }),
      ],
      ORG,
      (id) => id === CRM.id,
    );
    expect(groups.map((g) => g.other.id)).toEqual([ERP.id]);
  });

  it("returns an empty list for no relations", () => {
    expect(groupRelationsByOtherCard([], ORG)).toEqual([]);
  });
});
