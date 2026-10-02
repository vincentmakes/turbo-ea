/**
 * Direct, table-driven tests of `validateImport()` — the pure, synchronous
 * per-sheet validator that `validateMultiSheet()` wraps. The sibling
 * `excel*.test.ts` files only ever reach it through the multi-sheet wrapper and
 * a real workbook; here the rows are plain objects so every rule is pinned on
 * its own, against the kit's fixed metamodel (`@/test/fixtures/metamodel`).
 *
 * Every expected message is computed through the real i18n instance
 * (`setup.ts` loads it in `en`), never hardcoded — the `err()` / `warn()`
 * helpers below mirror the module's own `t()`.
 *
 * A few tests are titled "documents current behaviour": they pin what the
 * code does today where that looks unintended, so a fix flips an assertion
 * rather than silently changing a rule. They are listed in the report that
 * accompanied these tests:
 *   (a) an upper-case UUID in `id` is not matched to the (lowercase) existing
 *       id, so the row is demoted to a create;
 *   (b) a valid `approval_status` is validated but never written into the
 *       row's data, so it can never reach the patch;
 *   (c) an invalid lifecycle date raises an error, yet the row still lands in
 *       `creates` (every other field error drops the row);
 *   (d) the `parent_path` self-reference guard compares keys of different
 *       depth, so a row naming itself as its parent is never caught;
 *   (e) a same-file row referenced by legacy `parent_id` keeps that id on the
 *       child while the parent's own file id is dropped, so the executor can
 *       never remap it (see `excelImport.execute.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { fieldLabel } from "@/hooks/useResolveLabel";
import i18n from "@/i18n";
import {
  APPLICATION_TYPE,
  CARD_IDS,
  CARD_TYPES,
  CARDS,
  CRITICALITY_OPTIONS,
  HOSTING_GROUP,
  MEMBER_USER,
  RISK_GROUP,
  STAKEHOLDER_ROLES_BY_TYPE,
  TAG_GROUPS,
  USERS,
  cardById,
  makeCard,
  makeCardType,
  makeField,
  makeSection,
  makeTag,
  makeTagGroup,
} from "@/test/fixtures/metamodel";
import type { CalculatedFieldsMap, Card, CardType, TagGroup } from "@/types";

import {
  type ImportReport,
  type StakeholderRolesByType,
  type UserRef,
  type ValidateImportOptions,
  validateImport,
} from "./excelImport";

/* ------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* ------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

const err = (key: string, vars?: Record<string, unknown>): string =>
  i18n.t(`inventory:import.errors.${key}`, vars);
const warn = (key: string, vars?: Record<string, unknown>): string =>
  i18n.t(`inventory:import.warnings.${key}`, vars);

/** The label the validator prints for a field: `fieldLabel()` over the fixture's own def. */
function label(typeKey: string, fieldKey: string): string {
  const type = CARD_TYPES.find((t) => t.key === typeKey);
  const field = type?.fields_schema.flatMap((s) => s.fields).find((f) => f.key === fieldKey);
  if (!field) throw new Error(`no fixture field ${typeKey}.${fieldKey}`);
  return fieldLabel(field, i18n.language);
}

const CLOUD_TAG = HOSTING_GROUP.tags[1].id;
const ON_PREM_TAG = HOSTING_GROUP.tags[0].id;
const HOSTING_CRITICAL_TAG = HOSTING_GROUP.tags[2].id;
const AUDITED_TAG = RISK_GROUP.tags[1].id;
const ERP = cardById(CARD_IDS.erp);
const ADMIN_EMAIL = "admin@test.local";
const MEMBER_EMAIL = "member@test.local";
const UNKNOWN_ID = "11111111-2222-4333-8444-555555555555";

/** A valid Application create row; `businessCriticality` is required, so it is supplied. */
const app = (over: Row = {}): Row => ({
  type: "Application",
  name: "New App",
  attr_businessCriticality: "businessOperational",
  ...over,
});
/** A valid BusinessCapability create row (no required fields on the type). */
const bc = (over: Row = {}): Row => ({ type: "BusinessCapability", name: "Payments", ...over });
/** An update row for the ERP fixture card (nothing changed unless overridden). */
const erp = (over: Row = {}): Row => ({
  id: CARD_IDS.erp,
  type: "Application",
  name: "ERP Core",
  ...over,
});

interface RunOptions {
  existing?: Card[];
  types?: CardType[];
  preSelectedType?: string;
  tagGroups?: TagGroup[];
  calculated?: CalculatedFieldsMap;
  users?: UserRef[];
  roles?: StakeholderRolesByType;
  opts?: ValidateImportOptions;
}

function run(rows: Row[], o: RunOptions = {}): ImportReport {
  return validateImport(
    rows,
    o.existing ?? CARDS,
    o.types ?? CARD_TYPES,
    o.preSelectedType,
    o.tagGroups ?? TAG_GROUPS,
    o.calculated ?? {},
    o.users ?? USERS,
    o.roles ?? STAKEHOLDER_ROLES_BY_TYPE,
    o.opts ?? {},
  );
}

/** The report of a single valid row that must produce exactly one create. */
function oneCreate(row: Row, o: RunOptions = {}) {
  const r = run([row], o);
  expect(r.errors).toEqual([]);
  expect(r.creates).toHaveLength(1);
  return r;
}

/* ------------------------------------------------------------------------- */
/*  i18n sanity                                                                */
/* ------------------------------------------------------------------------- */

