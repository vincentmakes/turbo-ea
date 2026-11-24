import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldDef, PortalCard, PortalRelationType, PortalVisitorFilters, PublicPortal } from "@/types";
import { catalogFields } from "@/lib/fieldFilters";
import {
  DEFAULT_CARD,
  DEFAULT_DETAIL,
  EMPTY_VISITOR_FILTERS,
  cardQueryParams,
  clearVisitorFilters,
  detailRelationGroups,
  fieldFilterKey,
  fieldsWithValues,
  filterableFieldKeys,
  hasActiveFilters,
  hasAttributeValue,
  isVisible,
  knownFilterFields,
  loadPortalPrefs,
  portalFields,
  portalFilterCatalog,
  portalPrefsKey,
  portalRelationTypes,
  portalSilentKey,
  portalToggles,
  relatedTypeKeys,
  relationFilterKey,
  relationFilterLabel,
  savePortalPrefs,
  showsFilter,
  tileRelations,
  visitorFilterLists,
  visitorFiltersParam,
  type CardQuery,
  type Toggles,
  type VisitorFilterState,
} from "./portalViewerState";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const field = (key: string, type = "text", options?: FieldDef["options"]): FieldDef => ({
  key,
  label: key,
  type,
  ...(options ? { options } : {}),
});

const OPTS = [{ key: "a", label: "A" }];

function portal(over: Partial<PublicPortal> = {}): PublicPortal {
  return {
    id: "p1",
    name: "Portal",
    slug: "acme",
    card_type: "Application",
    type_info: null,
    relation_types: [],
    tag_groups: [],
    ...over,
  };
}

function withFields(fields: FieldDef[], toggles?: Toggles): PublicPortal {
  return portal({
    type_info: {
      key: "Application",
      label: "Application",
      icon: "apps",
      color: "#000",
      fields_schema: [
        { section: "One", fields: fields.slice(0, 2) },
        { section: "Two", fields: fields.slice(2) },
      ],
    },
    ...(toggles ? { card_config: { toggles } } : {}),
  });
}

const rt = (key: string, over: Partial<PortalRelationType> = {}): PortalRelationType => ({
  key,
  label: `${key} fwd`,
  source_type_key: "Application",
  target_type_key: "ITComponent",
  other_type_key: "ITComponent",
  other_type_label: "IT Component",
  ...over,
});

const rel = (
  type: string,
  related_id: string,
  direction = "outgoing",
): PortalCard["relations"][number] => ({
  type,
  related_id,
  related_name: `name-${related_id}`,
  related_type: "ITComponent",
  direction,
});

/** A label that says which relation type and which direction it was asked for. */
const label = (r: PortalRelationType, reverse?: boolean) => `${r.key}:${reverse ? "rev" : "fwd"}`;

/* ------------------------------------------------------------------ */
/*  Visibility toggles                                                 */
/* ------------------------------------------------------------------ */

describe("visibility toggles", () => {
  it("shows everything but the approval chip on a tile by default", () => {
    expect(DEFAULT_CARD).toEqual({
      description: true,
      lifecycle: true,
      tags: true,
      subscribers: true,
      data_quality: true,
      approval_status: false,
    });
  });

  it("shows everything in the detail panel by default", () => {
    expect(DEFAULT_DETAIL).toEqual({
      description: true,
      lifecycle: true,
      tags: true,
      subscribers: true,
      data_quality: true,
      approval_status: true,
    });
  });

  it("follows the administrator's toggle for the mode asked", () => {
    const toggles: Toggles = { tags: { card: false, detail: true } };
    expect(isVisible(toggles, "tags", "card", true)).toBe(false);
    expect(isVisible(toggles, "tags", "detail", false)).toBe(true);
  });

  it("falls back to the built-in default, then to the caller's fallback", () => {
    expect(isVisible(undefined, "approval_status", "card", true)).toBe(false);
    expect(isVisible(undefined, "approval_status", "detail", false)).toBe(true);
    expect(isVisible({}, "field:x", "card", true)).toBe(true);
    expect(isVisible({}, "field:x", "detail", false)).toBe(false);
  });

  it("reads the toggles off the portal's card config", () => {
    const toggles: Toggles = { tags: { card: true, detail: false } };
    expect(portalToggles(null)).toBeUndefined();
    expect(portalToggles(portal())).toBeUndefined();
    expect(portalToggles(portal({ card_config: {} }))).toBeUndefined();
    expect(portalToggles(portal({ card_config: { toggles } }))).toBe(toggles);
  });

  it("keys the silent sign-in marker by resource kind and slug", () => {
    expect(portalSilentKey("acme")).toBe("portal_silent_portal_acme");
  });
});

