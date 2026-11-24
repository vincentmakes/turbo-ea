import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import {
  EMPTY_CARD_FILTERS,
  buildRelationFilterOptions,
  clearCardFilterValues,
  buildRelSubtypes,
  countActiveFilters,
  conditionLabelsFor,
  conditionText,
  describeActiveFilters,
  expandRelationFilters,
  hasActiveFilters,
  relatedTypeOfKey,
  readCardFilters,
  relationTypeKeys,
  restoreCardFilters,
  type ConditionLabels,
  type FilterMember,
} from "./cardFilters";
import type { TFunction } from "i18next";
import { activeFieldKeys, rowsToRender, type FilterKind } from "@/lib/fieldFilters";
import { matchesStaticFilters, type AppData, type RelTypeDef } from "./portfolioHelpers";

const rt = (key: string, source: string, target: string, other: string, extra: Partial<RelTypeDef> = {}): RelTypeDef => ({
  key,
  label: key,
  source_type_key: source,
  target_type_key: target,
  other_type_key: other,
  ...extra,
});

// Operations > Fulfilment > Shipping, and an unrelated Finance.
const CAPS: FilterMember[] = [
  { id: "ops", name: "Operations", parent_id: null, ancestor_only: true },
  { id: "ful", name: "Fulfilment", parent_id: "ops", ancestor_only: true },
  { id: "ship", name: "Shipping", parent_id: "ful" },
  { id: "fin", name: "Finance", parent_id: null },
];
const ORGS: FilterMember[] = [{ id: "hq", name: "HQ" }];
const GROUPABLE = { BusinessCapability: CAPS, Organization: ORGS };
const REL_TYPES = [
  rt("relAppToBC", "Application", "BusinessCapability", "BusinessCapability"),
  rt("relOrgToApp", "Organization", "Application", "Organization"),
  rt("relOrgToAppOwns", "Organization", "Application", "Organization"),
  rt("relAppToApp", "Application", "Application", "Application"),
];

const META: Record<string, { label: string; icon?: string; hierarchical: boolean }> = {
  BusinessCapability: { label: "Business Capability", icon: "account_tree", hierarchical: true },
  Organization: { label: "Organization", hierarchical: false },
};

const buildOptions = (includeDescendants: boolean) =>
  buildRelationFilterOptions({
    groupableTypes: GROUPABLE,
    relationTypes: REL_TYPES,
    cardType: "Application",
    includeDescendants,
    typeMeta: (k) => META[k],
    relationVerb: (r, reverse) => `${reverse ? "rev" : "fwd"}:${r.key}`,
  });

describe("buildRelationFilterOptions", () => {
  it("offers directly linked cards only, plus one facet per relation side when several reach a type", () => {
    expect(buildOptions(false)).toEqual([
      {
        typeKey: "BusinessCapability",
        label: "Business Capability",
        icon: "account_tree",
        hierarchical: true,
        options: [
          { key: "ship", label: "Shipping" },
          { key: "fin", label: "Finance" },
        ],
      },
      { typeKey: "Organization", label: "Organization", icon: "link", hierarchical: false, options: [{ key: "hq", label: "HQ" }] },
      {
        typeKey: "relOrgToApp",
        label: "Organization · rev:relOrgToApp",
        icon: "link",
        hierarchical: false,
        options: [{ key: "hq", label: "HQ" }],
      },
      {
        typeKey: "relOrgToAppOwns",
        label: "Organization · rev:relOrgToAppOwns",
        icon: "link",
        hierarchical: false,
        options: [{ key: "hq", label: "HQ" }],
      },
    ]);
  });

  it("offers the parents too once sub-cards are included, so a parent can be picked", () => {
    expect(buildOptions(true)[0].options.map((o) => o.key)).toEqual(["ops", "ful", "ship", "fin"]);
    // A flat type has no parents to offer.
    expect(buildOptions(true)[1].options.map((o) => o.key)).toEqual(["hq"]);
  });

  it("skips a type that only completes a hierarchy, and names an unknown type by its key", () => {
    const opts = buildRelationFilterOptions({
      groupableTypes: { Ghost: [{ id: "g", name: "G" }], Only: [{ id: "a", name: "A", ancestor_only: true }] },
      relationTypes: [],
      cardType: "Application",
      includeDescendants: true,
      typeMeta: () => undefined,
      relationVerb: () => "",
    });
    expect(opts).toEqual([{ typeKey: "Ghost", label: "Ghost", icon: "link", hierarchical: false, options: [{ key: "g", label: "G" }] }]);
  });

  it("splits a self-referencing type into its two sides with their own verbs", () => {
    const opts = buildRelationFilterOptions({
      groupableTypes: { Application: [{ id: "crm", name: "CRM" }] },
      relationTypes: REL_TYPES,
      cardType: "Application",
      includeDescendants: false,
      typeMeta: () => ({ label: "Application", hierarchical: false }),
      relationVerb: (r, reverse) => `${reverse ? "rev" : "fwd"}:${r.key}`,
    });
    expect(opts.map((o) => [o.typeKey, o.label])).toEqual([
      ["Application", "Application"],
      ["relAppToApp__out", "Application · fwd:relAppToApp"],
      ["relAppToApp__in", "Application · rev:relAppToApp"],
    ]);
  });
});