describe("i18n keys used by these tests", () => {
  it("resolve to real messages, so the comparisons below are not vacuous", () => {
    expect(err("noDataRows")).not.toBe("inventory:import.errors.noDataRows");
    expect(err("noDataRows")).not.toBe("import.errors.noDataRows");
    expect(err("nameRequired", { row: 7 })).toContain("7");
    expect(warn("unknownTag", { row: 3, value: "x" })).toContain("x");
  });
});

/* ------------------------------------------------------------------------- */
/*  Structure                                                                  */
/* ------------------------------------------------------------------------- */

describe("validateImport — structure", () => {
  it("rejects an empty sheet", () => {
    const r = run([]);
    expect(r.errors).toEqual([{ row: 0, message: err("noDataRows") }]);
    expect(r).toMatchObject({ totalRows: 0, creates: [], updates: [], skipped: 0, relationOps: [] });
  });

  it("requires a name column", () => {
    const r = run([{ type: "Application", description: "x" }]);
    expect(r.errors).toEqual([
      { row: 0, column: "name", message: err("missingColumn", { column: "name" }) },
    ]);
    expect(r.totalRows).toBe(1);
    expect(r.creates).toEqual([]);
  });

  it("requires a type column unless a type is pre-selected", () => {
    const rows = [{ name: "New Cap" }];
    expect(run(rows).errors).toEqual([
      { row: 0, column: "type", message: err("missingTypeColumn") },
    ]);
    const r = run(rows, { preSelectedType: "BusinessCapability" });
    expect(r.errors).toEqual([]);
    expect(r.creates[0]).toMatchObject({ type: "BusinessCapability", data: { type: "BusinessCapability" } });
  });

  it("reports both structural errors at once and stops there", () => {
    const r = run([{ description: "x" }]);
    expect(r.errors.map((e) => e.column)).toEqual(["name", "type"]);
    expect(r.warnings).toEqual([]);
  });

  it("lets a filled type cell override the pre-selected type, and an empty one fall back", () => {
    const r = run(
      [
        { type: "Application", name: "A", attr_businessCriticality: "businessOperational" },
        { type: "", name: "B" },
      ],
      { preSelectedType: "BusinessCapability" },
    );
    expect(r.errors).toEqual([]);
    expect(r.creates.map((c) => c.type)).toEqual(["Application", "BusinessCapability"]);
  });

  it.each([
    ["foo", true],
    ["Name", false],
    ["TYPE", false],
    ["attr_notAField", false],
    ["attr_version", false],
    ["rel:relAppToITC", false],
    ["stakeholder:capabilityOwner", false],
    ["lifecycle_active", false],
    ["parent_label", false],
  ])("column %s → unrecognised warning: %s", (column, warned) => {
    const r = run([bc({ [column]: "" })]);
    const expected = { column, message: warn("unrecognisedColumn", { column }) };
    const found = r.warnings.filter((w) => w.column === column);
    expect(found).toEqual(warned ? [expected] : []);
    if (warned) expect(found[0]).not.toHaveProperty("row");
  });
});

/* ------------------------------------------------------------------------- */
/*  Rows                                                                       */
/* ------------------------------------------------------------------------- */

