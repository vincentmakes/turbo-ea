import { describe, expect, it } from "vitest";
import type { FieldDef, PortalCard, PortalRelationType, PublicPortal } from "@/types";
import {
  DEFAULT_CARD,
  DEFAULT_DETAIL,
  cardQueryParams,
  detailRelationGroups,
  fieldsWithValues,
  hasActiveFilters,
  hasAttributeValue,
  isVisible,
  portalFields,
  portalRelationTypes,
  portalSilentKey,
  portalToggles,
  relatedTypeKeys,
  relationFilterLabel,
  tileRelations,
  type CardQuery,
  type Toggles,
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
    expect(portalFields(null)).toEqual({ all: [], card: [], detail: [], filterable: [] });
    expect(portalFields(portal())).toEqual({ all: [], card: [], detail: [], filterable: [] });
    // A type payload without a schema (an older backend) has no fields either.
    const noSchema = { key: "Application", label: "Application", icon: "apps", color: "#000" };
    expect(
      portalFields(portal({ type_info: noSchema as PublicPortal["type_info"] })),
    ).toEqual({ all: [], card: [], detail: [], filterable: [] });
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

  it("offers a select field with options as a filter while it shows somewhere", () => {
    const fs = [
      field("single", "single_select", OPTS),
      field("multi", "multiple_select", OPTS),
      field("noOptions", "single_select"),
      field("emptyOptions", "single_select", []),
      field("text", "text", OPTS),
      field("hidden", "single_select", OPTS),
      field("panelOnly", "single_select", OPTS),
      field("tileOnly", "single_select", OPTS),
    ];
    const out = portalFields(
      withFields(fs, {
        "field:hidden": { card: false, detail: false },
        "field:panelOnly": { card: false, detail: true },
        "field:tileOnly": { card: true, detail: false },
      }),
    );
    expect(out.filterable.map((f) => f.key)).toEqual(["single", "multi", "panelOnly", "tileOnly"]);
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
/*  The card query                                                     */
/* ------------------------------------------------------------------ */

const BASE: CardQuery = {
  search: "",
  subtype: "",
  attrFilters: {},
  relationFilters: {},
  tagFilter: [],
  page: 1,
  pageSize: 24,
  sortBy: "name",
  sortDir: "asc",
};

describe("card query", () => {
  it("sends only paging and sorting when no filter is set", () => {
    expect(cardQueryParams(BASE)).toBe("page=1&page_size=24&sort_by=name&sort_dir=asc");
  });

  it("sends every set filter, leaving out emptied dropdowns", () => {
    const params = new URLSearchParams(
      cardQueryParams({
        ...BASE,
        search: "crm",
        subtype: "saas",
        attrFilters: { criticality: "high", status: "" },
        relationFilters: { owns: "c1", uses: "" },
        tagFilter: ["t1", "t2"],
        page: 3,
        pageSize: 12,
        sortBy: "updated_at",
        sortDir: "desc",
      }),
    );
    expect([...params.keys()]).toEqual([
      "search",
      "subtype",
      "attr_filters",
      "relation_filters",
      "tag_ids",
      "page",
      "page_size",
      "sort_by",
      "sort_dir",
    ]);
    expect(params.get("search")).toBe("crm");
    expect(params.get("subtype")).toBe("saas");
    expect(params.get("attr_filters")).toBe('{"criticality":"high"}');
    expect(params.get("relation_filters")).toBe('{"owns":"c1"}');
    expect(params.get("tag_ids")).toBe("t1,t2");
    expect(params.get("page")).toBe("3");
    expect(params.get("page_size")).toBe("12");
    expect(params.get("sort_by")).toBe("updated_at");
    expect(params.get("sort_dir")).toBe("desc");
  });

  it("leaves out a filter map whose every entry was emptied", () => {
    const query = cardQueryParams({
      ...BASE,
      attrFilters: { criticality: "" },
      relationFilters: { owns: "" },
    });
    expect(query).toBe("page=1&page_size=24&sort_by=name&sort_dir=asc");
  });

  it("counts a filter as active only once one is set", () => {
    const none = { subtype: "", attrFilters: { a: "" }, relationFilters: { r: "" }, tagFilter: [] };
    expect(hasActiveFilters(none)).toBe(false);
    expect(hasActiveFilters({ ...none, subtype: "saas" })).toBe(true);
    expect(hasActiveFilters({ ...none, attrFilters: { a: "", b: "x" } })).toBe(true);
    expect(hasActiveFilters({ ...none, relationFilters: { r: "", s: "c1" } })).toBe(true);
    expect(hasActiveFilters({ ...none, tagFilter: ["t1"] })).toBe(true);
  });
});
