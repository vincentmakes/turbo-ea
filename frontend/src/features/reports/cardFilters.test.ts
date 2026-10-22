import { describe, expect, it } from "vitest";
import { EMPTY_FILTER_KEY } from "@/components/FilterSelect";
import {
  EMPTY_CARD_FILTERS,
  buildRelationFilterOptions,
  buildRelSubtypes,
  countActiveFilters,
  describeActiveFilters,
  expandRelationFilters,
  hasActiveFilters,
  relatedTypeOfKey,
  relationTypeKeys,
  restoreCardFilters,
  type FilterMember,
} from "./cardFilters";
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
      }),
    ).toEqual({
      attrFilters: { fit: ["good"] },
      relationFilters: { BusinessCapability: ["ops"] },
      relSubtypeFilters: {},
      subtypeFilters: ["saas"],
      tagFilterIds: [],
      includeDescendants: false,
    });
    expect(restoreCardFilters({ includeDescendants: true }).includeDescendants).toBe(true);
    expect(restoreCardFilters({})).toEqual(EMPTY_CARD_FILTERS);
    // A null, a scalar and a list in place of a record all read as empty.
    expect(
      restoreCardFilters({ attrFilters: null, relationFilters: 7, relSubtypeFilters: [["x"]] }),
    ).toEqual(EMPTY_CARD_FILTERS);
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
  };

  it("counts every selected value", () => {
    expect(countActiveFilters(value)).toBe(8);
    expect(countActiveFilters(EMPTY_CARD_FILTERS)).toBe(0);
  });

  it("is active with any selection or a search", () => {
    expect(hasActiveFilters(EMPTY_CARD_FILTERS, "")).toBe(false);
    expect(hasActiveFilters(EMPTY_CARD_FILTERS, "erp")).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_CARD_FILTERS, tagFilterIds: ["t"] }, "")).toBe(true);
    // The sub-card switch alone narrows nothing.
    expect(hasActiveFilters({ ...EMPTY_CARD_FILTERS, includeDescendants: true }, "")).toBe(false);
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