describe("validateImport — rows", () => {
  it("skips a fully blank row and still counts it in totalRows", () => {
    const r = run([{ type: "", name: "", description: "  " }, bc()]);
    expect(r.errors).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(r.totalRows).toBe(2);
    expect(r.creates).toHaveLength(1);
  });

  it("requires a name on a non-blank row (row numbers start at 2)", () => {
    const r = run([{ type: "Application", name: "" }]);
    expect(r.errors).toEqual([
      { row: 2, column: "name", message: err("nameRequired", { row: 2 }) },
    ]);
  });

  it.each([
    ["an unknown type", "Nope"],
    ["a hidden type", "Secret"],
    ["an empty type", ""],
  ])("rejects %s", (_what, type) => {
    const r = run([{ type, name: "X" }]);
    expect(r.errors).toEqual([
      { row: 2, column: "type", message: err("unknownType", { row: 2, type }) },
    ]);
    expect(r.creates).toEqual([]);
  });

  it("rejects an id that is not a UUID", () => {
    const r = run([bc({ id: "not-a-uuid" })]);
    expect(r.errors).toEqual([
      { row: 2, column: "id", message: err("invalidId", { row: 2, id: "not-a-uuid" }) },
    ]);
  });

  it("rejects a duplicated existing id, naming the first row", () => {
    const r = run([erp(), erp({ name: "ERP Core (again)" })]);
    expect(r.errors).toEqual([
      {
        row: 3,
        column: "id",
        message: err("duplicateId", { row: 3, id: CARD_IDS.erp, prevRow: 2 }),
      },
    ]);
  });

  it("warns and creates when the id is unknown here, dropping the file id", () => {
    const r = run([bc({ id: UNKNOWN_ID })]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      { row: 2, column: "id", message: warn("idNotFoundCreating", { row: 2, id: UNKNOWN_ID }) },
    ]);
    expect(r.creates).toHaveLength(1);
    expect(r.creates[0].id).toBeUndefined();
    expect(r.creates[0].existing).toBeUndefined();
  });

  it("documents current behaviour: two rows sharing an unknown id both create, with no duplicate error", () => {
    const r = run([bc({ id: UNKNOWN_ID, name: "A" }), bc({ id: UNKNOWN_ID, name: "B" })]);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.row)).toEqual([2, 3]);
    expect(r.creates).toHaveLength(2);
  });

  it("rejects an update whose type differs from the existing card's", () => {
    const r = run([{ id: CARD_IDS.erp, type: "ITComponent", name: "ERP Core" }]);
    expect(r.errors).toEqual([
      {
        row: 2,
        column: "type",
        message: err("typeMismatch", {
          row: 2,
          fileType: "ITComponent",
          existingType: "Application",
        }),
      },
    ]);
  });

  it("matches an upper-case id to the existing card: a UUID is case-insensitive", () => {
    // A workbook edited in a tool that upper-cases UUIDs used to report every
    // card as unknown and create a duplicate of each.
    const r = run([
      erp({ id: CARD_IDS.erp.toUpperCase(), name: "ERP Core renamed", attr_businessCriticality: "missionCritical" }),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.creates).toEqual([]);
    expect(r.updates).toHaveLength(1);
    expect(r.updates[0].id).toBe(CARD_IDS.erp);
    expect(r.updates[0].changes).toMatchObject({ name: { old: "ERP Core", new: "ERP Core renamed" } });
  });

  it("rejects a second row carrying the same id in another case as a duplicate", () => {
    const r = run([erp({ id: CARD_IDS.erp }), erp({ id: CARD_IDS.erp.toUpperCase(), name: "ERP Core 2" })]);
    expect(r.errors).toEqual([
      { row: 3, column: "id", message: err("duplicateId", { row: 3, id: CARD_IDS.erp.toUpperCase(), prevRow: 2 }) },
    ]);
  });

  describe("approval_status", () => {
    it("rejects an unknown status, upper-cased in the message", () => {
      const r = run([bc({ approval_status: "bogus" })]);
      expect(r.errors).toEqual([
        {
          row: 2,
          column: "approval_status",
          message: err("invalidApprovalStatus", { row: 2, status: "BOGUS" }),
        },
      ]);
      expect(r.creates).toEqual([]);
    });

    it.each(["approved", "DRAFT", "Broken", "rejected"])("accepts %s in any case", (status) => {
      oneCreate(bc({ approval_status: status }));
    });

    it("documents current behaviour (b): a valid status never reaches the row data or the patch", () => {
      const create = oneCreate(bc({ approval_status: "APPROVED" }));
      expect(create.creates[0].data).not.toHaveProperty("approval_status");

      // ERP is APPROVED; asking for REJECTED with nothing else changed is a no-op.
      const update = run([erp({ approval_status: "REJECTED" })]);
      expect(update.errors).toEqual([]);
      expect(update.updates).toEqual([]);
      expect(update.skipped).toBe(1);
    });
  });

  describe("lifecycle dates", () => {
    it("collects valid phases into data.lifecycle, converting a Date cell", () => {
      const r = oneCreate(
        bc({
          lifecycle_plan: "2024-01-01",
          lifecycle_active: new Date(2024, 5, 15),
          lifecycle_endOfLife: "",
        }),
      );
      expect(r.creates[0].data.lifecycle).toEqual({ plan: "2024-01-01", active: "2024-06-15" });
    });

    it("leaves data.lifecycle unset when no phase is given", () => {
      expect(oneCreate(bc()).creates[0].data).not.toHaveProperty("lifecycle");
    });

    it("drops a row with an invalid date from the creates, like a row with an invalid attribute", () => {
      const r = run([bc({ lifecycle_active: "15/06/2024", lifecycle_plan: "2024-01-01" })]);
      expect(r.errors).toEqual([
        {
          row: 2,
          column: "lifecycle_active",
          message: err("invalidDate", { row: 2, field: "lifecycle_active", value: "15/06/2024" }),
        },
      ]);
      expect(r.creates).toEqual([]);
      expect(r.updates).toEqual([]);
    });
  });

  describe("parent_path", () => {
    it("resolves to an existing card's id and records every path key", () => {
      const r = oneCreate(bc({ parent_path: "Finance" }));
      const row = r.creates[0];
      expect(row.data.parent_id).toBe(CARD_IDS.finance);
      expect(row.parentId).toBe(CARD_IDS.finance);
      expect(row.parentPath).toEqual(["Finance"]);
      expect(row.parentPathKey).toBe("BusinessCapability|finance");
      expect(row.ownPathKey).toBe("BusinessCapability|finance/payments");
    });

    it("sets ownPathKey from the name alone for a root row", () => {
      expect(oneCreate(bc()).creates[0]).toMatchObject({
        ownPathKey: "BusinessCapability|payments",
        parentPath: undefined,
        parentPathKey: undefined,
      });
    });

    it("needs the full ancestry of a nested card: a bare name fails, the path resolves", () => {
      const bare = run([bc({ parent_path: "Billing" })]);
      expect(bare.errors).toEqual([
        {
          row: 2,
          column: "parent_path",
          message: err("invalidParentPath", { row: 2, path: "Billing" }),
        },
      ]);
      const full = oneCreate(bc({ parent_path: "Finance / Billing" }));
      expect(full.creates[0].data.parent_id).toBe(CARD_IDS.billingUnderFinance);
      expect(full.creates[0].parentPath).toEqual(["Finance", "Billing"]);
    });

    it("warns and takes the first match when two existing cards share the path", () => {
      const first = makeCard({ type: "BusinessCapability", name: "Ops" });
      const second = makeCard({ type: "BusinessCapability", name: "Ops" });
      const r = run([bc({ parent_path: "Ops" })], { existing: [first, second] });
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([
        {
          row: 2,
          column: "parent_path",
          message: warn("ambiguousParentPath", { row: 2, path: "Ops" }),
        },
      ]);
      expect(r.creates[0].data.parent_id).toBe(first.id);
    });

    it("accepts a forward reference to a later row and clears a stale parent_id", () => {
      const r = run([
        bc({ name: "Child", parent_path: "New Root", parent_id: CARD_IDS.sales }),
        bc({ name: "New Root" }),
      ]);
      expect(r.errors).toEqual([]);
      expect(r.creates[0]).toMatchObject({
        parentPathKey: "BusinessCapability|new root",
        parentId: undefined,
      });
      expect(r.creates[0].data).not.toHaveProperty("parent_id");
      expect(r.creates[1].ownPathKey).toBe("BusinessCapability|new root");
    });

    it("reads an escaped slash as part of a segment, so the keys of both rows agree", () => {
      const r = run([bc({ name: "Child", parent_path: "A\\/B" }), bc({ name: "A/B" })]);
      expect(r.errors).toEqual([]);
      expect(r.creates[0].parentPath).toEqual(["A/B"]);
      expect(r.creates[0].parentPathKey).toBe("BusinessCapability|a/b");
      expect(r.creates[1].ownPathKey).toBe("BusinessCapability|a/b");
    });

    it("errors on a path nothing resolves, dropping the row", () => {
      const r = run([bc({ parent_path: "Nowhere / At All" })]);
      expect(r.errors).toEqual([
        {
          row: 2,
          column: "parent_path",
          message: err("invalidParentPath", { row: 2, path: "Nowhere / At All" }),
        },
      ]);
      expect(r.creates).toEqual([]);
    });

    it("treats a path with no segments as absent", () => {
      const r = oneCreate(bc({ parent_path: " / " }));
      expect(r.creates[0].parentPath).toBeUndefined();
      expect(r.creates[0].data).not.toHaveProperty("parent_id");
    });

    it("prefers parent_path over parent_id when both are given", () => {
      const r = oneCreate(bc({ parent_path: "Finance", parent_id: CARD_IDS.sales }));
      expect(r.creates[0].data.parent_id).toBe(CARD_IDS.finance);
    });

    it("rejects a row whose parent path resolves to its own card", () => {
      // Used to compare `type|finance` with `type|finance/finance` — never
      // equal — so the row went through as an update making the card its own parent.
      const r = run([{ id: CARD_IDS.finance, type: "BusinessCapability", name: "Finance", parent_path: "Finance" }]);
      expect(r.errors).toEqual([
        { row: 2, column: "parent_path", message: err("parentSelfReference", { row: 2 }) },
      ]);
      expect(r.updates).toEqual([]);
      expect(r.creates).toEqual([]);
    });

    it("still lets a card named like its parent sit under it", () => {
      // "Finance / Finance" is a legitimate path: only the very same card is a self-reference.
      const r = run([{ type: "BusinessCapability", name: "Finance", parent_path: "Finance" }]);
      expect(r.errors).toEqual([]);
      expect(r.creates).toHaveLength(1);
      expect(r.creates[0].data.parent_id).toBe(CARD_IDS.finance);
    });
  });

  describe("legacy parent_id", () => {
    it("accepts an existing card", () => {
      const r = oneCreate(bc({ parent_id: CARD_IDS.finance }));
      expect(r.creates[0]).toMatchObject({ parentId: CARD_IDS.finance, data: { parent_id: CARD_IDS.finance } });
    });

    it("documents current behaviour (e): a same-file row's id is accepted but kept verbatim on the child", () => {
      const r = run([bc({ id: UNKNOWN_ID, name: "P" }), bc({ name: "C", parent_id: UNKNOWN_ID })]);
      expect(r.errors).toEqual([]);
      // The parent's file id was dropped (unknown here) …
      expect(r.creates[0].id).toBeUndefined();
      // … while the child still carries it, so nothing can remap it at apply time.
      expect(r.creates[1]).toMatchObject({ parentId: UNKNOWN_ID, data: { parent_id: UNKNOWN_ID } });
    });

    it("rejects a malformed parent_id", () => {
      const r = run([bc({ parent_id: "xyz" })]);
      expect(r.errors).toEqual([
        { row: 2, column: "parent_id", message: err("invalidParentId", { row: 2, parentId: "xyz" }) },
      ]);
    });

    it("rejects a parent_id that is neither an existing card nor a file row", () => {
      const r = run([bc({ parent_id: UNKNOWN_ID })]);
      expect(r.errors).toEqual([
        { row: 2, column: "parent_id", message: err("parentNotFound", { row: 2, parentId: UNKNOWN_ID }) },
      ]);
    });

    it("rejects a card as its own parent", () => {
      const r = run([{ id: CARD_IDS.finance, type: "BusinessCapability", name: "Finance", parent_id: CARD_IDS.finance }]);
      expect(r.errors).toEqual([
        { row: 2, column: "parent_id", message: err("parentSelfReference", { row: 2 }) },
      ]);
    });
  });
});

