/**
 * The Portfolio report reads every card at the travelled date with only the
 * relations in effect then (`relationsAtDate`), so grouping, relation filters
 * and colour all place a card by the related cards it has AT that date: an
 * application an organisation starts using in 2027 sits under that
 * organisation from 2027 and stays in the report throughout.
 */
import { describe, it, expect } from "vitest";
import { buildGroupTree } from "./portfolioGrouping";
import { groupingRelationLifecycles, relationsAtDate } from "./portfolioHelpers";
import type { AppData, AppRelation } from "./portfolioHelpers";

const ms = (iso: string) => new Date(iso).getTime();

const rel = (orgId: string, lifecycle?: Record<string, string>): AppRelation => ({
  relation_type: "relOrgToApp",
  direction: "incoming",
  related_id: orgId,
  related_name: orgId,
  related_type: "Organization",
  ...(lifecycle ? { lifecycle } : {}),
});

const app = (relations: AppRelation[]): AppData => ({
  id: "crm",
  name: "CRM",
  relations,
  org_ids: [],
});

describe("relationsAtDate", () => {
  it("returns a card without dated relations as the same object", () => {
    const a = app([rel("hq")]);
    expect(relationsAtDate(a, ms("2027-01-01"))).toBe(a);
  });

  it("returns the same object while every dated relation is in effect", () => {
    const a = app([rel("hq", { active: "2020-01-01", endOfLife: "2030-01-01" })]);
    expect(relationsAtDate(a, ms("2027-01-01"))).toBe(a);
  });

  it("keeps a relation from its start day and drops it from its end day", () => {
    const a = app([
      rel("hq"),
      rel("de", { active: "2027-01-01" }),
      rel("cn", { active: "2020-01-01", endOfLife: "2027-01-01" }),
    ]);
    const before = relationsAtDate(a, ms("2026-12-31"));
    expect(before.relations.map((r) => r.related_id)).toEqual(["hq", "cn"]);
    const on = relationsAtDate(a, ms("2027-01-01"));
    expect(on.relations.map((r) => r.related_id)).toEqual(["hq", "de"]);
    // The card is the same card — only its relations are projected.
    expect(on.id).toBe("crm");
    expect(a.relations).toHaveLength(3);
  });

  it("drops a planned relation with no active date at every date", () => {
    const a = app([rel("hq", { plan: "2020-01-01" })]);
    expect(relationsAtDate(a, ms("2040-01-01")).relations).toEqual([]);
  });
});

describe("grouping by organisation at a travelled date", () => {
  const members = [
    { id: "hq", name: "HQ", type: "Organization" },
    { id: "de", name: "Germany", type: "Organization" },
  ];
  const crm = app([rel("hq"), rel("de", { active: "2027-01-01" })]);
  const groupAt = (iso: string) =>
    new Map(
      buildGroupTree([relationsAtDate(crm, ms(iso))], "Organization", members).map((n) => [
        n.key,
        n.directApps.map((a) => a.id),
      ]),
    );

  it("places the application under the organisation only once it uses it", () => {
    // A member with no card is not a group.
    expect(groupAt("2026-06-01")).toEqual(new Map([["hq", ["crm"]]]));
    expect(groupAt("2027-01-01")).toEqual(
      new Map([
        ["hq", ["crm"]],
        ["de", ["crm"]],
      ]),
    );
  });
});

describe("groupingRelationLifecycles", () => {
  const dated = (
    relation_type: string,
    related_type: string,
    lifecycle: Record<string, string>,
    direction?: "outgoing" | "incoming",
  ): AppRelation => ({
    relation_type,
    related_type,
    related_id: `${relation_type}-${related_type}`,
    related_name: related_type,
    lifecycle,
    ...(direction ? { direction } : {}),
  });
  const owns = { active: "2027-01-01" };
  const uses = { endOfLife: "2028-01-01" };
  const runsOn = { active: "2029-01-01" };
  const hasSite = { active: "2030-01-01" };
  const isSiteOf = { active: "2031-01-01" };
  const apps = [
    app([
      dated("relOrgOwnsApp", "Organization", owns),
      dated("relOrgToApp", "Organization", uses),
      dated("relAppToITC", "ITComponent", runsOn),
    ]),
    app([
      dated("relAppToApp", "Application", hasSite, "outgoing"),
      dated("relAppToApp", "Application", isSiteOf, "incoming"),
    ]),
  ];

  it("gives an attribute grouping no relation dates", () => {
    expect(groupingRelationLifecycles(apps, { kind: "attribute", fieldKey: "x" })).toBeUndefined();
  });

  it("takes every relation to the grouped card type when no relation type is named", () => {
    expect(groupingRelationLifecycles(apps, { kind: "relation", typeKey: "Organization" })).toEqual([
      owns,
      uses,
    ]);
  });

  it("narrows to the named relation type, and to its side of a self-referencing one", () => {
    expect(
      groupingRelationLifecycles(apps, {
        kind: "relation",
        typeKey: "Organization",
        relTypeKey: "relOrgToApp",
      }),
    ).toEqual([uses]);
    expect(
      groupingRelationLifecycles(apps, {
        kind: "relation",
        typeKey: "Application",
        relTypeKey: "relAppToApp__in",
      }),
    ).toEqual([isSiteOf]);
  });
});
