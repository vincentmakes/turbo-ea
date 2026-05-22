import * as XLSX from "xlsx";
import { api } from "@/api/client";
import type { AppRole, User } from "@/types";

export interface UserImportError {
  row: number;
  column?: string;
  message: string;
}

export interface UserImportWarning {
  row?: number;
  column?: string;
  message: string;
}

export interface ParsedUserRow {
  rowIndex: number;
  email: string;
  display_name: string;
  role: string;
  password?: string;
  locale?: string;
  auth_provider?: "local" | "sso";
  existing?: User;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

export interface UserImportReport {
  errors: UserImportError[];
  warnings: UserImportWarning[];
  creates: ParsedUserRow[];
  updates: ParsedUserRow[];
  skipped: number;
  totalRows: number;
}

export interface UserImportResult {
  created: number;
  updated: number;
  failed: number;
  failedDetails: { row: number; message: string }[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRUTHY = new Set(["true", "yes", "1", "active", "enabled"]);
const FALSY = new Set(["false", "no", "0", "inactive", "disabled"]);

function s(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseBool(v: unknown): boolean | null {
  const str = s(v).toLowerCase();
  if (!str) return null;
  if (TRUTHY.has(str)) return true;
  if (FALSY.has(str)) return false;
  return null;
}

export function parseUserWorkbook(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
}

export function validateUserImport(
  rows: Record<string, unknown>[],
  existingUsers: User[],
  roles: AppRole[],
): UserImportReport {
  const errors: UserImportError[] = [];
  const warnings: UserImportWarning[] = [];
  const creates: ParsedUserRow[] = [];
  const updates: ParsedUserRow[] = [];

  const usersByEmail = new Map<string, User>();
  for (const u of existingUsers) usersByEmail.set(u.email.toLowerCase(), u);

  const knownRoleKeys = new Set(roles.filter((r) => !r.is_archived).map((r) => r.key));
  const seenEmails = new Set<string>();
  let skipped = 0;

  rows.forEach((raw, idx) => {
    const rowNum = idx + 2; // header is row 1, data starts at row 2

    const email = s(raw.email).toLowerCase();
    const displayName = s(raw.display_name);

    // Fully-blank row → skip silently (common when admins leave trailing rows)
    if (!email && !displayName && !s(raw.role)) {
      skipped++;
      return;
    }

    if (!email) {
      errors.push({ row: rowNum, column: "email", message: `Row ${rowNum}: email is required` });
      return;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push({
        row: rowNum,
        column: "email",
        message: `Row ${rowNum}: '${email}' is not a valid email address`,
      });
      return;
    }
    if (seenEmails.has(email)) {
      errors.push({
        row: rowNum,
        column: "email",
        message: `Row ${rowNum}: email '${email}' appears more than once in the file`,
      });
      return;
    }
    seenEmails.add(email);

    if (!displayName) {
      errors.push({
        row: rowNum,
        column: "display_name",
        message: `Row ${rowNum}: display_name is required`,
      });
      return;
    }

    const role = s(raw.role) || "viewer";
    if (!knownRoleKeys.has(role)) {
      errors.push({
        row: rowNum,
        column: "role",
        message: `Row ${rowNum}: unknown role '${role}'`,
      });
      return;
    }

    const password = s(raw.password) || undefined;
    const locale = s(raw.locale) || undefined;

    // Optional `auth_provider` column from the export sheet. When set,
    // forwards to the backend so a row tagged «local» lands as a local
    // account even in SSO-enabled tenants (and vice versa). Empty cells
    // fall back to the backend's heuristic (local iff a password is set).
    const providerRaw = s(raw.auth_provider).toLowerCase();
    let authProvider: "local" | "sso" | undefined;
    if (providerRaw === "local" || providerRaw === "sso") {
      authProvider = providerRaw;
    } else if (providerRaw) {
      errors.push({
        row: rowNum,
        column: "auth_provider",
        message: `Row ${rowNum}: auth_provider must be 'local' or 'sso' (got '${providerRaw}')`,
      });
      return;
    }
    if (authProvider === "local" && !password && !usersByEmail.has(email)) {
      errors.push({
        row: rowNum,
        column: "password",
        message: `Row ${rowNum}: a password is required when auth_provider is 'local'`,
      });
      return;
    }

    const existing = usersByEmail.get(email);

    if (existing) {
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      if (existing.display_name !== displayName) {
        changes.display_name = { old: existing.display_name, new: displayName };
      }
      if (existing.role !== role) {
        changes.role = { old: existing.role, new: role };
      }
      if (locale && existing.locale !== locale) {
        changes.locale = { old: existing.locale || "", new: locale };
      }
      const isActiveRaw = parseBool(raw.is_active);
      if (isActiveRaw !== null && existing.is_active !== isActiveRaw) {
        changes.is_active = { old: existing.is_active, new: isActiveRaw };
      }
      if (password) {
        changes.password = { old: "••••••", new: "••••••" };
      }
      if (Object.keys(changes).length === 0) {
        // No-op update — drop the row but mention it as a warning so the
        // admin can see we noticed it.
        warnings.push({
          row: rowNum,
          message: `Row ${rowNum}: user '${email}' already up to date`,
        });
        skipped++;
        return;
      }
      updates.push({
        rowIndex: rowNum,
        email,
        display_name: displayName,
        role,
        password,
        locale,
        existing,
        changes,
      });
    } else {
      creates.push({
        rowIndex: rowNum,
        email,
        display_name: displayName,
        role,
        password,
        locale,
        auth_provider: authProvider,
      });
    }
  });

  return {
    errors,
    warnings,
    creates,
    updates,
    skipped,
    totalRows: rows.length,
  };
}

interface UserCreateResponse {
  id?: string;
  email_error?: string;
  email_sent?: boolean;
}

export async function executeUserImport(
  report: UserImportReport,
  sendInvites: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<UserImportResult> {
  const result: UserImportResult = {
    created: 0,
    updated: 0,
    failed: 0,
    failedDetails: [],
  };

  const total = report.creates.length + report.updates.length;
  let done = 0;

  for (const row of report.creates) {
    try {
      const created = await api.post<UserCreateResponse>("/users", {
        email: row.email,
        display_name: row.display_name,
        password: row.password || null,
        role: row.role,
        send_email: sendInvites,
        ...(row.auth_provider ? { auth_provider: row.auth_provider } : {}),
      });
      result.created++;
      if (sendInvites && created.email_error) {
        // Surface the SMTP failure as a per-row error in the Done step. The
        // user account itself was created, so don't bump `failed`.
        result.failedDetails.push({
          row: row.rowIndex,
          message: `${row.email}: ${created.email_error}`,
        });
      }
    } catch (err) {
      result.failed++;
      result.failedDetails.push({
        row: row.rowIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    done++;
    onProgress?.(done, total);
  }

  for (const row of report.updates) {
    if (!row.existing) continue;
    const payload: Record<string, unknown> = {};
    if (row.changes?.display_name) payload.display_name = row.display_name;
    if (row.changes?.role) payload.role = row.role;
    if (row.changes?.locale && row.locale) payload.locale = row.locale;
    if (row.changes?.is_active !== undefined) {
      payload.is_active = row.changes.is_active.new;
    }
    if (row.password) payload.password = row.password;

    try {
      await api.patch(`/users/${row.existing.id}`, payload);
      result.updated++;
    } catch (err) {
      result.failed++;
      result.failedDetails.push({
        row: row.rowIndex,
        message: err instanceof Error ? err.message : String(err),
      });
    }
    done++;
    onProgress?.(done, total);
  }

  return result;
}