describe("relatedTypeOfKey", () => {
  it("resolves card-type keys, relation keys and side keys", () => {
    expect(relatedTypeOfKey("BusinessCapability", REL_TYPES)).toBe("BusinessCapability");
    expect(relatedTypeOfKey("relOrgToAppOwns", REL_TYPES)).toBe("Organization");
    expect(relatedTypeOfKey("relAppToApp__in", REL_TYPES)).toBe("Application");
  });
});

describe("expandRelationFilters", () => {
  it("widens a pick to itself and everything beneath it", () => {
    const out = expandRelationFilters({ BusinessCapability: ["ops"] }, GROUPABLE, REL_TYPES);
    expect(new Set(out.BusinessCapability)).toEqual(new Set(["ops", "ful", "ship"]));
  });

  it("resolves a relation-type key to its card type", () => {
    const groupable = { Organization: [{ id: "hq", name: "HQ" }, { id: "eu", name: "EU", parent_id: "hq" }] };
    const out = expandRelationFilters({ relOrgToAppOwns: ["hq"] }, groupable, REL_TYPES);
    expect(new Set(out.relOrgToAppOwns)).toEqual(new Set(["hq", "eu"]));
  });

  it("leaves a pick on a type with no members as it is", () => {
    expect(expandRelationFilters({ Ghost: ["g1"] }, GROUPABLE, REL_TYPES)).toEqual({ Ghost: ["g1"] });
  });

  it("keeps the (empty) pick and an empty pick list as they are", () => {
    const out = expandRelationFilters(
      { BusinessCapability: [EMPTY_FILTER_KEY, "ful"], Organization: [] },
      GROUPABLE,
      REL_TYPES,
    );
    expect(out.BusinessCapability[0]).toBe(EMPTY_FILTER_KEY);
    expect(new Set(out.BusinessCapability)).toEqual(new Set([EMPTY_FILTER_KEY, "ful", "ship"]));
    expect(out.Organization).toEqual([]);
  });

  it("survives a parent cycle", () => {
    const loop = { BusinessCapability: [{ id: "a", name: "A", parent_id: "b" }, { id: "b", name: "B", parent_id: "a" }] };
    expect(new Set(expandRelationFilters({ BusinessCapability: ["a"] }, loop, REL_TYPES).BusinessCapability)).toEqual(
      new Set(["a", "b"]),
    );
  });

  it("lets a parent pick match a card linked only to a grandchild (#1305)", () => {
    const app = (id: string, capId: string): AppData => ({
      id,
      name: id,
      org_ids: [],
      relations: [
        {
          relation_type: "relAppToBC",
          direction: "outgoing",
          related_id: capId,
          related_name: capId,
          related_type: "BusinessCapability",
        },
      ],
    });
    const base = {
      attributeFilters: {},
      relSubtypeFilters: {},
      relSubtypes: [],
      subtypeFilters: [],
      tagFilterIds: [],
      tagGroups: [],
      search: "",
      relTypeKeys: relationTypeKeys(REL_TYPES),
    };
    const picked = { BusinessCapability: ["ops"] };
    const shipping = app("shipping-app", "ship");
    const finance = app("finance-app", "fin");
    expect(matchesStaticFilters(shipping, { ...base, relationFilters: picked })).toBe(false);
    const widened = expandRelationFilters(picked, GROUPABLE, REL_TYPES);
    expect(matchesStaticFilters(shipping, { ...base, relationFilters: widened })).toBe(true);
    expect(matchesStaticFilters(finance, { ...base, relationFilters: widened })).toBe(false);
  });
});

describe("relationTypeKeys", () => {
  it("lists bare keys, and both sides of a self-referencing type", () => {
    expect(relationTypeKeys(REL_TYPES)).toEqual(
      new Set(["relAppToBC", "relOrgToApp", "relOrgToAppOwns", "relAppToApp", "relAppToApp__out", "relAppToApp__in"]),
    );
  });
});

