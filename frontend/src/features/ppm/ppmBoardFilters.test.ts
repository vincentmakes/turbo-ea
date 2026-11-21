/**
 * The PPM board's Filters section: the `?filters=` encoding, its tolerant
 * decoding, and which initiatives a selection keeps — matched by the reports'
 * own rules.
 */
import { describe, expect, it } from "vitest";

import { EMPTY_CARD_FILTERS } from "@/features/reports/cardFilters";
import type { CardFilterValue, RelationFilterOption } from "@/features/reports/cardFilters";
import type { RelTypeDef } from "@/features/reports/portfolioHelpers";
import {
  decodeCardFilters,
  encodeCardFilters,
  matchingInitiativeIds,
  otherTypesFirst,
} from "./ppmBoardFilters";
import type { PpmFilterContext, PpmFilterItem } from "./ppmBoardFilters";

const value = (over: Partial<CardFilterValue> = {}): CardFilterValue => ({
  ...EMPTY_CARD_FILTERS,
  ...over,
});

const EMPTY = {
  attrFilters: {},
  relationFilters: {},
  relSubtypeFilters: {},
  subtypeFilters: [],
  tagFilterIds: [],
  includeDescendants: false,
};

describe("encodeCardFilters", () => {
  it("encodes nothing selected as an empty string", () => {
    expect(encodeCardFilters(value())).toBe("");
  });

  it("writes each key on its own", () => {
    expect(encodeCardFilters(value({ relationFilters: { Organization: ["o1"] } }))).toBe(
      '{"relationFilters":{"Organization":["o1"]}}',
    );
    expect(encodeCardFilters(value({ attrFilters: { size: ["big"] } }))).toBe(
      '{"attrFilters":{"size":["big"]}}',
    );
    expect(encodeCardFilters(value({ relSubtypeFilters: { "rel::usage": ["owner"] } }))).toBe(
      '{"relSubtypeFilters":{"rel::usage":["owner"]}}',
    );
    expect(encodeCardFilters(value({ tagFilterIds: ["t1", "t2"] }))).toBe(
      '{"tagFilterIds":["t1","t2"]}',
    );
  });

  it("writes Include sub-cards on its own", () => {
    expect(encodeCardFilters(value({ includeDescendants: true }))).toBe(
      '{"includeDescendants":true}',
    );
  });

  it("leaves emptied entries out, and a record of only empty entries", () => {
    expect(
      encodeCardFilters(
        value({
          relationFilters: { Organization: [], Platform: ["p1"] },
          attrFilters: { size: [] },
          relSubtypeFilters: { "rel::usage": [] },
        }),
      ),
    ).toBe('{"relationFilters":{"Platform":["p1"]}}');
  });

  it("never writes the section's subtype", () => {
    expect(encodeCardFilters(value({ subtypeFilters: ["project"] }))).toBe("");
  });

  it("writes the keys in one fixed order, whatever order they arrive in", () => {
    const v: CardFilterValue = {
      includeDescendants: true,
      tagFilterIds: ["t"],
      subtypeFilters: ["x"],
      relSubtypeFilters: { "r::f": ["v"] },
      attrFilters: { a: ["1"] },
      relationFilters: { R: ["r1"] },
    };
    expect(encodeCardFilters(v)).toBe(
      '{"relationFilters":{"R":["r1"]},"attrFilters":{"a":["1"]},' +
        '"relSubtypeFilters":{"r::f":["v"]},"tagFilterIds":["t"],"includeDescendants":true}',
    );
  });
});

describe("decodeCardFilters", () => {
  it("reads no param, an empty one and anything unparseable as the empty selection", () => {
    for (const raw of [null, "", "{bad", "[]", "[1]", "5", "0", '"str"', "null", "true", "false"]) {
      expect(decodeCardFilters(raw)).toEqual(EMPTY);
    }
  });

  it("returns a fresh object, never the shared empty constant", () => {
    expect(decodeCardFilters(null)).not.toBe(EMPTY_CARD_FILTERS);
  });

  it("forces the section's subtype empty, so the toolbar's stays the only one", () => {
    expect(decodeCardFilters('{"subtypeFilters":["project"],"tagFilterIds":["t"]}')).toEqual({
      ...EMPTY,
      tagFilterIds: ["t"],
    });
  });

  it("drops members that are not strings", () => {
    expect(
      decodeCardFilters(
        '{"relationFilters":{"Org":["o1",3,null],"Bad":"x"},"tagFilterIds":["t",{}],"includeDescendants":"yes"}',
      ),
    ).toEqual({ ...EMPTY, relationFilters: { Org: ["o1"] }, tagFilterIds: ["t"] });
  });

  it("round-trips what it encoded", () => {
    const v: CardFilterValue = {
      attrFilters: { size: ["big", "__empty__"] },
      relationFilters: { Organization: ["o1"] },
      relSubtypeFilters: { "rel::usage": ["owner"] },
      subtypeFilters: [],
      tagFilterIds: ["t1"],
      includeDescendants: true,
    };
    expect(decodeCardFilters(encodeCardFilters(v))).toEqual(v);
  });
});