/* ------------------------------------------------------------------ */
/*  Fields                                                             */
/* ------------------------------------------------------------------ */

describe("fields", () => {
  it("has none without a type", () => {
    expect(portalFields(null)).toEqual({ all: [], card: [], detail: [] });
    expect(portalFields(portal())).toEqual({ all: [], card: [], detail: [] });
    // A type payload without a schema (an older backend) has no fields either.
    const noSchema = { key: "Application", label: "Application", icon: "apps", color: "#000" };
    expect(
      portalFields(portal({ type_info: noSchema as PublicPortal["type_info"] })),
    ).toEqual({ all: [], card: [], detail: [] });
  });

  it("puts the first three fields on a tile and every field in the panel by default", () => {
    const fs = ["a", "b", "c", "d"].map((k) => field(k));
    const out = portalFields(withFields(fs));
    expect(out.all.map((f) => f.key)).toEqual(["a", "b", "c", "d"]);
    expect(out.card.map((f) => f.key)).toEqual(["a", "b", "c"]);
    expect(out.detail.map((f) => f.key)).toEqual(["a", "b", "c", "d"]);
  });

  it("follows a field's toggle over the defaults", () => {
    const fs = ["a", "b", "c", "d"].map((k) => field(k));
    const out = portalFields(
      withFields(fs, {
        "field:a": { card: false, detail: false },
        "field:d": { card: true, detail: true },
      }),
    );
    expect(out.card.map((f) => f.key)).toEqual(["b", "c", "d"]);
    expect(out.detail.map((f) => f.key)).toEqual(["b", "c", "d"]);
  });

  it("counts a value as present unless it is absent, null or empty text", () => {
    expect(hasAttributeValue({}, "k")).toBe(false);
    expect(hasAttributeValue({ attributes: {} }, "k")).toBe(false);
    expect(hasAttributeValue({ attributes: { k: null } }, "k")).toBe(false);
    expect(hasAttributeValue({ attributes: { k: "" } }, "k")).toBe(false);
    expect(hasAttributeValue({ attributes: { k: 0 } }, "k")).toBe(true);
    expect(hasAttributeValue({ attributes: { k: false } }, "k")).toBe(true);
    expect(hasAttributeValue({ attributes: { k: "x" } }, "k")).toBe(true);
  });

  it("keeps a section's fields that are shown in the panel and have a value, in section order", () => {
    const section = [field("a"), field("b"), field("c"), field("d")];
    const detail = [field("d"), field("a"), field("c")];
    const card = { attributes: { a: "x", b: "y", c: "", d: 3 } };
    expect(fieldsWithValues(section, detail, card).map((f) => f.key)).toEqual(["a", "d"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Relation types                                                     */
/* ------------------------------------------------------------------ */

describe("relation types", () => {
  it("shows none without a portal or without rel toggles", () => {
    expect(portalRelationTypes(null)).toEqual({ visible: [], card: [], detail: [] });
    expect(portalRelationTypes(portal({ relation_types: [rt("r1")] }))).toEqual({
      visible: [],
      card: [],
      detail: [],
    });
  });

  it("splits the toggled relation types by where they show", () => {
    const types = [rt("both"), rt("tile"), rt("panel"), rt("off"), rt("untoggled")];
    const out = portalRelationTypes(
      portal({
        relation_types: types,
        card_config: {
          toggles: {
            "rel:both": { card: true, detail: true },
            "rel:tile": { card: true, detail: false },
            "rel:panel": { card: false, detail: true },
            "rel:off": { card: false, detail: false },
            // A field toggle of the same key is not a relation toggle.
            untoggled: { card: true, detail: true },
          },
        },
      }),
    );
    expect(out.visible.map((r) => r.key)).toEqual(["both", "tile", "panel"]);
    expect(out.card.map((r) => r.key)).toEqual(["both", "tile"]);
    expect(out.detail.map((r) => r.key)).toEqual(["both", "panel"]);
  });

  it("lists each related card type once, in order of first appearance", () => {
    const types = [
      rt("r1", { other_type_key: "ITComponent" }),
      rt("r2", { other_type_key: "Interface" }),
      rt("r3", { other_type_key: "ITComponent" }),
    ];
    expect(relatedTypeKeys(types)).toEqual(["ITComponent", "Interface"]);
    expect(relatedTypeKeys([])).toEqual([]);
  });
});

describe("relation filter label", () => {
  it("names a lone relation type by the card type it reaches", () => {
    const r = rt("r1");
    expect(relationFilterLabel(r, [r, rt("r2", { other_type_key: "Interface" })], label)).toBe(
      "IT Component",
    );
  });

  it("adds the verb from the portal type's end when two types reach the same card type", () => {
    // The portal type is the source: the forward verb.
    const owns = rt("owns");
    const uses = rt("uses");
    expect(relationFilterLabel(owns, [owns, uses], label)).toBe("IT Component · owns:fwd");
    // The portal type is the target: the reverse verb.
    const a = rt("a", { source_type_key: "ITComponent", target_type_key: "Application" });
    const b = rt("b", { source_type_key: "ITComponent", target_type_key: "Application" });
    expect(relationFilterLabel(a, [a, b], label)).toBe("IT Component · a:rev");
  });

  it("carries both verbs for a self-referencing type, which matches either direction", () => {
    const self = rt("succ", {
      source_type_key: "Application",
      target_type_key: "Application",
      other_type_key: "Application",
      other_type_label: "Application",
    });
    const other = rt("dup", { ...self, key: "dup" });
    expect(relationFilterLabel(self, [self, other], label)).toBe(
      "Application · succ:fwd / succ:rev",
    );
  });
});

describe("tile relations", () => {
  it("names each related card once, through the tile's relation types only", () => {
    const card = {
      relations: [
        rel("owns", "c1"),
        rel("uses", "c1"),
        rel("hidden", "c2"),
        rel("uses", "c3"),
        rel("owns", "c3", "incoming"),
      ],
    };
    const out = tileRelations(card, [rt("owns"), rt("uses")]);
    expect(out).toEqual([rel("owns", "c1"), rel("uses", "c3")]);
  });

  it("names nothing when no relation type shows on a tile", () => {
    expect(tileRelations({ relations: [rel("owns", "c1")] }, [])).toEqual([]);
  });
});

describe("detail relation groups", () => {
  it("groups by relation type and direction, labelled from this card's side", () => {
    const owns = rt("owns");
    const uses = rt("uses");
    const card = {
      relations: [
        rel("owns", "c1"),
        rel("uses", "c2"),
        rel("owns", "c3"),
        rel("owns", "c4", "incoming"),
        rel("hidden", "c5"),
      ],
    };
    expect(detailRelationGroups(card, [owns, uses], [owns, uses, rt("hidden")], label)).toEqual([
      { key: "owns|outgoing", label: "owns:fwd", relations: [rel("owns", "c1"), rel("owns", "c3")] },
      { key: "uses|outgoing", label: "uses:fwd", relations: [rel("uses", "c2")] },
      { key: "owns|incoming", label: "owns:rev", relations: [rel("owns", "c4", "incoming")] },
    ]);
  });

  it("falls back to the raw key for a relation type the portal does not describe", () => {
    const card = { relations: [rel("ghost", "c1", "incoming")] };
    expect(detailRelationGroups(card, [rt("ghost")], [], label)).toEqual([
      { key: "ghost|incoming", label: "ghost", relations: [rel("ghost", "c1", "incoming")] },
    ]);
  });

  it("has no groups when nothing on the card is shown in the panel", () => {
    expect(detailRelationGroups({ relations: [rel("owns", "c1")] }, [], [], label)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Visitor filters                                                    */
/* ------------------------------------------------------------------ */

const LISTS: PortalVisitorFilters = {
  shown: ["subtype", "field:single", "rel:r1"],
  allowed: ["subtype", "tags", "field:single", "field:code", "field:count", "rel:r1"],
  can_add: true,
};

/** A portal of every field kind, with the server's lists when given. */
function filterPortal(lists?: PortalVisitorFilters, over: Partial<PublicPortal> = {}): PublicPortal {
  const fs = [
    field("single", "single_select", OPTS),
    field("multi", "multiple_select", OPTS),
    field("code", "text"),
    field("count", "number"),
    field("flag", "boolean"),
  ];
  return {
    ...withFields(fs),
    ...(lists ? { visitor_filters: lists } : {}),
    ...over,
  };
}

const LABELS = {
  sectionLabel: (s: { section: string }) => `S:${s.section}`,
  descriptionLabel: "Description",
  resolveField: (f: FieldDef) => ({ ...f, label: `F:${f.label}` }),
};

describe("visitor filter lists", () => {
  it("are the server's lists when the payload carries them", () => {
    expect(visitorFilterLists(filterPortal(LISTS))).toBe(LISTS);
  });

  it("fall back to the old bar on a payload without them: shown selects, subtype, tags, relations, nothing to add", () => {
    const p = filterPortal(undefined, {
      type_info: {
        ...withFields([
          field("single", "single_select", OPTS),
          field("multi", "multiple_select", OPTS),
          field("bare", "single_select"),
          field("hidden", "single_select", OPTS),
          field("panel", "single_select", OPTS),
          field("flag", "boolean"),
          field("code", "text", OPTS),
        ]).type_info!,
        subtypes: [{ key: "saas", label: "SaaS" }],
      },
      card_config: {
        toggles: {
          "field:hidden": { card: false, detail: false },
          "field:panel": { card: false, detail: true },
          "rel:r1": { card: true, detail: false },
        },
      },
      relation_types: [rt("r1"), rt("r2")],
      tag_groups: [
        { id: "g0", name: "Empty", tags: [] },
        { id: "g1", name: "Domain", tags: [{ id: "t1", name: "Finance" }] },
      ],
    });
    const shown = ["subtype", "tags", "field:single", "field:multi", "field:panel", "rel:r1"];
    expect(visitorFilterLists(p)).toEqual({ shown, allowed: shown, can_add: false });
  });

  it("offer no tag filter for a payload without tag groups", () => {
    const p = filterPortal(undefined, { tag_groups: undefined as unknown as PublicPortal["tag_groups"] });
    expect(visitorFilterLists(p).shown).toEqual(["field:single", "field:multi"]);
  });

  it("fall back to nothing at all without a portal", () => {
    expect(visitorFilterLists(null)).toEqual({ shown: [], allowed: [], can_add: false });
  });

  it("leave out the subtype without subtypes, and the tags when no group has any", () => {
    const p = filterPortal(undefined, {
      tag_groups: [{ id: "g0", name: "Bare" } as unknown as PublicPortal["tag_groups"][number]],
    });
    expect(visitorFilterLists(p).shown).toEqual(["field:single", "field:multi"]);
  });

  it("names filters by toggle key", () => {
    expect(fieldFilterKey("code")).toBe("field:code");
    expect(relationFilterKey("r1")).toBe("rel:r1");
    expect(showsFilter(LISTS, "rel:r1")).toBe(true);
    expect(showsFilter(LISTS, "tags")).toBe(false);
  });

  it("lets a visitor filter on the allowed fields, or only the shown ones while adding is off", () => {
    expect(filterableFieldKeys(LISTS)).toEqual(["single", "code", "count"]);
    expect(filterableFieldKeys({ ...LISTS, can_add: false })).toEqual(["single"]);
    expect(filterableFieldKeys({ shown: [], allowed: ["tags", "rel:x", "subtype"], can_add: true })).toEqual([]);
  });
});

describe("portal filter catalog", () => {
  it("holds the allowed fields, each shown by default iff the server lists it", () => {
    const catalog = portalFilterCatalog(filterPortal(LISTS), LISTS, LABELS);
    expect(catalogFields(catalog).map((e) => [e.field.key, e.kind, e.shownByDefault])).toEqual([
      ["single", "facet", true],
      ["code", "text", false],
      ["count", "number", false],
    ]);
    // Labels as the caller resolves them.
    expect(catalog.map((s) => s.label)).toEqual(["S:One", "S:Two"]);
    expect(catalogFields(catalog)[0].field.label).toBe("F:single");
  });

  it("shows a listed text field by default, not only facets", () => {
    const lists = { ...LISTS, shown: ["field:code"] };
    const catalog = portalFilterCatalog(filterPortal(lists), lists, LABELS);
    expect(catalogFields(catalog).map((e) => [e.field.key, e.shownByDefault])).toEqual([
      ["single", false],
      ["code", true],
      ["count", false],
    ]);
  });

  it("holds only the shown fields when adding is off, so nothing is addable", () => {
    const lists = { ...LISTS, can_add: false };
    const catalog = portalFilterCatalog(filterPortal(lists), lists, LABELS);
    expect(catalogFields(catalog).map((e) => [e.field.key, e.shownByDefault])).toEqual([["single", true]]);
  });

  it("is empty without a type", () => {
    expect(portalFilterCatalog(null, LISTS, LABELS)).toEqual([]);
    expect(portalFilterCatalog(portal(), LISTS, LABELS)).toEqual([]);
  });

  it("drops a cost field even if a list named it", () => {
    const p = withFields([field("budget", "cost"), field("code", "text")]);
    const lists = { shown: ["field:budget"], allowed: ["field:budget", "field:code"], can_add: true };
    expect(catalogFields(portalFilterCatalog(p, lists, LABELS)).map((e) => e.field.key)).toEqual(["code"]);
  });
});

/* ------------------------------------------------------------------ */
/*  The card query                                                     */
/* ------------------------------------------------------------------ */

const NONE: CardQuery["filters"] = {
  subtypeFilters: [],
  attrFilters: {},
  attrConditions: {},
  relationFilters: {},
  tagFilterIds: [],
};

const BASE: CardQuery = {
  search: "",
  filters: NONE,
  page: 1,
  pageSize: 24,
  sortBy: "name",
  sortDir: "asc",
};

describe("card query", () => {
  it("sends only paging and sorting when no filter is set", () => {
    expect(cardQueryParams(BASE)).toBe("page=1&page_size=24&sort_by=name&sort_dir=asc");
  });

  it("sends every set filter as one canonical filters parameter", () => {
    const params = new URLSearchParams(
      cardQueryParams({
        ...BASE,
        search: "crm",
        filters: {
          subtypeFilters: ["saas", "__empty__"],
          attrFilters: { criticality: ["high"], status: [] },
          attrConditions: {
            code: { contains: " ORG " },
            count: { min: 2 },
            blank: { contains: "  " },
            since: { from: "2025-01-01", to: "nope" },
          },
          relationFilters: { owns: ["c1", "c2"], uses: [] },
          tagFilterIds: ["t1", "t2"],
        },
        page: 3,
        pageSize: 12,
        sortBy: "updated_at",
        sortDir: "desc",
      }),
    );
    expect([...params.keys()]).toEqual(["search", "filters", "page", "page_size", "sort_by", "sort_dir"]);
    expect(params.get("search")).toBe("crm");
    expect(JSON.parse(params.get("filters")!)).toEqual({
      subtypeFilters: ["saas", "__empty__"],
      attrFilters: { criticality: ["high"] },
      attrConditions: { code: { contains: "ORG" }, count: { min: 2 }, since: { from: "2025-01-01" } },
      relationFilters: { owns: ["c1", "c2"] },
      tagFilterIds: ["t1", "t2"],
    });
    expect(params.get("page")).toBe("3");
    expect(params.get("page_size")).toBe("12");
    expect(params.get("sort_by")).toBe("updated_at");
    expect(params.get("sort_dir")).toBe("desc");
  });

  it("leaves out the parameter when every pick was emptied", () => {
    const query = cardQueryParams({
      ...BASE,
      filters: {
        ...NONE,
        attrFilters: { criticality: [] },
        attrConditions: { code: { contains: "" } },
        relationFilters: { owns: [] },
      },
    });
    expect(query).toBe("page=1&page_size=24&sort_by=name&sort_dir=asc");
  });

  it("sends each kind on its own, with no other key", () => {
    const one = (f: Partial<CardQuery["filters"]>) => JSON.parse(visitorFiltersParam({ ...NONE, ...f })!);
    expect(one({ subtypeFilters: ["a"] })).toEqual({ subtypeFilters: ["a"] });
    expect(one({ attrFilters: { a: ["x"] } })).toEqual({ attrFilters: { a: ["x"] } });
    expect(one({ attrConditions: { a: { max: 1 } } })).toEqual({ attrConditions: { a: { max: 1 } } });
    expect(one({ relationFilters: { r: ["c"] } })).toEqual({ relationFilters: { r: ["c"] } });
    expect(one({ tagFilterIds: ["t"] })).toEqual({ tagFilterIds: ["t"] });
    expect(visitorFiltersParam(NONE)).toBeNull();
  });

  it("never sends the added fields", () => {
    const f: VisitorFilterState = { ...EMPTY_VISITOR_FILTERS, filterFields: ["code"] };
    expect(visitorFiltersParam(f)).toBeNull();
  });
});

describe("active filters and Clear", () => {
  it("counts a filter as active only once one narrows", () => {
    const none = EMPTY_VISITOR_FILTERS;
    expect(hasActiveFilters(none)).toBe(false);
    expect(hasActiveFilters({ ...none, filterFields: ["code"], attrFilters: { a: [] } })).toBe(false);
    expect(hasActiveFilters({ ...none, attrConditions: { code: { contains: " " } } })).toBe(false);
    expect(hasActiveFilters({ ...none, subtypeFilters: ["saas"] })).toBe(true);
    expect(hasActiveFilters({ ...none, attrFilters: { a: [], b: ["x"] } })).toBe(true);
    expect(hasActiveFilters({ ...none, attrConditions: { code: { contains: "x" } } })).toBe(true);
    expect(hasActiveFilters({ ...none, relationFilters: { r: [], s: ["c1"] } })).toBe(true);
    expect(hasActiveFilters({ ...none, tagFilterIds: ["t1"] })).toBe(true);
  });

  it("clears every value and keeps the added rows", () => {
    const f: VisitorFilterState = {
      subtypeFilters: ["saas"],
      attrFilters: { a: ["x"] },
      attrConditions: { code: { contains: "x" } },
      filterFields: ["code", "count"],
      relationFilters: { r: ["c1"] },
      tagFilterIds: ["t1"],
    };
    expect(clearVisitorFilters(f)).toEqual({ ...EMPTY_VISITOR_FILTERS, filterFields: ["code", "count"] });
  });

  it("starts empty", () => {
    expect(EMPTY_VISITOR_FILTERS).toEqual({
      subtypeFilters: [],
      attrFilters: {},
      attrConditions: {},
      filterFields: [],
      relationFilters: {},
      tagFilterIds: [],
    });
  });
});

/* ------------------------------------------------------------------ */
/*  What the visitor's browser remembers                               */
/* ------------------------------------------------------------------ */

describe("portal prefs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("are kept per portal", () => {
    expect(portalPrefsKey("acme")).toBe("turboea.portal.acme.prefs");
  });

  it("round-trip the added fields, and nothing else", () => {
    savePortalPrefs("acme", { filterFields: ["code", "code", "", "count"] });
    expect(JSON.parse(localStorage.getItem("turboea.portal.acme.prefs")!)).toEqual({
      filterFields: ["code", "count"],
    });
    expect(loadPortalPrefs("acme")).toEqual({ filterFields: ["code", "count"] });
    expect(loadPortalPrefs("other")).toEqual({ filterFields: [] });
  });

  it("remember no added field as nothing at all", () => {
    localStorage.setItem("turboea.portal.acme.prefs", JSON.stringify({ filterFields: ["code"] }));
    savePortalPrefs("acme", { filterFields: [] });
    expect(localStorage.getItem("turboea.portal.acme.prefs")).toBeNull();
  });

  it.each([
    ["garbage", "{not json"],
    ["a list", "[\"code\"]"],
    ["a string", "\"code\""],
    ["null", "null"],
    ["a number", "3"],
    ["no list", "{\"filterFields\": \"code\"}"],
  ])("read %s as nothing remembered", (_label, raw) => {
    localStorage.setItem("turboea.portal.acme.prefs", raw);
    expect(loadPortalPrefs("acme")).toEqual({ filterFields: [] });
  });

  it("keep only the strings of a mixed list", () => {
    localStorage.setItem(
      "turboea.portal.acme.prefs",
      JSON.stringify({ filterFields: ["code", 3, null, "count", "code"] }),
    );
    expect(loadPortalPrefs("acme")).toEqual({ filterFields: ["code", "count"] });
  });

  it("survive storage that throws (private mode, blocked site data)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadPortalPrefs("acme")).toEqual({ filterFields: [] });
    expect(() => savePortalPrefs("acme", { filterFields: ["code"] })).not.toThrow();
    expect(() => savePortalPrefs("acme", { filterFields: [] })).not.toThrow();
  });

  it("ignore remembered fields no longer in the catalog", () => {
    const catalog = portalFilterCatalog(filterPortal(LISTS), LISTS, LABELS);
    expect(knownFilterFields(["count", "gone", "code", "flag"], catalog)).toEqual(["count", "code"]);
    expect(knownFilterFields([], catalog)).toEqual([]);
  });
});
