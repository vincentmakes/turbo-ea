import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_SECTION,
  FILTER_KIND_ICONS,
  activeFieldKeys,
  addFilterField,
  addableFields,
  buildFilterCatalog,
  catalogFields,
  filterKindOf,
  removeFilterField,
  restoreFilterFields,
  rowsToRender,
  searchFilterCatalog,
  type FilterCatalog,
  type FilterSchemaSection,
} from "./fieldFilters";

interface Field {
  key: string;
  label: string;
  type: string;
  options?: { key: string; label: string; color?: string }[];
}

const opts = [{ key: "a", label: "A" }];
const select = (key: string, label = key): Field => ({ key, label, type: "single_select", options: opts });

const SCHEMA: FilterSchemaSection<Field>[] = [
  { section: DESCRIPTION_SECTION, fields: [{ key: "alias", label: "Alias", type: "text" }, select("tier", "Tier")] },
  {
    section: "Business",
    fields: [
      select("crit", "Criticality"),
      { key: "cloud", label: "Cloud", type: "boolean" },
      { key: "cost", label: "Cost", type: "cost" },
      { key: "empty", label: "Empty", type: "single_select", options: [] },
    ],
  },
  { section: "Compliance", hideInFilters: true, fields: [select("risk", "Risk Level"), select("aiAct", "AI Act Class")] },
  { section: "Notes", fields: [{ key: "note", label: "Note", type: "multiline_text" }] },
];

const build = (schema = SCHEMA) =>
  buildFilterCatalog<Field, Field>(schema, {
    sectionLabel: (s) => `S:${s.section}`,
    descriptionLabel: "Description",
    resolveField: (f) => ({ ...f, label: `F:${f.label}` }),
  });

describe("filterKindOf", () => {
  it("files selects with options and yes/no fields as facets, and nothing else", () => {
    expect(filterKindOf(select("x"))).toBe("facet");
    expect(filterKindOf({ key: "m", label: "M", type: "multiple_select", options: opts })).toBe("facet");
    expect(filterKindOf({ key: "b", label: "B", type: "boolean" })).toBe("facet");
    for (const type of ["text", "multiline_text", "number", "cost", "date", "url", "percentage", "ext.plus.rating"]) {
      expect(filterKindOf({ key: "x", label: "X", type })).toBeNull();
    }
    expect(filterKindOf({ key: "s", label: "S", type: "single_select", options: [] })).toBeNull();
    expect(FILTER_KIND_ICONS.facet).toBe("checklist");
  });
});

describe("buildFilterCatalog", () => {
  it("lists each section with its filterable fields, labels resolved by the caller", () => {
    const catalog = build();
    expect(catalog.map((s) => [s.key, s.label, s.hidden])).toEqual([
      [DESCRIPTION_SECTION, "Description", false],
      ["Business", "S:Business", false],
      ["Compliance", "S:Compliance", true],
    ]);
    expect(catalog.map((s) => s.fields.map((f) => f.field.key))).toEqual([["tier"], ["crit", "cloud"], ["risk", "aiAct"]]);
    expect(catalog[1].fields[0]).toEqual({
      field: { ...select("crit", "Criticality"), label: "F:Criticality" },
      kind: "facet",
      shownByDefault: true,
    });
  });

  it("shows a hidden section's fields only on request", () => {
    const catalog = build();
    expect(catalog[2].fields.map((f) => f.shownByDefault)).toEqual([false, false]);
    expect(catalog[0].fields[0].shownByDefault).toBe(true);
    // An explicit `false` is the default.
    const [shown] = build([{ section: "X", hideInFilters: false, fields: [select("x")] }]);
    expect(shown.hidden).toBe(false);
    expect(shown.fields[0].shownByDefault).toBe(true);
  });

  it("drops a section with no filterable field, and an empty schema", () => {
    expect(build().some((s) => s.key === "Notes")).toBe(false);
    expect(build([])).toEqual([]);
  });

  it("flattens to every field in schema order", () => {
    expect(catalogFields(build()).map((e) => e.field.key)).toEqual(["tier", "crit", "cloud", "risk", "aiAct"]);
  });
});

describe("rowsToRender", () => {
  const catalog = build();
  const keys = (rows: { field: { key: string } }[]) => rows.map((r) => r.field.key);

  it("renders the fields shown by default, none removable", () => {
    const rows = rowsToRender(catalog, [], new Set());
    expect(keys(rows)).toEqual(["tier", "crit", "cloud"]);
    expect(rows.every((r) => !r.removable)).toBe(true);
  });

  it("adds the user-added and the valued fields, in schema order, removable", () => {
    const rows = rowsToRender(catalog, ["aiAct"], new Set(["risk"]));
    expect(keys(rows)).toEqual(["tier", "crit", "cloud", "risk", "aiAct"]);
    expect(rows.filter((r) => r.removable).map((r) => r.field.key)).toEqual(["risk", "aiAct"]);
  });

  it("ignores keys the catalog does not know, and lists a default field once", () => {
    expect(keys(rowsToRender(catalog, ["gone", "crit", "crit"], new Set(["cost", "note"])))).toEqual([
      "tier",
      "crit",
      "cloud",
    ]);
  });
});