describe("matchingInitiativeIds", () => {
  const rel = (relation_type: string, related_type: string, related_id: string, attrs = {}) => ({
    relation_type,
    direction: "outgoing" as const,
    related_id,
    related_name: related_id,
    related_type,
    attributes: attrs,
  });

  const initiative = (over: Partial<PpmFilterItem> & { id: string }): PpmFilterItem => ({
    name: over.id,
    subtype: null,
    attributes: {},
    relations: [],
    tag_ids: [],
    ...over,
  });

  const items: PpmFilterItem[] = [
    initiative({
      id: "a",
      name: "Alpha",
      subtype: "project",
      attributes: { regions: ["emea", "apac"] },
      relations: [rel("relInitToOrg", "Organization", "sales", { role: "sponsor" })],
      tag_ids: ["red", "big"],
    }),
    initiative({
      id: "b",
      name: "Beta",
      subtype: "epic",
      attributes: { regions: ["amer"] },
      relations: [rel("relInitToOrg", "Organization", "emea-sales", { role: "" })],
      tag_ids: ["blue", "big"],
    }),
    initiative({
      id: "c",
      name: "Gamma",
      relations: [rel("relInitToApp", "Application", "crm")],
      tag_ids: ["red"],
    }),
  ];

  const ctx: PpmFilterContext = {
    facetFields: [
      {
        key: "regions",
        label: "Regions",
        type: "multiple_select",
        options: [
          { key: "emea", label: "EMEA" },
          { key: "apac", label: "APAC" },
          { key: "amer", label: "AMER" },
        ],
      },
    ],
    relationTypes: [
      {
        key: "relInitToOrg",
        label: "affects",
        source_type_key: "Initiative",
        target_type_key: "Organization",
        other_type_key: "Organization",
      },
      {
        key: "relInitToApp",
        label: "affects",
        source_type_key: "Initiative",
        target_type_key: "Application",
        other_type_key: "Application",
      },
    ],
    groupableTypes: {
      Organization: [
        { id: "sales", name: "Sales", parent_id: null },
        { id: "emea-sales", name: "EMEA Sales", parent_id: "sales" },
      ],
      Application: [{ id: "crm", name: "CRM", parent_id: null }],
    },
    relSubtypes: [
      {
        composite: "relInitToOrg::role",
        relTypeKey: "relInitToOrg",
        fieldKey: "role",
        relatedTypeKey: "Organization",
        comboLabel: "affects · Role",
        options: [{ key: "sponsor", label: "Sponsor" }],
      },
    ],
    tagGroups: [
      {
        id: "colour",
        name: "Colour",
        mode: "multi",
        tags: [
          { id: "red", name: "Red" },
          { id: "blue", name: "Blue" },
        ],
      },
      { id: "size", name: "Size", mode: "multi", tags: [{ id: "big", name: "Big" }] },
    ],
  };

  const ids = (v: CardFilterValue) => {
    const set = matchingInitiativeIds(items, v, ctx);
    return set === null ? null : [...set].sort();
  };

  it("narrows nothing without a pick, Include sub-cards alone included", () => {
    expect(matchingInitiativeIds(items, value(), ctx)).toBeNull();
    expect(matchingInitiativeIds(items, value({ includeDescendants: true }), ctx)).toBeNull();
  });

  it("keeps the initiatives linked to a picked related card", () => {
    expect(ids(value({ relationFilters: { Organization: ["sales"] } }))).toEqual(["a"]);
    expect(ids(value({ relationFilters: { Application: ["crm"] } }))).toEqual(["c"]);
  });

  it("reads a relation-type key as that relation type", () => {
    expect(ids(value({ relationFilters: { relInitToApp: ["crm"] } }))).toEqual(["c"]);
  });

  it("matches a parent pick to a child-linked initiative only with sub-cards included", () => {
    expect(ids(value({ relationFilters: { Organization: ["sales"] } }))).toEqual(["a"]);
    expect(
      ids(value({ relationFilters: { Organization: ["sales"] }, includeDescendants: true })),
    ).toEqual(["a", "b"]);
  });

  it("matches the empty pick to an initiative with no such relation", () => {
    expect(ids(value({ relationFilters: { Organization: ["__empty__"] } }))).toEqual(["c"]);
    expect(
      ids(value({ relationFilters: { Organization: ["__empty__"] }, includeDescendants: true })),
    ).toEqual(["c"]);
  });

  it("ORs tags within a group and ANDs them across groups", () => {
    expect(ids(value({ tagFilterIds: ["red", "blue"] }))).toEqual(["a", "b", "c"]);
    expect(ids(value({ tagFilterIds: ["red", "big"] }))).toEqual(["a"]);
  });

  it("matches a select facet through the shared facet rule", () => {
    expect(ids(value({ attrFilters: { regions: ["apac"] } }))).toEqual(["a"]);
    expect(ids(value({ attrFilters: { regions: ["__empty__"] } }))).toEqual(["c"]);
  });

  it("matches a relation-subtype pick", () => {
    expect(ids(value({ relSubtypeFilters: { "relInitToOrg::role": ["sponsor"] } }))).toEqual([
      "a",
    ]);
    expect(ids(value({ relSubtypeFilters: { "relInitToOrg::role": ["__empty__"] } }))).toEqual([
      "b",
    ]);
  });

  it("passes a subtype pick through, a missing subtype reading as none", () => {
    expect(ids(value({ subtypeFilters: ["epic"] }))).toEqual(["b"]);
    expect(ids(value({ subtypeFilters: ["__empty__"] }))).toEqual(["c"]);
  });

  it("never lets the name decide", () => {
    expect(ids(value({ tagFilterIds: ["big"] }))).toEqual(["a", "b"]);
    const named = [initiative({ id: "z", name: "", tag_ids: ["big"] })];
    expect([...(matchingInitiativeIds(named, value({ tagFilterIds: ["big"] }), ctx) ?? [])]).toEqual(
      ["z"],
    );
  });

  it("returns an empty set when the pick matches nothing", () => {
    expect(ids(value({ tagFilterIds: ["blue"], relationFilters: { Application: ["crm"] } }))).toEqual(
      [],
    );
  });
});

