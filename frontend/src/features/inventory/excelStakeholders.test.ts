/**
 * Round-trip tests for the `stakeholder:<role>` columns: export cell
 * serialization, entry parsing, validation (resolution + diff
 * classification), and the bulk apply in the multi-sheet executor.
 * API client is mocked — pure unit tests, same setup as excelRelations.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { Card, CardType } from "@/types";

import { serializeStakeholderCell } from "./excelExport";

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
  parseStakeholderEntry,
  parseWorkbookSheets,
  validateMultiSheet,
  executeMultiSheetImport,
  type StakeholderRolesByType,
  type UserRef,
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

const USERS: UserRef[] = [
  { id: "u-ada", display_name: "Ada Lovelace", email: "ada@corp.com" },
  { id: "u-bob", display_name: "Bob Builder", email: "bob@corp.com" },
  { id: "u-dup1", display_name: "Sam Smith", email: "sam1@corp.com" },
  { id: "u-dup2", display_name: "Sam Smith", email: "sam2@corp.com" },
];

const ROLES: StakeholderRolesByType = {
  Application: [
    { key: "responsible", label: "Responsible" },
    { key: "observer", label: "Observer" },
  ],
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

beforeEach(() => {
  vi.mocked(api.get).mockReset().mockResolvedValue([] as never);
  vi.mocked(api.post).mockReset().mockResolvedValue({ results: [] } as never);
});

describe("serializeStakeholderCell / parseStakeholderEntry round-trip", () => {
  it("serializes one role's refs as plain emails joined with semicolons", () => {
    const card = makeCard({
      id: "c1",
      type: "Application",
      name: "App",
      stakeholders: [
        { id: "s1", user_id: "u-ada", user_display_name: "Ada Lovelace", user_email: "ada@corp.com", role: "responsible" },
        { id: "s2", user_id: "u-bob", user_display_name: "Bob Builder", user_email: "bob@corp.com", role: "responsible" },
        { id: "s3", user_id: "u-ada", user_display_name: "Ada Lovelace", user_email: "ada@corp.com", role: "observer" },
      ],
    });
    expect(serializeStakeholderCell(card, "responsible")).toBe("ada@corp.com; bob@corp.com");
    expect(serializeStakeholderCell(card, "observer")).toBe("ada@corp.com");
    expect(serializeStakeholderCell(card, "unused_role")).toBe("");
  });

  it("degrades to the display name only when the email is missing", () => {
    const card = makeCard({
      id: "c1",
      type: "Application",
      name: "App",
      stakeholders: [
        { id: "s1", user_id: "u-x", user_display_name: "No Mail", role: "responsible" },
      ],
    });
    expect(serializeStakeholderCell(card, "responsible")).toBe("No Mail");
  });

  it("accepts emails (bare or bracketed); a bare name never resolves", () => {
    expect(parseStakeholderEntry("ada@corp.com")).toEqual({ email: "ada@corp.com" });
    expect(parseStakeholderEntry("Ada Lovelace <ada@corp.com>")).toEqual({
      email: "ada@corp.com",
    });
    expect(parseStakeholderEntry("Ada Lovelace")).toEqual({});
  });
});

describe("validateMultiSheet — stakeholder columns", () => {
  it("resolves users by email on creates (bracketed form tolerated)", async () => {
    const buf = buildWorkbook(
      [
        {
          name: "New App",
          type: "Application",
          "stakeholder:responsible": "Ada Lovelace <ada@corp.com>; bob@corp.com",
        },
      ],
      "Application",
    );
    const report = await validateMultiSheet(
      parseWorkbookSheets(buf, [APP_TYPE]),
      [],
      [APP_TYPE],
      [],
      [],
      undefined,
      [],
      {},
      USERS,
      ROLES,
    );
    expect(report.errors).toHaveLength(0);
    expect(report.creates).toHaveLength(1);
    expect(report.creates[0].stakeholders).toEqual({
      responsible: ["u-ada", "u-bob"],
    });
  });

  it("warns on unknown emails and on bare display names (never resolved)", async () => {
    const buf = buildWorkbook(
      [
        {
          name: "New App",
          type: "Application",
          // "Ada Lovelace" IS a real user's display name — it must still be
          // warned-and-skipped: emails are the only accepted reference.
          "stakeholder:responsible": "ghost@corp.com; Ada Lovelace",
        },
      ],
      "Application",
    );
    const report = await validateMultiSheet(
      parseWorkbookSheets(buf, [APP_TYPE]),
      [],
      [APP_TYPE],
      [],
      [],
      undefined,
      [],
      {},
      USERS,
      ROLES,
    );
    expect(report.creates[0].stakeholders).toEqual({ responsible: [] });
    const messages = report.warnings.map((w) => w.message).join("\n");
    expect(messages).toContain("ghost@corp.com");
    expect(messages).toContain("Ada Lovelace");
  });

  it("ignores columns for roles the type does not define, with one warning", async () => {
    const buf = buildWorkbook(
      [
        { name: "A1", type: "Application", "stakeholder:nonrole": "ada@corp.com" },
        { name: "A2", type: "Application", "stakeholder:nonrole": "bob@corp.com" },
      ],
      "Application",
    );
    const report = await validateMultiSheet(
      parseWorkbookSheets(buf, [APP_TYPE]),
      [],
      [APP_TYPE],
      [],
      [],
      undefined,
      [],
      {},
      USERS,
      ROLES,
    );
    expect(report.creates[0].stakeholders).toBeUndefined();
    const roleWarnings = report.warnings.filter((w) => w.message.includes("nonrole"));
    expect(roleWarnings).toHaveLength(1);
  });

  it("classifies a stakeholder-only change as an update; unchanged rows skip", async () => {
    const existing = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "Existing App",
      stakeholders: [
        { id: "s1", user_id: "u-ada", user_display_name: "Ada Lovelace", user_email: "ada@corp.com", role: "responsible" },
      ],
    });
    const changedBuf = buildWorkbook(
      [
        {
          id: existing.id,
          name: "Existing App",
          type: "Application",
          "stakeholder:responsible": "Bob Builder <bob@corp.com>",
        },
      ],
      "Application",
    );
    const changed = await validateMultiSheet(
      parseWorkbookSheets(changedBuf, [APP_TYPE]),
      [existing],
      [APP_TYPE],
      [],
      [],
      undefined,
      [],
      {},
      USERS,
      ROLES,
    );
    expect(changed.updates).toHaveLength(1);
    expect(changed.updates[0].stakeholders).toEqual({ responsible: ["u-bob"] });
    expect(changed.updates[0].changes?.stakeholder_responsible).toEqual({
      old: "Ada Lovelace",
      new: "Bob Builder",
    });

    const unchangedBuf = buildWorkbook(
      [
        {
          id: existing.id,
          name: "Existing App",
          type: "Application",
          "stakeholder:responsible": "Ada Lovelace <ada@corp.com>",
        },
      ],
      "Application",
    );
    const unchanged = await validateMultiSheet(
      parseWorkbookSheets(unchangedBuf, [APP_TYPE]),
      [existing],
      [APP_TYPE],
      [],
      [],
      undefined,
      [],
      {},
      USERS,
      ROLES,
    );
    expect(unchanged.updates).toHaveLength(0);
    expect(unchanged.skipped).toBe(1);
  });
});

describe("executeMultiSheetImport — stakeholder bulk apply", () => {
  it("adds stakeholders for creates and diffs adds/removes for updates", async () => {
    const existing = makeCard({
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "Existing App",
      stakeholders: [
        { id: "s1", user_id: "u-ada", user_display_name: "Ada Lovelace", user_email: "ada@corp.com", role: "responsible" },
      ],
    });
    const buf = buildWorkbook(
      [
        {
          name: "New App",
          type: "Application",
          "stakeholder:responsible": "ada@corp.com",
        },
        {
          id: existing.id,
          name: "Existing App",
          type: "Application",
          "stakeholder:responsible": "bob@corp.com",
        },
      ],
      "Application",
    );
    const report = await validateMultiSheet(
      parseWorkbookSheets(buf, [APP_TYPE]),
      [existing],
      [APP_TYPE],
      [],
      [],
      undefined,
      [],
      {},
      USERS,
      ROLES,
    );
    expect(report.errors).toHaveLength(0);
    expect(report.creates).toHaveLength(1);
    expect(report.updates).toHaveLength(1);

    const stakeholderCalls: unknown[] = [];
    vi.mocked(api.post).mockImplementation(async (url: string, body?: unknown) => {
      if (url === "/cards/bulk-create") {
        const b = body as { cards: { row_index: number }[] };
        return {
          results: b.cards.map((c) => ({
            row_index: c.row_index,
            status: "created",
            id: "22222222-2222-2222-2222-222222222222",
          })),
        } as never;
      }
      if (url === "/stakeholders/bulk") {
        stakeholderCalls.push(body);
        const b = body as { operations: { action: string }[] };
        return {
          results: b.operations.map((op, i) => ({
            row_index: i,
            status: op.action === "add" ? "added" : "removed",
          })),
        } as never;
      }
      return { results: [] } as never;
    });

    const result = await executeMultiSheetImport(report);
    expect(result.created).toBe(1);
    expect(result.stakeholdersAdded).toBe(2);
    expect(result.stakeholdersRemoved).toBe(1);
    expect(result.stakeholdersFailed).toBe(0);

    expect(stakeholderCalls).toHaveLength(1);
    const ops = (stakeholderCalls[0] as { operations: Record<string, unknown>[] }).operations;
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "add",
          card_id: "22222222-2222-2222-2222-222222222222",
          user_id: "u-ada",
          role: "responsible",
        }),
        expect.objectContaining({
          action: "add",
          card_id: existing.id,
          user_id: "u-bob",
          role: "responsible",
        }),
        expect.objectContaining({
          action: "remove",
          card_id: existing.id,
          user_id: "u-ada",
          role: "responsible",
        }),
      ]),
    );
    expect(ops).toHaveLength(3);
  });
});