/* ------------------------------------------------------------------------- */
/*  Attributes                                                                 */
/* ------------------------------------------------------------------------- */

describe("validateImport — attributes", () => {
  const attrError = (field: string, key: string, vars: Record<string, unknown>) => ({
    row: 2,
    column: `attr_${field}`,
    message: err(key, { row: 2, field: label("Application", field), ...vars }),
  });

  it("leaves data.attributes unset when no attribute column is filled", () => {
    expect(oneCreate(bc()).creates[0].data).not.toHaveProperty("attributes");
  });

  describe("percentage", () => {
    it.each([
      ["42.5", 42.5],
      ["0", 0],
      ["100", 100],
      [75, 75],
    ])("accepts %s", (cell, expected) => {
      const r = oneCreate(app({ attr_coverage: cell }));
      expect(r.creates[0].data.attributes).toMatchObject({ coverage: expected });
    });

    it.each(["150", "-1", "abc"])("rejects %s and drops the row", (cell) => {
      const r = run([app({ attr_coverage: cell })]);
      expect(r.errors).toEqual([attrError("coverage", "expectsPercentage", { value: cell })]);
      expect(r.creates).toEqual([]);
    });
  });

  describe("cost and number", () => {
    it.each([
      ["250000", 250000],
      [1234.5, 1234.5],
      ["-3", -3],
    ])("parses %s", (cell, expected) => {
      const r = oneCreate(app({ attr_costTotalAnnual: cell }));
      expect(r.creates[0].data.attributes).toMatchObject({ costTotalAnnual: expected });
    });

    it("rejects a thousands separator", () => {
      const r = run([app({ attr_costTotalAnnual: "1,000" })]);
      expect(r.errors).toEqual([attrError("costTotalAnnual", "expectsNumber", { value: "1,000" })]);
    });

    it("parses a plain number field the same way", () => {
      const r = oneCreate(bc({ attr_maturity: "3" }));
      expect(r.creates[0].data.attributes).toEqual({ maturity: 3 });
    });
  });

  describe("boolean", () => {
    it.each(["true", "Yes", "1", "TRUE"])("reads %s as true", (cell) => {
      expect(oneCreate(app({ attr_isCloud: cell })).creates[0].data.attributes).toMatchObject({ isCloud: true });
    });

    it.each(["false", "No", "0", "FALSE"])("reads %s as false", (cell) => {
      expect(oneCreate(app({ attr_isCloud: cell })).creates[0].data.attributes).toMatchObject({ isCloud: false });
    });

    it("reads a native boolean cell", () => {
      expect(oneCreate(app({ attr_isCloud: true })).creates[0].data.attributes).toMatchObject({ isCloud: true });
    });

    it("rejects any other spelling", () => {
      const r = run([app({ attr_isCloud: "maybe" })]);
      expect(r.errors).toEqual([attrError("isCloud", "expectsBoolean", { value: "maybe" })]);
    });
  });

  describe("date", () => {
    it("accepts YYYY-MM-DD and a Date cell", () => {
      expect(oneCreate(app({ attr_goLiveDate: "2024-01-15" })).creates[0].data.attributes).toMatchObject({
        goLiveDate: "2024-01-15",
      });
      expect(oneCreate(app({ attr_goLiveDate: new Date(2024, 0, 15) })).creates[0].data.attributes).toMatchObject({
        goLiveDate: "2024-01-15",
      });
    });

    it.each(["15/01/2024", "2024-1-5", "Invalid Date"])("rejects %s", (cell) => {
      const r = run([app({ attr_goLiveDate: cell })]);
      expect(r.errors).toEqual([attrError("goLiveDate", "invalidDate", { value: cell })]);
    });
  });

  describe("single_select", () => {
    const valid = CRITICALITY_OPTIONS.map((o) => o.key).join(", ");

    it("accepts an option key", () => {
      expect(oneCreate(app({ attr_businessCriticality: "missionCritical" })).creates[0].data.attributes).toEqual({
        businessCriticality: "missionCritical",
      });
    });

    it("rejects an option label — only keys are accepted — listing the valid keys", () => {
      const r = run([app({ attr_businessCriticality: "Mission Critical" })]);
      expect(r.errors).toEqual([
        attrError("businessCriticality", "invalidSelectValue", { value: "Mission Critical", valid }),
      ]);
      expect(r.creates).toEqual([]);
    });

    it("accepts any value on a select with no options", () => {
      const free = makeCardType({
        key: "Free",
        fields_schema: [
          makeSection({
            fields: [
              makeField({ key: "pick", type: "single_select" }),
              makeField({ key: "picks", type: "multiple_select" }),
            ],
          }),
        ],
      });
      const r = oneCreate(
        { type: "Free", name: "X", attr_pick: "anything", attr_picks: "a, b" },
        { types: [...CARD_TYPES, free] },
      );
      expect(r.creates[0].data.attributes).toEqual({ pick: "anything", picks: ["a", "b"] });
    });
  });

  describe("multiple_select", () => {
    it("splits on commas and trims", () => {
      expect(oneCreate(app({ attr_regions: " emea ,apac " })).creates[0].data.attributes).toMatchObject({
        regions: ["emea", "apac"],
      });
    });

    it("rejects an unknown part and keeps the attribute off the row", () => {
      const valid = ["emea", "amer", "apac"].join(", ");
      const r = run([app({ attr_regions: "emea, nope" })]);
      expect(r.errors).toEqual([attrError("regions", "invalidSelectValue", { value: "nope", valid })]);
      expect(r.creates).toEqual([]);
    });

    it("documents current behaviour: the separator is a comma, not the list cell's semicolon", () => {
      const r = run([app({ attr_regions: "emea; apac" })]);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].message).toBe(
        err("invalidSelectValue", {
          row: 2,
          value: "emea; apac",
          field: label("Application", "regions"),
          valid: "emea, amer, apac",
        }),
      );
    });
  });

  it("stores text, multiline text and url values as given", () => {
    const r = oneCreate(
      app({ attr_docsUrl: "https://docs.example", attr_notes: "line one\nline two", attr_alias: "ERP" }),
    );
    expect(r.creates[0].data.attributes).toMatchObject({
      docsUrl: "https://docs.example",
      notes: "line one\nline two",
      alias: "ERP",
    });
  });

  describe("required fields", () => {
    const required = {
      row: 2,
      column: "attr_businessCriticality",
      message: err("requiredFieldEmpty", { row: 2, field: label("Application", "businessCriticality") }),
    };

    it.each([
      ["absent", {}],
      ["empty", { attr_businessCriticality: "" }],
    ])("warns (never errors) on a create whose required field is %s", (_how, cell) => {
      const r = run([{ type: "Application", name: "New App", ...cell }]);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([required]);
      expect(r.creates).toHaveLength(1);
    });

    it("stays quiet on an update, where the existing value is kept", () => {
      const r = run([erp({ attr_businessCriticality: "", name: "ERP Core renamed" })]);
      expect(r.warnings).toEqual([]);
      expect(r.updates).toHaveLength(1);
    });
  });

  describe("read-only and calculated fields", () => {
    const ignored = (field: string) => ({
      row: 2,
      column: `attr_${field}`,
      message: warn("readOnlyFieldIgnored", { row: 2, field: label("Application", field) }),
    });

    it("warns on a create that supplies a read-only value, and never stores it", () => {
      const r = oneCreate(app({ attr_vendorScore: "5" }));
      expect(r.warnings).toEqual([ignored("vendorScore")]);
      expect(r.creates[0].data.attributes).not.toHaveProperty("vendorScore");
    });

    it("stays quiet on a round-trip of the existing read-only value", () => {
      const r = run([erp({ attr_vendorScore: "4.2" })]);
      expect(r.warnings).toEqual([]);
      expect(r.skipped).toBe(1);
    });

    it("warns only when the read-only value differs, and the row is otherwise unchanged", () => {
      const r = run([erp({ attr_vendorScore: "5" })]);
      expect(r.warnings).toEqual([ignored("vendorScore")]);
      expect(r.updates).toEqual([]);
      expect(r.skipped).toBe(1);
    });

    it("treats a calculated field the same way, joining an array value for the comparison", () => {
      const calculated: CalculatedFieldsMap = { Application: ["coverage", "regions"] };
      const same = run([erp({ attr_coverage: "75", attr_regions: "emea, amer" })], { calculated });
      expect(same.warnings).toEqual([]);
      const differs = run([erp({ attr_coverage: "80", attr_regions: "apac" })], { calculated });
      expect(differs.warnings).toEqual([ignored("coverage"), ignored("regions")]);
      expect(differs.updates).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------------- */
/*  Tags                                                                       */
/* ------------------------------------------------------------------------- */

describe("validateImport — tags", () => {
  const tagIdsOf = (tags: string, o: RunOptions = {}) => {
    const r = run([bc({ tags })], o);
    expect(r.errors).toEqual([]);
    return { ids: r.creates[0].tagIds, warnings: r.warnings };
  };
  const unknown = (value: string) => ({ row: 2, column: "tags", message: warn("unknownTag", { row: 2, value }) });

  it("leaves tagIds undefined when the column is absent or empty", () => {
    expect(oneCreate(bc()).creates[0].tagIds).toBeUndefined();
    expect(oneCreate(bc({ tags: "  " })).creates[0].tagIds).toBeUndefined();
  });

  it("reads a capitalised Tags header too", () => {
    expect(oneCreate(bc({ Tags: "Hosting: Cloud" })).creates[0].tagIds).toEqual([CLOUD_TAG]);
  });

  it.each([
    ["Hosting: Cloud", [CLOUD_TAG]],
    ["hosting:cloud", [CLOUD_TAG]],
    ["Audited", [AUDITED_TAG]],
    ["Hosting: Critical", [HOSTING_CRITICAL_TAG]],
    ["Hosting: Cloud; Cloud; Risk: Audited", [CLOUD_TAG, AUDITED_TAG]],
  ])("resolves %s", (cell, expected) => {
    const { ids, warnings } = tagIdsOf(cell);
    expect(ids).toEqual(expected);
    expect(warnings).toEqual([]);
  });

  it("warns on a bare name shared by two groups, and on an unknown name — the rest still resolve", () => {
    const { ids, warnings } = tagIdsOf("Critical; Nope; Audited");
    expect(ids).toEqual([AUDITED_TAG]);
    expect(warnings).toEqual([unknown("Critical"), unknown("Nope")]);
  });

  it("warns on a group-qualified tag the group does not hold", () => {
    const { ids, warnings } = tagIdsOf("Risk: Cloud");
    expect(ids).toEqual([]);
    expect(warnings).toEqual([unknown("Risk: Cloud")]);
  });

  describe("separator by workbook format", () => {
    const comma = "Risk: Audited, Hosting: Cloud";

    it("format 4 reads only `;`, so a comma is part of the name", () => {
      const { ids, warnings } = tagIdsOf(comma, { opts: { meta: { formatVersion: "4" } } });
      expect(ids).toEqual([]);
      expect(warnings).toEqual([unknown(comma)]);
    });

    it("format 3 splits on commas", () => {
      const { ids } = tagIdsOf(comma, { opts: { meta: { formatVersion: "3" } } });
      expect(ids).toEqual([AUDITED_TAG, CLOUD_TAG]);
    });

    it("without _Meta, uses `;` when present and the comma reading otherwise", () => {
      expect(tagIdsOf("Risk: Audited; Hosting: Cloud").ids).toEqual([AUDITED_TAG, CLOUD_TAG]);
      expect(tagIdsOf(comma).ids).toEqual([AUDITED_TAG, CLOUD_TAG]);
    });

    it("without _Meta, keeps a comma-bearing cell whole when it names one tag", () => {
      const misc = makeTagGroup({ name: "Misc" });
      misc.tags = [makeTag({ name: "Acme, Inc.", tag_group_id: misc.id })];
      const { ids, warnings } = tagIdsOf("Misc: Acme, Inc.", { tagGroups: [...TAG_GROUPS, misc] });
      expect(ids).toEqual([misc.tags[0].id]);
      expect(warnings).toEqual([]);
    });

    it("unescapes `\\;` inside a `;`-separated entry", () => {
      const misc = makeTagGroup({ name: "Misc" });
      misc.tags = [makeTag({ name: "A;B", tag_group_id: misc.id })];
      const { ids, warnings } = tagIdsOf("Misc: A\\;B; Risk: Audited", {
        tagGroups: [...TAG_GROUPS, misc],
        opts: { meta: { formatVersion: "4" } },
      });
      expect(ids).toEqual([misc.tags[0].id, AUDITED_TAG]);
      expect(warnings).toEqual([]);
    });
  });
});

/* ------------------------------------------------------------------------- */
/*  Stakeholders                                                               */
/* ------------------------------------------------------------------------- */

describe("validateImport — stakeholder columns", () => {
  const OWNER = "stakeholder:applicationOwner";
  const unknownUser = (value: string) => ({
    row: 2,
    column: OWNER,
    message: warn("unknownStakeholderUser", { row: 2, value }),
  });

  it("leaves stakeholders undefined when no stakeholder column exists", () => {
    expect(oneCreate(app()).creates[0].stakeholders).toBeUndefined();
  });

  it.each([
    ["a bare email", MEMBER_EMAIL, [MEMBER_USER.id]],
    ["an upper-cased email", MEMBER_EMAIL.toUpperCase(), [MEMBER_USER.id]],
    ["a `Name <email>` entry", `Test Member <${MEMBER_EMAIL}>`, [MEMBER_USER.id]],
    ["two entries, `;`-separated", `Test Admin <${ADMIN_EMAIL}>; ${MEMBER_EMAIL}`, [USERS[0].id, MEMBER_USER.id]],
    ["two entries, `,`-separated", `${ADMIN_EMAIL}, ${MEMBER_EMAIL}`, [USERS[0].id, MEMBER_USER.id]],
    ["a repeated email", `${MEMBER_EMAIL}; ${MEMBER_EMAIL}`, [MEMBER_USER.id]],
  ])("resolves %s", (_what, cell, expected) => {
    const r = oneCreate(app({ [OWNER]: cell }));
    expect(r.warnings).toEqual([]);
    expect(r.creates[0].stakeholders).toEqual({ applicationOwner: expected });
  });

  it("warns on an unknown email and on a bare display name, keeping the rest", () => {
    const r = oneCreate(app({ [OWNER]: `ghost@test.local; Test Admin; ${MEMBER_EMAIL}` }));
    expect(r.warnings).toEqual([unknownUser("ghost@test.local"), unknownUser("Test Admin")]);
    expect(r.creates[0].stakeholders).toEqual({ applicationOwner: [MEMBER_USER.id] });
  });

  it("records an empty cell as an explicit clear of that role", () => {
    const r = oneCreate(app({ [OWNER]: "" }));
    expect(r.creates[0].stakeholders).toEqual({ applicationOwner: [] });
  });

  it("warns once per (type, role) on an unknown role and ignores the column", () => {
    const r = run([app({ "stakeholder:ceo": ADMIN_EMAIL }), app({ name: "Other", "stakeholder:ceo": ADMIN_EMAIL })]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([
      {
        column: "stakeholder:ceo",
        message: warn("unknownStakeholderRole", { role: "ceo", type: "Application" }),
      },
    ]);
    expect(r.creates.map((c) => c.stakeholders)).toEqual([undefined, undefined]);
  });

  it("maps a legacy snake_case header onto the camelCase role", () => {
    const r = oneCreate(app({ "stakeholder:technical_application_owner": MEMBER_EMAIL }));
    expect(r.warnings).toEqual([]);
    expect(r.creates[0].stakeholders).toEqual({ technicalApplicationOwner: [MEMBER_USER.id] });
  });

  it("skips a header with no role key", () => {
    const r = oneCreate(app({ "stakeholder:": MEMBER_EMAIL }));
    expect(r.creates[0].stakeholders).toBeUndefined();
  });

  it("takes any role as given when the type's roles are not supplied", () => {
    const r = oneCreate(app({ "stakeholder:ceo": MEMBER_EMAIL }), { roles: {} });
    expect(r.warnings).toEqual([]);
    expect(r.creates[0].stakeholders).toEqual({ ceo: [MEMBER_USER.id] });
  });
});

/* ------------------------------------------------------------------------- */
/*  Update classification                                                      */
/* ------------------------------------------------------------------------- */

describe("validateImport — update classification", () => {
  /** Every column of the ERP fixture as the exporter would write it. */
  const erpRoundTrip = (): Row =>
    erp({
      description: ERP.description,
      subtype: ERP.subtype,
      lifecycle_plan: "2019-01-01",
      lifecycle_phaseIn: "",
      lifecycle_active: "2020-06-01",
      lifecycle_phaseOut: "",
      lifecycle_endOfLife: "2030-12-31",
      attr_businessCriticality: "missionCritical",
      attr_costTotalAnnual: 250000,
      attr_isCloud: "false",
      attr_goLiveDate: "2020-06-01",
      attr_coverage: "75",
      attr_regions: "emea, amer",
      attr_vendorScore: "4.2",
      tags: "Hosting: On-Prem",
      "stakeholder:applicationOwner": MEMBER_EMAIL,
    });

  function oneUpdate(row: Row, o: RunOptions = {}) {
    const r = run([row], o);
    expect(r.errors).toEqual([]);
    expect(r.updates).toHaveLength(1);
    expect(r.creates).toEqual([]);
    return r.updates[0];
  }

  it("skips a full round-trip of an unchanged card", () => {
    const r = run([erpRoundTrip()]);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.updates).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("ignores CRLF and surrounding whitespace differences introduced by the round-trip", () => {
    const card = makeCard({ type: "Provider", name: "Acme", description: "Line one\nLine two" });
    const r = run([{ id: card.id, type: "Provider", name: " Acme ", description: "Line one\r\nLine two  " }], {
      existing: [card],
    });
    expect(r.updates).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("carries the existing card and the id on an update row", () => {
    const row = oneUpdate(erp({ name: "ERP Core v2" }));
    expect(row.id).toBe(CARD_IDS.erp);
    expect(row.existing).toBe(ERP);
    expect(row.changes).toEqual({ name: { old: "ERP Core", new: "ERP Core v2" } });
  });

  it.each([
    ["description", "A new description", { old: ERP.description, new: "A new description" }],
    ["subtype", "microservice", { old: "businessApplication", new: "microservice" }],
    ["alias", "Core", { old: null, new: "Core" }],
    ["external_id", "EXT-1", { old: null, new: "EXT-1" }],
    ["parent_label", "part of", { old: null, new: "part of" }],
  ])("records a changed %s", (column, value, change) => {
    const row = oneUpdate(erp({ [column]: value }));
    expect(row.changes).toEqual({ [column]: change });
  });

  it("documents current behaviour: an emptied core cell means leave alone, never clear", () => {
    const r = run([erp({ description: "", subtype: "" })]);
    expect(r.updates).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("records only the lifecycle phase that changed when every phase is present", () => {
    const row = oneUpdate(erp({ lifecycle_plan: "2019-01-01", lifecycle_active: "2021-01-01", lifecycle_endOfLife: "2030-12-31" }));
    expect(row.changes).toEqual({ lifecycle_active: { old: "2020-06-01", new: "2021-01-01" } });
    expect(row.data.lifecycle).toEqual({ plan: "2019-01-01", active: "2021-01-01", endOfLife: "2030-12-31" });
  });

  it("documents current behaviour: a phase absent from the sheet reads as cleared", () => {
    const row = oneUpdate(erp({ lifecycle_active: "2020-06-01" }));
    expect(row.changes).toEqual({
      lifecycle_plan: { old: "2019-01-01", new: null },
      lifecycle_endOfLife: { old: "2030-12-31", new: null },
    });
  });

  it("records a changed attribute alone, leaving the others to the merge", () => {
    const row = oneUpdate(erp({ attr_costTotalAnnual: "300000", attr_coverage: "75" }));
    expect(row.changes).toEqual({ attr_costTotalAnnual: { old: 250000, new: 300000 } });
    expect(row.data.attributes).toEqual({ costTotalAnnual: 300000, coverage: 75 });
  });

  it("compares a multi-select by its serialised form: same order is equal, reordered is a change", () => {
    const same = run([erp({ attr_regions: "emea, amer" })]);
    expect(same.updates).toEqual([]);
    const reordered = oneUpdate(erp({ attr_regions: "amer, emea" }));
    expect(reordered.changes).toEqual({ attr_regions: { old: ["emea", "amer"], new: ["amer", "emea"] } });
  });

  it("classifies a tags-only change as an update, naming old and new tags", () => {
    const row = oneUpdate(erp({ tags: "Hosting: Cloud" }));
    expect(row.tagIds).toEqual([CLOUD_TAG]);
    expect(row.changes).toEqual({ tags: { old: "On-Prem", new: "Cloud" } });
  });

  it("skips a row whose tags match the existing set", () => {
    const r = run([erp({ tags: "On-Prem" })]);
    expect(r.updates).toEqual([]);
    expect(r.skipped).toBe(1);
    expect(ON_PREM_TAG).toBe(ERP.tags[0].id);
  });

  it("classifies a stakeholders-only change as an update, naming the people", () => {
    const row = oneUpdate(erp({ "stakeholder:applicationOwner": ADMIN_EMAIL }));
    expect(row.stakeholders).toEqual({ applicationOwner: [USERS[0].id] });
    expect(row.changes).toEqual({
      stakeholder_applicationOwner: { old: "Test Member", new: "Test Admin" },
    });
  });

  it("classifies clearing a role as an update", () => {
    const row = oneUpdate(erp({ "stakeholder:applicationOwner": "" }));
    expect(row.changes).toEqual({ stakeholder_applicationOwner: { old: "Test Member", new: "" } });
  });

  it("skips a row whose stakeholders match, and never compares a role whose column is absent", () => {
    const r = run([erp({ "stakeholder:applicationOwner": MEMBER_EMAIL })]);
    expect(r.updates).toEqual([]);
    expect(r.skipped).toBe(1);
  });

  it("merges field, tag and stakeholder changes into one changes map", () => {
    const row = oneUpdate(erp({ name: "ERP Core v2", tags: "Hosting: Cloud", "stakeholder:applicationOwner": ADMIN_EMAIL }));
    expect(Object.keys(row.changes ?? {}).sort()).toEqual(["name", "stakeholder_applicationOwner", "tags"]);
  });

  it("still ignores the read-only field on a round-trip where something else changed", () => {
    const row = oneUpdate(erp({ name: "ERP Core v2", attr_vendorScore: "4.2" }));
    expect(row.data.attributes).toBeUndefined();
    expect(APPLICATION_TYPE.fields_schema.flatMap((s) => s.fields).find((f) => f.key === "vendorScore")?.readonly).toBe(true);
  });
});
