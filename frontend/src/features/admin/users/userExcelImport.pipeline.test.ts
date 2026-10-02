/**
 * The Users admin page's `.xlsx` import pipeline, end to end:
 *
 *   parseUserWorkbook(buffer)  →  validateUserImport(rows, users, roles)
 *                              →  executeUserImport(report, sendInvites)
 *
 * `userExcelImport.test.ts` covers `validateUserImport`'s main rules. This
 * file covers the two halves it leaves out — the SheetJS reader and the API
 * writer — plus the validation details it does not pin: the exact row
 * messages the dialog renders, row numbering, trimming and case folding,
 * locale / is_active change detection, and what happens to a row that
 * matches an existing user.
 *
 * `parseUserWorkbook` runs against real in-memory workbooks (built with
 * `aoa_to_sheet` and serialised with `XLSX.write`); only `XLSX.read` is
 * wrapped so one test can hand the parser a workbook with no sheet.
 * `executeUserImport` talks to the scripted `@/api/client` stand-in from
 * `@/test/apiMock`.
 *
 * The row messages are the module's own literal strings — `UserImportDialog`
 * renders `err.message` / `w.message` verbatim, there is no i18n key behind
 * them — so the assertions pin those literals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

import type { AppRole, User } from "@/types";
import { mockApi } from "@/test/apiMock";
import { makeUserRef, USERS } from "@/test/fixtures/metamodel";

import {
  executeUserImport,
  parseUserWorkbook,
  validateUserImport,
  type UserImportReport,
} from "./userExcelImport";

vi.mock("@/api/client", () => import("@/test/apiMock").then((m) => m.apiClientModule()));
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, read: vi.fn(actual.read) };
});

/* ------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

function makeRole(overrides: Partial<AppRole> & { key: string }): AppRole {
  return {
    id: `role-${overrides.key}`,
    label: overrides.key,
    is_system: false,
    is_default: false,
    is_archived: false,
    color: "#000000",
    permissions: {},
    sort_order: 0,
    ...overrides,
  };
}

const ROLES: AppRole[] = [
  makeRole({ key: "admin", is_system: true }),
  makeRole({ key: "member", is_system: true, is_default: true }),
  makeRole({ key: "viewer", is_system: true }),
  makeRole({ key: "retired", is_archived: true }),
];

/** Serialise an array-of-arrays into the `.xlsx` bytes a file input hands over. */
function workbook(aoa: unknown[][], sheetName = "Users"): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
  return { email: "new@test.local", display_name: "New Person", role: "member", ...overrides };
}

const NO_USERS: User[] = [];

/* ------------------------------------------------------------------------- */
/*  parseUserWorkbook                                                          */
/* ------------------------------------------------------------------------- */

describe("parseUserWorkbook", () => {
  it("reads the first sheet into one object per data row keyed by header", () => {
    const rows = parseUserWorkbook(
      workbook([
        ["email", "display_name", "role"],
        ["a@test.local", "Person A", "member"],
        ["b@test.local", "Person B", "viewer"],
      ]),
    );
    expect(rows).toEqual([
      { email: "a@test.local", display_name: "Person A", role: "member" },
      { email: "b@test.local", display_name: "Person B", role: "viewer" },
    ]);
  });

  it("fills blank cells with an empty string so every row carries every header", () => {
    const rows = parseUserWorkbook(
      workbook([
        ["email", "display_name", "role", "locale"],
        ["a@test.local", "", "member", ""],
      ]),
    );
    expect(rows).toEqual([{ email: "a@test.local", display_name: "", role: "member", locale: "" }]);
  });

  it("reads only the first sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["email"], ["first@test.local"]]),
      "First",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["email"], ["second@test.local"]]),
      "Second",
    );
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(parseUserWorkbook(buf)).toEqual([{ email: "first@test.local" }]);
  });

  it("returns no rows for a header-only sheet", () => {
    expect(parseUserWorkbook(workbook([["email", "display_name", "role"]]))).toEqual([]);
  });

  it("returns no rows when the workbook has no sheet at all", () => {
    vi.mocked(XLSX.read).mockReturnValueOnce({ SheetNames: [], Sheets: {} } as XLSX.WorkBook);
    expect(parseUserWorkbook(new ArrayBuffer(0))).toEqual([]);
  });

  it("keeps numeric cells numeric and date cells as Date objects", () => {
    // `cellDates: true` hands a date-formatted cell back as a `Date`, not an
    // ISO day. `validateUserImport` never reads the export's `created_at` /
    // `last_login` columns, so a Date landing there is harmless today — but
    // any consumer that ran it through the module's `s()` helper would get
    // `String(date)` ("Fri Oct 02 2026 00:00:00 GMT+0000 (…)"), never
    // "2026-10-02". Pinned so a future reader of those columns knows.
    const rows = parseUserWorkbook(
      workbook([
        ["email", "display_name", "created_at"],
        ["a@test.local", 12345, new Date(2026, 9, 2)],
      ]),
    );
    expect(rows[0].display_name).toBe(12345);
    expect(rows[0].created_at).toBeInstanceOf(Date);
    const created = rows[0].created_at as Date;
    expect([created.getFullYear(), created.getMonth(), created.getDate()]).toEqual([2026, 9, 2]);
  });
});

