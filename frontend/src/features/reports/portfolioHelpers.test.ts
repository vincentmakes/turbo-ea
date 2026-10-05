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
  hasStartedByDate,
  isAliveAtDate,
  isAppAliveAtDate,
  isRetiredByDate,
  matchesFilters,
  matchesStaticFilters,
  MULTIPLE_COLOR,
  parseDate,
  pickSelectFields,
  REL_SUBTYPE_PREFIX,
  relationMemberMatchesSubtypeFilters,
  relationOnSide,
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

describe("lifecycle date helpers", () => {
  const ms = (iso: string) => new Date(iso).getTime();
  const at = ms("2026-06-15");

  it("treats a card with no lifecycle as always present", () => {
    expect(hasStartedByDate(undefined, at)).toBe(true);
    expect(isRetiredByDate(undefined, at)).toBe(false);
    expect(isAliveAtDate(undefined, at)).toBe(true);
  });

  it("treats a lifecycle with no usable dates as always present", () => {
    expect(isAliveAtDate({}, at)).toBe(true);
    expect(isAliveAtDate({ active: "not-a-date" }, at)).toBe(true);
  });

  it("uses the go-live date as the birthday, not an earlier plan", () => {
    expect(hasStartedByDate({ plan: "2027-01-01" }, at)).toBe(false);
    expect(hasStartedByDate({ plan: "2027-01-01", active: "2020-01-01" }, at)).toBe(true);
    // The go-live mark sits on `active`, so a card must not appear years before
    // it — taking the earliest start phase made this one visible from 2020.
    expect(hasStartedByDate({ plan: "2020-01-01", active: "2029-01-01" }, at)).toBe(false);
    expect(hasStartedByDate({ phaseIn: "2020-01-01", active: "2029-01-01" }, at)).toBe(false);
    expect(hasStartedByDate({ plan: "2020-01-01", active: "2029-01-01" }, ms("2029-01-01"))).toBe(
      true,
    );
  });

  it("treats a card that never went live as upcoming, whatever its plan date", () => {
    // No `active` at all: it has not entered the landscape, so it shows only
    // where planned cards are previewed — even once its plan date has passed.
    expect(hasStartedByDate({ plan: "2020-01-01" }, at)).toBe(false);
    expect(hasStartedByDate({ phaseIn: "2020-01-01" }, at)).toBe(false);
    expect(hasStartedByDate({ plan: "2020-01-01", phaseIn: "2021-01-01" }, at)).toBe(false);
    expect(isAliveAtDate({ plan: "2020-01-01" }, at)).toBe(false);
  });

  it("treats end-phase-only lifecycles as already started", () => {
    // A card carrying nothing but phaseOut/endOfLife dates (the endoflife.date
    // mass-link shape) must exist to be phasing out — its end date is not its
    // birthday, or it would be invisible its entire life.
    expect(hasStartedByDate({ phaseOut: "2020-01-01" }, at)).toBe(true);
    expect(hasStartedByDate({ endOfLife: "2030-01-01" }, at)).toBe(true);
    expect(isAliveAtDate({ endOfLife: "2030-01-01" }, at)).toBe(true);
    expect(isAliveAtDate({ endOfLife: "2030-01-01" }, ms("2031-01-01"))).toBe(false);
  });

  it("counts a card retired exactly on the date as retired", () => {
    expect(isRetiredByDate({ endOfLife: "2026-06-15" }, at)).toBe(true);
    expect(isRetiredByDate({ endOfLife: "2026-06-16" }, at)).toBe(false);
  });

  it("is alive only between its birthday and its end of life", () => {
    const lc = { active: "2020-01-01", endOfLife: "2030-01-01" };
    expect(isAliveAtDate(lc, ms("2019-01-01"))).toBe(false);
    expect(isAliveAtDate(lc, ms("2025-01-01"))).toBe(true);
    expect(isAliveAtDate(lc, ms("2031-01-01"))).toBe(false);
  });

  it("keeps isAppAliveAtDate delegating to the lifecycle-only helper", () => {
    const app = { lifecycle: { active: "2020-01-01", endOfLife: "2024-01-01" } } as AppData;
    expect(isAppAliveAtDate(app, ms("2022-01-01"))).toBe(true);
    expect(isAppAliveAtDate(app, at)).toBe(false);
  });
});

