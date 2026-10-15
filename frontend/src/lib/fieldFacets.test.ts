import { describe, expect, it } from "vitest";

import {
  BOOL_FALSE,
  BOOL_TRUE,
  MULTIPLE_COLOR,
  MULTIPLE_KEY,
  UNSET_KEY,
  defaultColorField,
  facetBucket,
  facetLegend,
  facetOptions,
  facetValues,
  isFacetField,
  isGroupableField,
  matchesFacet,
  pickFacetFields,
  pickGroupableFields,
  rawValues,
  resolveFacetField,
  type FacetFieldLike,
} from "./fieldFacets";
import {
  BOOLEAN_COLORS,
  CATEGORICAL_COLORS,
  MULTIPLE_VALUE_COLOR,
  STATUS_COLORS,
} from "@/theme/tokens";

const LABELS = { yes: "Yes", no: "No", notSet: "Not set", multiple: "Multiple" };

const bool: FacetFieldLike = { key: "isCloud", label: "Cloud", type: "boolean" };
const single: FacetFieldLike = {
  key: "criticality",
  label: "Criticality",
  type: "single_select",
  options: [
    { key: "high", label: "High", color: "#ff0000" },
    { key: "low", label: "Low" },
    { key: "mid", label: "Mid", color: "" },
  ],
};
const multi: FacetFieldLike = {
  key: "regions",
  label: "Regions",
  type: "multiple_select",
  options: [
    { key: "eu", label: "EU" },
    { key: "us", label: "US", color: "#00ff00" },
  ],
};
const text: FacetFieldLike = { key: "notes", label: "Notes", type: "text" };

describe("constants", () => {
  it("names the synthetic keys and the Multiple colour", () => {
    expect(BOOL_TRUE).toBe("true");
    expect(BOOL_FALSE).toBe("false");
    expect(MULTIPLE_KEY).toBe("__multiple__");
    expect(UNSET_KEY).toBe("__unset__");
    expect(MULTIPLE_COLOR).toBe(MULTIPLE_VALUE_COLOR);
    expect(MULTIPLE_COLOR).toBe("#607d8b");
    expect(BOOLEAN_COLORS).toEqual({ true: "#4caf50", false: "#2196f3" });
  });

  it("never paints No in a grey, so it cannot read as Not set or Multiple", () => {
    const channels = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r, g, b] = channels(BOOLEAN_COLORS.false);
    // A grey has (near-)equal channels; demand a clearly saturated hue.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(100);
    expect(BOOLEAN_COLORS.false).not.toBe(MULTIPLE_VALUE_COLOR);
    expect(BOOLEAN_COLORS.false).not.toBe(STATUS_COLORS.neutral);
    expect(BOOLEAN_COLORS.false).not.toBe(BOOLEAN_COLORS.true);
  });
});

describe("isFacetField / isGroupableField", () => {
  it("accepts a boolean without options", () => {
    expect(isFacetField(bool)).toBe(true);
    expect(isGroupableField(bool)).toBe(true);
  });

  it("accepts selects only when they carry options", () => {
    expect(isFacetField(single)).toBe(true);
    expect(isFacetField(multi)).toBe(true);
    expect(isFacetField({ ...single, options: [] })).toBe(false);
    expect(isFacetField({ ...single, options: undefined })).toBe(false);
    expect(isFacetField({ ...multi, options: [] })).toBe(false);
  });

  it("rejects other field types, even with options", () => {
    expect(isFacetField(text)).toBe(false);
    expect(isFacetField({ ...text, options: single.options })).toBe(false);
    expect(isFacetField({ key: "n", label: "N", type: "number" })).toBe(false);
  });

  it("does not group by a multiple_select", () => {
    expect(isGroupableField(single)).toBe(true);
    expect(isGroupableField(multi)).toBe(false);
    expect(isGroupableField(text)).toBe(false);
    expect(isGroupableField({ ...single, options: [] })).toBe(false);
  });
});

describe("pickFacetFields / pickGroupableFields", () => {
  const schema = [
    { fields: [text, bool] },
    { fields: [multi, single, { ...single, key: "empty", options: [] }] },
  ];

  it("keeps facet fields in schema order", () => {
    expect(pickFacetFields(schema).map((f) => f.key)).toEqual(["isCloud", "regions", "criticality"]);
  });

  it("drops multi-selects from the groupable list", () => {
    expect(pickGroupableFields(schema).map((f) => f.key)).toEqual(["isCloud", "criticality"]);
  });

  it("returns nothing for an empty schema", () => {
    expect(pickFacetFields([])).toEqual([]);
    expect(pickGroupableFields([])).toEqual([]);
  });
});