describe("buildRelSubtypes", () => {
  it("labels each relation attribute by the verb read from the card's side", () => {
    const usage = {
      key: "usageType",
      label: "Usage Type",
      type: "single_select",
      options: [{ key: "owner", label: "Owner", color: "#111" }],
    };
    const subs = buildRelSubtypes(
      [
        rt("relOrgToApp", "Organization", "Application", "Organization", { attributes_schema: [usage] }),
        rt("relAppToBC", "Application", "BusinessCapability", "BusinessCapability", {
          attributes_schema: [{ ...usage, key: "support", label: "Support" }],
        }),
      ],
      "Application",
      {
        relationVerb: (r, reverse) => `${reverse ? "rev" : "fwd"}:${r.key}`,
        fieldLabel: (f) => `F:${f.label}`,
        optionLabel: (o) => `O:${o.label}`,
      },
    );
    expect(subs).toEqual([
      {
        composite: "relOrgToApp::usageType",
        relTypeKey: "relOrgToApp",
        fieldKey: "usageType",
        relatedTypeKey: "Organization",
        comboLabel: "rev:relOrgToApp · F:Usage Type",
        options: [{ key: "owner", label: "O:Owner", color: "#111" }],
      },
      {
        composite: "relAppToBC::support",
        relTypeKey: "relAppToBC",
        fieldKey: "support",
        relatedTypeKey: "BusinessCapability",
        comboLabel: "fwd:relAppToBC · F:Support",
        options: [{ key: "owner", label: "O:Owner", color: "#111" }],
      },
    ]);
  });
});

describe("restoreCardFilters", () => {
  it("reads the saved keys back and drops anything malformed", () => {
    expect(
      restoreCardFilters({
        attrFilters: { fit: ["good", 3], empty: [], bad: "x" },
        relationFilters: { BusinessCapability: ["ops"] },
        relSubtypeFilters: ["not", "a", "record"],
        subtypeFilters: ["saas", null],
        tagFilterIds: "t1",
        includeDescendants: "yes",
        filterFields: ["risk", 4, "risk", null, "tier"],
        attrConditions: { code: { contains: " ORG " }, bad: { contains: "x", min: 1 }, n: "x" },
      }),
    ).toEqual({
      attrFilters: { fit: ["good"] },
      attrConditions: { code: { contains: "ORG" } },
      relationFilters: { BusinessCapability: ["ops"] },
      relSubtypeFilters: {},
      subtypeFilters: ["saas"],
      tagFilterIds: [],
      includeDescendants: false,
      // The stored rows first, then every field holding a value: picks, then conditions.
      filterFields: ["risk", "tier", "fit", "code"],
    });
    expect(restoreCardFilters({ filterFields: "risk" }).filterFields).toEqual([]);
    expect(restoreCardFilters({ includeDescendants: true }).includeDescendants).toBe(true);
    expect(restoreCardFilters({})).toEqual(EMPTY_CARD_FILTERS);
    // A null, a scalar and a list in place of a record all read as empty.
    expect(
      restoreCardFilters({ attrFilters: null, relationFilters: 7, relSubtypeFilters: [["x"]] }),
    ).toEqual(EMPTY_CARD_FILTERS);
  });

  it("gives a value restored without its added row a row of its own, so clearing it keeps the row", () => {
    const restored = restoreCardFilters({ attrConditions: { code: { contains: "ORG" } } });
    expect(restored.filterFields).toEqual(["code"]);
    // The person empties the box: the row no longer holds a value, yet it is
    // still an added row, so `rowsToRender` keeps it.
    const catalog = [
      {
        key: "s",
        label: "S",
        hidden: false,
        fields: [{ field: { key: "code" }, kind: "text" as const, shownByDefault: false }],
      },
    ];
    const cleared = { ...restored, attrConditions: {} };
    expect(
      rowsToRender(catalog, cleared.filterFields, activeFieldKeys(cleared)).map((r) => r.field.key),
    ).toEqual(["code"]);
    // A key already stored is not repeated, and an unusable value adds nothing.
    expect(
      restoreCardFilters({
        filterFields: ["code"],
        attrConditions: { code: { contains: "x" }, blank: { contains: "  " } },
      }).filterFields,
    ).toEqual(["code"]);
  });

  it("reads a config as stored through readCardFilters, filterFields not widened", () => {
    expect(
      readCardFilters({ attrFilters: { fit: ["good"] }, attrConditions: { code: { contains: "x" } } })
        .filterFields,
    ).toEqual([]);
  });
});

