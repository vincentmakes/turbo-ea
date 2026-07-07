/**
 * Round-trip + ambiguity tests for the multi-sheet importer / exporter.
 *
 * We deliberately mock the API client so these stay pure unit tests — no
 * HTTP, no Vite dev server needed. The bulk-create / relations/bulk
 * endpoints are also smoke-tested through this spec.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type {
  Card,
  CardType,
  FieldDef,
  Relation,
  RelationType,
  SectionDef,
} from "@/types";

import {
  buildExportWorkbook,
  encodePathSegment as exportEncode,
} from "./excelExport";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(async () => [] as unknown),
    post: vi.fn(async () => ({ results: [] } as unknown)),
    patch: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  },
}));

// Late import so the mocks above are in place.
import { api } from "@/api/client";
import {
  parseWorkbookSheets,
  validateMultiSheet,
  executeMultiSheetImport,
} from "./excelImport";

const APP_TYPE: CardType = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#000",
  has_hierarchy: true,
  has_successors: false,
  fields_schema: [],
  built_in: true,
  is_hidden: false,
  sort_order: 0,
};
const ITC_TYPE: CardType = {
  key: "ITComponent",
  label: "IT Component",
  icon: "memory",
  color: "#000",
  has_hierarchy: false,
  has_successors: false,
  fields_schema: [],
  built_in: true,
  is_hidden: false,
  sort_order: 1,
};

const DEPENDS_ON_TYPE: RelationType = {
  key: "depends_on",
  label: "depends on",
  reverse_label: "supports",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  cardinality: "n:m",
  attributes_schema: [],
  built_in: true,
  is_hidden: false,
  sort_order: 0,
  source_visible: true,
  source_mandatory: false,
  target_visible: true,
  target_mandatory: false,
};

function makeCard(partial: Partial<Card> & { id: string; type: string; name: string }): Card {
  return {
    status: "ACTIVE",
    approval_status: "DRAFT",
    data_quality: 0,
    tags: [],
    stakeholders: [],
    ...partial,
  };
}

function buildWorkbook(rows: Record<string, unknown>[], sheetName: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("encodePathSegment", () => {
  it("escapes backslash and slash so card names round-trip", () => {
    expect(exportEncode("A/B")).toBe("A\\/B");
    expect(exportEncode("A\\B")).toBe("A\\\\B");
    expect(exportEncode("Plain")).toBe("Plain");
  });
});

describe("parseWorkbookSheets", () => {
  it("recognises card-type sheets, _Meta, and Relations", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ name: "App", type: "Application" }]),
      "Application",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          action: "upsert",
          relation_type: "depends_on",
          source_ref: "App",
          target_ref: "DB",
        },
      ]),
      "Relations",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ key: "format_version", value: "2" }]),
      "_Meta",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbookSheets(buf, [APP_TYPE, ITC_TYPE]);
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.sheets[0].sheet).toBe("Application");
    expect(parsed.sheets[0].typeHint).toBe("Application");
    expect(parsed.relationRows).toHaveLength(1);
    expect(parsed.meta?.formatVersion).toBe("2");
  });
});

/**
 * Build a `/cards/resolve-refs` mock implementation that resolves any ref
 * against the provided `Card` list. Mirrors what the backend
 * `CardResolver` would do: bare names match when unique within a type,
 * names that appear in multiple cards come back ambiguous. We use this so
 * the existing tests don't have to spell out the full server-shape result
 * for every payload.
 */
function buildResolveRefsMock(cards: Card[]) {
  // Decode `\\` / `\/` escapes the same way the backend's `decode_ref`
  // does, so refs that contain literal slashes (e.g. "SAP S\\/4HANA")
  // match against the card's raw name.
  function decodeName(ref: string): string {
    let out = "";
    for (let i = 0; i < ref.length; i++) {
      if (ref[i] === "\\" && i + 1 < ref.length) {
        out += ref[i + 1];
        i++;
      } else {
        out += ref[i];
      }
    }
    return out;
  }
  return async (
    url: string,
    body: unknown,
  ): Promise<unknown> => {
    if (url !== "/cards/resolve-refs") return {};
    const refs = (body as {
      refs: { row: number; column: string; type: string; ref: string }[];
    }).refs;
    return {
      results: refs.map(({ row, column, type, ref }) => {
        const decoded = decodeName(ref).trim().toLowerCase();
        const candidates = cards.filter(
          (c) => c.type === type && c.name.trim().toLowerCase() === decoded,
        );
        if (candidates.length === 1) {
          return { row, column, status: "resolved", id: candidates[0].id };
        }
        if (candidates.length > 1) {
          return {
            row,
            column,
            status: "ambiguous",
            candidates: candidates.map((c) => ({ id: c.id, path: c.name })),
          };
        }
        return { row, column, status: "missing" };
      }),
    };
  };
}