describe("relation facets on a self-referencing type", () => {
  // Organization → Organization "has site": the same row is outgoing on the
  // parent and incoming on the site. A bare key matches either side; a side
  // key (`__out` / `__in`) matches one — never decided from the TYPE, which
  // reads as "source" at both ends.
  const rel = (direction: "outgoing" | "incoming", relatedId: string): AppData["relations"][number] => ({
    relation_type: "orgToOrg",
    direction,
    related_id: relatedId,
    related_name: relatedId,
    related_type: "Organization",
    attributes: {},
  });

  it("relationOnSide: bare key either side, side key one side, no direction = either", () => {
    const out = rel("outgoing", "site");
    expect(relationOnSide(out, "orgToOrg")).toBe(true);
    expect(relationOnSide(out, "orgToOrg__out")).toBe(true);
    expect(relationOnSide(out, "orgToOrg__in")).toBe(false);
    expect(relationOnSide(rel("incoming", "hq"), "orgToOrg__in")).toBe(true);
    expect(relationOnSide(rel("incoming", "hq"), "other__in")).toBe(false);
    // An older payload carries no direction: it matches either side, as it always did.
    const legacy = { ...out, direction: undefined };
    expect(relationOnSide(legacy, "orgToOrg__in")).toBe(true);
  });

  it("matchesFilters filters one side of a self-referencing type", () => {
    const hq = app("hq", [rel("outgoing", "site")]);
    const site = app("site", [rel("incoming", "hq")]);
    const relTypeKeys = new Set(["orgToOrg", "orgToOrg__out", "orgToOrg__in"]);
    const hasSite = baseFilters({ relationFilters: { orgToOrg__out: ["site"] }, relTypeKeys });
    expect(matchesFilters(hq, hasSite)).toBe(true);
    expect(matchesFilters(site, hasSite)).toBe(false);
    const isSiteOf = baseFilters({ relationFilters: { orgToOrg__in: ["hq"] }, relTypeKeys });
    expect(matchesFilters(site, isSiteOf)).toBe(true);
    expect(matchesFilters(hq, isSiteOf)).toBe(false);
  });
});


/* ----- exact answers: every branch states its full result ----- */

