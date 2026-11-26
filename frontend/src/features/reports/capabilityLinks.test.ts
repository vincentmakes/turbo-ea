import { describe, it, expect } from "vitest";
import { appRelationsAtDate, capabilityIdsAtDate, capabilityLinkInEffect } from "./capabilityLinks";

const ms = (iso: string) => new Date(iso).getTime();

describe("capabilityLinkInEffect", () => {
  const cap = {
    app_link_lifecycles: {
      later: [{ active: "2027-01-01" }],
      over: [{ endOfLife: "2027-01-01" }],
      twice: [{ endOfLife: "2026-01-01" }, { active: "2028-01-01" }],
    },
  };

  it("links an application with no dated entry at every date", () => {
    expect(capabilityLinkInEffect(cap, "undated", ms("1990-01-01"))).toBe(true);
    expect(capabilityLinkInEffect({}, "any", ms("2027-01-01"))).toBe(true);
  });

  it("links from the relation's start day, not before", () => {
    expect(capabilityLinkInEffect(cap, "later", ms("2026-12-31"))).toBe(false);
    expect(capabilityLinkInEffect(cap, "later", ms("2027-01-01"))).toBe(true);
  });

  it("unlinks on the relation's end day", () => {
    expect(capabilityLinkInEffect(cap, "over", ms("2026-12-31"))).toBe(true);
    expect(capabilityLinkInEffect(cap, "over", ms("2027-01-01"))).toBe(false);
  });

  it("links while any of several relations is in effect", () => {
    expect(capabilityLinkInEffect(cap, "twice", ms("2025-06-01"))).toBe(true);
    expect(capabilityLinkInEffect(cap, "twice", ms("2027-01-01"))).toBe(false);
    expect(capabilityLinkInEffect(cap, "twice", ms("2028-01-01"))).toBe(true);
  });
});

describe("capabilityIdsAtDate", () => {
  const capById = new Map([
    ["c1", { app_link_lifecycles: { app: [{ active: "2027-01-01" }] } }],
    ["c2", {}],
  ]);

  it("keeps the capabilities linked at the date, and any it holds no row for", () => {
    expect(capabilityIdsAtDate(["c1", "c2", "c3"], "app", capById, ms("2026-01-01"))).toEqual([
      "c2",
      "c3",
    ]);
    expect(capabilityIdsAtDate(["c1", "c2", "c3"], "app", capById, ms("2027-01-01"))).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
  });
});

describe("appRelationsAtDate", () => {
  const app = {
    id: "app",
    org_ids: ["undated", "ended", "planned"],
    related_by_type: { Organization: ["undated", "ended", "planned"], ITComponent: ["itc"] },
    related_by_rel_type: {
      relOrgToApp: ["undated", "ended", "planned"],
      relAppToITC: ["itc"],
    },
    related_link_lifecycles: {
      relOrgToApp: {
        ended: [{ active: "2020-01-01", endOfLife: "2027-01-01" }],
        planned: [{ plan: "2020-01-01", active: "2028-01-01" }],
      },
    },
  };

  it("returns an application with no dated link unchanged", () => {
    const plain = { org_ids: ["o"], related_by_type: { Organization: ["o"] } };
    expect(appRelationsAtDate(plain, Date.parse("2027-06-01"))).toBe(plain);
  });

  it("keeps a related card only while a relation behind it is in effect", () => {
    const at = appRelationsAtDate(app, Date.parse("2027-06-01"));
    expect(at.related_by_rel_type).toEqual({ relOrgToApp: ["undated"], relAppToITC: ["itc"] });
    expect(at.related_by_type).toEqual({ Organization: ["undated"], ITComponent: ["itc"] });
    expect(at.org_ids).toEqual(["undated"]);
  });

  it("reads the end date inclusively and the start date on its day", () => {
    const before = appRelationsAtDate(app, Date.parse("2026-12-31"));
    expect(before.related_by_rel_type!.relOrgToApp).toEqual(["undated", "ended"]);
    const started = appRelationsAtDate(app, Date.parse("2028-01-01"));
    expect(started.related_by_rel_type!.relOrgToApp).toEqual(["undated", "planned"]);
    expect(started.related_by_type!.Organization).toEqual(["undated", "planned"]);
    expect(started.org_ids).toEqual(["undated", "planned"]);
  });

  it("keeps a card under its type while any relation type still reaches it", () => {
    const twoWays = {
      org_ids: ["o"],
      related_by_type: { Organization: ["o"] },
      related_by_rel_type: { owns: ["o"], uses: ["o"] },
      related_link_lifecycles: { owns: { o: [{ endOfLife: "2020-01-01" }] } },
    };
    const at = appRelationsAtDate(twoWays, Date.parse("2027-01-01"));
    expect(at.related_by_rel_type).toEqual({ owns: [], uses: ["o"] });
    expect(at.related_by_type).toEqual({ Organization: ["o"] });
  });

  it("does not mutate the payload", () => {
    appRelationsAtDate(app, Date.parse("2027-06-01"));
    expect(app.org_ids).toEqual(["undated", "ended", "planned"]);
  });
});
