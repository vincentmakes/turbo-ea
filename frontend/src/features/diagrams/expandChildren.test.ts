import { describe, it, expect } from "vitest";
import { groupRelationsByOtherCard, pruneDeletedRelations } from "./expandChildren";
import type { ExpandChildData } from "./drawio-shapes";
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

describe("pruneDeletedRelations", () => {
  const child = (over: Partial<ExpandChildData> = {}): ExpandChildData => ({
    id: "app-crm",
    name: "CRM",
    type: "Application",
    color: "#0f7eb5",
    relationType: "relOrgToApp",
    relationId: "rel-uses",
    relationLabel: "uses",
    ...over,
  });

  it("returns the input untouched when nothing was deleted", () => {
    const children = [child()];
    expect(pruneDeletedRelations(children, new Set())).toBe(children);
  });

  it("drops a child whose only relation was deleted", () => {
    expect(pruneDeletedRelations([child()], new Set(["rel-uses"]))).toEqual([]);
  });

  it("keeps the child and promotes a surviving extra when the primary went", () => {
    // The bug this guards: deleting one of two edges left the card still
    // "connected", so nothing was recorded and re-expanding redrew the deleted
    // relation with a relationId the server no longer has.
    const out = pruneDeletedRelations(
      [
        child({
          extraRelations: [
            { relationType: "relOrgToAppOwns", relationId: "rel-owns", relationLabel: "owns" },
          ],
        }),
      ],
      new Set(["rel-uses"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].relationId).toBe("rel-owns");
    expect(out[0].relationLabel).toBe("owns");
    expect(out[0].extraRelations ?? []).toEqual([]);
  });

  it("keeps the primary and drops only the deleted extra", () => {
    const out = pruneDeletedRelations(
      [
        child({
          extraRelations: [
            { relationType: "relOrgToAppOwns", relationId: "rel-owns", relationLabel: "owns" },
          ],
        }),
      ],
      new Set(["rel-owns"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].relationId).toBe("rel-uses");
    expect(out[0].extraRelations ?? []).toEqual([]);
  });

  it("never drops a relation that was never persisted", () => {
    // No relation id means it cannot have been deleted server-side.
    const out = pruneDeletedRelations([child({ relationId: undefined })], new Set(["rel-uses"]));
    expect(out).toHaveLength(1);
  });
});
