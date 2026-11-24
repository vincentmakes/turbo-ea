import { describe, expect, it } from "vitest";
import {
  CONTAINS_MAX,
  DESCRIPTION_SECTION,
  FILTER_KIND_ICONS,
  activeFieldKeys,
  addFilterField,
  addableFields,
  appliedConditions,
  buildFilterCatalog,
  catalogFields,
  catalogKinds,
  countActiveConditions,
  describeCondition,
  filterKindOf,
  matchesCondition,
  matchesConditions,
  normaliseCondition,
  numericValueOf,
  removeFilterField,
  restoreAttrConditions,
  restoreFilterFields,
  rowsToRender,
  schemaWithFields,
  searchFilterCatalog,
  setCondition,
  shapeOfCondition,
  withActiveFilterFields,
  type FilterCatalog,
  type FilterKind,
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

const build = (schema = SCHEMA, canViewCosts = false) =>
  buildFilterCatalog<Field, Field>(schema, {
    canViewCosts,
    sectionLabel: (s) => `S:${s.section}`,
    descriptionLabel: "Description",
    resolveField: (f) => ({ ...f, label: `F:${f.label}` }),
  });

describe("filterKindOf", () => {
  it("files selects with options and yes/no fields as facets", () => {
    expect(filterKindOf(select("x"))).toBe("facet");
    expect(filterKindOf({ key: "m", label: "M", type: "multiple_select", options: opts })).toBe("facet");
    expect(filterKindOf({ key: "b", label: "B", type: "boolean" })).toBe("facet");
    expect(filterKindOf({ key: "s", label: "S", type: "single_select", options: [] })).toBeNull();
  });

  it.each([
    ["text", "text"],
    ["multiline_text", "text"],
    ["url", "text"],
    ["number", "number"],
    ["percentage", "number"],
    ["cost", "number"],
    ["date", "date"],
    ["ext.plus.rating", null],
    ["ext.text", null],
    ["logo", null],
    ["", null],
  ])("files a %s field as %s", (type, kind) => {
    expect(filterKindOf({ key: "x", label: "X", type })).toBe(kind);
  });

  it("gives every kind its own glyph", () => {
    expect(FILTER_KIND_ICONS).toEqual({
      facet: "checklist",
      text: "text_fields",
      number: "123",
      date: "calendar_month",
    });
  });
});

describe("buildFilterCatalog", () => {
  it("lists each section with its filterable fields, labels resolved by the caller", () => {
    const catalog = build();
    expect(catalog.map((s) => [s.key, s.label, s.hidden])).toEqual([
      [DESCRIPTION_SECTION, "Description", false],
      ["Business", "S:Business", false],
      ["Compliance", "S:Compliance", true],
      ["Notes", "S:Notes", false],
    ]);
    expect(catalog.map((s) => s.fields.map((f) => f.field.key))).toEqual([
      ["alias", "tier"],
      ["crit", "cloud"],
      ["risk", "aiAct"],
      ["note"],
    ]);
    expect(catalog[1].fields[0]).toEqual({
      field: { ...select("crit", "Criticality"), label: "F:Criticality" },
      kind: "facet",
      shownByDefault: true,
    });
  });

  it("shows a hidden section's fields only on request", () => {
    const catalog = build();
    expect(catalog[2].fields.map((f) => f.shownByDefault)).toEqual([false, false]);
    expect(catalog[0].fields[1].shownByDefault).toBe(true);
    // An explicit `false` is the default.
    const [shown] = build([{ section: "X", hideInFilters: false, fields: [select("x")] }]);
    expect(shown.hidden).toBe(false);
    expect(shown.fields[0].shownByDefault).toBe(true);
  });

  it("lets the caller decide what is shown by default, with the raw field, its kind and section", () => {
    const seen: [string, FilterKind, string][] = [];
    const catalog = buildFilterCatalog<Field, Field>(SCHEMA, {
      canViewCosts: false,
      sectionLabel: (s) => s.section,
      descriptionLabel: "Description",
      resolveField: (f) => ({ ...f, label: `F:${f.label}` }),
      shownByDefault: (field, kind, section) => {
        seen.push([field.label, kind, section.section]);
        return field.key === "alias" || field.key === "risk";
      },
    });
    expect(catalogFields(catalog).filter((e) => e.shownByDefault).map((e) => e.field.key)).toEqual([
      "alias",
      "risk",
    ]);
    // The raw field (its label unresolved), never a cost field the reader cannot see.
    expect(seen).toEqual([
      ["Alias", "text", DESCRIPTION_SECTION],
      ["Tier", "facet", DESCRIPTION_SECTION],
      ["Criticality", "facet", "Business"],
      ["Cloud", "facet", "Business"],
      ["Risk Level", "facet", "Compliance"],
      ["AI Act Class", "facet", "Compliance"],
      ["Note", "text", "Notes"],
    ]);
  });

  it("drops a section with no filterable field, and an empty schema", () => {
    const schema = [
      { section: "Ext", fields: [{ key: "r", label: "R", type: "ext.plus.rating" }] },
      { section: "Money", fields: [{ key: "c", label: "C", type: "cost" }] },
    ];
    expect(build(schema)).toEqual([]);
    expect(build([])).toEqual([]);
  });

  it("flattens to every field in schema order", () => {
    expect(catalogFields(build()).map((e) => e.field.key)).toEqual([
      "alias",
      "tier",
      "crit",
      "cloud",
      "risk",
      "aiAct",
      "note",
    ]);
  });

  it("never shows a text, number or date field by default, in any section", () => {
    const catalog = build([
      {
        section: "Main",
        fields: [
          { key: "code", label: "Code", type: "text" },
          { key: "n", label: "N", type: "number" },
          { key: "d", label: "D", type: "date" },
          select("s"),
        ],
      },
    ]);
    expect(catalog[0].fields.map((f) => [f.field.key, f.kind, f.shownByDefault])).toEqual([
      ["code", "text", false],
      ["n", "number", false],
      ["d", "date", false],
      ["s", "facet", true],
    ]);
  });

  it("offers a cost field only to a reader who may see costs", () => {
    expect(catalogFields(build()).some((e) => e.field.key === "cost")).toBe(false);
    const withCosts = catalogFields(build(SCHEMA, true));
    expect(withCosts.find((e) => e.field.key === "cost")).toMatchObject({ kind: "number", shownByDefault: false });
    // A percentage or plain number is no cost.
    const pct = build([{ section: "M", fields: [{ key: "p", label: "P", type: "percentage" }] }]);
    expect(catalogFields(pct).map((e) => e.field.key)).toEqual(["p"]);
  });

  it("maps each field to its kind", () => {
    expect([...catalogKinds(build())]).toEqual([
      ["alias", "text"],
      ["tier", "facet"],
      ["crit", "facet"],
      ["cloud", "facet"],
      ["risk", "facet"],
      ["aiAct", "facet"],
      ["note", "text"],
    ]);
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
    expect(keys(rowsToRender(catalog, ["gone", "crit", "crit"], new Set(["cost", "ghost"])))).toEqual([
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
    expect(addable.map((s) => [s.key, s.fields.map((f) => f.field.key)])).toEqual([
      [DESCRIPTION_SECTION, ["alias"]],
      ["Compliance", ["aiAct"]],
      ["Notes", ["note"]],
    ]);
    expect(addable[1].label).toBe("S:Compliance");
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
    const state = {
      attrFilters: { risk: ["high"], crit: ["a"] },
      attrConditions: { code: { contains: "x" }, n: { min: 1 } },
      filterFields: ["risk", "tier", "code"],
    };
    expect(removeFilterField(state, "risk")).toEqual({
      attrFilters: { crit: ["a"] },
      attrConditions: { code: { contains: "x" }, n: { min: 1 } },
      filterFields: ["tier", "code"],
    });
    expect(removeFilterField(state, "code")).toEqual({
      attrFilters: { risk: ["high"], crit: ["a"] },
      attrConditions: { n: { min: 1 } },
      filterFields: ["risk", "tier"],
    });
    expect(state.attrFilters).toEqual({ risk: ["high"], crit: ["a"] });
    expect(state.attrConditions).toEqual({ code: { contains: "x" }, n: { min: 1 } });
  });

  it("reads the fields holding a value", () => {
    expect(activeFieldKeys({ attrFilters: { a: ["x"], b: [], c: ["__empty__"] } })).toEqual(new Set(["a", "c"]));
    expect(
      activeFieldKeys({
        attrFilters: {},
        attrConditions: {
          t: { contains: "x" },
          blank: { contains: "  " },
          n: { min: 0 },
          none: {},
          d: { to: "2026-01-01" },
          bad: { from: "2026" },
        },
      }),
    ).toEqual(new Set(["t", "n", "d"]));
  });

  it("restores strings only, each once, from whatever was stored", () => {
    expect(restoreFilterFields(["risk", "risk", 3, null, "", { k: 1 }, "tier"])).toEqual(["risk", "tier"]);
    for (const raw of [undefined, null, "risk", 7, { risk: true }]) expect(restoreFilterFields(raw)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Conditions — the same edge cases as backend                        */
/*  tests/services/test_portal_card_filters.py                         */
/* ------------------------------------------------------------------ */

describe("withActiveFilterFields", () => {
  it("adds every field holding a value after the stored rows: picks, then conditions", () => {
    const state = {
      attrFilters: { fit: ["good"], none: [] },
      attrConditions: { n: { min: 1 }, code: { contains: "x" }, blank: { contains: " " } },
      filterFields: ["code", "risk"],
    };
    expect(withActiveFilterFields(state).filterFields).toEqual(["code", "risk", "fit", "n"]);
  });

  it("keeps the other keys and the stored order, and returns the state itself when nothing is missing", () => {
    const state = { attrFilters: {}, attrConditions: { code: { contains: "x" } }, filterFields: [], extra: 1 };
    expect(withActiveFilterFields(state)).toEqual({ ...state, filterFields: ["code"] });
    const complete = { attrFilters: { fit: ["a"] }, attrConditions: {}, filterFields: ["fit"] };
    expect(withActiveFilterFields(complete)).toBe(complete);
    const empty = { attrFilters: {}, attrConditions: {}, filterFields: ["z"] };
    expect(withActiveFilterFields(empty)).toBe(empty);
  });
});

describe("shapeOfCondition", () => {
  it("names the kind a condition's keys belong to", () => {
    expect(shapeOfCondition({ contains: "" })).toBe("text");
    expect(shapeOfCondition({ max: null })).toBe("number");
    expect(shapeOfCondition({ min: 1 })).toBe("number");
    expect(shapeOfCondition({ to: null })).toBe("date");
    expect(shapeOfCondition({ from: "x" })).toBe("date");
  });

  it("is null for two kinds at once, no known key, or no object", () => {
    expect(shapeOfCondition({ from: 1, min: 1 })).toBeNull();
    expect(shapeOfCondition({ contains: "x", max: 1 })).toBeNull();
    expect(shapeOfCondition({ other: 1 })).toBeNull();
    expect(shapeOfCondition({})).toBeNull();
    for (const raw of [null, undefined, "contains", 3, ["contains"]]) expect(shapeOfCondition(raw)).toBeNull();
  });

  it("reads own keys only", () => {
    expect(shapeOfCondition(Object.create({ contains: "x" }))).toBeNull();
  });
});

describe("normaliseCondition", () => {
  it("trims a needle and drops a blank or non-text one", () => {
    expect(normaliseCondition("text", { contains: "  ORG-12 " })).toEqual({ contains: "ORG-12" });
    expect(normaliseCondition("text", { contains: "   " })).toBeNull();
    expect(normaliseCondition("text", { contains: "" })).toBeNull();
    expect(normaliseCondition("text", { contains: 3 })).toBeNull();
  });

  it("caps a needle at 200 characters, after trimming", () => {
    const exact = "y".repeat(CONTAINS_MAX);
    expect(CONTAINS_MAX).toBe(200);
    expect(normaliseCondition("text", { contains: exact })).toEqual({ contains: exact });
    expect(normaliseCondition("text", { contains: ` ${exact}z ` })).toEqual({ contains: exact });
  });

  it("keeps finite number bounds only, zero included", () => {
    expect(normaliseCondition("number", { min: 0, max: 2.5 })).toEqual({ min: 0, max: 2.5 });
    expect(normaliseCondition("number", { max: 0 })).toEqual({ max: 0 });
    expect(normaliseCondition("number", { min: true, max: 3 })).toEqual({ max: 3 });
    expect(normaliseCondition("number", { min: "2" })).toBeNull();
    expect(normaliseCondition("number", { min: Infinity })).toBeNull();
    expect(normaliseCondition("number", { max: -Infinity })).toBeNull();
    expect(normaliseCondition("number", { min: NaN })).toBeNull();
    expect(normaliseCondition("number", { min: null, max: undefined })).toBeNull();
  });

  it("keeps YYYY-MM-DD date bounds only", () => {
    expect(normaliseCondition("date", { from: "2026-01-01", to: "2026-12-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(normaliseCondition("date", { from: "x", to: "2026-02-03" })).toEqual({ to: "2026-02-03" });
    expect(normaliseCondition("date", { from: "2026-1-1" })).toBeNull();
    expect(normaliseCondition("date", { to: "2026-01-01T00:00" })).toBeNull();
    expect(normaliseCondition("date", { from: 20260101 })).toBeNull();
    expect(normaliseCondition("date", { from: " 2026-01-01" })).toBeNull();
  });

  it("is null for a facet or a non-object", () => {
    expect(normaliseCondition("facet", { contains: "x" })).toBeNull();
    expect(normaliseCondition("text", "x")).toBeNull();
    expect(normaliseCondition("number", [1])).toBeNull();
    expect(normaliseCondition("date", null)).toBeNull();
  });
});

describe("restoreAttrConditions", () => {
  it("keeps every usable condition in canonical shape", () => {
    expect(
      restoreAttrConditions({
        code: { contains: "  ORG-12 " },
        n: { min: 0, max: 2.5 },
        due: { from: "2026-01-01", to: "2026-12-31" },
      }),
    ).toEqual({
      code: { contains: "ORG-12" },
      n: { min: 0, max: 2.5 },
      due: { from: "2026-01-01", to: "2026-12-31" },
    });
  });

  it("drops whatever is unusable (the backend's garbage list)", () => {
    expect(
      restoreAttrConditions({
        "": { contains: "x" },
        blank: { contains: "   " },
        notText: { contains: 3 },
        mixed: { contains: "x", min: 1 },
        empty: {},
        list: ["x"],
        str: "x",
        bool: { min: true },
        textNumber: { min: "2" },
        noBound: { min: null, max: null },
        shortDate: { from: "2026-1-1" },
        timeDate: { to: "2026-01-01T00:00" },
        dateNumber: { from: 20260101 },
        half: { min: true, max: 3 },
        halfDate: { from: "x", to: "2026-02-03" },
      }),
    ).toEqual({ half: { max: 3 }, halfDate: { to: "2026-02-03" } });
  });

  it.each([undefined, null, "x", 3, [{ contains: "x" }]])("is empty for %j", (raw) => {
    expect(restoreAttrConditions(raw)).toEqual({});
  });
});

describe("numericValueOf", () => {
  it.each<[unknown, number | null]>([
    [12.5, 12.5],
    [0, 0],
    ["12.5", 12.5],
    ["+12", 12],
    ["12.", 12],
    ["-.5", -0.5],
    ["1e2", 100],
    ["9e99", 9e99],
    ["1E-2", 0.01],
    ["1".repeat(40), Number("1".repeat(40))],
    ["1".repeat(41), null],
    ["1".repeat(500), null],
    ["9e100", null],
    ["1e999999", null],
    ["abc", null],
    ["", null],
    [" 12", null],
    ["12 ", null],
    ["1,5", null],
    ["١٢", null],
    [".", null],
    ["-", null],
    [true, null],
    [false, null],
    [[12], null],
    [{ n: 1 }, null],
    [null, null],
    [undefined, null],
    [Infinity, null],
    [NaN, null],
  ])("reads %j as %j", (raw, expected) => {
    expect(numericValueOf(raw)).toBe(expected);
  });
});

describe("matchesCondition", () => {
  describe("text", () => {
    const has = (needle: string, v: unknown) => matchesCondition("text", { contains: needle }, v);

    it("is a case-insensitive contains on a string", () => {
      expect(has("org-12", "ORG-12")).toBe(true);
      expect(has("org-12", "org-120")).toBe(true);
      expect(has("ORG-13", "ORG-12")).toBe(false);
    });

    it("trims the needle", () => {
      expect(has("  ORG-120 ", "org-120")).toBe(true);
      expect(has("  ORG-120 ", "ORG-12")).toBe(false);
    });

    it("reads a stored number as its text", () => {
      expect(has("234", 12345)).toBe(true);
      expect(has("6", 12345)).toBe(false);
    });

    it("never matches a list, a boolean, an object or no value", () => {
      expect(has("org", ["ORG-12"])).toBe(false);
      expect(has("tru", true)).toBe(false);
      expect(has("o", { o: "o" })).toBe(false);
      expect(has("x", null)).toBe(false);
      expect(has("x", undefined)).toBe(false);
    });

    it("takes wildcards literally", () => {
      expect(has("%", "100%")).toBe(true);
      expect(has("%", "abc")).toBe(false);
      expect(has("a_b", "a_b")).toBe(true);
      expect(has("a_b", "axb")).toBe(false);
      expect(has("\\", "a\\b")).toBe(true);
    });
  });

  describe("number", () => {
    const within = (c: object, v: unknown) => matchesCondition("number", c, v);

    it("reads a JSON number and numeric text alike", () => {
      expect(within({ min: 12.5, max: 12.5 }, 12.5)).toBe(true);
      expect(within({ min: 12.5, max: 12.5 }, "12.5")).toBe(true);
      expect(within({ min: 12.5 }, "1e2")).toBe(true);
    });

    it("includes both bounds", () => {
      expect(within({ min: 10, max: 20 }, 10)).toBe(true);
      expect(within({ min: 10, max: 20 }, 20)).toBe(true);
      expect(within({ min: 10, max: 20 }, 9.99)).toBe(false);
      expect(within({ min: 10, max: 20 }, 20.01)).toBe(false);
    });

    it("applies only the bound that is set", () => {
      expect(within({ min: 12.6 }, 12.5)).toBe(false);
      expect(within({ min: 12.6 }, 1e30)).toBe(true);
      expect(within({ max: -0.5 }, "-.5")).toBe(true);
      expect(within({ max: -0.6 }, "-.5")).toBe(false);
      expect(within({ max: 12.4 }, -1e30)).toBe(true);
    });

    it("fails a value that is not a number", () => {
      for (const v of ["abc", true, [12], null, undefined, "", "1".repeat(41), "9e100"]) {
        expect(within({ min: -1e99 }, v)).toBe(false);
      }
    });
  });

  describe("date", () => {
    const between = (c: object, v: unknown) => matchesCondition("date", c, v);

    it("includes both bounds, reading a time suffix by its day", () => {
      expect(between({ from: "2026-01-01" }, "2026-01-01")).toBe(true);
      expect(between({ from: "2026-01-02" }, "2026-01-01")).toBe(false);
      expect(between({ to: "2026-12-31" }, "2026-12-31T10:00:00Z")).toBe(true);
      expect(between({ to: "2026-12-30" }, "2026-12-31T10:00:00Z")).toBe(false);
      expect(between({ from: "2026-01-02", to: "2026-12-31" }, "2026-06-01")).toBe(true);
    });

    it("compares an impossible date as its text, as the server does", () => {
      expect(between({ from: "2026-01-01" }, "2026-13-45")).toBe(true);
      expect(between({ to: "2026-12-31" }, "2026-13-45")).toBe(false);
    });

    it("fails a malformed date, a list, junk after the day or no value", () => {
      for (const v of ["01/02/2026", "2026-06-01 noon", "2026-1-5", ["2026-06-01"], 20260601, null, undefined]) {
        expect(between({ to: "2026-12-31" }, v)).toBe(false);
      }
    });
  });

  it("passes a condition that narrows nothing, and a facet", () => {
    expect(matchesCondition("text", { contains: "  " }, undefined)).toBe(true);
    expect(matchesCondition("number", {}, "abc")).toBe(true);
    expect(matchesCondition("facet", { contains: "x" }, undefined)).toBe(true);
  });
});

describe("conditions against the reader's catalog", () => {
  const kinds = new Map<string, FilterKind>([
    ["code", "text"],
    ["n", "number"],
    ["due", "date"],
    ["crit", "facet"],
  ]);
  const card = { code: "ORG-12", n: 15, due: "2026-03-01", crit: "high", price: 5000 };

  it("applies each condition whose field is in the catalog with its shape's kind", () => {
    expect(matchesConditions(card, { code: { contains: "org" } }, kinds)).toBe(true);
    expect(matchesConditions(card, { code: { contains: "xyz" } }, kinds)).toBe(false);
    expect(matchesConditions(card, { code: { contains: "org" }, n: { max: 10 } }, kinds)).toBe(false);
    expect(matchesConditions(card, { due: { from: "2026-01-01", to: "2026-12-31" } }, kinds)).toBe(true);
  });

  it("ignores a condition on a field the catalog lacks — a cost field without cost access", () => {
    expect(matchesConditions(card, { price: { min: 1e6 } }, kinds)).toBe(true);
    expect(countActiveConditions({ price: { min: 1e6 } }, kinds)).toBe(0);
    expect(matchesConditions(card, { code: { contains: "xyz" } }, undefined)).toBe(true);
    expect(countActiveConditions({ code: { contains: "xyz" } }, undefined)).toBe(0);
  });

  it("ignores a condition whose shape does not fit the field's kind", () => {
    expect(matchesConditions(card, { code: { min: 100 } }, kinds)).toBe(true);
    expect(matchesConditions(card, { n: { contains: "9" } }, kinds)).toBe(true);
    expect(matchesConditions(card, { crit: { contains: "zzz" } }, kinds)).toBe(true);
    expect(countActiveConditions({ code: { min: 100 }, crit: { contains: "z" } }, kinds)).toBe(0);
  });

  it("fails a card with no value on an active condition", () => {
    expect(matchesConditions({}, { n: { min: 0 } }, kinds)).toBe(false);
    expect(matchesConditions(undefined, { n: { min: 0 } }, kinds)).toBe(false);
  });

  it("counts and lists the applied conditions, normalised", () => {
    const conditions = { code: { contains: " org " }, n: { min: 1 }, price: { min: 1 }, blank: { contains: "" } };
    expect(countActiveConditions(conditions, kinds)).toBe(2);
    expect(appliedConditions(conditions, kinds)).toEqual([
      { key: "code", kind: "text", condition: { contains: "org" } },
      { key: "n", kind: "number", condition: { min: 1 } },
    ]);
    expect(appliedConditions(undefined, kinds)).toEqual([]);
  });
});

describe("describeCondition", () => {
  it("words each shape as parts", () => {
    expect(describeCondition({ contains: "ORG" })).toEqual({ op: "contains", value: "ORG" });
    expect(describeCondition({ min: 10, max: 20 })).toEqual({ op: "between", from: "10", to: "20" });
    expect(describeCondition({ min: 0 })).toEqual({ op: "atLeast", value: "0" });
    expect(describeCondition({ max: 0 })).toEqual({ op: "atMost", value: "0" });
    expect(describeCondition({ from: "2026-01-01" })).toEqual({ op: "atLeast", value: "2026-01-01" });
    expect(describeCondition({ to: "2026-12-31" })).toEqual({ op: "atMost", value: "2026-12-31" });
    expect(describeCondition({ from: "2026-01-01", to: "2026-12-31" })).toEqual({
      op: "between",
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("formats numbers with the caller's formatter, never dates", () => {
    const fmt = (n: number) => `#${n}`;
    expect(describeCondition({ min: 1000, max: 2000 }, fmt)).toEqual({ op: "between", from: "#1000", to: "#2000" });
    expect(describeCondition({ from: "2026-01-01" }, fmt)).toEqual({ op: "atLeast", value: "2026-01-01" });
  });
});

describe("setCondition", () => {
  it("sets a condition that narrows, and drops one that does not", () => {
    const before = { n: { min: 1 } };
    expect(setCondition(before, "code", "text", { contains: "x" })).toEqual({ n: { min: 1 }, code: { contains: "x" } });
    expect(setCondition(before, "n", "number", { min: undefined, max: undefined })).toEqual({});
    expect(setCondition(before, "n", "number", { max: 3 })).toEqual({ n: { max: 3 } });
    expect(before).toEqual({ n: { min: 1 } });
  });
});

describe("schemaWithFields", () => {
  it("keeps only the allowed fields, sections and their flags intact", () => {
    const out = schemaWithFields(SCHEMA, ["tier", "risk", "gone"]);
    expect(out.map((s) => [s.section, s.hideInFilters, s.fields.map((f) => f.key)])).toEqual([
      [DESCRIPTION_SECTION, undefined, ["tier"]],
      ["Business", undefined, []],
      ["Compliance", true, ["risk"]],
      ["Notes", undefined, []],
    ]);
    expect(catalogFields(build(out)).map((e) => e.field.key)).toEqual(["tier", "risk"]);
    expect(SCHEMA[0].fields).toHaveLength(2);
  });
});
