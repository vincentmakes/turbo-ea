import { type BrowserContext, type APIRequestContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@turboea.demo";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "TurboEA!2025";

const AUTH_STATE_FILE = path.join(__dirname, "../.auth/admin.json");

/**
 * Verify that auth state exists (created by globalSetup).
 * With storageState configured in playwright.config.ts, all contexts automatically
 * restore auth cookies and storage, so we just need to verify the state file exists.
 */
export async function loginAsAdmin(
  _context: BrowserContext,
  _baseURL: string,
): Promise<string> {
  if (!fs.existsSync(AUTH_STATE_FILE)) {
    throw new Error(
      `Auth state file not found: ${AUTH_STATE_FILE}. Did globalSetup run successfully?`,
    );
  }
  // Auth state is already applied via playwright.config.ts storageState
  return "authenticated-via-storage-state";
}

export async function enableArchiMate(
  request: APIRequestContext,
  baseURL: string,
  token: string,
): Promise<void> {
  const resp = await request.patch(`${baseURL}/api/v1/settings/archimate-enabled`, {
    data: { enabled: true },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok()) {
    throw new Error(`Failed to enable ArchiMate: ${resp.status()}`);
  }
}

export async function disableArchiMate(
  request: APIRequestContext,
  baseURL: string,
  token: string,
): Promise<void> {
  const resp = await request.patch(`${baseURL}/api/v1/settings/archimate-enabled`, {
    data: { enabled: false },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok()) {
    throw new Error(`Failed to disable ArchiMate: ${resp.status()}`);
  }
}
