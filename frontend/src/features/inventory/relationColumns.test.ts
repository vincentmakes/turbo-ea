import { describe, it, expect } from "vitest";
import {
  RELATION_COLUMN_PREFIX,
  legacyRelationColumnMap,
  legacySideColumnMap,
  migrateLegacyRelationColumnIds,
  migrateLegacyRelationColumnState,
  migrateLegacyRelationFilterModel,
  migrateLegacyRelationSortModel,
  relationColumnId,
  relationColumnSides,
  relationSideLabel,
  relationSideOfColumn,
} from "./relationColumns";
import { makeRelationType } from "@/test/fixtures/metamodel";

const USES_ITC = makeRelationType({
  key: "relAppToITC",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  translations: { label: { de: "verwendet" }, reverse_label: { de: "wird verwendet von" } },
});
const SUPPORTS_BC = makeRelationType({
  key: "relAppToBC",
  label: "supports",
  reverse_label: "is supported by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
});
const HOSTED_ON_ITC = makeRelationType({
  key: "relAppToITCHosts",
  label: "is hosted on",
  reverse_label: "hosts",
  source_type_key: "Application",
  target_type_key: "ITComponent",
});
const SENDS_TO_APP = makeRelationType({
  key: "relAppToApp",
  label: "sends data to",
  reverse_label: "receives data from",
  source_type_key: "Application",
  target_type_key: "Application",
});
const PROVIDER_TO_ITC = makeRelationType({
  key: "relProviderToITC",
  label: "provides",
  reverse_label: "is provided by",
  source_type_key: "Provider",
  target_type_key: "ITComponent",
});

/** Application's columns: two types to IT Component (not adjacent in the metamodel), one to
 *  Business Capability, and both sides of a self-referencing type. */
const APP_SIDES = relationColumnSides(
  [USES_ITC, SUPPORTS_BC, HOSTED_ON_ITC, SENDS_TO_APP, PROVIDER_TO_ITC],
  "Application",
);

describe("relationColumnId", () => {
  it("is always qualified by the side, cross-type relations included", () => {
    expect(RELATION_COLUMN_PREFIX).toBe("rel_");
    expect(relationColumnId(USES_ITC, true)).toBe("rel_relAppToITC__out");
    expect(relationColumnId(USES_ITC, false)).toBe("rel_relAppToITC__in");
    expect(relationColumnId(SENDS_TO_APP, true)).toBe("rel_relAppToApp__out");
    expect(relationColumnId(SENDS_TO_APP, false)).toBe("rel_relAppToApp__in");
  });
});

describe("relationColumnSides", () => {
  it("lists one column per side, same-target columns together, a self-pair's two sides adjacent", () => {
    expect(APP_SIDES.map((s) => s.colId)).toEqual([
      "rel_relAppToITC__out",
      "rel_relAppToITCHosts__out",
      "rel_relAppToBC__out",
      "rel_relAppToApp__out",
      "rel_relAppToApp__in",
    ]);
  });

  it("carries the side key the cell reads, the relation type, the side and the other end's type", () => {
    expect(APP_SIDES[0]).toEqual({
      colId: "rel_relAppToITC__out",
      // A cross-type relation's `relationsMap` entry keeps its bare key.
      sideKey: "relAppToITC",
      rt: USES_ITC,
      isSource: true,
      otherTypeKey: "ITComponent",
    });
    expect(APP_SIDES[4]).toEqual({
      colId: "rel_relAppToApp__in",
      sideKey: "relAppToApp__in",
      rt: SENDS_TO_APP,
      isSource: false,
      otherTypeKey: "Application",
    });
  });

  it("reads the other end from the target side, and drops types that do not touch the type", () => {
    const sides = relationColumnSides([USES_ITC, PROVIDER_TO_ITC, SUPPORTS_BC], "ITComponent");
    expect(sides.map((s) => [s.colId, s.sideKey, s.isSource, s.otherTypeKey])).toEqual([
      ["rel_relAppToITC__in", "relAppToITC", false, "Application"],
      ["rel_relProviderToITC__in", "relProviderToITC", false, "Provider"],
    ]);
  });

  it("gives a cross-type relation a different column at each of its two ends", () => {
    // The column prefs are shared by every card type: one id at both ends would
    // tie "uses IT Component" on Application to "is used by Application" on IT Component.
    const fromApp = relationColumnSides([USES_ITC], "Application")[0].colId;
    const fromItc = relationColumnSides([USES_ITC], "ITComponent")[0].colId;
    expect(fromApp).toBe("rel_relAppToITC__out");
    expect(fromItc).toBe("rel_relAppToITC__in");
  });

  it("has no columns without a selected type", () => {
    expect(relationColumnSides([USES_ITC], "")).toEqual([]);
  });
});

describe("relationSideOfColumn", () => {
  it("finds the side a column stands for, and nothing for any other column", () => {
    expect(relationSideOfColumn("rel_relAppToApp__in", APP_SIDES)).toBe(APP_SIDES[4]);
    // The other end's column of a relation on screen is not this grid's column.
    expect(relationSideOfColumn("rel_relAppToITC__in", APP_SIDES)).toBeUndefined();
    expect(relationSideOfColumn("rel_ITComponent", APP_SIDES)).toBeUndefined();
    expect(relationSideOfColumn("core_name", APP_SIDES)).toBeUndefined();
  });
});

