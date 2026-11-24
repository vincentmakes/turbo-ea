import { describe, expect, it } from "vitest";
import {
  fieldGroups,
  groupCheckState,
  rowChecked,
  rowName,
  setSurfaceForRows,
  type DisplayRow,
} from "./portalDisplayGroups";

interface Field {
  key: string;
  label: string;
  filter?: boolean;
}

const field = (key: string, filter = true): Field => ({ key, label: key.toUpperCase(), filter });

const LABELS = {
  sectionLabel: (s: { section: string; translations?: Record<string, string> }) =>
    s.translations?.fr ?? `«${s.section}»`,
  descriptionLabel: "Description",
  fieldLabel: (f: Field) => f.label,
  canBeFilter: (f: Field) => f.filter === true,
};

describe("fieldGroups", () => {
  const schema = [
    { section: "__description", fields: [field("alias")] },
    { section: "Business", fields: [field("crit"), field("cost", false)] },
    { section: "Empty", fields: [] },
    { section: "Compliance", translations: { fr: "Conformité" }, fields: [field("risk"), field("class")] },
  ];

  it("makes one group per section with fields, in schema order, labelled by the caller", () => {
    const groups = fieldGroups(schema, LABELS);
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ["section:0", "Description"],
      ["section:1", "«Business»"],
      ["section:3", "Conformité"],
    ]);
    expect(groups[2].rows.map((r) => [r.key, r.label])).toEqual([
      ["field:risk", "RISK"],
      ["field:class", "CLASS"],
    ]);
  });

  it("puts the first three fields of the whole schema on the card, every field in the detail", () => {
    const rows = fieldGroups(schema, LABELS).flatMap((g) => g.rows);
    expect(rows.map((r) => [r.key, r.defaultCard, r.defaultDetail])).toEqual([
      ["field:alias", true, true],
      ["field:crit", true, true],
      ["field:cost", true, true],
      ["field:risk", false, true],
      ["field:class", false, true],
    ]);
  });

  it("gives a row a filter key only when its field can be a filter", () => {
    const rows = fieldGroups(schema, LABELS).flatMap((g) => g.rows);
    expect(rows.map((r) => r.filterKey)).toEqual([
      "field:alias",
      "field:crit",
      undefined,
      "field:risk",
      "field:class",
    ]);
  });

  it("makes no group for an empty schema", () => {
    expect(fieldGroups([], LABELS)).toEqual([]);
  });
});

describe("rowName", () => {
  it("adds the hint in brackets when there is one", () => {
    expect(rowName({ label: "IT Component", hint: "uses" })).toBe("IT Component (uses)");
    expect(rowName({ label: "Alias" })).toBe("Alias");
  });
});

const ROW: DisplayRow = { key: "field:a", label: "A", defaultCard: true, defaultDetail: false };

describe("rowChecked", () => {
  it("reads the toggle when the row has one, else its default", () => {
    expect(rowChecked({}, ROW, "card")).toBe(true);
    expect(rowChecked({}, ROW, "detail")).toBe(false);
    const toggles = { "field:a": { card: false, detail: true } };
    expect(rowChecked(toggles, ROW, "card")).toBe(false);
    expect(rowChecked(toggles, ROW, "detail")).toBe(true);
  });

  it("reads a missing side of a stored toggle as not shown", () => {
    expect(rowChecked({ "field:a": { detail: true } }, ROW, "card")).toBe(false);
  });
});

describe("groupCheckState", () => {
  it.each([
    [[true, true], { checked: true, indeterminate: false }],
    [[true, false], { checked: false, indeterminate: true }],
    [[false, false], { checked: false, indeterminate: false }],
    [[], { checked: false, indeterminate: false }],
  ])("%j → %j", (values, expected) => {
    expect(groupCheckState(values)).toEqual(expected);
  });
});

describe("setSurfaceForRows", () => {
  const rows: DisplayRow[] = [
    ROW,
    { key: "field:b", label: "B", defaultCard: false, defaultDetail: true },
  ];

  it("writes every row whole, keeping the other column at what it shows now", () => {
    const toggles = { "field:b": { card: false, detail: false }, tags: { card: true, detail: true } };
    expect(setSurfaceForRows(toggles, rows, "card", true)).toEqual({
      "field:a": { card: true, detail: false },
      "field:b": { card: true, detail: false },
      tags: { card: true, detail: true },
    });
    expect(setSurfaceForRows({}, rows, "detail", false)).toEqual({
      "field:a": { card: true, detail: false },
      "field:b": { card: false, detail: false },
    });
  });

  it("leaves the toggles it was given untouched", () => {
    const toggles = { "field:a": { card: false, detail: false } };
    setSurfaceForRows(toggles, rows, "card", true);
    expect(toggles).toEqual({ "field:a": { card: false, detail: false } });
  });
});