/* ------------------------------------------------------------------------- */
/*  validateUserImport                                                         */
/* ------------------------------------------------------------------------- */

describe("validateUserImport", () => {
  it("classifies a new address as a create carrying its role, locale and provider", () => {
    const report = validateUserImport(
      [row({ locale: "fr", auth_provider: "sso" })],
      NO_USERS,
      ROLES,
    );
    expect(report).toEqual({
      errors: [],
      warnings: [],
      updates: [],
      skipped: 0,
      totalRows: 1,
      creates: [
        {
          rowIndex: 2,
          email: "new@test.local",
          display_name: "New Person",
          role: "member",
          locale: "fr",
          auth_provider: "sso",
        },
      ],
    });
  });

  it("numbers rows from 2, the header being row 1", () => {
    const report = validateUserImport(
      [row({ email: "a@test.local" }), row({ email: "b@test.local" }), row({ email: "" })],
      NO_USERS,
      ROLES,
    );
    expect(report.creates.map((c) => c.rowIndex)).toEqual([2, 3]);
    expect(report.errors.map((e) => e.row)).toEqual([4]);
  });

  it("lower-cases and trims the email, trims the name and role, and stringifies numbers", () => {
    const report = validateUserImport(
      [row({ email: "  Mixed.Case@Test.LOCAL ", display_name: 4711, role: " member " })],
      NO_USERS,
      ROLES,
    );
    expect(report.creates[0]).toMatchObject({
      email: "mixed.case@test.local",
      display_name: "4711",
      role: "member",
    });
  });

  it("treats null, undefined, whitespace and missing cells alike as a blank row", () => {
    const report = validateUserImport(
      [
        row({ email: "a@test.local" }),
        { email: "   ", display_name: null, role: undefined },
        {},
      ],
      NO_USERS,
      ROLES,
    );
    expect(report.creates).toHaveLength(1);
    expect(report.errors).toEqual([]);
    expect(report.skipped).toBe(2);
    expect(report.totalRows).toBe(3);
  });

  it("pins the exact message of every rejection and warning the dialog renders", () => {
    const member = USERS[1];
    const report = validateUserImport(
      [
        { email: "", display_name: "No Mail" },
        row({ email: "not-an-email" }),
        row({ email: "dup@test.local" }),
        row({ email: "dup@test.local" }),
        row({ email: "noname@test.local", display_name: "   " }),
        row({ email: "norole@test.local", role: "superuser" }),
        row({ email: "noprov@test.local", auth_provider: "ldap" }),
        row({ email: "pw@test.local", password: "hunter2" }),
        { email: member.email, display_name: member.display_name, role: member.role },
      ],
      USERS,
      ROLES,
    );
    expect(report.errors).toEqual([
      { row: 2, column: "email", message: "Row 2: email is required" },
      { row: 3, column: "email", message: "Row 3: 'not-an-email' is not a valid email address" },
      {
        row: 5,
        column: "email",
        message: "Row 5: email 'dup@test.local' appears more than once in the file",
      },
      { row: 6, column: "display_name", message: "Row 6: display_name is required" },
      { row: 7, column: "role", message: "Row 7: unknown role 'superuser'" },
      {
        row: 8,
        column: "auth_provider",
        message: "Row 8: auth_provider must be 'local' or 'sso' (got 'ldap')",
      },
    ]);
    expect(report.warnings).toEqual([
      {
        row: 9,
        column: "password",
        message:
          "Row 9: password column is ignored — local users set their own password via the invite email",
      },
      { row: 10, message: `Row 10: user '${member.email}' already up to date` },
    ]);
    expect(report.creates.map((c) => c.email)).toEqual(["dup@test.local", "pw@test.local"]);
    expect(report.updates).toEqual([]);
    expect(report.skipped).toBe(1);
  });

  it("rejects every malformed address shape the regex is meant to catch", () => {
    for (const bad of ["two words@test.local", "no@tld", "@test.local", "user@"]) {
      const report = validateUserImport([row({ email: bad })], NO_USERS, ROLES);
      expect(report.errors.map((e) => e.column)).toEqual(["email"]);
      expect(report.creates).toEqual([]);
    }
  });

  it("keeps the first of two duplicates, folding case before comparing", () => {
    const report = validateUserImport(
      [row({ email: "dup@test.local" }), row({ email: "DUP@test.local" })],
      NO_USERS,
      ROLES,
    );
    expect(report.creates.map((c) => c.rowIndex)).toEqual([2]);
    expect(report.errors.map((e) => e.row)).toEqual([3]);
  });

  it("accepts auth_provider local / sso in any letter case, blank meaning unset", () => {
    const report = validateUserImport(
      [
        row({ auth_provider: "LOCAL" }),
        row({ email: "b@test.local", auth_provider: "Sso" }),
        row({ email: "c@test.local", auth_provider: "" }),
      ],
      NO_USERS,
      ROLES,
    );
    expect(report.errors).toEqual([]);
    expect(report.creates.map((c) => c.auth_provider)).toEqual(["local", "sso", undefined]);
  });

  it("leaves locale undefined when the cell is blank", () => {
    const report = validateUserImport([row({ locale: "  " })], NO_USERS, ROLES);
    expect(report.creates[0].locale).toBeUndefined();
  });

  describe("against existing users", () => {
    const existing = USERS.map((u) => ({ ...u, locale: "en" }));
    const [admin, member] = existing;

    it("matches an existing address case-insensitively and lists only the changed fields", () => {
      const report = validateUserImport(
        [{ email: member.email.toUpperCase(), display_name: "Renamed Member", role: "member" }],
        existing,
        ROLES,
      );
      expect(report.creates).toEqual([]);
      expect(report.errors).toEqual([]);
      expect(report.updates).toEqual([
        {
          rowIndex: 2,
          email: member.email,
          display_name: "Renamed Member",
          role: "member",
          locale: undefined,
          existing: member,
          changes: { display_name: { old: "Test Member", new: "Renamed Member" } },
        },
      ]);
    });

    it("records role, locale and is_active changes together", () => {
      const report = validateUserImport(
        [
          {
            email: admin.email,
            display_name: admin.display_name,
            role: "viewer",
            locale: "de",
            is_active: "no",
          },
        ],
        existing,
        ROLES,
      );
      expect(report.updates[0].changes).toEqual({
        role: { old: "admin", new: "viewer" },
        locale: { old: "en", new: "de" },
        is_active: { old: true, new: false },
      });
    });

    it("reports the old locale as an empty string when the user had none", () => {
      const report = validateUserImport(
        [{ email: member.email, display_name: member.display_name, role: "member", locale: "fr" }],
        USERS,
        ROLES,
      );
      expect(report.updates[0].changes).toEqual({ locale: { old: "", new: "fr" } });
    });

    it("does not record a locale change when the sheet leaves locale blank", () => {
      const report = validateUserImport(
        [{ email: member.email, display_name: "Renamed", role: "member", locale: "" }],
        existing,
        ROLES,
      );
      expect(report.updates[0].changes).toEqual({
        display_name: { old: "Test Member", new: "Renamed" },
      });
    });

    it("understands every spelling of the is_active flag and ignores the rest", () => {
      const activeUser = makeUserRef({ email: "active@test.local", is_active: true });
      const check = (value: unknown) =>
        validateUserImport(
          [
            {
              email: activeUser.email,
              display_name: activeUser.display_name,
              role: "member",
              is_active: value,
            },
          ],
          [activeUser],
          ROLES,
        );
      for (const falsy of ["false", "No", "0", "INACTIVE", "disabled"]) {
        expect(check(falsy).updates[0].changes).toEqual({
          is_active: { old: true, new: false },
        });
      }
      // Already active: every truthy spelling is a no-op, as is a value the
      // parser does not understand or a blank cell.
      for (const noop of ["true", "YES", "1", "active", "Enabled", "maybe", "", null]) {
        const report = check(noop);
        expect(report.updates).toEqual([]);
        expect(report.skipped).toBe(1);
      }
    });

    it("reactivates a deactivated user from a truthy cell", () => {
      const dormant = makeUserRef({ email: "dormant@test.local", is_active: false });
      const report = validateUserImport(
        [{ email: dormant.email, display_name: dormant.display_name, role: "member", is_active: "TRUE" }],
        [dormant],
        ROLES,
      );
      expect(report.updates[0].changes).toEqual({ is_active: { old: false, new: true } });
    });

    it("does not carry auth_provider onto an update", () => {
      const report = validateUserImport(
        [{ email: member.email, display_name: "Renamed", role: "member", auth_provider: "sso" }],
        existing,
        ROLES,
      );
      expect(report.updates[0]).not.toHaveProperty("auth_provider");
    });

    it("still validates auth_provider on an existing user's row", () => {
      const report = validateUserImport(
        [{ email: member.email, display_name: "Renamed", role: "member", auth_provider: "oauth" }],
        existing,
        ROLES,
      );
      expect(report.updates).toEqual([]);
      expect(report.errors.map((e) => e.column)).toEqual(["auth_provider"]);
    });

    it("splits a mixed file into creates, updates, errors, warnings and skips", () => {
      const report = validateUserImport(
        [
          row({ email: "fresh@test.local" }),
          { email: member.email, display_name: "Renamed Member", role: "member" },
          { email: admin.email, display_name: admin.display_name, role: admin.role },
          row({ email: "broken" }),
          { email: "", display_name: "", role: "" },
        ],
        existing,
        ROLES,
      );
      expect(report.creates.map((c) => c.rowIndex)).toEqual([2]);
      expect(report.updates.map((u) => u.rowIndex)).toEqual([3]);
      expect(report.warnings.map((w) => w.row)).toEqual([4]);
      expect(report.errors.map((e) => e.row)).toEqual([5]);
      expect(report.skipped).toBe(2);
      expect(report.totalRows).toBe(5);
    });
  });

  it("validates what parseUserWorkbook produced from a real sheet, end to end", () => {
    const rows = parseUserWorkbook(
      workbook([
        ["email", "display_name", "role", "is_active", "auth_provider", "locale"],
        ["fresh@test.local", "Fresh Person", "viewer", "TRUE", "local", "da"],
        [USERS[1].email, USERS[1].display_name, "admin", "FALSE", "", ""],
        ["", "", "", "", "", ""],
      ]),
    );
    const report = validateUserImport(rows, USERS, ROLES);
    expect(report.errors).toEqual([]);
    expect(report.creates).toEqual([
      {
        rowIndex: 2,
        email: "fresh@test.local",
        display_name: "Fresh Person",
        role: "viewer",
        locale: "da",
        auth_provider: "local",
      },
    ]);
    expect(report.updates[0].changes).toEqual({
      role: { old: "member", new: "admin" },
      is_active: { old: true, new: false },
    });
    expect(report.skipped).toBe(1);
  });
});

