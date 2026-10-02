/**
 * `executeImport()` — the legacy single-sheet executor — driven through the
 * scripted API client (`@/test/apiMock`), plus the small exported helpers
 * (`legacyRoleKeyToCamel`, `parseStakeholderEntry`). The reports come either
 * from the real `validateImport()` over the kit's inventory, or are hand-built
 * where a shape the validator never produces today is the point (a same-file
 * parent keyed by its file id, a bare relation op).
 *
 * The multi-sheet executor (`executeMultiSheetImport`) is covered by
 * `excelRelations.test.ts` / `excelStakeholders.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { mockApi } from "@/test/apiMock";
import {
  CARD_IDS,
  CARD_TYPES,
  CARDS,
  HOSTING_GROUP,
  STAKEHOLDER_ROLES_BY_TYPE,
  TAG_GROUPS,
  USERS,
  cardById,
} from "@/test/fixtures/metamodel";

import {
  type ImportReport,
  type ParsedRow,
  type RelationOp,
  executeImport,
  legacyRoleKeyToCamel,
  parseStakeholderEntry,
  validateImport,
} from "./excelImport";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));

/* ------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* ------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

const CLOUD_TAG = HOSTING_GROUP.tags[1].id;
const ON_PREM_TAG = HOSTING_GROUP.tags[0].id;
const ERP = cardById(CARD_IDS.erp);
const UNKNOWN_ID = "11111111-2222-4333-8444-555555555555";
const unknownMessage = () => i18n.t("inventory:import.errors.unknown");

const bc = (over: Row = {}): Row => ({ type: "BusinessCapability", name: "Payments", ...over });
const erp = (over: Row = {}): Row => ({ id: CARD_IDS.erp, type: "Application", name: "ERP Core", ...over });

/** Validate rows against the kit inventory; the report must carry no errors. */
function validated(rows: Row[]): ImportReport {
  const report = validateImport(rows, CARDS, CARD_TYPES, undefined, TAG_GROUPS, {}, USERS, STAKEHOLDER_ROLES_BY_TYPE);
  expect(report.errors).toEqual([]);
  return report;
}

function report(partial: Partial<ImportReport> = {}): ImportReport {
  return { errors: [], warnings: [], creates: [], updates: [], skipped: 0, totalRows: 0, relationOps: [], ...partial };
}

function createRow(over: Partial<ParsedRow> & { name: string; type?: string }): ParsedRow {
  const type = over.type ?? "BusinessCapability";
  const { name, data, ...rest } = over;
  return {
    rowIndex: 2,
    type,
    data: { type, name, ...(data ?? {}) },
    ownPathKey: `${type}|${name.toLowerCase()}`,
    ...rest,
  };
}

function relationOp(over: Partial<RelationOp> = {}): RelationOp {
  return {
    rowIndex: 5,
    sheet: "Application",
    action: "upsert",
    relationType: "relAppToBC",
    sourceRef: { kind: "id", id: CARD_IDS.erp },
    targetRef: { kind: "id", id: CARD_IDS.finance },
    ...over,
  };
}

/** Script `POST /cards` to hand out `srv-1`, `srv-2`, … in call order. */
function scriptCreates(fail?: (body: Row) => unknown) {
  let n = 0;
  mockApi.on("post", "/cards", (_path, body) => {
    const thrown = fail?.(body as Row);
    if (thrown !== undefined) throw thrown;
    n += 1;
    return { id: `srv-${n}` };
  });
}

const createBodies = () => mockApi.callsOf("post", "/cards").map((c) => c.body as Row);

beforeEach(() => {
  mockApi.reset();
});

/* ------------------------------------------------------------------------- */
/*  Creates                                                                   */
/* ------------------------------------------------------------------------- */

