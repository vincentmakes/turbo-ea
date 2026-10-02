/**
 * Tests for the Users admin page's `.xlsx` export.
 *
 * Only `XLSX.writeFile` is mocked — under jsdom it would try to trigger a
 * browser download, which jsdom cannot do. The workbook handed to the mock
 * is a real SheetJS workbook, read back with `sheet_to_json`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import { makeUserRef, USERS } from "@/test/fixtures/metamodel";

import { exportUsersToXlsx } from "./userExcelExport";

vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile: vi.fn() };
});

const writeFile = vi.mocked(XLSX.writeFile);

const HEADERS = [
  "email",
  "display_name",
  "role",
  "is_active",
  "auth_provider",
  "locale",
  "last_login",
  "created_at",
];

function lastWritten(): { wb: XLSX.WorkBook; filename: string } {
  const call = writeFile.mock.calls.at(-1);
  if (!call) throw new Error("writeFile was not called");
  return { wb: call[0] as XLSX.WorkBook, filename: call[1] as string };
}

function aoa(ws: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
}

beforeEach(() => {
  writeFile.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("exportUsersToXlsx", () => {
  it("writes one 'Users' sheet with the canonical header row and one row per user", () => {
    exportUsersToXlsx(USERS);

    expect(writeFile).toHaveBeenCalledTimes(1);
    const { wb } = lastWritten();
    expect(wb.SheetNames).toEqual(["Users"]);
    const rows = aoa(wb.Sheets.Users);
    expect(rows[0]).toEqual(HEADERS);
    expect(rows).toHaveLength(USERS.length + 1);
    expect(rows.slice(1).map((r) => r[0])).toEqual(USERS.map((u) => u.email));
  });

  it("renders the booleans as TRUE / FALSE and defaults blanks per column", () => {
    exportUsersToXlsx([
      makeUserRef({
        email: "full@test.local",
        display_name: "Full Record",
        role: "admin",
        is_active: true,
        auth_provider: "sso",
        locale: "de",
        last_login: "2026-09-30T08:00:00Z",
        created_at: "2026-01-02T03:04:05Z",
      }),
      makeUserRef({
        email: "bare@test.local",
        display_name: "Bare Record",
        role: "viewer",
        is_active: false,
      }),
    ]);

    const rows = aoa(lastWritten().wb.Sheets.Users);
    expect(rows[1]).toEqual([
      "full@test.local",
      "Full Record",
      "admin",
      "TRUE",
      "sso",
      "de",
      "2026-09-30T08:00:00Z",
      "2026-01-02T03:04:05Z",
    ]);
    // No provider means a local account; the optional columns export blank.
    expect(rows[2]).toEqual(["bare@test.local", "Bare Record", "viewer", "FALSE", "local", "", "", ""]);
  });

  it("treats an empty auth_provider string as local", () => {
    exportUsersToXlsx([makeUserRef({ email: "x@test.local", auth_provider: "" })]);
    const rows = aoa(lastWritten().wb.Sheets.Users);
    expect(rows[1][4]).toBe("local");
  });

  it("writes the booleans as text cells, never as spreadsheet booleans", () => {
    exportUsersToXlsx([makeUserRef({ email: "x@test.local", is_active: true })]);
    const ws = lastWritten().wb.Sheets.Users;
    expect(ws.D2.t).toBe("s");
    expect(ws.D2.v).toBe("TRUE");
  });

  it("auto-fits each column to its longest value plus two, capped at 60", () => {
    const longEmail = `${"a".repeat(70)}@test.local`;
    exportUsersToXlsx([
      makeUserRef({ email: longEmail, display_name: "Short", role: "member" }),
    ]);
    const cols = lastWritten().wb.Sheets.Users["!cols"] as XLSX.ColInfo[];
    expect(cols).toHaveLength(HEADERS.length);
    const widthOf = (header: string) => cols[HEADERS.indexOf(header)].wch;
    expect(widthOf("email")).toBe(60);
    // The header is the longest value in these columns.
    expect(widthOf("display_name")).toBe("display_name".length + 2);
    expect(widthOf("role")).toBe("member".length + 2);
    expect(widthOf("locale")).toBe("locale".length + 2);
  });

  it("still writes the header row for an empty user list", () => {
    exportUsersToXlsx([]);
    const ws = lastWritten().wb.Sheets.Users;
    expect(aoa(ws)).toEqual([HEADERS]);
    expect((ws["!cols"] as XLSX.ColInfo[]).map((c) => c.wch)).toEqual(
      HEADERS.map((h) => h.length + 2),
    );
  });

  it("names the file users_export_<local date>_<HHMM>.xlsx with zero padding", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 5, 7, 4, 59));
    exportUsersToXlsx(USERS);
    expect(lastWritten().filename).toBe("users_export_2026-03-05_0704.xlsx");
  });

  it("uses the local clock for the stamp, so a late evening stays on its own day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59));
    exportUsersToXlsx([]);
    expect(lastWritten().filename).toBe("users_export_2026-12-31_2359.xlsx");
  });
});
