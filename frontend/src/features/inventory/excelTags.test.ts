/**
 * Round-trip tests for the `tags` column. Since workbook format 4 it is
 * `; `-separated like every other list cell, so a tag name may hold a comma
 * (#1171); format 3 and earlier wrote `, `, which the importer still reads.
 * API client is mocked — pure unit tests, same setup as excelRelations.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { Card, CardType, TagGroup } from "@/types";

import { buildExportWorkbook } from "./excelExport";

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
import { parseWorkbookSheets, validateMultiSheet } from "./excelImport";

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

const TAG_GROUPS: TagGroup[] = [
  {
    id: "g-vendor",
    name: "Vendor",
    mode: "multi",
    mandatory: false,
    tags: [
      { id: "t-acme-inc", name: "Acme, Inc.", tag_group_id: "g-vendor" },
      { id: "t-acme", name: "Acme", tag_group_id: "g-vendor" },
      { id: "t-billing", name: "Billing; Invoicing", tag_group_id: "g-vendor" },
      { id: "t-slash", name: "R\\D", tag_group_id: "g-vendor" },
    ],
  },
  {
    id: "g-region",
    name: "Region",
    mode: "multi",
    mandatory: false,
    tags: [
      { id: "t-eu", name: "EU", tag_group_id: "g-region" },
      { id: "t-us", name: "US", tag_group_id: "g-region" },
    ],
  },
];

/** A one-card Application sheet with the given `tags` cell, plus `_Meta`
 * when a format version is given. */
function workbookWithTags(tags: string, formatVersion?: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([{ type: "Application", name: "ERP", tags }]),
    "Application",
  );
  if (formatVersion) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([{ key: "format_version", value: formatVersion }]),
      "_Meta",
    );
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

async function importedTagIds(buf: ArrayBuffer): Promise<string[] | undefined> {
  const report = await validateMultiSheet(
    parseWorkbookSheets(buf, [APP_TYPE]),
    [],
    [APP_TYPE],
    [],
    [],
    undefined,
    TAG_GROUPS,
  );
  expect(report.errors).toEqual([]);
  // An unknown tag is a warning on the `tags` column, not an error.
  expect(report.warnings.filter((w) => w.column === "tags")).toEqual([]);
  expect(report.creates).toHaveLength(1);
  return report.creates[0].tagIds;
}

describe("tags column", () => {
  beforeEach(() => {
    (api.get as unknown as ReturnType<typeof vi.fn>).mockReset();
    (api.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it("exports `; `-separated, escaped entries that import back unchanged", async () => {
    const card: Card = {
      id: "11111111-1111-1111-1111-111111111111",
      type: "Application",
      name: "ERP",
      status: "ACTIVE",
      approval_status: "DRAFT",
      data_quality: 0,
      stakeholders: [],
      tags: [
        { id: "t-acme-inc", name: "Acme, Inc.", group_name: "Vendor" },
        { id: "t-billing", name: "Billing; Invoicing", group_name: "Vendor" },
        { id: "t-slash", name: "R\\D", group_name: "Vendor" },
        { id: "t-eu", name: "EU", group_name: "Region" },
      ],
    };
    const wb = await buildExportWorkbook([card], APP_TYPE, [APP_TYPE], []);
    const row = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Application"])[0];
    expect(row.tags).toBe(
      "Vendor: Acme, Inc.; Vendor: Billing\\; Invoicing; Vendor: R\\\\D; Region: EU",
    );

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(await importedTagIds(buf)).toEqual(["t-acme-inc", "t-billing", "t-slash", "t-eu"]);
  });

  it("keeps a lone comma-bearing tag whole in a current workbook", async () => {
    expect(await importedTagIds(workbookWithTags("Vendor: Acme, Inc.", "4"))).toEqual([
      "t-acme-inc",
    ]);
  });

  describe("format 3 (`, `-separated)", () => {
    it("splits on commas", async () => {
      expect(await importedTagIds(workbookWithTags("Region: EU, Region: US", "3"))).toEqual([
        "t-eu",
        "t-us",
      ]);
    });

    it("keeps the cell whole when it names one tag", async () => {
      expect(await importedTagIds(workbookWithTags("Vendor: Acme, Inc.", "3"))).toEqual([
        "t-acme-inc",
      ]);
    });

    it("reads a `;` as part of the name, as format 3 wrote it", async () => {
      expect(await importedTagIds(workbookWithTags("Vendor: Billing; Invoicing", "3"))).toEqual([
        "t-billing",
      ]);
    });
  });

  describe("a sheet without _Meta", () => {
    it("uses `;` when the cell has one", async () => {
      expect(await importedTagIds(workbookWithTags("Vendor: Acme, Inc.; Region: US"))).toEqual([
        "t-acme-inc",
        "t-us",
      ]);
    });

    it("keeps a comma-bearing cell whole when it names one tag, else splits", async () => {
      expect(await importedTagIds(workbookWithTags("Vendor: Acme, Inc."))).toEqual([
        "t-acme-inc",
      ]);
      expect(await importedTagIds(workbookWithTags("Region: EU, Region: US"))).toEqual([
        "t-eu",
        "t-us",
      ]);
    });
  });
});