describe("pickSelectFields / extractRelSubtypes / parseDate", () => {
  it("keeps only single_select fields, in schema order, across sections", () => {
    const tier: FieldDef = { key: "tier", label: "Tier", type: "single_select", options: [] };
    const risk: FieldDef = { key: "risk", label: "Risk", type: "single_select", options: [] };
    const schema = [
      { section: "A", fields: [{ key: "n", label: "N", type: "number" }, tier] },
      { section: "B", fields: [] },
      { section: "C", fields: [risk, { key: "t", label: "T", type: "multiple_select" }] },
    ];
    expect(pickSelectFields(schema)).toEqual([tier, risk]);
    expect(pickSelectFields([])).toEqual([]);
  });

  it("reads a relation type from either end and tolerates a missing schema", () => {
    const appIsSource: RelTypeDef = { ...plainRelType, attributes_schema: [usageTypeField] };
    const noSchema: RelTypeDef = { ...orgUsesApp, attributes_schema: undefined };
    expect(extractRelSubtypes([appIsSource, noSchema, orgUsesApp], "Application")).toEqual([
      { relType: appIsSource, field: usageTypeField },
      { relType: orgUsesApp, field: usageTypeField },
    ]);
    // Neither end is an Organization here.
    expect(extractRelSubtypes([appIsSource], "Organization")).toEqual([]);
  });

  it("parses a date or answers null", () => {
    expect(parseDate("2026-01-02")).toBe(Date.UTC(2026, 0, 2));
    expect(parseDate("")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("resolveColorBy / appColorBucket exact buckets", () => {
  const tierField: FieldDef = {
    key: "tier",
    label: "Tier",
    type: "single_select",
    options: [
      { key: "gold", label: "Gold", color: "#ffd700" },
      { key: "bare", label: "Bare" },
    ],
  };
  const fieldRes = { kind: "field" as const, field: tierField };
  const withTier = (tier: unknown): AppData => ({ ...app("x"), attributes: { tier } });

  it("resolves own fields, rel keys and unknowns", () => {
    expect(resolveColorBy("", [tierField], [usageSub])).toEqual({ kind: "none" });
    expect(resolveColorBy("tier", [tierField], [usageSub])).toEqual(fieldRes);
    expect(resolveColorBy("nope", [tierField], [usageSub])).toEqual({ kind: "none" });
    expect(resolveColorBy(`${REL_SUBTYPE_PREFIX}nope`, [tierField], [usageSub])).toEqual({
      kind: "none",
    });
    // An own field whose key merely contains the prefix is still an own field.
    const odd: FieldDef = { ...tierField, key: "x-rel:" };
    expect(resolveColorBy("x-rel:", [odd], [])).toEqual({ kind: "field", field: odd });
  });

  it("buckets an own field value", () => {
    expect(appColorBucket(app("x"), { kind: "none" }, LABELS)).toEqual({
      key: "__none__",
      color: DEFAULT_APP_COLOR,
      label: "",
      isUnset: false,
    });
    expect(appColorBucket(withTier("gold"), fieldRes, LABELS)).toEqual({
      key: "gold",
      color: "#ffd700",
      label: "Gold",
      isUnset: false,
    });
    // An option without a colour, and a value no option knows.
    expect(appColorBucket(withTier("bare"), fieldRes, LABELS)).toEqual({
      key: "bare",
      color: UNSET_COLOR,
      label: "Bare",
      isUnset: false,
    });
    expect(appColorBucket(withTier("legacy"), fieldRes, LABELS)).toEqual({
      key: "legacy",
      color: UNSET_COLOR,
      label: "legacy",
      isUnset: false,
    });
    const noOptions = { kind: "field" as const, field: { ...tierField, options: undefined } };
    expect(appColorBucket(withTier("gold"), noOptions, LABELS)).toEqual({
      key: "gold",
      color: UNSET_COLOR,
      label: "gold",
      isUnset: false,
    });
    const unset = { key: "__unset__", color: UNSET_COLOR, label: "Not set", isUnset: true };
    expect(appColorBucket(withTier(""), fieldRes, LABELS)).toEqual(unset);
    expect(appColorBucket({ ...app("x"), attributes: undefined }, fieldRes, LABELS)).toEqual(
      unset,
    );
  });

  it("buckets a relation subtype value", () => {
    const relRes = { kind: "rel" as const, sub: usageSub };
    expect(appColorBucket(app("a", [orgRel("owner")]), relRes, LABELS)).toEqual({
      key: "owner",
      color: "#1976d2",
      label: "Owner",
      isUnset: false,
    });
    expect(appColorBucket(app("a", [orgRel("retired")]), relRes, LABELS)).toEqual({
      key: "retired",
      color: UNSET_COLOR,
      label: "retired",
      isUnset: false,
    });
    expect(appColorBucket(app("a", [orgRel("owner"), orgRel("user")]), relRes, LABELS)).toEqual({
      key: "__multiple__",
      color: MULTIPLE_COLOR,
      label: "Multiple",
      isUnset: false,
    });
    // The same value twice is one value; another relation type and a
    // non-string value do not count.
    const noisy = app("a", [
      orgRel("owner"),
      orgRel("owner", "org-2"),
      { ...orgRel("user"), relation_type: "relOther" },
      { ...orgRel(undefined), attributes: { usageType: 3 } },
      { ...orgRel(undefined), attributes: { usageType: "" } },
    ]);
    expect(appColorBucket(noisy, relRes, LABELS).key).toBe("owner");
    expect(appColorBucket(app("a", [orgRel(undefined)]), relRes, LABELS)).toEqual({
      key: "__unset__",
      color: UNSET_COLOR,
      label: "Not set",
      isUnset: true,
    });
    expect(getAppColorLabel(app("a", [orgRel(undefined)]), relRes, LABELS)).toBeNull();
    expect(getAppColorLabel(app("a", [orgRel("user")]), relRes, LABELS)).toBe("User");
  });
});

describe("buildColorSegments / buildColorLegend exact output", () => {
  const relRes = { kind: "rel" as const, sub: usageSub };

  it("counts each bucket once, in first-seen order", () => {
    const apps = [app("a", [orgRel("owner")]), app("b", [orgRel("user")]), app("c", [orgRel("owner")])];
    expect(buildColorSegments(apps, relRes, LABELS)).toEqual([
      { color: "#1976d2", label: "Owner", n: 2 },
      { color: "#66bb6a", label: "User", n: 1 },
    ]);
    expect(buildColorSegments([], relRes, LABELS)).toEqual([]);
    expect(buildColorSegments(apps, { kind: "none" }, LABELS)).toEqual([]);
  });

  it("lists coloured options, and Multiple only when a card needs it", () => {
    const field: FieldDef = {
      key: "tier",
      label: "Tier",
      type: "single_select",
      options: [
        { key: "gold", label: "Gold", color: "#ffd700" },
        { key: "bare", label: "Bare" },
      ],
    };
    expect(buildColorLegend({ kind: "none" }, LABELS, [])).toBeNull();
    expect(buildColorLegend({ kind: "field", field }, LABELS, [])).toEqual([
      { label: "Gold", color: "#ffd700" },
    ]);
    expect(
      buildColorLegend({ kind: "field", field: { ...field, options: undefined } }, LABELS, []),
    ).toBeNull();
    expect(buildColorLegend(relRes, LABELS, [app("a", [orgRel("owner")])])).toEqual([
      { label: "Owner", color: "#1976d2" },
      { label: "User", color: "#66bb6a" },
      { label: "Stakeholder", color: "#ff9800" },
    ]);
    expect(buildColorLegend(relRes, LABELS, [app("a", [orgRel("owner"), orgRel("user")])])).toEqual([
      { label: "Owner", color: "#1976d2" },
      { label: "User", color: "#66bb6a" },
      { label: "Stakeholder", color: "#ff9800" },
      { label: "Multiple", color: MULTIPLE_COLOR },
    ]);
    const colourless = { ...usageSub, options: [{ key: "x", label: "X" }] };
    expect(buildColorLegend({ kind: "rel", sub: colourless }, LABELS, [])).toBeNull();
  });
});

describe("relationMemberMatchesSubtypeFilters edges", () => {
  it("skips an unknown composite and reads null or '' as empty", () => {
    const a = app("a", [{ ...orgRel(undefined, "orgA"), attributes: { usageType: null } }]);
    expect(relationMemberMatchesSubtypeFilters(a, "orgA", { nope: ["owner"] }, [usageSub])).toBe(true);
    const empty = { [usageSub.composite]: [EMPTY_FILTER_KEY] };
    expect(relationMemberMatchesSubtypeFilters(a, "orgA", empty, [usageSub])).toBe(true);
    const blank = app("b", [{ ...orgRel(undefined, "orgA"), attributes: { usageType: "" } }]);
    expect(relationMemberMatchesSubtypeFilters(blank, "orgA", empty, [usageSub])).toBe(true);
    // A non-string value matches neither a real value nor EMPTY.
    const odd = app("c", [{ ...orgRel(undefined, "orgA"), attributes: { usageType: 3 } }]);
    expect(relationMemberMatchesSubtypeFilters(odd, "orgA", empty, [usageSub])).toBe(false);
    expect(
      relationMemberMatchesSubtypeFilters(odd, "orgA", { [usageSub.composite]: ["3"] }, [usageSub]),
    ).toBe(false);
    // EMPTY and a real value together: either satisfies the member.
    const both = { [usageSub.composite]: [EMPTY_FILTER_KEY, "owner"] };
    expect(relationMemberMatchesSubtypeFilters(app("d", [orgRel("owner", "orgA")]), "orgA", both, [usageSub])).toBe(true);
    // No relation to that member at all: nothing to match.
    expect(relationMemberMatchesSubtypeFilters(app("e", []), "orgA", empty, [usageSub])).toBe(false);
  });
});

describe("matchesStaticFilters, one filter kind at a time", () => {
  const f = (over: Partial<FilterState>) => baseFilters(over);
  const withAttrs = (attributes: Record<string, unknown> | undefined): AppData => ({
    ...app("Payments Hub"),
    attributes,
  });

  it("matches with no filter at all", () => {
    expect(matchesStaticFilters(app("a"), f({}))).toBe(true);
  });

  it("attribute filters: values, EMPTY, both, and AND across keys", () => {
    const gold = withAttrs({ tier: "gold", risk: "low" });
    expect(matchesStaticFilters(gold, f({ attributeFilters: { tier: [] } }))).toBe(true);
    expect(matchesStaticFilters(gold, f({ attributeFilters: { tier: ["gold"] } }))).toBe(true);
    expect(matchesStaticFilters(gold, f({ attributeFilters: { tier: ["silver"] } }))).toBe(false);
    const empty = f({ attributeFilters: { tier: [EMPTY_FILTER_KEY] } });
    expect(matchesStaticFilters(gold, empty)).toBe(false);
    for (const attributes of [{}, { tier: "" }, { tier: null }, undefined]) {
      expect(matchesStaticFilters(withAttrs(attributes), empty)).toBe(true);
    }
    const either = f({ attributeFilters: { tier: [EMPTY_FILTER_KEY, "gold"] } });
    expect(matchesStaticFilters(gold, either)).toBe(true);
    expect(matchesStaticFilters(withAttrs({ tier: "silver" }), either)).toBe(false);
    const both = f({ attributeFilters: { tier: ["gold"], risk: ["high"] } });
    expect(matchesStaticFilters(gold, both)).toBe(false);
  });

  it("relation filters by card type: ids, EMPTY and both", () => {
    const owned = app("a", [orgRel("owner", "orgA")]);
    const lonely = app("b", []);
    expect(matchesStaticFilters(owned, f({ relationFilters: { Organization: [] } }))).toBe(true);
    expect(matchesStaticFilters(owned, f({ relationFilters: { Organization: ["orgA"] } }))).toBe(true);
    expect(matchesStaticFilters(owned, f({ relationFilters: { Organization: ["orgB"] } }))).toBe(false);
    // Another card type with the same id does not count.
    expect(matchesStaticFilters(owned, f({ relationFilters: { ITComponent: ["orgA"] } }))).toBe(false);
    const none = f({ relationFilters: { Organization: [EMPTY_FILTER_KEY] } });
    expect(matchesStaticFilters(lonely, none)).toBe(true);
    expect(matchesStaticFilters(owned, none)).toBe(false);
    const either = f({ relationFilters: { Organization: [EMPTY_FILTER_KEY, "orgA"] } });
    expect(matchesStaticFilters(owned, either)).toBe(true);
    expect(matchesStaticFilters(lonely, either)).toBe(true);
    expect(matchesStaticFilters(app("c", [orgRel("owner", "orgB")]), either)).toBe(false);
  });

  it("relation filters by relation type only when the key is one", () => {
    const owned = app("a", [orgRel("owner", "orgA")]);
    const byType = f({
      relationFilters: { relOrgToApp: ["orgA"] },
      relTypeKeys: new Set(["relOrgToApp"]),
    });
    expect(matchesStaticFilters(owned, byType)).toBe(true);
    // The same key without relTypeKeys reads as a card type no row carries.
    expect(matchesStaticFilters(owned, f({ relationFilters: { relOrgToApp: ["orgA"] } }))).toBe(false);
  });

  it("relation-subtype filters: unknown composites, null and non-string values", () => {
    const nullValue = app("a", [{ ...orgRel(undefined), attributes: { usageType: null } }]);
    const numeric = app("b", [{ ...orgRel(undefined), attributes: { usageType: 3 } }]);
    const empty = f({ relSubtypeFilters: { [usageSub.composite]: [EMPTY_FILTER_KEY] } });
    expect(matchesStaticFilters(nullValue, empty)).toBe(true);
    expect(matchesStaticFilters(numeric, empty)).toBe(false);
    expect(matchesStaticFilters(numeric, f({ relSubtypeFilters: { [usageSub.composite]: ["3"] } }))).toBe(false);
    expect(matchesStaticFilters(numeric, f({ relSubtypeFilters: { nope: ["owner"] } }))).toBe(true);
    // No relation of that type at all matches neither EMPTY nor a value.
    expect(matchesStaticFilters(app("c", []), empty)).toBe(false);
    const either = f({ relSubtypeFilters: { [usageSub.composite]: [EMPTY_FILTER_KEY, "owner"] } });
    expect(matchesStaticFilters(app("d", [orgRel("owner")]), either)).toBe(true);
    expect(matchesStaticFilters(app("e", [orgRel("user")]), either)).toBe(false);
  });

  it("tag filters: OR within a group, AND across groups", () => {
    const tagGroups = [
      { id: "g1", name: "Region", mode: "single", tags: [{ id: "eu", name: "EU" }, { id: "us", name: "US" }] },
      { id: "g2", name: "Tier", mode: "single", tags: [{ id: "t1", name: "T1" }] },
    ];
    const tagged = (ids?: string[]): AppData => ({ ...app("a"), tag_ids: ids });
    const euOrUs = f({ tagFilterIds: ["eu", "us"], tagGroups });
    expect(matchesStaticFilters(tagged(["us"]), euOrUs)).toBe(true);
    expect(matchesStaticFilters(tagged(["t1"]), euOrUs)).toBe(false);
    expect(matchesStaticFilters(tagged(undefined), euOrUs)).toBe(false);
    const euAndT1 = f({ tagFilterIds: ["eu", "t1"], tagGroups });
    expect(matchesStaticFilters(tagged(["eu", "t1"]), euAndT1)).toBe(true);
    expect(matchesStaticFilters(tagged(["eu"]), euAndT1)).toBe(false);
    // A selection no group holds narrows nothing.
    expect(matchesStaticFilters(tagged([]), f({ tagFilterIds: ["ghost"], tagGroups }))).toBe(true);
  });

  it("search is a case-insensitive substring of the name", () => {
    const hub = app("Payments Hub");
    expect(matchesStaticFilters(hub, f({ search: "payments" }))).toBe(true);
    expect(matchesStaticFilters(hub, f({ search: "HUB" }))).toBe(true);
    expect(matchesStaticFilters(hub, f({ search: "ledger" }))).toBe(false);
  });
});


describe("filters that must look at the right relation and date", () => {
  it("matchesFilters drops a card retired by the timeline date", () => {
    const retired: AppData = { ...app("old"), lifecycle: { endOfLife: "2020-01-01" } };
    const f = baseFilters({ timelineDate: Date.UTC(2026, 0, 1) });
    expect(matchesFilters(retired, f)).toBe(false);
    expect(matchesFilters(app("live"), f)).toBe(true);
  });

  it("another relation type to the same card never satisfies a subtype filter", () => {
    const other = { ...orgRel("owner", "orgA"), relation_type: "relOther" };
    const a = app("a", [other]);
    const owner = { [usageSub.composite]: ["owner"] };
    expect(relationMemberMatchesSubtypeFilters(a, "orgA", owner, [usageSub])).toBe(false);
    expect(matchesStaticFilters(a, baseFilters({ relSubtypeFilters: owner }))).toBe(false);
  });

  it("an empty-string subtype value counts as empty", () => {
    const blank = app("a", [{ ...orgRel(undefined), attributes: { usageType: "" } }]);
    const empty = baseFilters({ relSubtypeFilters: { [usageSub.composite]: [EMPTY_FILTER_KEY] } });
    expect(matchesStaticFilters(blank, empty)).toBe(true);
  });
});