describe("executeImport — creates", () => {
  it("creates parents before children and rewrites parent_id from the path map", async () => {
    scriptCreates();
    const rep = validated([
      bc({ name: "Grandchild", parent_path: "New Root / Child" }),
      bc({ name: "Child", parent_path: "New Root" }),
      bc({ name: "New Root" }),
      bc({ name: "Payments", parent_path: "Finance" }),
    ]);

    const result = await executeImport(rep);

    expect(result).toMatchObject({ created: 4, updated: 0, failed: 0, failedDetails: [] });
    const bodies = createBodies();
    expect(bodies.map((b) => b.name)).toEqual(["New Root", "Child", "Grandchild", "Payments"]);
    expect(bodies[0]).not.toHaveProperty("parent_id");
    expect(bodies[1].parent_id).toBe("srv-1");
    expect(bodies[2].parent_id).toBe("srv-2");
    // An existing parent was resolved at validation time and passes through.
    expect(bodies[3].parent_id).toBe(CARD_IDS.finance);
  });

  it("sends the row's data verbatim apart from the parent rewrite", async () => {
    scriptCreates();
    const rep = validated([
      { type: "Application", name: "New App", description: "d", subtype: "microservice", alias: "NA",
        external_id: "X-1", lifecycle_active: "2024-01-01", attr_businessCriticality: "businessOperational",
        attr_isCloud: "yes" },
    ]);

    await executeImport(rep);

    expect(createBodies()).toEqual([
      {
        type: "Application",
        name: "New App",
        description: "d",
        subtype: "microservice",
        alias: "NA",
        external_id: "X-1",
        lifecycle: { active: "2024-01-01" },
        attributes: { businessCriticality: "businessOperational", isCloud: true },
      },
    ]);
  });

  it("maps a legacy parent_id onto the server id of a same-file row keyed by its file id", async () => {
    scriptCreates();
    const parent = createRow({ name: "P", id: UNKNOWN_ID, rowIndex: 3 });
    const child = createRow({ name: "C", rowIndex: 2, parentId: UNKNOWN_ID, data: { parent_id: UNKNOWN_ID } });

    const result = await executeImport(report({ creates: [child, parent] }));

    expect(result.created).toBe(2);
    const bodies = createBodies();
    expect(bodies.map((b) => b.name)).toEqual(["P", "C"]);
    expect(bodies[1].parent_id).toBe("srv-1");
  });

  it("documents current behaviour (e): a legacy parent_id from validation is sent unchanged", async () => {
    // `validateImport` drops the parent's unknown file id, so nothing ever
    // lands in the id map: the child goes out with the source-instance UUID
    // and in sheet order, not parent-first.
    scriptCreates();
    const rep = validated([bc({ name: "C", parent_id: UNKNOWN_ID }), bc({ id: UNKNOWN_ID, name: "P" })]);

    await executeImport(rep);

    const bodies = createBodies();
    expect(bodies.map((b) => b.name)).toEqual(["C", "P"]);
    expect(bodies[0].parent_id).toBe(UNKNOWN_ID);
  });

  it("keeps two rows with the same per-sheet row number apart when they carry a wireRow", async () => {
    scriptCreates();
    const rows = [
      createRow({ name: "A", rowIndex: 2, wireRow: 1 }),
      createRow({ name: "B", rowIndex: 2, wireRow: 2, type: "Provider" }),
    ];

    const result = await executeImport(report({ creates: rows }));

    expect(result.created).toBe(2);
    expect(createBodies().map((b) => b.name)).toEqual(["A", "B"]);
  });

  it("assigns the resolved tags after the card exists", async () => {
    scriptCreates();
    mockApi.on("post", /^\/cards\/[^/]+\/tags$/, {});
    const rep = validated([bc({ tags: "Hosting: Cloud" }), bc({ name: "Untagged" })]);

    const result = await executeImport(rep);

    expect(result.created).toBe(2);
    expect(mockApi.callsOf("post", /\/tags$/)).toEqual([
      { method: "post", path: "/cards/srv-1/tags", body: [CLOUD_TAG] },
    ]);
  });

  it("treats a failed tag assignment as non-fatal", async () => {
    scriptCreates();
    mockApi.fail("post", /^\/cards\/[^/]+\/tags$/, 500);
    const rep = validated([bc({ tags: "Hosting: Cloud" })]);

    const result = await executeImport(rep);

    expect(result).toMatchObject({ created: 1, failed: 0, failedDetails: [] });
  });

  it("counts and reports a failed row by its sheet row number, and carries on", async () => {
    scriptCreates((body) => (body.name === "Dup" ? new Error("name taken") : undefined));
    const rep = validated([bc({ name: "Fine" }), bc({ name: "Dup" }), bc({ name: "Also fine" })]);

    const result = await executeImport(rep);

    expect(result).toMatchObject({ created: 2, failed: 1, failedDetails: [{ row: 3, message: "name taken" }] });
  });

  it("reports an ApiError by its message and a non-Error rejection as unknown", async () => {
    mockApi.fail("post", "/cards", 409);
    const api = report({ creates: [createRow({ name: "A", rowIndex: 2 })] });
    expect((await executeImport(api)).failedDetails).toEqual([{ row: 2, message: "POST /cards failed" }]);

    mockApi.reset();
    scriptCreates(() => "not an Error");
    const bare = report({ creates: [createRow({ name: "B", rowIndex: 4 })] });
    expect((await executeImport(bare)).failedDetails).toEqual([{ row: 4, message: unknownMessage() }]);
  });
});

