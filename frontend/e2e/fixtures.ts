/**
 * Shared fixtures for the browser smoke suite.
 *
 * - `demo` (worker-scoped): the ids of the demo cards and diagram the specs
 *   drive, looked up by name through the API with the saved admin session —
 *   never hardcoded, the seed assigns fresh UUIDs on every install. The BPMN
 *   spec needs a draft to save into, so the fixture reuses one or branches one
 *   off the published flow, the way the editor's Edit button does.
 * - `gotoApp`: `domcontentloaded` navigation. The SSE stream keeps the network
 *   busy for the life of the tab, so `networkidle` never arrives.
 * - `drawio` / `waitForDrawio`: the DrawIO iframe, ready once the SPA's
 *   bootstrap has put the graph on `window.__turboGraph`.
 * - `page` (override): with `E2E_COVERAGE=1`, records Chromium's V8 coverage
 *   of the SPA's `/assets/*.js` chunks into `.e2e-coverage/<testId>-<retry>.json`
 *   (a V8 `ProcessCov`, `{ result: ScriptCov[] }`), one file per test so a
 *   worker restart loses nothing already written. `scripts/e2e-coverage.mjs`
 *   remaps them onto the sources and `Frontend Tests` (ci.yml) merges that
 *   with the unit suite's coverage. Every spec imports `test` from here —
 *   `login.spec.ts` included — so the fixture reaches them all. A second page
 *   (`context.newPage()`, a popup) is not recorded; no spec opens one.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, expect, type APIRequestContext, type Frame, type FrameLocator, type Page } from "@playwright/test";

import { t } from "./i18n";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:4173";
/** Where `auth.setup.ts` saves the admin session; the chromium project loads it. */
export const STORAGE_STATE = path.join(E2E_DIR, ".auth", "admin.json");
/** The demo admin the seed creates (`SEED_DEMO=true`). */
export const ADMIN = { email: "admin@turboea.demo", password: "TurboEA!2025" };