describe("text, number and date conditions", () => {
  const kinds = new Map<string, FilterKind>([
    ["code", "text"],
    ["n", "number"],
    ["due", "date"],
  ]);
  const value = {
    ...EMPTY_CARD_FILTERS,
    attrConditions: {
      code: { contains: "ORG" },
      n: { min: 10, max: 20 },
      due: { from: "2026-01-01" },
      price: { min: 1000 },
    },
  };
  const conditionLabels: ConditionLabels = {
    contains: (v) => `contains "${v}"`,
    between: (a, b) => `${a} – ${b}`,
    atLeast: (v) => `≥ ${v}`,
    atMost: (v) => `≤ ${v}`,
  };
  const describe_ = (kindByKey = kinds) =>
    describeActiveFilters({
      value,
      relationOptions: [],
      tagGroups: [],
      subtypeOptions: [],
      fields: [],
      relSubtypes: [],
      labels: { subtype: "Subtype", tags: "Tags", empty: "(empty)", subCards: "(incl. sub-cards)" },
      conditions: {
        fields: [
          { key: "code", label: "Code" },
          { key: "n", label: "Count" },
        ],
        kindByKey,
        labels: conditionLabels,
        formatNumber: (x) => `${x}.0`,
      },
    });

  it("counts a condition only when its field is in the reader's catalog", () => {
    expect(countActiveFilters(value, kinds)).toBe(3);
    expect(countActiveFilters(value)).toBe(0);
    expect(countActiveFilters(value, new Map([["price", "number"]]))).toBe(1);
    expect(hasActiveFilters(value, "", kinds)).toBe(true);
    expect(hasActiveFilters(value, "")).toBe(false);
    expect(hasActiveFilters({ ...value, attrConditions: { price: { min: 1 } } }, "", kinds)).toBe(false);
  });

  it("describes exactly the conditions it counts, one line each", () => {
    const lines = describe_();
    expect(lines).toEqual([
      { label: "Code", value: 'contains "ORG"' },
      { label: "Count", value: "10.0 – 20.0" },
      // A field the label list misses falls back to its key.
      { label: "due", value: "≥ 2026-01-01" },
    ]);
    expect(lines).toHaveLength(countActiveFilters(value, kinds));
    expect(describe_(new Map())).toEqual([]);
  });

  it("describes nothing without the catalog", () => {
    expect(
      describeActiveFilters({
        value,
        relationOptions: [],
        tagGroups: [],
        subtypeOptions: [],
        fields: [],
        relSubtypes: [],
        labels: { subtype: "Subtype", tags: "Tags", empty: "(empty)", subCards: "(incl. sub-cards)" },
      }),
    ).toEqual([]);
  });

  it("words each condition through the labels", () => {
    expect(conditionText({ op: "contains", value: "x" }, conditionLabels)).toBe('contains "x"');
    expect(conditionText({ op: "between", from: "1", to: "2" }, conditionLabels)).toBe("1 – 2");
    expect(conditionText({ op: "atLeast", value: "1" }, conditionLabels)).toBe("≥ 1");
    expect(conditionText({ op: "atMost", value: "2" }, conditionLabels)).toBe("≤ 2");
  });

  it("reads the words from the reports namespace", () => {
    const t = ((key: string, opts?: Record<string, unknown>) => `${key} ${JSON.stringify(opts)}`) as unknown as TFunction;
    const words = conditionLabelsFor(t);
    expect(words.contains("x")).toBe('reports:cardFilters.conditionContains {"value":"x"}');
    expect(words.between("1", "2")).toBe('reports:cardFilters.conditionBetween {"from":"1","to":"2"}');
    expect(words.atLeast("1")).toBe('reports:cardFilters.conditionAtLeast {"value":"1"}');
    expect(words.atMost("2")).toBe('reports:cardFilters.conditionAtMost {"value":"2"}');
  });

  it("Clear all empties the conditions, keeping the added rows", () => {
    expect(clearCardFilterValues({ ...value, filterFields: ["code"] })).toEqual({
      ...EMPTY_CARD_FILTERS,
      filterFields: ["code"],
    });
    expect(EMPTY_CARD_FILTERS.attrConditions).toEqual({});
  });

  it("the shared matcher applies a condition on a catalog field only", () => {
    const base = {
      attributeFilters: {},
      relationFilters: {},
      relSubtypeFilters: {},
      relSubtypes: [],
      subtypeFilters: [],
      tagFilterIds: [],
      tagGroups: [],
      search: "",
    };
    const app: AppData = { id: "a", name: "A", attributes: { code: "ORG-1", price: 5 }, relations: [], org_ids: [] };
    const run = (attrConditions: Record<string, unknown>) =>
      matchesStaticFilters(app, { ...base, attrConditions, conditionKinds: kinds });
    expect(run({ code: { contains: "org" } })).toBe(true);
    expect(run({ code: { contains: "xyz" } })).toBe(false);
    expect(run({ price: { min: 1000 } })).toBe(true);
  });
});