/* ------------------------------------------------------------------------- */
/*  Updates                                                                   */
/* ------------------------------------------------------------------------- */

describe("executeImport — updates", () => {
  it("PATCHes only the diff, merging attributes over the existing ones", async () => {
    mockApi.on("patch", /^\/cards\/[^/]+$/, {});
    const rep = validated([erp({ name: "ERP Core v2", attr_costTotalAnnual: "300000" })]);

    const result = await executeImport(rep);

    expect(result).toMatchObject({ created: 0, updated: 1, failed: 0 });
    expect(mockApi.callsOf("patch")).toEqual([
      {
        method: "patch",
        path: `/cards/${CARD_IDS.erp}`,
        body: {
          name: "ERP Core v2",
          attributes: { ...ERP.attributes, costTotalAnnual: 300000 },
        },
      },
    ]);
    expect(mockApi.callsOf("post")).toEqual([]);
  });

  it("syncs tags as adds and removes, without a PATCH when only tags changed", async () => {
    mockApi.on("post", /^\/cards\/[^/]+\/tags$/, {});
    mockApi.on("delete", /^\/cards\/[^/]+\/tags\/[^/]+$/, {});
    const rep = validated([erp({ tags: "Hosting: Cloud" })]);

    const result = await executeImport(rep);

    expect(result.updated).toBe(1);
    expect(mockApi.callsOf("patch")).toEqual([]);
    expect(mockApi.callsOf("post")).toEqual([
      { method: "post", path: `/cards/${CARD_IDS.erp}/tags`, body: [CLOUD_TAG] },
    ]);
    expect(mockApi.callsOf("delete")).toEqual([
      { method: "delete", path: `/cards/${CARD_IDS.erp}/tags/${ON_PREM_TAG}`, body: undefined },
    ]);
  });

  it("does not count a row that needed no call", async () => {
    const noop: ParsedRow = {
      rowIndex: 2,
      type: "Application",
      id: CARD_IDS.erp,
      existing: ERP,
      data: { type: "Application", name: "ERP Core" },
      tagIds: [ON_PREM_TAG],
    };

    const result = await executeImport(report({ updates: [noop] }));

    expect(result.updated).toBe(0);
    expect(mockApi.calls).toEqual([]);
  });

  it("counts a failed PATCH against the row", async () => {
    mockApi.fail("patch", /^\/cards\/[^/]+$/, 500);
    const rep = validated([erp({ name: "ERP Core v2" })]);

    const result = await executeImport(rep);

    expect(result).toMatchObject({
      updated: 0,
      failed: 1,
      failedDetails: [{ row: 2, message: `PATCH /cards/${CARD_IDS.erp} failed` }],
    });
  });

  it("leaves stakeholder sync to the multi-sheet executor", async () => {
    mockApi.on("patch", /^\/cards\/[^/]+$/, {});
    const rep = validated([erp({ name: "ERP Core v2", "stakeholder:applicationOwner": "admin@test.local" })]);

    const result = await executeImport(rep);

    expect(result).toMatchObject({ stakeholdersAdded: 0, stakeholdersRemoved: 0, stakeholdersFailed: 0 });
    expect(mockApi.callsOf("post")).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- */
/*  Relation operations                                                        */
/* ------------------------------------------------------------------------- */

describe("executeImport — relation operations", () => {
  const bulk = (status: string, error?: string) =>
    mockApi.on("post", "/relations/bulk", { results: [{ status, error }] });

  it("sends one bulk operation per op, materialising path keys into name + parent_path", async () => {
    bulk("upserted");
    const op = relationOp({
      targetRef: { kind: "pathKey", pathKey: "BusinessCapability|finance/payments", type: "BusinessCapability" },
      attributes: { weight: 2 },
      description: "d",
    });

    const result = await executeImport(report({ relationOps: [op] }));

    expect(result.relationsUpserted).toBe(1);
    expect(mockApi.callsOf("post", "/relations/bulk")).toEqual([
      {
        method: "post",
        path: "/relations/bulk",
        body: {
          operations: [
            {
              row_index: 5,
              action: "upsert",
              type: "relAppToBC",
              source: { id: CARD_IDS.erp },
              target: { type: "BusinessCapability", name: "payments", parent_path: ["finance"] },
              attributes: { weight: 2 },
              description: "d",
            },
          ],
        },
      },
    ]);
  });

  it.each([
    ["a root path key", "BusinessCapability|finance", { type: "BusinessCapability", name: "finance", parent_path: [] }],
    ["a path key without segments", "BusinessCapability", { type: "BusinessCapability" }],
  ])("materialises %s", async (_what, pathKey, expected) => {
    bulk("upserted");
    const op = relationOp({ targetRef: { kind: "pathKey", pathKey, type: "BusinessCapability" } });

    await executeImport(report({ relationOps: [op] }));

    const body = mockApi.callsOf("post", "/relations/bulk")[0].body as { operations: { target: unknown }[] };
    expect(body.operations[0].target).toEqual(expected);
  });

  it.each([
    ["upserted", { relationsUpserted: 1, relationsDeleted: 0, relationsFailed: 0 }],
    ["deleted", { relationsUpserted: 0, relationsDeleted: 1, relationsFailed: 0 }],
    ["noop", { relationsUpserted: 0, relationsDeleted: 0, relationsFailed: 0 }],
  ])("counts a %s result", async (status, expected) => {
    bulk(status);
    const result = await executeImport(report({ relationOps: [relationOp({ action: status === "deleted" ? "delete" : "upsert" })] }));
    expect(result).toMatchObject({ ...expected, failedDetails: [] });
  });

  it("reports a failed result with its error, or as unknown without one", async () => {
    bulk("failed", "no such target");
    const withError = await executeImport(report({ relationOps: [relationOp()] }));
    expect(withError).toMatchObject({ relationsFailed: 1, failedDetails: [{ row: 5, message: "no such target" }] });

    mockApi.reset();
    bulk("failed");
    const without = await executeImport(report({ relationOps: [relationOp({ rowIndex: 9 })] }));
    expect(without.failedDetails).toEqual([{ row: 9, message: unknownMessage() }]);
  });

  it("counts a rejected bulk call as a failed op", async () => {
    mockApi.fail("post", "/relations/bulk", 500);

    const result = await executeImport(report({ relationOps: [relationOp()] }));

    expect(result).toMatchObject({
      relationsFailed: 1,
      failedDetails: [{ row: 5, message: "POST /relations/bulk failed" }],
    });
  });
});

/* ------------------------------------------------------------------------- */
/*  Progress                                                                   */
/* ------------------------------------------------------------------------- */

describe("executeImport — progress", () => {
  it("reports one step per create, update and relation op, failures included", async () => {
    scriptCreates((body) => (body.name === "Bad" ? new Error("nope") : undefined));
    mockApi.on("patch", /^\/cards\/[^/]+$/, {});
    mockApi.on("post", "/relations/bulk", { results: [{ status: "upserted" }] });
    const rep = validated([bc({ name: "Good" }), bc({ name: "Bad" }), erp({ name: "ERP Core v2" })]);
    rep.relationOps.push(relationOp());
    const onProgress = vi.fn();

    const result = await executeImport(rep, onProgress);

    expect(onProgress.mock.calls).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(result).toMatchObject({ created: 1, failed: 1, updated: 1, relationsUpserted: 1 });
  });

  it("works without a progress callback and returns the full result shape", async () => {
    const result = await executeImport(report());
    expect(result).toEqual({
      created: 0,
      updated: 0,
      failed: 0,
      relationsUpserted: 0,
      relationsDeleted: 0,
      relationsFailed: 0,
      stakeholdersAdded: 0,
      stakeholdersRemoved: 0,
      stakeholdersFailed: 0,
      failedDetails: [],
    });
  });
});

/* ------------------------------------------------------------------------- */
/*  Exported helpers                                                           */
/* ------------------------------------------------------------------------- */

describe("legacyRoleKeyToCamel", () => {
  it.each([
    ["technical_application_owner", "technicalApplicationOwner"],
    ["business_owner", "businessOwner"],
    ["owner", ""],
    ["", ""],
    ["_", ""],
    ["a__b", "aB"],
    ["_leading", "leading"],
  ])("%s → %s", (input, expected) => {
    expect(legacyRoleKeyToCamel(input)).toBe(expected);
  });
});

describe("parseStakeholderEntry", () => {
  it.each([
    ["ada@corp.com", { email: "ada@corp.com" }],
    ["  ada@corp.com  ", { email: "ada@corp.com" }],
    ["Ada Lovelace <ada@corp.com>", { email: "ada@corp.com" }],
    ["Ada Lovelace < ada@corp.com > ", { email: "ada@corp.com" }],
    ["<ada@corp.com>", { email: "ada@corp.com" }],
    ["Ada Lovelace", {}],
    ["Ada Lovelace <>", {}],
    ["ada @corp.com", {}],
    ["", {}],
  ])("%s", (input, expected) => {
    expect(parseStakeholderEntry(input)).toEqual(expected);
  });
});