describe("otherTypesFirst", () => {
  const rt = (key: string, source: string, target: string): RelTypeDef => ({
    key,
    label: key,
    source_type_key: source,
    target_type_key: target,
    other_type_key: source === "Initiative" ? target : source,
  });
  const RTS = [
    rt("relInitiativeToOrganization", "Initiative", "Organization"),
    rt("relInitiativeToOrganizationSponsor", "Initiative", "Organization"),
    rt("relInitiativeSucceeds", "Initiative", "Initiative"),
  ];
  const opt = (typeKey: string): RelationFilterOption => ({
    typeKey,
    label: typeKey,
    icon: "link",
    hierarchical: false,
    options: [],
  });
  const keys = (list: RelationFilterOption[]) => list.map((o) => o.typeKey);

  it("moves the own type's bare facet and both its sides after the other types, keeping each group's order", () => {
    const input = [
      opt("Initiative"),
      opt("relInitiativeSucceeds__out"),
      opt("relInitiativeSucceeds__in"),
      opt("Organization"),
      opt("relInitiativeToOrganizationSponsor"),
      opt("relInitiativeToOrganization"),
      opt("Application"),
    ];
    expect(keys(otherTypesFirst(input, RTS, "Initiative"))).toEqual([
      "Organization",
      "relInitiativeToOrganizationSponsor",
      "relInitiativeToOrganization",
      "Application",
      "Initiative",
      "relInitiativeSucceeds__out",
      "relInitiativeSucceeds__in",
    ]);
  });

  it("keeps the incoming order inside the own type's group too", () => {
    const input = [opt("relInitiativeSucceeds__in"), opt("Platform"), opt("Initiative")];
    expect(keys(otherTypesFirst(input, RTS, "Initiative"))).toEqual([
      "Platform",
      "relInitiativeSucceeds__in",
      "Initiative",
    ]);
  });

  it("returns only other types in the order they came", () => {
    const input = [opt("Platform"), opt("Organization"), opt("Application")];
    expect(keys(otherTypesFirst(input, RTS, "Initiative"))).toEqual([
      "Platform",
      "Organization",
      "Application",
    ]);
  });

  it("returns only the own type's facets in the order they came", () => {
    const input = [
      opt("relInitiativeSucceeds__in"),
      opt("Initiative"),
      opt("relInitiativeSucceeds__out"),
    ];
    expect(keys(otherTypesFirst(input, RTS, "Initiative"))).toEqual([
      "relInitiativeSucceeds__in",
      "Initiative",
      "relInitiativeSucceeds__out",
    ]);
  });

  it("reads the far end from the key, so the own type is whatever it is told", () => {
    const input = [opt("Initiative"), opt("Organization")];
    expect(keys(otherTypesFirst(input, RTS, "Organization"))).toEqual(["Initiative", "Organization"]);
  });

  it("returns an empty list for no facets", () => {
    expect(otherTypesFirst([], RTS, "Initiative")).toEqual([]);
  });
});