describe("relationSideLabel", () => {
  it("is the verb of the side under view, then the other card type", () => {
    expect(relationSideLabel(USES_ITC, true, "IT Component", "en")).toBe("uses IT Component");
    expect(relationSideLabel(USES_ITC, false, "Application", "en")).toBe(
      "is used by Application",
    );
    expect(relationSideLabel(SENDS_TO_APP, false, "Application", "en")).toBe(
      "receives data from Application",
    );
  });

  it("resolves the verb in the locale asked for", () => {
    expect(relationSideLabel(USES_ITC, true, "IT-Komponente", "de")).toBe("verwendet IT-Komponente");
    expect(relationSideLabel(USES_ITC, false, "Anwendung", "de")).toBe(
      "wird verwendet von Anwendung",
    );
  });
});

/** The whole metamodel's relation types, in list order. */
const ALL_RTS = [USES_ITC, SUPPORTS_BC, HOSTED_ON_ITC, SENDS_TO_APP, PROVIDER_TO_ITC];

describe("legacyRelationColumnMap", () => {
  it("maps each card type to every column it stood for, seen from the other end, in list order", () => {
    expect(Object.fromEntries(legacyRelationColumnMap(ALL_RTS))).toEqual({
      // A target: the column on the source type's inventory.
      rel_ITComponent: [
        "rel_relAppToITC__out",
        "rel_relAppToITCHosts__out",
        "rel_relProviderToITC__out",
      ],
      rel_BusinessCapability: ["rel_relAppToBC__out"],
      // A source: the columns on the target types' inventories, then both
      // sides of the self-pair, out before in.
      rel_Application: [
        "rel_relAppToITC__in",
        "rel_relAppToBC__in",
        "rel_relAppToITCHosts__in",
        "rel_relAppToApp__out",
        "rel_relAppToApp__in",
      ],
      rel_Provider: ["rel_relProviderToITC__in"],
    });
  });
});

describe("legacySideColumnMap", () => {
  it("maps each card type to the selected type's side columns reaching it", () => {
    expect(Object.fromEntries(legacySideColumnMap(APP_SIDES))).toEqual({
      rel_ITComponent: ["rel_relAppToITC__out", "rel_relAppToITCHosts__out"],
      rel_BusinessCapability: ["rel_relAppToBC__out"],
      rel_Application: ["rel_relAppToApp__out", "rel_relAppToApp__in"],
    });
  });
});

describe("migrateLegacyRelationColumnIds", () => {
  it("renames a card type reached through one relation side", () => {
    expect(migrateLegacyRelationColumnIds(["core_name", "rel_BusinessCapability"], ALL_RTS)).toEqual(
      ["core_name", "rel_relAppToBC__out"],
    );
  });

  it("fans a card type out in place to every column it stood for, on every card type", () => {
    expect(migrateLegacyRelationColumnIds(["rel_Provider", "core_name", "rel_ITComponent"], ALL_RTS)).toEqual([
      "rel_relProviderToITC__in",
      "core_name",
      "rel_relAppToITC__out",
      "rel_relAppToITCHosts__out",
      "rel_relProviderToITC__out",
    ]);
  });

  it("keeps the legacy position when a produced id is already listed elsewhere", () => {
    // The column-order hook may already have folded the new columns in.
    expect(
      migrateLegacyRelationColumnIds(
        ["rel_BusinessCapability", "core_name", "rel_relAppToBC__out", "core_type"],
        ALL_RTS,
      ),
    ).toEqual(["rel_relAppToBC__out", "core_name", "core_type"]);
  });

  it("leaves ids that resolve to nothing alone", () => {
    expect(migrateLegacyRelationColumnIds(["rel_Ghost", "rel_BusinessCapability", "attr_x"], ALL_RTS)).toEqual(
      ["rel_Ghost", "rel_relAppToBC__out", "attr_x"],
    );
  });

  it("hands back the same array when there is nothing to translate, and is idempotent", () => {
    const current = ["core_name", "rel_relAppToITC__out", "rel_Ghost"];
    expect(migrateLegacyRelationColumnIds(current, ALL_RTS)).toBe(current);
    const once = migrateLegacyRelationColumnIds(["rel_ITComponent", "rel_Application"], ALL_RTS);
    expect(migrateLegacyRelationColumnIds(once, ALL_RTS)).toBe(once);
    const none = ["rel_ITComponent"];
    expect(migrateLegacyRelationColumnIds(none, [])).toBe(none);
  });
});

