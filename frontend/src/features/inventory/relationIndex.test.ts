import { describe, expect, it } from "vitest";
import type { Relation, RelationType } from "@/types";
import { buildRelationIndex } from "./relationIndex";

const orgToApp = {
  key: "relOrgToApp",
  source_type_key: "Organization",
  target_type_key: "Application",
} as RelationType;
const orgToOrg = {
  key: "orgToOrg",
  source_type_key: "Organization",
  target_type_key: "Organization",
} as RelationType;

const ref = (id: string, type: string) => ({ id, name: id, type });
const rel = (type: string, s: ReturnType<typeof ref>, t: ReturnType<typeof ref>): Relation =>
  ({ id: `${s.id}-${t.id}`, type, source_id: s.id, target_id: t.id, source: s, target: t }) as Relation;

describe("buildRelationIndex", () => {
  it("indexes a cross-type relation under the selected type's end only", () => {
    const r = rel("relOrgToApp", ref("hq", "Organization"), ref("crm", "Application"));
    const fromOrg = buildRelationIndex([r], orgToApp, "Organization");
    expect([...fromOrg.keys()]).toEqual(["hq"]);
    expect(fromOrg.get("hq")?.map((x) => x.id)).toEqual(["crm"]);
    const fromApp = buildRelationIndex([r], orgToApp, "Application");
    expect([...fromApp.keys()]).toEqual(["crm"]);
    expect(fromApp.get("crm")?.map((x) => x.id)).toEqual(["hq"]);
  });

  it("indexes a self-referencing relation under BOTH cards", () => {
    // The bug this guards: "which end am I" read off the type filed the row
    // under its source only, and the site's Organization cell stayed empty.
    const r = rel("orgToOrg", ref("hq", "Organization"), ref("inchn", "Organization"));
    const index = buildRelationIndex([r], orgToOrg, "Organization");
    expect(index.get("hq")?.map((x) => x.id)).toEqual(["inchn"]);
    expect(index.get("inchn")?.map((x) => x.id)).toEqual(["hq"]);
  });

  it("keeps one side when asked, for the per-verb facets", () => {
    const r = rel("orgToOrg", ref("hq", "Organization"), ref("inchn", "Organization"));
    expect([...buildRelationIndex([r], orgToOrg, "Organization", "out").keys()]).toEqual(["hq"]);
    expect([...buildRelationIndex([r], orgToOrg, "Organization", "in").keys()]).toEqual(["inchn"]);
  });

  it("skips a row whose far end is missing", () => {
    const r = { ...rel("relOrgToApp", ref("hq", "Organization"), ref("crm", "Application")), target: undefined };
    expect(buildRelationIndex([r as Relation], orgToApp, "Organization").size).toBe(0);
  });
});

describe("buildRelationIndex — relation dates", () => {
  const hq = ref("hq", "Organization");
  const dated = (id: string, lifecycle?: Record<string, string>) =>
    ({ ...rel("relOrgToApp", hq, ref(id, "Application")), lifecycle }) as Relation;
  const ms = (iso: string) => new Date(iso).getTime();

  it("indexes only the relations in effect at the date — the grid is the landscape now", () => {
    const rels = [
      dated("undated"),
      dated("current", { active: "2026-01-01" }),
      dated("planned", { active: "2026-06-02" }),
      dated("ended", { endOfLife: "2026-06-01" }),
    ];
    const idx = buildRelationIndex(rels, orgToApp, "Organization", undefined, ms("2026-06-01"));
    expect(idx.get("hq")?.map((x) => x.id)).toEqual(["undated", "current"]);
    // The day after: the planned one has started, the ended one stays ended.
    const next = buildRelationIndex(rels, orgToApp, "Organization", undefined, ms("2026-06-02"));
    expect(next.get("hq")?.map((x) => x.id)).toEqual(["undated", "current", "planned"]);
  });

  it("drops a card whose only relation is not in effect from the index", () => {
    const idx = buildRelationIndex(
      [dated("ended", { endOfLife: "2000-01-01" })],
      orgToApp,
      "Application",
    );
    expect(idx.size).toBe(0);
  });

  it("reads today by default", () => {
    const idx = buildRelationIndex(
      [dated("later", { active: "2999-01-01" }), dated("now")],
      orgToApp,
      "Organization",
    );
    expect(idx.get("hq")?.map((x) => x.id)).toEqual(["now"]);
  });
});