describe("addableFields", () => {
  const catalog = build();

  it("offers what is not rendered, grouped by section, empty sections dropped", () => {
    const addable = addableFields(catalog, rowsToRender(catalog, ["risk"], new Set()));
    expect(addable.map((s) => [s.key, s.fields.map((f) => f.field.key)])).toEqual([["Compliance", ["aiAct"]]]);
    expect(addable[0].label).toBe("S:Compliance");
  });

  it("offers nothing once everything is rendered", () => {
    expect(addableFields(catalog, catalogFields(catalog))).toEqual([]);
  });
});

describe("searchFilterCatalog", () => {
  const catalog: FilterCatalog<Field> = [
    {
      key: "Main",
      label: "Main",
      hidden: false,
      fields: [
        { field: select("rx", "Risk register"), kind: "facet", shownByDefault: false },
        { field: select("own", "Owner risk"), kind: "facet", shownByDefault: false },
        { field: select("r", "Risk"), kind: "facet", shownByDefault: false },
        { field: select("pr", "Prisk"), kind: "facet", shownByDefault: false },
        { field: select("tier", "Tier"), kind: "facet", shownByDefault: false },
      ],
    },
    {
      key: "Compliance",
      label: "Compliance",
      hidden: true,
      fields: [{ field: select("ai", "AI Act Class"), kind: "facet", shownByDefault: false }],
    },
  ];
  const keysOf = (c: FilterCatalog<Field>) => c.map((s) => [s.key, s.fields.map((f) => f.field.key)]);

  it("lists everything, as it is, for an empty or blank query", () => {
    expect(searchFilterCatalog(catalog, "")).toBe(catalog);
    expect(searchFilterCatalog(catalog, "   ")).toBe(catalog);
  });

  it("ranks exact, then starts-with, then starts-a-word, then contains", () => {
    expect(keysOf(searchFilterCatalog(catalog, "risk"))).toEqual([["Main", ["r", "rx", "own", "pr"]]]);
  });

  it("matches a field by its section's label too, on the raw input", () => {
    expect(keysOf(searchFilterCatalog(catalog, "compl"))).toEqual([["Compliance", ["ai"]]]);
    expect(keysOf(searchFilterCatalog(catalog, "TIER"))).toEqual([["Main", ["tier"]]]);
  });

  it("orders the sections by their best match", () => {
    // "ai" starts "AI Act Class"; in Main it only sits inside the section label.
    const out = keysOf(searchFilterCatalog(catalog, "ai"));
    expect(out[0]).toEqual(["Compliance", ["ai"]]);
    expect(out[1][0]).toBe("Main");
    expect(out[1][1]).toContain("own");
  });

  it("keeps schema order between sections that match equally well", () => {
    const twin: FilterCatalog<Field> = [
      { ...catalog[1], key: "B", label: "B" },
      { ...catalog[1], key: "A", label: "A" },
    ];
    expect(searchFilterCatalog(twin, "ai act").map((s) => s.key)).toEqual(["B", "A"]);
  });

  it("returns no section when nothing matches", () => {
    expect(searchFilterCatalog(catalog, "zzz")).toEqual([]);
  });
});

describe("added fields", () => {
  it("adds a key once, at the end, without touching the input", () => {
    const before = ["a"];
    expect(addFilterField(before, "b")).toEqual(["a", "b"]);
    expect(addFilterField(before, "a")).toEqual(["a"]);
    expect(addFilterField(before, "a")).not.toBe(before);
    expect(before).toEqual(["a"]);
  });

  it("removes a row and clears its value, leaving the others", () => {
    const state = { attrFilters: { risk: ["high"], crit: ["a"] }, filterFields: ["risk", "tier"] };
    expect(removeFilterField(state, "risk")).toEqual({ attrFilters: { crit: ["a"] }, filterFields: ["tier"] });
    expect(state.attrFilters).toEqual({ risk: ["high"], crit: ["a"] });
  });

  it("reads the fields holding a value", () => {
    expect(activeFieldKeys({ attrFilters: { a: ["x"], b: [], c: ["__empty__"] } })).toEqual(new Set(["a", "c"]));
  });

  it("restores strings only, each once, from whatever was stored", () => {
    expect(restoreFilterFields(["risk", "risk", 3, null, "", { k: 1 }, "tier"])).toEqual(["risk", "tier"]);
    for (const raw of [undefined, null, "risk", 7, { risk: true }]) expect(restoreFilterFields(raw)).toEqual([]);
  });
});