describe("counting and describing", () => {
  const value = {
    attrFilters: { fit: ["good", EMPTY_FILTER_KEY], other: [] },
    relationFilters: { BusinessCapability: ["ops"], Organization: ["hq"] },
    relSubtypeFilters: { "relOrgToApp::usageType": ["owner"] },
    subtypeFilters: ["saas"],
    tagFilterIds: ["t1", "t9"],
    includeDescendants: true,
    filterFields: ["risk", "tier"],
  };

  it("counts every selected value, never the added fields", () => {
    expect(countActiveFilters(value)).toBe(8);
    expect(countActiveFilters(EMPTY_CARD_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...EMPTY_CARD_FILTERS, filterFields: ["risk"] })).toBe(0);
  });

  it("is active with any selection or a search", () => {
    expect(hasActiveFilters(EMPTY_CARD_FILTERS, "")).toBe(false);
    expect(hasActiveFilters(EMPTY_CARD_FILTERS, "erp")).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_CARD_FILTERS, tagFilterIds: ["t"] }, "")).toBe(true);
    // The sub-card switch alone narrows nothing, nor does an added, empty row.
    expect(hasActiveFilters({ ...EMPTY_CARD_FILTERS, includeDescendants: true }, "")).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_CARD_FILTERS, filterFields: ["risk"] }, "")).toBe(false);
  });

  it("Clear all empties every value and keeps the added rows and the sub-card preference", () => {
    expect(clearCardFilterValues(value)).toEqual({
      ...EMPTY_CARD_FILTERS,
      includeDescendants: true,
      filterFields: ["risk", "tier"],
    });
    expect(clearCardFilterValues({ ...value, includeDescendants: false, filterFields: [] })).toEqual(
      EMPTY_CARD_FILTERS,
    );
  });

  it("names nothing when nothing is picked, whatever options are offered", () => {
    expect(
      describeActiveFilters({
        value: { ...EMPTY_CARD_FILTERS, includeDescendants: true },
        relationOptions: buildOptions(true),
        tagGroups: [{ id: "g", name: "Origin", mode: "multi", tags: [{ id: "t1", name: "In-house" }] }],
        subtypeOptions: [{ key: "saas", label: "SaaS" }],
        fields: [{ key: "fit", label: "Fit", type: "single_select", options: [{ key: "good", label: "Good" }] }],
        relSubtypes: [
          {
            composite: "relOrgToApp::usageType",
            relTypeKey: "relOrgToApp",
            fieldKey: "usageType",
            relatedTypeKey: "Organization",
            comboLabel: "used by · Usage Type",
            options: [{ key: "owner", label: "Owner" }],
          },
        ],
        labels: { subtype: "Subtype", tags: "Tags", empty: "(empty)", subCards: "(incl. sub-cards)" },
      }),
    ).toEqual([]);
  });

  it("names each active filter by its labels for an export header", () => {
    expect(
      describeActiveFilters({
        value,
        relationOptions: buildOptions(true),
        tagGroups: [{ id: "g", name: "Origin", mode: "multi", tags: [{ id: "t1", name: "Internally Developed" }] }],
        subtypeOptions: [{ key: "saas", label: "SaaS" }],
        fields: [{ key: "fit", label: "Fit", type: "single_select", options: [{ key: "good", label: "Good" }] }],
        relSubtypes: [
          {
            composite: "relOrgToApp::usageType",
            relTypeKey: "relOrgToApp",
            fieldKey: "usageType",
            relatedTypeKey: "Organization",
            comboLabel: "used by · Usage Type",
            options: [{ key: "owner", label: "Owner" }],
          },
        ],
        labels: { subtype: "Subtype", tags: "Tags", empty: "(empty)", subCards: "(incl. sub-cards)" },
      }),
    ).toEqual([
      { label: "Subtype", value: "SaaS" },
      { label: "Business Capability", value: "Operations (incl. sub-cards)" },
      { label: "Organization", value: "HQ" },
      { label: "Tags", value: "Internally Developed, t9" },
      { label: "Fit", value: "Good, (empty)" },
      { label: "used by · Usage Type", value: "Owner" },
    ]);
  });
});