describe("facetOptions", () => {
  it("gives a boolean Yes / No in fixed colours", () => {
    expect(facetOptions(bool, LABELS)).toEqual([
      { key: "true", label: "Yes", color: "#4caf50" },
      { key: "false", label: "No", color: "#2196f3" },
    ]);
  });

  it("keeps an option's own colour and fills the rest from the palette by index", () => {
    expect(facetOptions(single, LABELS)).toEqual([
      { key: "high", label: "High", color: "#ff0000" },
      { key: "low", label: "Low", color: CATEGORICAL_COLORS[1] },
      { key: "mid", label: "Mid", color: CATEGORICAL_COLORS[2] },
    ]);
    expect(CATEGORICAL_COLORS[1]).toBe("#7b1fa2");
    expect(facetOptions(multi, LABELS).map((o) => o.color)).toEqual(["#1976d2", "#00ff00"]);
  });

  it("keeps other option properties", () => {
    const f = { type: "single_select", options: [{ key: "a", label: "A", translations: { de: "Ä" } }] };
    expect(facetOptions(f, LABELS)[0]).toEqual({
      key: "a",
      label: "A",
      translations: { de: "Ä" },
      color: "#1976d2",
    });
  });

  it("returns nothing for a select without options", () => {
    expect(facetOptions({ type: "single_select" }, LABELS)).toEqual([]);
  });
});

describe("resolveFacetField", () => {
  it("copies the field with coloured options and does not mutate it", () => {
    const r = resolveFacetField(single, LABELS);
    expect(r).not.toBe(single);
    expect(r.key).toBe("criticality");
    expect(r.options?.map((o) => o.color)).toEqual(["#ff0000", "#7b1fa2", "#00897b"]);
    expect(single.options?.[1].color).toBeUndefined();
  });

  it("is idempotent", () => {
    const once = resolveFacetField(bool, LABELS);
    expect(resolveFacetField(once, LABELS)).toEqual(once);
    expect(once.options?.map((o) => o.key)).toEqual(["true", "false"]);
  });
});

describe("rawValues", () => {
  it("reads nothing as no values", () => {
    expect(rawValues(null)).toEqual([]);
    expect(rawValues(undefined)).toEqual([]);
    expect(rawValues("")).toEqual([]);
    expect(rawValues([])).toEqual([]);
  });

  it("reads a boolean as its key", () => {
    expect(rawValues(true)).toEqual(["true"]);
    expect(rawValues(false)).toEqual(["false"]);
  });

  it("reads a list as its non-empty entries, once each", () => {
    expect(rawValues(["eu", "", null, undefined, "us", "eu", 3])).toEqual(["eu", "us", "3"]);
    expect(rawValues([null, ""])).toEqual([]);
  });

  it("reads a scalar as its string form", () => {
    expect(rawValues("high")).toEqual(["high"]);
    expect(rawValues(0)).toEqual(["0"]);
    expect(rawValues(" ")).toEqual([" "]);
  });
});

describe("facetValues", () => {
  it("delegates to rawValues for a select", () => {
    expect(facetValues(single, "high")).toEqual(["high"]);
    expect(facetValues(multi, ["eu", "us"])).toEqual(["eu", "us"]);
    expect(facetValues(single, true)).toEqual(["true"]);
  });

  it("reads booleans and the legacy strings on a boolean field", () => {
    expect(facetValues(bool, true)).toEqual(["true"]);
    expect(facetValues(bool, false)).toEqual(["false"]);
    expect(facetValues(bool, "true")).toEqual(["true"]);
    expect(facetValues(bool, " Yes ")).toEqual(["true"]);
    expect(facetValues(bool, "YES")).toEqual(["true"]);
    expect(facetValues(bool, "false")).toEqual(["false"]);
    expect(facetValues(bool, "No")).toEqual(["false"]);
    expect(facetValues(bool, "\tFALSE\n")).toEqual(["false"]);
  });

  it("reads anything else on a boolean field as not set", () => {
    expect(facetValues(bool, "maybe")).toEqual([]);
    expect(facetValues(bool, "")).toEqual([]);
    expect(facetValues(bool, 1)).toEqual([]);
    expect(facetValues(bool, ["true"])).toEqual([]);
    expect(facetValues(bool, null)).toEqual([]);
    expect(facetValues(bool, undefined)).toEqual([]);
  });
});