/* ------------------------------------------------------------------------- */
/*  executeUserImport                                                          */
/* ------------------------------------------------------------------------- */

function emptyReport(overrides: Partial<UserImportReport> = {}): UserImportReport {
  return {
    errors: [],
    warnings: [],
    creates: [],
    updates: [],
    skipped: 0,
    totalRows: 0,
    ...overrides,
  };
}

const CREATE_A = { rowIndex: 2, email: "a@test.local", display_name: "A", role: "member" };

describe("executeUserImport", () => {
  beforeEach(() => {
    mockApi.reset();
  });

  it("creates each new user with the invite flag and reports progress", async () => {
    mockApi.on("post", "/users", { id: "u-new" });
    const progress = vi.fn();
    const report = emptyReport({
      creates: [
        CREATE_A,
        {
          rowIndex: 3,
          email: "b@test.local",
          display_name: "B",
          role: "viewer",
          locale: "de",
          auth_provider: "sso",
        },
      ],
    });

    const result = await executeUserImport(report, true, progress);

    expect(result).toEqual({ created: 2, updated: 0, failed: 0, failedDetails: [] });
    // `locale` is deliberately not part of the create payload.
    expect(mockApi.callsOf("post", "/users").map((c) => c.body)).toEqual([
      { email: "a@test.local", display_name: "A", role: "member", send_email: true },
      {
        email: "b@test.local",
        display_name: "B",
        role: "viewer",
        send_email: true,
        auth_provider: "sso",
      },
    ]);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("passes send_email: false when invites are off", async () => {
    mockApi.on("post", "/users", { id: "u-new" });
    await executeUserImport(emptyReport({ creates: [CREATE_A] }), false);
    expect(mockApi.callsOf("post", "/users")[0].body).toMatchObject({ send_email: false });
  });

  it("surfaces an invite email failure as a row detail without counting the user as failed", async () => {
    mockApi.on("post", "/users", { id: "u-new", email_error: "SMTP refused", email_sent: false });
    const result = await executeUserImport(
      emptyReport({ creates: [{ ...CREATE_A, rowIndex: 7 }] }),
      true,
    );
    expect(result).toEqual({
      created: 1,
      updated: 0,
      failed: 0,
      failedDetails: [{ row: 7, message: "a@test.local: SMTP refused" }],
    });
  });

  it("ignores an email_error when no invite was requested", async () => {
    mockApi.on("post", "/users", { id: "u-new", email_error: "SMTP refused" });
    const result = await executeUserImport(emptyReport({ creates: [CREATE_A] }), false);
    expect(result.failedDetails).toEqual([]);
  });

  it("counts a rejected create as failed with the error's message and carries on", async () => {
    mockApi.on("post", "/users", (_path, body) => {
      if ((body as { email: string }).email === "bad@test.local") {
        throw new Error("Email already registered");
      }
      return { id: "u-ok" };
    });
    const progress = vi.fn();
    const result = await executeUserImport(
      emptyReport({
        creates: [
          { rowIndex: 2, email: "bad@test.local", display_name: "Bad", role: "member" },
          { rowIndex: 3, email: "good@test.local", display_name: "Good", role: "member" },
        ],
      }),
      false,
      progress,
    );
    expect(result).toEqual({
      created: 1,
      updated: 0,
      failed: 1,
      failedDetails: [{ row: 2, message: "Email already registered" }],
    });
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it("uses the ApiError message when the backend rejects a create", async () => {
    mockApi.fail("post", "/users", 409, "duplicate");
    const result = await executeUserImport(emptyReport({ creates: [CREATE_A] }), false);
    expect(result.failed).toBe(1);
    expect(result.failedDetails).toEqual([{ row: 2, message: "POST /users failed" }]);
  });

  it("stringifies a non-Error rejection", async () => {
    mockApi.on("post", "/users", () => {
      throw "plain failure";
    });
    const result = await executeUserImport(emptyReport({ creates: [CREATE_A] }), false);
    expect(result.failedDetails).toEqual([{ row: 2, message: "plain failure" }]);
  });

  it("patches an existing user with only the fields that changed", async () => {
    mockApi.on("patch", /^\/users\//, (_path, body) => ({ ...USERS[1], ...(body as object) }));
    const member = USERS[1];
    const result = await executeUserImport(
      emptyReport({
        updates: [
          {
            rowIndex: 2,
            email: member.email,
            display_name: "Renamed",
            role: "admin",
            locale: "fr",
            existing: member,
            changes: {
              display_name: { old: member.display_name, new: "Renamed" },
              role: { old: "member", new: "admin" },
              locale: { old: "", new: "fr" },
              is_active: { old: true, new: false },
            },
          },
        ],
      }),
      true,
    );
    expect(result).toEqual({ created: 0, updated: 1, failed: 0, failedDetails: [] });
    const [call] = mockApi.callsOf("patch");
    expect(call.path).toBe(`/users/${member.id}`);
    expect(call.body).toEqual({
      display_name: "Renamed",
      role: "admin",
      locale: "fr",
      is_active: false,
    });
    expect(mockApi.callsOf("post")).toEqual([]);
  });

  it("sends only the is_active flag when that is the one change", async () => {
    mockApi.on("patch", /^\/users\//, {});
    const member = USERS[1];
    await executeUserImport(
      emptyReport({
        updates: [
          {
            rowIndex: 2,
            email: member.email,
            display_name: member.display_name,
            role: member.role,
            existing: member,
            changes: { is_active: { old: false, new: true } },
          },
        ],
      }),
      false,
    );
    expect(mockApi.callsOf("patch")[0].body).toEqual({ is_active: true });
  });

  it("counts a rejected patch as failed", async () => {
    mockApi.fail("patch", /^\/users\//, 403, "forbidden");
    const member = USERS[1];
    const progress = vi.fn();
    const result = await executeUserImport(
      emptyReport({
        updates: [
          {
            rowIndex: 5,
            email: member.email,
            display_name: "Renamed",
            role: member.role,
            existing: member,
            changes: { display_name: { old: member.display_name, new: "Renamed" } },
          },
        ],
      }),
      false,
      progress,
    );
    expect(result).toEqual({
      created: 0,
      updated: 0,
      failed: 1,
      failedDetails: [{ row: 5, message: `PATCH /users/${member.id} failed` }],
    });
    expect(progress.mock.calls).toEqual([[1, 1]]);
  });

  it("skips an update row that carries no existing user, without touching the API", async () => {
    // `validateUserImport` never builds such a row; the guard is defensive.
    // Note the row still counts in the progress total but never reports
    // `done`, so a report containing one ends short of total.
    const progress = vi.fn();
    const result = await executeUserImport(
      emptyReport({
        updates: [{ rowIndex: 2, email: "ghost@test.local", display_name: "Ghost", role: "member" }],
      }),
      false,
      progress,
    );
    expect(result).toEqual({ created: 0, updated: 0, failed: 0, failedDetails: [] });
    expect(mockApi.calls).toEqual([]);
    expect(progress).not.toHaveBeenCalled();
  });

  it("runs creates before updates and counts both in the progress total", async () => {
    mockApi.on("post", "/users", { id: "u-new" });
    mockApi.on("patch", /^\/users\//, {});
    const member = USERS[1];
    const progress = vi.fn();
    const result = await executeUserImport(
      emptyReport({
        creates: [CREATE_A],
        updates: [
          {
            rowIndex: 3,
            email: member.email,
            display_name: "Renamed",
            role: member.role,
            existing: member,
            changes: { display_name: { old: member.display_name, new: "Renamed" } },
          },
        ],
      }),
      false,
      progress,
    );
    expect(result).toMatchObject({ created: 1, updated: 1, failed: 0 });
    expect(mockApi.calls.map((c) => c.method)).toEqual(["post", "patch"]);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("resolves immediately for an empty report", async () => {
    const progress = vi.fn();
    const result = await executeUserImport(emptyReport(), true, progress);
    expect(result).toEqual({ created: 0, updated: 0, failed: 0, failedDetails: [] });
    expect(progress).not.toHaveBeenCalled();
    expect(mockApi.calls).toEqual([]);
  });
});
