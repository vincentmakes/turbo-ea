import { type BrowserContext, type APIRequestContext } from "@playwright/test";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@turboea.demo";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "TurboEA!2025";

export async function loginAsAdmin(
  context: BrowserContext,
  baseURL: string,
): Promise<string> {
  const response = await context.request.post(`${baseURL}/api/v1/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
  }

  const { access_token } = await response.json();

  // Inject token into sessionStorage for all pages opened in this context
  await context.addInitScript(
    ({ token }) => {
      sessionStorage.setItem("token", token);
    },
    { token: access_token },
  );

  return access_token;
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