describe("matchesFacet", () => {
  const EMPTY = "__empty__";

  it("passes everything when nothing is selected", () => {
    expect(matchesFacet(bool, undefined, [], EMPTY)).toBe(true);
    expect(matchesFacet(bool, false, [], EMPTY)).toBe(true);
  });

  it("matches a selected boolean value", () => {
    expect(matchesFacet(bool, true, ["true"], EMPTY)).toBe(true);
    expect(matchesFacet(bool, false, ["true"], EMPTY)).toBe(false);
    expect(matchesFacet(bool, "yes", ["true"], EMPTY)).toBe(true);
    expect(matchesFacet(bool, false, ["true", "false"], EMPTY)).toBe(true);
  });

  it("matches the empty key only for a card with no value", () => {
    expect(matchesFacet(bool, undefined, [EMPTY], EMPTY)).toBe(true);
    expect(matchesFacet(bool, "", [EMPTY], EMPTY)).toBe(true);
    expect(matchesFacet(multi, [], [EMPTY], EMPTY)).toBe(true);
    expect(matchesFacet(bool, false, [EMPTY], EMPTY)).toBe(false);
    expect(matchesFacet(bool, undefined, ["true"], EMPTY)).toBe(false);
  });

  it("matches any one value of a multi-select", () => {
    expect(matchesFacet(multi, ["eu", "us"], ["us"], EMPTY)).toBe(true);
    expect(matchesFacet(multi, ["eu"], ["us"], EMPTY)).toBe(false);
    expect(matchesFacet(multi, ["eu"], ["us", EMPTY], EMPTY)).toBe(false);
  });
});

describe("facetBucket", () => {
  it("puts a card with no value in the unset bucket", () => {
    expect(facetBucket(bool, undefined, LABELS)).toEqual({
      kind: "unset",
      key: "__unset__",
      label: "Not set",
      color: null,
    });
    expect(facetBucket(multi, [], LABELS).kind).toBe("unset");
  });

  it("colours false as No, not as unset", () => {
    expect(facetBucket(bool, false, LABELS)).toEqual({
      kind: "value",
      key: "false",
      label: "No",
      color: "#2196f3",
    });
    expect(facetBucket(bool, true, LABELS)).toEqual({
      kind: "value",
      key: "true",
      label: "Yes",
      color: "#4caf50",
    });
  });

  it("gives an uncoloured option its palette colour", () => {
    expect(facetBucket(single, "low", LABELS)).toEqual({
      kind: "value",
      key: "low",
      label: "Low",
      color: "#7b1fa2",
    });
  });

  it("keeps an unknown stored key with its raw label and no colour", () => {
    expect(facetBucket(single, "gone", LABELS)).toEqual({
      kind: "value",
      key: "gone",
      label: "gone",
      color: null,
    });
  });

  it("puts a card with several values in the Multiple bucket", () => {
    expect(facetBucket(multi, ["eu", "us"], LABELS)).toEqual({
      kind: "multiple",
      key: "__multiple__",
      label: "Multiple",
      color: "#607d8b",
    });
    expect(facetBucket(multi, ["us"], LABELS)).toEqual({
      kind: "value",
      key: "us",
      label: "US",
      color: "#00ff00",
    });
  });
});

describe("facetLegend", () => {
  it("lists every option, coloured", () => {
    expect(facetLegend(bool, LABELS, false)).toEqual([
      { key: "true", label: "Yes", color: "#4caf50" },
      { key: "false", label: "No", color: "#2196f3" },
    ]);
  });

  it("appends Multiple only when asked", () => {
    expect(facetLegend(multi, LABELS, true)).toEqual([
      { key: "eu", label: "EU", color: "#1976d2" },
      { key: "us", label: "US", color: "#00ff00" },
      { key: "__multiple__", label: "Multiple", color: "#607d8b" },
    ]);
    expect(facetLegend(multi, LABELS, false)).toHaveLength(2);
  });
});

describe("defaultColorField", () => {
  it("prefers the first single_select with options", () => {
    expect(defaultColorField([bool, multi, { ...single, options: [] }, single])).toBe("criticality");
  });

  it("falls back to the first facet field", () => {
    expect(defaultColorField([text, multi, bool])).toBe("regions");
    expect(defaultColorField([{ ...single, options: [] }, bool])).toBe("isCloud");
    expect(defaultColorField([{ ...single, options: undefined }, bool])).toBe("isCloud");
  });

  it("returns empty when there is none", () => {
    expect(defaultColorField([text, { ...single, options: [] }])).toBe("");
    expect(defaultColorField([])).toBe("");
  });
});
