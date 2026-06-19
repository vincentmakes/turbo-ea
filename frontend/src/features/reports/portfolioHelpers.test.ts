import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import {
  appColorBucket,
  buildColorLegend,
  buildColorSegments,
  DEFAULT_APP_COLOR,
  extractRelSubtypes,
  getAppColor,
  getAppColorLabel,
  matchesFilters,
  MULTIPLE_COLOR,
  REL_SUBTYPE_PREFIX,
  relationMemberMatchesSubtypeFilters,
  relSubtypeComposite,
  resolveColorBy,
  UNSET_COLOR,
} from "./portfolioHelpers";
import type { AppData, FieldDef, FilterState, RelSubtype, RelTypeDef } from "./portfolioHelpers";

const LABELS = { notSet: "Not set", multiple: "Multiple" };

/* ----- fixtures ----- */

const usageTypeField: FieldDef = {
  key: "usageType",
  label: "Usage Type",
  type: "single_select",
  options: [
    { key: "owner", label: "Owner", color: "#1976d2" },
    { key: "user", label: "User", color: "#66bb6a" },
    { key: "stakeholder", label: "Stakeholder", color: "#ff9800" },
  ],
};

const orgUsesApp: RelTypeDef = {
  key: "relOrgToApp",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Organization",
  target_type_key: "Application",
  other_type_key: "Organization",
  attributes_schema: [usageTypeField],
};

const plainRelType: RelTypeDef = {
  key: "relAppToItc",
  label: "runs on",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  other_type_key: "ITComponent",
  attributes_schema: [],
};

const usageSub: RelSubtype = {
  composite: relSubtypeComposite("relOrgToApp", "usageType"),
  relTypeKey: "relOrgToApp",
  fieldKey: "usageType",
  relatedTypeKey: "Organization",
  comboLabel: "is used by · Usage Type",
  options: usageTypeField.options!,
};

function app(id: string, relations: AppData["relations"] = []): AppData {
  return { id, name: id, attributes: {}, relations, org_ids: [] };
}

function orgRel(usageType?: string, relatedId?: string): AppData["relations"][number] {
  return {
    relation_type: "relOrgToApp",
    related_id: relatedId ?? `org-${usageType ?? "none"}`,
    related_name: "Org",
    related_type: "Organization",
    attributes: usageType ? { usageType } : {},
  };
}

function baseFilters(over: Partial<FilterState> = {}): FilterState {
  return {
    attributeFilters: {},
    relationFilters: {},
    relSubtypeFilters: {},
    relSubtypes: [usageSub],
    tagFilterIds: [],
    tagGroups: [],
    timelineDate: Date.now(),
    search: "",
    ...over,
  };
}

/* ----- extractRelSubtypes ----- */

describe("extractRelSubtypes", () => {
  it("returns single_select attributes for relation types touching the card type", () => {
    const out = extractRelSubtypes([orgUsesApp, plainRelType], "Application");
    expect(out).toHaveLength(1);
    expect(out[0].relType.key).toBe("relOrgToApp");
    expect(out[0].field.key).toBe("usageType");
  });

  it("is empty when no relation type has single_select attributes", () => {
    expect(extractRelSubtypes([plainRelType], "Application")).toHaveLength(0);
  });

  it("skips relation types not touching the card type", () => {
    expect(extractRelSubtypes([orgUsesApp], "DataObject")).toHaveLength(0);
  });
});

/* ----- resolveColorBy + appColorBucket ----- */