/** `E2E_COVERAGE=1`: record the SPA's V8 coverage (ci.yml, `make e2e-coverage`). */
const COLLECT_COVERAGE = process.env.E2E_COVERAGE === "1";
/** Raw recordings, one file per test; `scripts/e2e-coverage.mjs` converts them. */
export const COVERAGE_DIR = path.join(E2E_DIR, "..", ".e2e-coverage");
/** The SPA's own chunks. DrawIO's /drawio/js/*.js has no map to src/ and would only bloat the files. Same regex in scripts/e2e-coverage.mjs. */
const APP_ASSET = /\/assets\/[^/?#]+\.js$/;

export interface DemoData {
  /** "Application Landscape Overview": 8 application cells, 3 relation edges. */
  landscapeDiagramId: string;
  /** The "SAP S/4HANA" Application card. */
  sapId: string;
  /** The "Order to Cash" Business Process card (a published flow). */
  orderToCashId: string;
  /** A draft flow version of Order to Cash the modeler can save into. */
  orderToCashDraftId: string;
  /** The "SAP S/4HANA Migration" Initiative (WBS, tasks and two milestones). */
  migrationId: string;
}

interface Named {
  id: string;
  name: string;
}

export async function findCard(api: APIRequestContext, type: string, name: string): Promise<string> {
  const res = await api.get(
    `/api/v1/cards?type=${encodeURIComponent(type)}&search=${encodeURIComponent(name)}&page_size=10`,
  );
  expect(res.ok(), `GET /cards for "${name}" answered ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { items: Named[] };
  const hit = body.items.find((c) => c.name === name);
  if (!hit) throw new Error(`demo card "${name}" (${type}) not found — is the backend seeded with SEED_DEMO=true?`);
  return hit.id;
}

export async function findDiagram(api: APIRequestContext, name: string): Promise<string> {
  const res = await api.get(`/api/v1/diagrams?search=${encodeURIComponent(name)}`);
  expect(res.ok(), `GET /diagrams for "${name}" answered ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as Named[] | { items: Named[] };
  const rows = Array.isArray(body) ? body : body.items;
  const hit = rows.find((d) => d.name === name);
  if (!hit) throw new Error(`demo diagram "${name}" not found — is the backend seeded with SEED_DEMO=true?`);
  return hit.id;
}

/** A draft flow version for `processId`: an existing one, else one branched off the published flow. */
export async function ensureDraft(api: APIRequestContext, processId: string): Promise<string> {
  const base = `/api/v1/bpm/processes/${processId}/flow`;
  const drafts = await api.get(`${base}/drafts`);
  if (drafts.ok()) {
    const rows = (await drafts.json()) as { id: string }[];
    if (rows.length > 0) return rows[0].id;
  }
  const published = await api.get(`${base}/published`);
  expect(published.ok(), `no published flow for process ${processId}`).toBeTruthy();
  const version = (await published.json()) as { id: string };
  // An empty bpmn_xml tells the backend to clone the base version's.
  const created = await api.post(`${base}/drafts`, { data: { bpmn_xml: "", based_on_id: version.id } });
  expect(created.ok(), `POST ${base}/drafts answered ${created.status()}`).toBeTruthy();
  return ((await created.json()) as { id: string }).id;
}

export async function gotoApp(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
}

const drawioSelector = () => `iframe[title="${t("diagrams:editor.title")}"]`;

/** Locators inside the DrawIO iframe. */
export function drawio(page: Page): FrameLocator {
  return page.frameLocator(drawioSelector());
}

/** The DrawIO frame, once the canvas is up and the SPA has bootstrapped the graph. */
export async function waitForDrawio(page: Page): Promise<Frame> {
  await drawio(page).locator(".geDiagramContainer").waitFor({ state: "visible", timeout: 60_000 });
  const handle = await page.locator(drawioSelector()).elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("the DrawIO iframe has no content frame");
  await expect
    .poll(() => frame.evaluate(() => Boolean((window as unknown as { __turboGraph?: unknown }).__turboGraph)), {
      timeout: 60_000,
      message: "window.__turboGraph never appeared: the SPA did not bootstrap the graph",
    })
    .toBe(true);
  return frame;
}

/** The card and relation cells on the DrawIO canvas, read off the live mxGraph model. */
export function readCanvas(frame: Frame) {
  return frame.evaluate(() => {
    type Cell = {
      id: string;
      edge?: boolean;
      value?: { getAttribute?: (k: string) => string | null };
    };
    const graph = (window as unknown as { __turboGraph: { getModel: () => { cells: Record<string, Cell> } } }).__turboGraph;
    const cells = Object.values(graph.getModel().cells);
    const attr = (c: Cell, k: string) => c.value?.getAttribute?.(k) ?? null;
    return {
      cards: cells
        .filter((c) => !c.edge && attr(c, "cardId"))
        .map((c) => ({ cellId: c.id, cardId: attr(c, "cardId"), parentGroupCell: attr(c, "parentGroupCell") })),
      edges: cells.filter((c) => c.edge).map((c) => ({ cellId: c.id, relationId: attr(c, "relationId") })),
    };
  });
}

export const test = base.extend<Record<string, never>, { demo: DemoData }>({
  // The callback is `run`, not Playwright's customary `use`: in a function
  // named `page`, eslint's rules-of-hooks reads `use(...)` as a React hook.
  page: async ({ page }, run, testInfo) => {
    if (!COLLECT_COVERAGE) {
      await run(page);
      return;
    }
    // Before the first navigation, and kept across the SPA's client-side routing.
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await run(page);
    if (page.isClosed()) return;
    const entries = await page.coverage.stopJSCoverage();
    // `source` is the chunk text (the converter reads dist/assets/ instead) and
    // DrawIO's scripts carry tens of MB of ranges per diagram test: both dropped.
    const result = entries
      .filter((entry) => APP_ASSET.test(new URL(entry.url).pathname))
      .map(({ url, scriptId, functions }) => ({ url, scriptId, functions }));
    await fs.mkdir(COVERAGE_DIR, { recursive: true });
    await fs.writeFile(path.join(COVERAGE_DIR, `${testInfo.testId}-${testInfo.retry}.json`), JSON.stringify({ result }));
  },
  demo: [
    async ({ playwright }, use) => {
      const api = await playwright.request.newContext({ baseURL: BASE_URL, storageState: STORAGE_STATE });
      try {
        const [landscapeDiagramId, sapId, orderToCashId, migrationId] = await Promise.all([
          findDiagram(api, "Application Landscape Overview"),
          findCard(api, "Application", "SAP S/4HANA"),
          findCard(api, "BusinessProcess", "Order to Cash"),
          findCard(api, "Initiative", "SAP S/4HANA Migration"),
        ]);
        const orderToCashDraftId = await ensureDraft(api, orderToCashId);
        await use({ landscapeDiagramId, sapId, orderToCashId, orderToCashDraftId, migrationId });
      } finally {
        await api.dispose();
      }
    },
    { scope: "worker" },
  ],
});

export { expect };