describe("migrateLegacyRelationColumnState", () => {
  it("gives every column the legacy width and the sort to the selected type's first side only", () => {
    expect(
      migrateLegacyRelationColumnState(
        [
          { colId: "core_name", width: 200 },
          { colId: "rel_Application", width: 250, pinned: "left", sort: "desc", sortIndex: 1 },
        ],
        ALL_RTS,
        // On the IT Component inventory, Application's first side is relAppToITC's in side.
        relationColumnSides(ALL_RTS, "ITComponent"),
      ),
    ).toEqual([
      { colId: "core_name", width: 200 },
      { colId: "rel_relAppToITC__in", width: 250, pinned: "left", sort: "desc", sortIndex: 1 },
      { colId: "rel_relAppToBC__in", width: 250, pinned: "left" },
      { colId: "rel_relAppToITCHosts__in", width: 250, pinned: "left" },
      { colId: "rel_relAppToApp__out", width: 250, pinned: "left" },
      { colId: "rel_relAppToApp__in", width: 250, pinned: "left" },
    ]);
  });

  it("puts the sort on a later column when that is the selected type's first side", () => {
    const out = migrateLegacyRelationColumnState(
      [{ colId: "rel_Application", width: 120, sort: "asc", sortIndex: 0 }],
      ALL_RTS,
      APP_SIDES,
    );
    expect(out.filter((c) => c.sort).map((c) => [c.colId, c.sort, c.sortIndex])).toEqual([
      ["rel_relAppToApp__out", "asc", 0],
    ]);
    expect(out.every((c) => c.width === 120)).toBe(true);
    expect(out.find((c) => c.colId === "rel_relAppToITC__in")).toEqual({
      colId: "rel_relAppToITC__in",
      width: 120,
    });
  });

  it("keeps the sort on the first column when the selected type does not reach the card type", () => {
    expect(
      migrateLegacyRelationColumnState(
        [{ colId: "rel_ITComponent", width: 90, sort: "asc" }],
        ALL_RTS,
        [],
      ),
    ).toEqual([
      { colId: "rel_relAppToITC__out", width: 90, sort: "asc" },
      { colId: "rel_relAppToITCHosts__out", width: 90 },
      { colId: "rel_relProviderToITC__out", width: 90 },
    ]);
  });

  it("lets the legacy entry replace a default entry for the same column", () => {
    expect(
      migrateLegacyRelationColumnState(
        [
          { colId: "rel_relAppToBC__out", width: 150 },
          { colId: "rel_BusinessCapability", width: 320 },
        ],
        ALL_RTS,
        APP_SIDES,
      ),
    ).toEqual([{ colId: "rel_relAppToBC__out", width: 320 }]);
  });

  it("hands back the same array when there is nothing to translate", () => {
    const state = [{ colId: "rel_relAppToITC__out", width: 250 }, { colId: "rel_Ghost" }];
    expect(migrateLegacyRelationColumnState(state, ALL_RTS, APP_SIDES)).toBe(state);
  });
});

describe("migrateLegacyRelationFilterModel", () => {
  const filter = (value: string) => ({ filterType: "text", type: "contains", filter: value });

  it("renames a one-side filter, drops one that cannot be split, keeps one the type does not reach", () => {
    expect(
      migrateLegacyRelationFilterModel(
        {
          core_name: filter("ERP"),
          rel_BusinessCapability: filter("Finance"),
          rel_ITComponent: filter("Postgres"),
          rel_Provider: filter("Acme"),
        },
        APP_SIDES,
      ),
    ).toEqual({
      core_name: filter("ERP"),
      rel_relAppToBC__out: filter("Finance"),
      rel_Provider: filter("Acme"),
    });
  });

  it("keeps a filter already set on the side column over the legacy one", () => {
    expect(
      migrateLegacyRelationFilterModel(
        { rel_relAppToBC__out: filter("Sales"), rel_BusinessCapability: filter("Finance") },
        APP_SIDES,
      ),
    ).toEqual({ rel_relAppToBC__out: filter("Sales") });
  });

  it("hands back the same model when there is nothing to translate", () => {
    const model = { rel_relAppToBC__out: filter("Finance") };
    expect(migrateLegacyRelationFilterModel(model, APP_SIDES)).toBe(model);
  });
});

describe("migrateLegacyRelationSortModel", () => {
  it("moves a legacy sort, in place, onto the selected type's first side", () => {
    expect(
      migrateLegacyRelationSortModel(
        [
          { colId: "core_name", sort: "asc" },
          { colId: "rel_ITComponent", sort: "desc" },
          { colId: "rel_Provider", sort: "asc" },
        ],
        APP_SIDES,
      ),
    ).toEqual([
      { colId: "core_name", sort: "asc" },
      { colId: "rel_relAppToITC__out", sort: "desc" },
      { colId: "rel_Provider", sort: "asc" },
    ]);
  });

  it("does not sort the same side twice", () => {
    expect(
      migrateLegacyRelationSortModel(
        [
          { colId: "rel_relAppToITC__out", sort: "asc" },
          { colId: "rel_ITComponent", sort: "desc" },
        ],
        APP_SIDES,
      ),
    ).toEqual([{ colId: "rel_relAppToITC__out", sort: "desc" }]);
  });

  it("hands back the same array when there is nothing to translate", () => {
    const sortModel = [{ colId: "rel_relAppToITC__out", sort: "asc" }];
    expect(migrateLegacyRelationSortModel(sortModel, APP_SIDES)).toBe(sortModel);
  });
});