describe("resolveColorBy / appColorBucket (relation subtype)", () => {
  const res = resolveColorBy(`${REL_SUBTYPE_PREFIX}${usageSub.composite}`, [], [usageSub]);

  it("resolves a rel: key to the matching subtype", () => {
    expect(res).toEqual({ kind: "rel", sub: usageSub });
  });

  it("colors by the single distinct subtype value", () => {
    const a = app("a", [orgRel("owner"), orgRel("owner")]);
    expect(getAppColor(a, res, LABELS)).toBe("#1976d2");
    expect(getAppColorLabel(a, res, LABELS)).toBe("Owner");
  });

  it("uses the Multiple bucket when values differ", () => {
    const a = app("a", [orgRel("owner"), orgRel("user")]);
    const bucket = appColorBucket(a, res, LABELS);
    expect(bucket.color).toBe(MULTIPLE_COLOR);
    expect(bucket.label).toBe("Multiple");
    expect(getAppColorLabel(a, res, LABELS)).toBe("Multiple");
  });

  it("is unset when there are no such relations / values", () => {
    const a = app("a", [orgRel(undefined)]);
    expect(getAppColor(a, res, LABELS)).toBe(UNSET_COLOR);
    expect(getAppColorLabel(a, res, LABELS)).toBeNull();
  });

  it("falls back to none for an unknown rel composite", () => {
    expect(resolveColorBy(`${REL_SUBTYPE_PREFIX}nope::x`, [], [usageSub])).toEqual({
      kind: "none",
    });
  });
});

describe("appColorBucket per group-member (memberId)", () => {
  const res = resolveColorBy(`${REL_SUBTYPE_PREFIX}${usageSub.composite}`, [], [usageSub]);

  // An app owned by Org A but used by Org B: under each group it should show
  // the value of that specific relation — never the aggregate "Multiple".
  const ownedAndUsed = app("a", [orgRel("owner", "orgA"), orgRel("user", "orgB")]);

  it("colors by the relation to the given member (User under Org B)", () => {
    const bucket = appColorBucket(ownedAndUsed, res, LABELS, "orgB");
    expect(bucket.label).toBe("User");
    expect(bucket.color).toBe("#66bb6a");
    expect(getAppColor(ownedAndUsed, res, LABELS, "orgB")).toBe("#66bb6a");
  });

  it("colors by the relation to the other member (Owner under Org A)", () => {
    expect(getAppColorLabel(ownedAndUsed, res, LABELS, "orgA")).toBe("Owner");
  });

  it("is unset when the card has no relation to that member", () => {
    const bucket = appColorBucket(ownedAndUsed, res, LABELS, "orgZ");
    expect(bucket.isUnset).toBe(true);
    expect(getAppColorLabel(ownedAndUsed, res, LABELS, "orgZ")).toBeNull();
  });

  it("aggregates to Multiple only when no member is given", () => {
    expect(appColorBucket(ownedAndUsed, res, LABELS).color).toBe(MULTIPLE_COLOR);
  });

  it("segments scoped to a member never produce a Multiple bucket", () => {
    const apps = [
      app("a", [orgRel("owner", "orgA"), orgRel("user", "orgB")]),
      app("b", [orgRel("user", "orgB")]),
    ];
    const segs = buildColorSegments(apps, res, LABELS, "orgB");
    const byLabel = Object.fromEntries(segs.map((s) => [s.label, s.n]));
    expect(byLabel).toEqual({ User: 2 });
  });
});

describe("appColorBucket (own field + none)", () => {
  const res = resolveColorBy("usageType", [usageTypeField], []);

  it("colors by an own single_select field value", () => {
    const a = { ...app("a"), attributes: { usageType: "user" } };
    expect(getAppColor(a, res, LABELS)).toBe("#66bb6a");
    expect(getAppColorLabel(a, res, LABELS)).toBe("User");
  });

  it("returns the default color when nothing is selected", () => {
    expect(getAppColor(app("a"), { kind: "none" }, LABELS)).toBe(DEFAULT_APP_COLOR);
    expect(getAppColorLabel(app("a"), { kind: "none" }, LABELS)).toBeNull();
  });
});

/* ----- segments + legend ----- */