describe("validateMultiSheet", () => {
  const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
  const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMock.mockReset();
    getMock.mockReset();
  });

  it("resolves a relation target by name when unambiguous", async () => {
    const existing: Card[] = [
      makeCard({ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP" }),
      makeCard({ id: "22222222-2222-2222-2222-222222222222", type: "ITComponent", name: "DB" }),
    ];
    postMock.mockImplementation(buildResolveRefsMock(existing));
    const wb = buildWorkbook(
      [{ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP", "rel:depends_on": "DB" }],
      "Application",
    );
    const parsed = parseWorkbookSheets(wb, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      existing,
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      [],
    );
    expect(report.errors).toEqual([]);
    expect(report.relationOps).toHaveLength(1);
    expect(report.relationOps[0]).toMatchObject({
      action: "upsert",
      relationType: "depends_on",
      sourceRef: { kind: "id", id: "11111111-1111-1111-1111-111111111111" },
      targetRef: { kind: "id", id: "22222222-2222-2222-2222-222222222222" },
    });
  });

  it("resolves cross-type targets that aren't in the filtered grid view", async () => {
    // Symmetric counterpart to the export-side bug: importer used to match
    // refs against `existingCards` (= the filtered Inventory page), so a
    // workbook re-imported into a single-type filter couldn't see targets
    // of other types. Now we route through the backend resolver instead.
    const filteredView: Card[] = [
      makeCard({ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP" }),
      // ITComponent "DB" is in the DB but NOT in `existingCards`.
    ];
    const dbView: Card[] = [
      ...filteredView,
      makeCard({ id: "22222222-2222-2222-2222-222222222222", type: "ITComponent", name: "DB" }),
    ];
    postMock.mockImplementation(buildResolveRefsMock(dbView));
    const wb = buildWorkbook(
      [{ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP", "rel:depends_on": "DB" }],
      "Application",
    );
    const parsed = parseWorkbookSheets(wb, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      filteredView,
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      [],
    );
    expect(report.errors).toEqual([]);
    expect(report.relationOps).toHaveLength(1);
    expect(report.relationOps[0].targetRef).toEqual({
      kind: "id",
      id: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("sources relations from a new card by pathKey, not its stale exported id", async () => {
    // Re-importing an export into a FRESH instance: the Application row still
    // carries the source instance's UUID in its `id` column, but no such card
    // exists in the target, so the row is created. Its outgoing relation must
    // source from the new card (pathKey → resolved to the new server id on
    // apply), NOT the stale UUID — otherwise the relation insert fails with a
    // foreign-key violation ("source_id ... is not present in table cards").
    const targetDb = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "DB",
    });
    postMock.mockImplementation(buildResolveRefsMock([targetDb]));
    const staleId = "f4776e0b-b6ae-4619-b89a-4170b8dee616";
    const wb = buildWorkbook(
      [{ id: staleId, type: "Application", name: "NewApp", "rel:depends_on": "DB" }],
      "Application",
    );
    const parsed = parseWorkbookSheets(wb, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      [], // fresh instance — nothing exists locally
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      [],
    );
    expect(report.errors).toEqual([]);
    expect(report.creates).toHaveLength(1);
    expect(report.relationOps).toHaveLength(1);
    expect(report.relationOps[0].sourceRef).toEqual({
      kind: "pathKey",
      pathKey: "Application|newapp",
      type: "Application",
    });
    expect(report.relationOps[0].targetRef).toEqual({
      kind: "id",
      id: "22222222-2222-2222-2222-222222222222",
    });
  });

  it("flags an ambiguous relation target", async () => {
    const existing: Card[] = [
      makeCard({ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP" }),
      makeCard({ id: "22222222-2222-2222-2222-222222222222", type: "ITComponent", name: "DB" }),
      makeCard({ id: "33333333-3333-3333-3333-333333333333", type: "ITComponent", name: "DB" }),
    ];
    postMock.mockImplementation(buildResolveRefsMock(existing));
    const wb = buildWorkbook(
      [{ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP", "rel:depends_on": "DB" }],
      "Application",
    );
    const parsed = parseWorkbookSheets(wb, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      existing,
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      [],
    );
    expect(report.errors.length).toBeGreaterThanOrEqual(1);
    expect(report.errors[0].message).toMatch(/ambiguous|DB/i);
    expect(report.relationOps).toHaveLength(0);
  });

  it("emits a delete op when an inline cell drops a previously-related target", async () => {
    const existing: Card[] = [
      makeCard({ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP" }),
      makeCard({ id: "22222222-2222-2222-2222-222222222222", type: "ITComponent", name: "DB" }),
      makeCard({ id: "33333333-3333-3333-3333-333333333333", type: "ITComponent", name: "Cache" }),
    ];
    const existingRels: Relation[] = [
      { id: "r1", type: "depends_on", source_id: "11111111-1111-1111-1111-111111111111", target_id: "22222222-2222-2222-2222-222222222222" },
      { id: "r2", type: "depends_on", source_id: "11111111-1111-1111-1111-111111111111", target_id: "33333333-3333-3333-3333-333333333333" },
    ];
    postMock.mockImplementation(buildResolveRefsMock(existing));
    const wb = buildWorkbook(
      // Cell lists only DB — Cache should be dropped.
      [{ id: "11111111-1111-1111-1111-111111111111", type: "Application", name: "ERP", "rel:depends_on": "DB" }],
      "Application",
    );
    const parsed = parseWorkbookSheets(wb, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      existing,
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      existingRels,
    );
    expect(report.errors).toEqual([]);
    const deletes = report.relationOps.filter((o) => o.action === "delete");
    const upserts = report.relationOps.filter((o) => o.action === "upsert");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].targetRef).toEqual({ kind: "id", id: "33333333-3333-3333-3333-333333333333" });
    // The remaining target (DB) already exists in the live graph, so it
    // produces no upsert — only the removed Cache shows in the diff.
    expect(upserts).toHaveLength(0);
  });

  it("resolves a same-batch hierarchical target referenced by bare name", async () => {
    // Application is hierarchical. "CRM" is a child of "Platform", so its
    // full path key is `Application|platform/crm`, but the relation cell
    // references it by the bare name "CRM" (the exporter's default for
    // uniquely-named cards). Same-batch matching must still find it — this
    // is the new-card / empty-instance case that used to fail with
    // "relation target doesn't match any card".
    const APP_DEP: RelationType = {
      ...DEPENDS_ON_TYPE,
      key: "app_dep",
      source_type_key: "Application",
      target_type_key: "Application",
    };
    postMock.mockImplementation(buildResolveRefsMock([])); // empty DB
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { type: "Application", name: "Platform" },
        { type: "Application", name: "CRM", parent_path: "Platform" },
        { type: "Application", name: "Portal", "rel:app_dep": "CRM" },
      ]),
      "Application",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbookSheets(buf, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(parsed, [], [APP_TYPE, ITC_TYPE], [APP_DEP], []);

    expect(report.errors).toEqual([]);
    expect(report.creates).toHaveLength(3);
    const op = report.relationOps.find((o) => o.relationType === "app_dep");
    expect(op).toBeTruthy();
    // Target resolved to the child's full path key (via bare-name match),
    // which the apply step hands the backend as a name+path ref.
    expect(op!.targetRef).toEqual({
      kind: "pathKey",
      pathKey: "Application|platform/crm",
      type: "Application",
    });
  });
});

describe("executeMultiSheetImport", () => {
  const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses bulk-create for new cards then relations/bulk with materialised ids", async () => {
    postMock.mockImplementation(async (url: string, body: unknown) => {
      if (url === "/cards/bulk-create") {
        const cards = (body as { cards: { row_index: number }[] }).cards;
        return {
          results: cards.map((c) => ({
            row_index: c.row_index,
            status: "created",
            id: `new-${c.row_index}`,
          })),
          created: cards.length,
          failed: 0,
        };
      }
      if (url === "/relations/bulk") {
        const ops = (body as { operations: { row_index: number }[] }).operations;
        return {
          results: ops.map((o) => ({
            row_index: o.row_index,
            status: "upserted",
            relation_id: `rel-${o.row_index}`,
          })),
          upserted: ops.length,
          deleted: 0,
          failed: 0,
        };
      }
      return {};
    });

    const result = await executeMultiSheetImport({
      errors: [],
      warnings: [],
      creates: [
        {
          rowIndex: 2,
          type: "Application",
          data: { type: "Application", name: "NewApp" },
          ownPathKey: "Application|newapp",
        },
      ],
      updates: [],
      skipped: 0,
      totalRows: 1,
      relationOps: [
        {
          rowIndex: 2,
          sheet: "Application",
          action: "upsert",
          relationType: "depends_on",
          sourceRef: { kind: "pathKey", pathKey: "Application|newapp", type: "Application" },
          targetRef: { kind: "id", id: "22222222-2222-2222-2222-222222222222" },
        },
      ],
    });

    expect(result.created).toBe(1);
    expect(result.relationsUpserted).toBe(1);
    expect(result.failed).toBe(0);
    // Cards commit first; the pathKey source ref is materialised into the
    // server-assigned uuid before the relations/bulk request.
    const bulkRelCall = postMock.mock.calls.find((c) => c[0] === "/relations/bulk");
    expect(bulkRelCall).toBeTruthy();
    const operations = (bulkRelCall![1] as { operations: { source: { id?: string } }[] }).operations;
    expect(operations[0].source.id).toBe("new-2");
  });
});

describe("multi-sheet row_index collision (#767)", () => {
  const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps every card when two sheets share per-sheet row numbers", async () => {
    // Two card-type sheets, each with rows at Excel rows 2 and 3 — the exact
    // shape (e.g. Application + Provider) that used to collide on `row_index`
    // and silently drop the second sheet's cards.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { type: "Application", name: "App One" },
        { type: "Application", name: "App Two" },
      ]),
      "Application",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { type: "ITComponent", name: "Comp One" },
        { type: "ITComponent", name: "Comp Two" },
      ]),
      "IT Component",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const parsed = parseWorkbookSheets(buf, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(parsed, [], [APP_TYPE, ITC_TYPE], [], []);

    expect(report.errors).toEqual([]);
    // All four cards survive the per-sheet → merged flattening (previously
    // the two "row 2" / "row 3" collisions dropped a card each).
    expect(report.creates).toHaveLength(4);
    // Each merged row carries a workbook-wide unique wireRow...
    const wireRows = report.creates.map((c) => c.wireRow);
    expect(new Set(wireRows).size).toBe(4);
    // ...while the per-sheet display row still repeats across sheets.
    expect(report.creates.map((c) => c.rowIndex).sort()).toEqual([2, 2, 3, 3]);

    // Capture the wire row_index values bulk-create actually receives.
    const seenRowIndices: number[] = [];
    postMock.mockImplementation(async (url: string, body: unknown) => {
      if (url === "/cards/bulk-create") {
        const cards = (body as { cards: { row_index: number }[] }).cards;
        for (const c of cards) seenRowIndices.push(c.row_index);
        return {
          results: cards.map((c) => ({
            row_index: c.row_index,
            status: "created",
            id: `new-${c.row_index}`,
          })),
          created: cards.length,
          failed: 0,
        };
      }
      return {};
    });

    const result = await executeMultiSheetImport(report);
    expect(result.created).toBe(4);
    expect(result.failed).toBe(0);
    // The wire row_index values sent to the server are unique — no collision,
    // so the backend's duplicate-index guard is never tripped.
    expect(seenRowIndices).toHaveLength(4);
    expect(new Set(seenRowIndices).size).toBe(4);
  });
});

describe("buildExportWorkbook", () => {
  const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
  const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  /**
   * Helper: read a sheet's data rows back as `Record<string, unknown>[]`.
   * Mirrors `XLSX.utils.sheet_to_json` with default options.
   */
  function rowsOf(wb: XLSX.WorkBook, sheet: string): Record<string, unknown>[] {
    const ws = wb.Sheets[sheet];
    if (!ws) return [];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  }

  it("emits a rel:<key> cell for a target that's not in the exported card set", async () => {
    // Filtered single-type export — only the Application is in `cards`, but
    // the relation's target is an ITComponent. The exporter must enrich via
    // GET /cards?ids= and emit the target name.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    const itc: Card = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "DB",
    });
    getMock.mockImplementation(async (url: string): Promise<unknown> => {
      if (url === "/relations") {
        return [
          {
            id: "rel1",
            type: "depends_on",
            source_id: app.id,
            target_id: itc.id,
            source: { id: app.id, type: app.type, name: app.name },
            target: { id: itc.id, type: itc.type, name: itc.name },
          },
        ];
      }
      if (url.startsWith("/cards?ids=")) {
        return { items: [itc] };
      }
      return [];
    });

    const wb = await buildExportWorkbook(
      [app],
      APP_TYPE,
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
    );
    const rows = rowsOf(wb, APP_TYPE.label);
    expect(rows).toHaveLength(1);
    expect(rows[0]["rel:depends_on"]).toBe(itc.name);
  });

  it("falls back to the embedded ref name when /cards?ids= returns nothing", async () => {
    // Permission-denied / transient-failure edge case: we still want a
    // populated cell rather than a silent blank. The relation payload's
    // own `target.name` is enough for the bare-name case.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    getMock.mockImplementation(async (url: string): Promise<unknown> => {
      if (url === "/relations") {
        return [
          {
            id: "rel1",
            type: "depends_on",
            source_id: app.id,
            target_id: "22222222-2222-2222-2222-222222222222",
            source: { id: app.id, type: app.type, name: app.name },
            target: {
              id: "22222222-2222-2222-2222-222222222222",
              type: "ITComponent",
              name: "DB",
            },
          },
        ];
      }
      if (url.startsWith("/cards?ids=")) {
        return { items: [] };
      }
      return [];
    });

    const wb = await buildExportWorkbook(
      [app],
      APP_TYPE,
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
    );
    const rows = rowsOf(wb, APP_TYPE.label);
    expect(rows[0]["rel:depends_on"]).toBe("DB");
  });

  it("separates multiple targets with semicolons, so comma-bearing names survive", async () => {
    // The whole reason for `;` over `,`: card names commonly contain commas
    // ("Acme, Inc."). Emitting them comma-separated would silently re-parse
    // as two distinct targets on the way back in.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    const itc1: Card = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "Acme, Inc.",
    });
    const itc2: Card = makeCard({
      id: "33333333-3333-3333-3333-333333333333",
      type: "ITComponent",
      name: "DB",
    });
    getMock.mockImplementation(async (url: string): Promise<unknown> => {
      if (url === "/relations") {
        return [
          {
            id: "r1",
            type: "depends_on",
            source_id: app.id,
            target_id: itc1.id,
            source: { id: app.id, type: app.type, name: app.name },
            target: { id: itc1.id, type: itc1.type, name: itc1.name },
          },
          {
            id: "r2",
            type: "depends_on",
            source_id: app.id,
            target_id: itc2.id,
            source: { id: app.id, type: app.type, name: app.name },
            target: { id: itc2.id, type: itc2.type, name: itc2.name },
          },
        ];
      }
      if (url.startsWith("/cards?ids=")) {
        return { items: [itc1, itc2] };
      }
      return [];
    });

    const wb = await buildExportWorkbook(
      [app],
      APP_TYPE,
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
    );
    const cell = String(rowsOf(wb, APP_TYPE.label)[0]["rel:depends_on"]);
    expect(cell).toBe("Acme, Inc.; DB");
    // Round-trip via the importer: the comma in "Acme, Inc." must survive.
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbookSheets(buf, [APP_TYPE, ITC_TYPE]);
    postMock.mockImplementation(buildResolveRefsMock([app, itc1, itc2]));
    const report = await validateMultiSheet(
      parsed,
      [app, itc1, itc2],
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      [
        { id: "r1", type: "depends_on", source_id: app.id, target_id: itc1.id },
        { id: "r2", type: "depends_on", source_id: app.id, target_id: itc2.id },
      ],
    );
    // Both targets already exist in the live graph, so a no-op
    // round-trip must produce **zero** upserts and zero deletes — the
    // import preview should not falsely claim to be re-creating things
    // that already exist.
    expect(report.errors).toEqual([]);
    expect(report.relationOps).toHaveLength(0);
  });

  it("still parses legacy comma-separated cells from older workbooks", async () => {
    // Backwards compat: an imported cell that contains commas but no
    // semicolons is treated as comma-separated. We can't tell whether
    // the user meant one target named "A, B" or two targets "A" and
    // "B", so we go with the historical interpretation. Card names with
    // commas in legacy workbooks remain ambiguous — they always were.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    const itc1: Card = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "DB",
    });
    const itc2: Card = makeCard({
      id: "33333333-3333-3333-3333-333333333333",
      type: "ITComponent",
      name: "Cache",
    });
    const wb = buildWorkbook(
      [
        {
          id: "11111111-1111-1111-1111-111111111111",
          type: "Application",
          name: "ERP",
          "rel:depends_on": "DB, Cache",
        },
      ],
      "Application",
    );
    const parsed = parseWorkbookSheets(wb, [APP_TYPE, ITC_TYPE]);
    postMock.mockImplementation(buildResolveRefsMock([app, itc1, itc2]));
    const report = await validateMultiSheet(
      parsed,
      [app, itc1, itc2],
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      [],
    );
    expect(report.errors).toEqual([]);
    const upserts = report.relationOps.filter((o) => o.action === "upsert");
    expect(upserts).toHaveLength(2);
  });

  it("escapes `/` in card names so SAP S/4HANA round-trips", async () => {
    // Regression: the exporter used to return raw `card.name` for
    // unambiguous bare-name refs, so a name like "SAP S/4HANA" was
    // written verbatim. The importer's `decodePath()` then split it on
    // `/` and tried to resolve a parent path "SAP S" — failing for every
    // such name.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    const sap: Card = makeCard({
      id: "44444444-4444-4444-4444-444444444444",
      type: "Application",
      name: "SAP S/4HANA",
    });
    getMock.mockImplementation(async (url: string): Promise<unknown> => {
      if (url === "/relations") {
        return [
          {
            id: "rdep",
            type: "depends_on",
            source_id: app.id,
            target_id: sap.id,
            source: { id: app.id, type: app.type, name: app.name },
            target: { id: sap.id, type: sap.type, name: sap.name },
          },
        ];
      }
      if (url.startsWith("/cards?ids=")) {
        return { items: [sap] };
      }
      return [];
    });

    // Re-use APP_TYPE for both apps; relation type forwarded App→App.
    const APP_TO_APP: RelationType = {
      ...DEPENDS_ON_TYPE,
      key: "depends_on",
      target_type_key: "Application",
    };
    const wb = await buildExportWorkbook(
      [app],
      APP_TYPE,
      [APP_TYPE, ITC_TYPE],
      [APP_TO_APP],
    );
    const cell = String(rowsOf(wb, APP_TYPE.label)[0]["rel:depends_on"]);
    // The exporter must emit the escape, not the raw `/`.
    expect(cell).toBe("SAP S\\/4HANA");

    // And the importer must resolve it as a single ref, not two.
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbookSheets(buf, [APP_TYPE, ITC_TYPE]);
    postMock.mockImplementation(buildResolveRefsMock([app, sap]));
    const report = await validateMultiSheet(
      parsed,
      [app, sap],
      [APP_TYPE, ITC_TYPE],
      [APP_TO_APP],
      [{ id: "rdep", type: "depends_on", source_id: app.id, target_id: sap.id }],
    );
    expect(report.errors).toEqual([]);
    // The relation already exists in the live graph, so a no-op
    // round-trip emits no ops at all. The point of the test is the
    // escape, not the diff — assert there are no spurious "missing"
    // errors and no false-positive upserts.
    expect(report.relationOps).toHaveLength(0);
  });

  it("emits an upsert only for genuinely new targets, not no-ops", async () => {
    // Direct coverage of the preview-noise fix: a cell that lists two
    // targets, one of which already exists, should produce exactly one
    // upsert (for the new one) and zero deletes.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    const itc1: Card = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "DB",
    });
    const itc2: Card = makeCard({
      id: "33333333-3333-3333-3333-333333333333",
      type: "ITComponent",
      name: "Cache",
    });
    postMock.mockImplementation(buildResolveRefsMock([app, itc1, itc2]));
    const wb = buildWorkbook(
      [
        {
          id: app.id,
          type: "Application",
          name: "ERP",
          "rel:depends_on": "DB; Cache",
        },
      ],
      "Application",
    );
    const parsed = parseWorkbookSheets(wb, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      [app, itc1, itc2],
      [APP_TYPE, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      // Only the DB relation exists — Cache is the genuinely new one.
      [{ id: "r1", type: "depends_on", source_id: app.id, target_id: itc1.id }],
    );
    expect(report.errors).toEqual([]);
    const upserts = report.relationOps.filter((o) => o.action === "upsert");
    const deletes = report.relationOps.filter((o) => o.action === "delete");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].targetRef).toEqual({ kind: "id", id: itc2.id });
    expect(deletes).toHaveLength(0);
  });

  it("round-trip pin: re-import of unchanged workbook = 0 ops, 0 read-only warnings", async () => {
    // The whole point of the multi-sheet format is round-trip fidelity.
    // A re-import of an unchanged export must produce zero relation ops
    // *and* zero read-only-field warnings — otherwise the preview
    // becomes scary noise for users who're just trying to apply a small
    // edit. Regression-pinned against:
    //   - source-card lookup ignoring valid UUIDs when the grid is filtered
    //   - read-only fields firing one warning per (row, calc-field)
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
      // Calculated/read-only field populated on the existing card — the
      // exporter writes it out, the importer must accept it silently on
      // round-trip.
      attributes: { dqIndex: 87 } as Record<string, unknown>,
    });
    const itc1: Card = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "DB",
    });
    const itc2: Card = makeCard({
      id: "33333333-3333-3333-3333-333333333333",
      type: "ITComponent",
      name: "Cache",
    });
    // Application type carries a read-only calculated field — exactly
    // what produced ~130 per-row warnings on a real demo dataset.
    const APP_TYPE_WITH_CALC: CardType = {
      ...APP_TYPE,
      fields_schema: [
        {
          section: "Quality",
          fields: [
            { key: "dqIndex", label: "DQ Index", type: "number", readonly: true } as FieldDef,
          ],
        } as SectionDef,
      ],
    };
    getMock.mockImplementation(async (url: string): Promise<unknown> => {
      if (url === "/relations") {
        return [
          {
            id: "r1",
            type: "depends_on",
            source_id: app.id,
            target_id: itc1.id,
            source: { id: app.id, type: app.type, name: app.name },
            target: { id: itc1.id, type: itc1.type, name: itc1.name },
          },
          {
            id: "r2",
            type: "depends_on",
            source_id: app.id,
            target_id: itc2.id,
            source: { id: app.id, type: app.type, name: app.name },
            target: { id: itc2.id, type: itc2.type, name: itc2.name },
          },
        ];
      }
      if (url.startsWith("/cards?ids=")) {
        return { items: [itc1, itc2] };
      }
      return [];
    });
    postMock.mockImplementation(buildResolveRefsMock([app, itc1, itc2]));

    // 1. Build workbook from current state.
    const wb = await buildExportWorkbook(
      [app],
      APP_TYPE_WITH_CALC,
      [APP_TYPE_WITH_CALC, ITC_TYPE],
      [DEPENDS_ON_TYPE],
    );
    // 2. Re-import while the "grid" only knows about the source card
    //    (mimics a filtered Inventory view — ITC targets aren't loaded).
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbookSheets(buf, [APP_TYPE_WITH_CALC, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      [app], // filtered grid: Apps only, no ITCs
      [APP_TYPE_WITH_CALC, ITC_TYPE],
      [DEPENDS_ON_TYPE],
      [
        { id: "r1", type: "depends_on", source_id: app.id, target_id: itc1.id },
        { id: "r2", type: "depends_on", source_id: app.id, target_id: itc2.id },
      ],
    );
    expect(report.errors).toEqual([]);
    expect(report.relationOps).toHaveLength(0);
    const readOnlyWarnings = report.warnings.filter((w) =>
      /read-only|ignored/i.test(w.message),
    );
    expect(readOnlyWarnings).toHaveLength(0);
  });

  it("Relations sheet upserts with unchanged attributes are dropped from the diff", async () => {
    // Regression for the "286 false relations to add" report — every
    // Relations-sheet row was being queued as `upsert` regardless of
    // whether the live graph already had an identical relation, so a
    // re-export of a demo carrying ~286 attribute-bearing relations
    // produced ~286 false adds.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    const itc: Card = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "DB",
    });
    const COST_REL: RelationType = {
      ...DEPENDS_ON_TYPE,
      key: "costs",
      attributes_schema: [
        { key: "annual", label: "Annual Cost", type: "cost" } as FieldDef,
      ],
    };
    postMock.mockImplementation(buildResolveRefsMock([app, itc]));
    // Build a workbook that has only a Relations sheet row matching the
    // live graph exactly. (We hand-craft the sheet rather than going
    // through the exporter so the assertion is hermetic.)
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          id: app.id,
          type: "Application",
          name: app.name,
        },
      ]),
      "Application",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          action: "upsert",
          relation_type: "costs",
          source_type: "Application",
          source_ref: app.name,
          target_type: "ITComponent",
          target_ref: itc.name,
          attr_annual: 25000,
          description: "Production",
        },
      ]),
      "Relations",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbookSheets(buf, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      [app, itc],
      [APP_TYPE, ITC_TYPE],
      [COST_REL],
      [
        {
          id: "rel-cost-1",
          type: "costs",
          source_id: app.id,
          target_id: itc.id,
          attributes: { annual: 25000 },
          description: "Production",
        },
      ],
    );
    expect(report.errors).toEqual([]);
    // The row matches exactly → diff drops it. Same target with a
    // *different* cost would queue an upsert; tested separately if
    // needed, but the round-trip-noop case is the hot path.
    expect(report.relationOps).toHaveLength(0);
  });

  it("Relations sheet upserts with changed attributes still queue", async () => {
    // Counterpart to the no-op test: a real attribute edit must still
    // surface as an upsert in the preview.
    const app: Card = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
    });
    const itc: Card = makeCard({
      id: "22222222-2222-2222-2222-222222222222",
      type: "ITComponent",
      name: "DB",
    });
    const COST_REL: RelationType = {
      ...DEPENDS_ON_TYPE,
      key: "costs",
      attributes_schema: [
        { key: "annual", label: "Annual Cost", type: "cost" } as FieldDef,
      ],
    };
    postMock.mockImplementation(buildResolveRefsMock([app, itc]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { id: app.id, type: "Application", name: app.name },
      ]),
      "Application",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        {
          action: "upsert",
          relation_type: "costs",
          source_type: "Application",
          source_ref: app.name,
          target_type: "ITComponent",
          target_ref: itc.name,
          attr_annual: 30000, // ← changed
          description: "Production",
        },
      ]),
      "Relations",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const parsed = parseWorkbookSheets(buf, [APP_TYPE, ITC_TYPE]);
    const report = await validateMultiSheet(
      parsed,
      [app, itc],
      [APP_TYPE, ITC_TYPE],
      [COST_REL],
      [
        {
          id: "rel-cost-1",
          type: "costs",
          source_id: app.id,
          target_id: itc.id,
          attributes: { annual: 25000 },
          description: "Production",
        },
      ],
    );
    const upserts = report.relationOps.filter((o) => o.action === "upsert");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].attributes).toMatchObject({ annual: 30000 });
  });
});
