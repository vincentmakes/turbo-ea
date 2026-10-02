/**
 * The one API login of the run. `/auth/login` is rate-limited and locks an
 * account after five failures, so every spec reuses this saved session; only
 * `login.spec.ts` goes through the form, with a fresh context.
 */
import { test as setup, expect } from "@playwright/test";

import { ADMIN, STORAGE_STATE } from "./fixtures";

setup("sign in as the demo admin through the API", async ({ request }) => {
  const res = await request.post("/api/v1/auth/login", { data: ADMIN });
  expect(res.ok(), `POST /auth/login answered ${res.status()}: ${await res.text()}`).toBeTruthy();
  // The httpOnly access_token cookie rides along in the storage state.
  await request.storageState({ path: STORAGE_STATE });
});