describe("buildColorSegments / buildColorLegend (relation subtype)", () => {
  const res = resolveColorBy(`${REL_SUBTYPE_PREFIX}${usageSub.composite}`, [], [usageSub]);
  const apps = [
    app("a", [orgRel("owner")]),
    app("b", [orgRel("user")]),
    app("c", [orgRel("owner"), orgRel("user")]), // multiple
    app("d", [orgRel(undefined)]), // unset
  ];

  it("aggregates apps into owner/user/multiple/unset buckets", () => {
    const segs = buildColorSegments(apps, res, LABELS);
    const byLabel = Object.fromEntries(segs.map((s) => [s.label, s.n]));
    expect(byLabel).toEqual({ Owner: 1, User: 1, Multiple: 1, "Not set": 1 });
  });

  it("adds a Multiple swatch to the legend only when a card has multiple values", () => {
    const legendWithMultiple = buildColorLegend(res, LABELS, apps);
    expect(legendWithMultiple?.some((l) => l.label === "Multiple")).toBe(true);

    const single = [app("a", [orgRel("owner")])];
    const legendNoMultiple = buildColorLegend(res, LABELS, single);
    expect(legendNoMultiple?.some((l) => l.label === "Multiple")).toBe(false);
  });
});

/* ----- matchesFilters (relation subtype) ----- */

describe("matchesFilters with relSubtypeFilters", () => {
  it("matches a card that has a relation with the selected subtype value", () => {
    const a = app("a", [orgRel("owner")]);
    const f = baseFilters({ relSubtypeFilters: { [usageSub.composite]: ["owner"] } });
    expect(matchesFilters(a, f)).toBe(true);
  });

  it("excludes a card whose relations don't carry the selected value", () => {
    const a = app("a", [orgRel("user")]);
    const f = baseFilters({ relSubtypeFilters: { [usageSub.composite]: ["owner"] } });
    expect(matchesFilters(a, f)).toBe(false);
  });

  it("matches via at-least-one across multiple relations", () => {
    const a = app("a", [orgRel("user"), orgRel("owner")]);
    const f = baseFilters({ relSubtypeFilters: { [usageSub.composite]: ["owner"] } });
    expect(matchesFilters(a, f)).toBe(true);
  });

  it("EMPTY matches a relation of that type whose subtype value is missing", () => {
    const a = app("a", [orgRel(undefined)]);
    const f = baseFilters({ relSubtypeFilters: { [usageSub.composite]: [EMPTY_FILTER_KEY] } });
    expect(matchesFilters(a, f)).toBe(true);

    const b = app("b", [orgRel("owner")]);
    expect(matchesFilters(b, f)).toBe(false);
  });

  it("ignores empty selections", () => {
    const a = app("a", [orgRel("user")]);
    const f = baseFilters({ relSubtypeFilters: { [usageSub.composite]: [] } });
    expect(matchesFilters(a, f)).toBe(true);
  });
});

describe("relationMemberMatchesSubtypeFilters (per group-member)", () => {
  // App owned by Org A, used by Org B.
  const a = app("a", [orgRel("owner", "orgA"), orgRel("user", "orgB")]);

  it("places the card under the member whose relation matches the filter", () => {
    const filters = { [usageSub.composite]: ["owner"] };
    expect(relationMemberMatchesSubtypeFilters(a, "orgA", filters, [usageSub])).toBe(true);
    expect(relationMemberMatchesSubtypeFilters(a, "orgB", filters, [usageSub])).toBe(false);
  });

  it("passes every member when no subtype filter is active", () => {
    expect(relationMemberMatchesSubtypeFilters(a, "orgB", {}, [usageSub])).toBe(true);
    expect(
      relationMemberMatchesSubtypeFilters(a, "orgB", { [usageSub.composite]: [] }, [usageSub]),
    ).toBe(true);
  });

  it("matches EMPTY only for a member whose relation has no value", () => {
    const b = app("b", [orgRel(undefined, "orgC"), orgRel("owner", "orgA")]);
    const filters = { [usageSub.composite]: [EMPTY_FILTER_KEY] };
    expect(relationMemberMatchesSubtypeFilters(b, "orgC", filters, [usageSub])).toBe(true);
    expect(relationMemberMatchesSubtypeFilters(b, "orgA", filters, [usageSub])).toBe(false);
  });
});
