import { beforeEach, describe, expect, it } from "vitest";
import type { EolCustomProduct } from "@/types";
import { EMPTY_CUSTOM_EOL_FILTERS } from "./CustomEolFilterSidebar";
import {
  DEFAULT_PREFS,
  FILLABLE_FIELDS,
  PREFS_STORAGE_KEY,
  buildRows,
  cyclePatch,
  filterRows,
  loadPrefs,
  savePrefs,
} from "./customEolGridModel";

const TODAY = "2026-06-15";

const ACME: EolCustomProduct = {
  id: "p1",
  key: "acme-erp",
  product: "custom:acme-erp",
  title: "Acme ERP",
  description: null,
  link: null,
  linked_cards: 3,
  updated_at: "2026-01-01T00:00:00Z",
  cycles: [
    {
      id: "c2",
      cycle: "2",
      releaseDate: "2024-01-01",
      support: true,
      eol: false,
      latest: "2.4.1",
      latestReleaseDate: null,
      sort_order: 0,
      linked_cards: 0,
      updated_at: "2026-02-01T00:00:00Z",
    },
    {
      id: "c1",
      cycle: "1",
      releaseDate: "2020-01-01",
      support: false,
      eol: "2025-01-01",
      latest: null,
      latestReleaseDate: null,
      sort_order: 0,
      linked_cards: 3,
      updated_at: null,
    },
  ],
};
const EMPTY: EolCustomProduct = {
  ...ACME,
  id: "p2",
  key: "bare",
  product: "custom:bare",
  title: "Bare Tool",
  linked_cards: 0,
  cycles: [],
};

describe("buildRows", () => {
  it("makes one row per cycle, with its status", () => {
    const rows = buildRows([ACME], TODAY);
    expect(rows.map((r) => [r.id, r.cycle, r.status, r.linked])).toEqual([
      ["c2", "2", "supported", 0],
      ["c1", "1", "eol", 3],
    ]);
    expect(rows[0]).toMatchObject({
      productKey: "acme-erp",
      productTitle: "Acme ERP",
      cycleId: "c2",
      latest: "2.4.1",
      support: true,
      eol: false,
      updated: "2026-02-01T00:00:00Z",
    });
    expect(rows[0].product).toBe(ACME);
  });

  it("gives a product without cycles one placeholder row", () => {
    const [row] = buildRows([EMPTY], TODAY);
    expect(row).toMatchObject({
      id: "product:bare",
      cycleId: null,
      cycle: "",
      status: "unknown",
      linked: 0,
      productTitle: "Bare Tool",
    });
  });
});

describe("filterRows", () => {
  const rows = buildRows([ACME, EMPTY], TODAY);
  const ids = (f: Partial<typeof EMPTY_CUSTOM_EOL_FILTERS>) =>
    filterRows(rows, { ...EMPTY_CUSTOM_EOL_FILTERS, ...f }).map((r) => r.id);

  it("keeps everything with no filter", () => {
    expect(ids({})).toEqual(["c2", "c1", "product:bare"]);
  });

  it("filters by product, status and usage", () => {
    expect(ids({ products: ["bare"] })).toEqual(["product:bare"]);
    expect(ids({ statuses: ["eol"] })).toEqual(["c1"]);
    expect(ids({ statuses: ["eol", "unknown"] })).toEqual(["c1", "product:bare"]);
    expect(ids({ usage: "linked" })).toEqual(["c1"]);
    expect(ids({ usage: "unused" })).toEqual(["c2", "product:bare"]);
  });

  it("searches product title, key, cycle and version without caring about case", () => {
    expect(ids({ search: "BARE" })).toEqual(["product:bare"]);
    expect(ids({ search: "acme-erp" })).toEqual(["c2", "c1"]);
    expect(ids({ search: "2.4" })).toEqual(["c2"]);
    expect(ids({ search: "  " })).toEqual(["c2", "c1", "product:bare"]);
    expect(ids({ search: "nothing" })).toEqual([]);
  });
});

describe("cyclePatch", () => {
  it("maps a grid field to its API key and blanks to null", () => {
    expect(cyclePatch("releaseDate", "2024-01-01")).toEqual({ releaseDate: "2024-01-01" });
    expect(cyclePatch("latest", "  ")).toEqual({ latest: null });
    expect(cyclePatch("latest", " 2.1 ")).toEqual({ latest: "2.1" });
    expect(cyclePatch("eol", false)).toEqual({ eol: false });
    expect(cyclePatch("support", undefined)).toEqual({ support: null });
  });

  it("refuses a field that is not editable", () => {
    expect(() => cyclePatch("status", "eol")).toThrow(/Not an editable field/);
  });

  it("never fills the cycle name, which is unique per product", () => {
    expect(FILLABLE_FIELDS.has("cycle")).toBe(false);
    expect([...FILLABLE_FIELDS].sort()).toEqual(
      ["eol", "latest", "latestReleaseDate", "releaseDate", "support"].sort(),
    );
  });
});

describe("prefs", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to grouping by product with product and cycle frozen", () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.groupBy).toBe("product");
    expect(DEFAULT_PREFS.frozenColumns).toEqual(["product", "cycle"]);
  });

  it("round-trips what it saves", () => {
    const prefs = {
      ...DEFAULT_PREFS,
      filtersCollapsed: true,
      sidebarWidth: 300,
      visibleColumns: ["product", "cycle", "actions", "eol"],
      frozenColumns: [],
      columnOrder: ["eol", "product"],
      groupBy: null,
    };
    savePrefs(prefs);
    expect(loadPrefs()).toEqual(prefs);
  });

  it("drops unknown columns, keeps locked ones visible and rejects a bad group axis", () => {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        visibleColumns: ["eol", "nope", 3],
        frozenColumns: ["nope", "eol"],
        columnOrder: ["x"],
        groupBy: "nope",
        sidebarWidth: "wide",
      }),
    );
    const prefs = loadPrefs();
    expect(new Set(prefs.visibleColumns)).toEqual(new Set(["product", "cycle", "actions", "eol"]));
    expect(prefs.frozenColumns).toEqual(["eol"]);
    expect(prefs.columnOrder).toEqual([]);
    expect(prefs.groupBy).toBe("product");
    expect(prefs.sidebarWidth).toBe(DEFAULT_PREFS.sidebarWidth);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem(PREFS_STORAGE_KEY, "{not json");
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
