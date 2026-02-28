#!/usr/bin/env npx tsx
/**
 * Screenshot capture automation for Turbo EA documentation and marketing site.
 *
 * Prerequisites:
 *   1. App running with SEED_DEMO=true (deterministic data)
 *   2. npm install && npm run install-browsers  (inside scripts/screenshots/)
 *
 * Usage:
 *   npx tsx capture.ts                     # All doc screenshots, all locales
 *   npx tsx capture.ts --locale en         # English only
 *   npx tsx capture.ts --locale es         # Spanish only
 *   npx tsx capture.ts --marketing         # Marketing site screenshots
 *   npx tsx capture.ts --marketing --docs  # Both
 *   npx tsx capture.ts --only 01,03,10     # Only specific IDs (prefix match)
 *   npx tsx capture.ts --base-url http://localhost:5173
 *   npx tsx capture.ts --dry-run           # Print what would be captured
 */

import { chromium, type Browser, type Page } from "playwright";
import * as path from "path";
import * as fs from "fs";
import {
  DOC_PAGES,
  MARKETING_PAGES,
  CARD_LOOKUPS,
  type PageDef,
  type ScreenshotAction,
} from "./pages.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface Config {
  baseUrl: string;
  email: string;
  password: string;
  locales: string[];
  captureDocs: boolean;
  captureMarketing: boolean;
  only: string[];
  dryRun: boolean;
  viewport: { width: number; height: number };
}

const DEFAULT_CONFIG: Config = {
  baseUrl: process.env.BASE_URL || "http://localhost:8920",
  email: process.env.SCREENSHOT_EMAIL || "admin@turboea.local",
  password: process.env.SCREENSHOT_PASSWORD || "admin123",
  locales: ["en", "es"],
  captureDocs: true,
  captureMarketing: false,
  only: [],
  dryRun: false,
  viewport: { width: 1280, height: 800 },
};

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--base-url":
        config.baseUrl = args[++i];
        break;
      case "--email":
        config.email = args[++i];
        break;
      case "--password":
        config.password = args[++i];
        break;
      case "--locale":
        config.locales = [args[++i]];
        break;
      case "--marketing":
        config.captureMarketing = true;
        config.captureDocs = false;
        break;
      case "--docs":
        config.captureDocs = true;
        break;
      case "--all":
        config.captureDocs = true;
        config.captureMarketing = true;
        break;
      case "--only":
        config.only = args[++i].split(",").map((s) => s.trim());
        break;
      case "--dry-run":
        config.dryRun = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
        break;
    }
  }

  // If --marketing is passed without --docs, only do marketing
  // If --docs is passed with --marketing, do both
  return config;
}

function printUsage(): void {
  console.log(`
Turbo EA Screenshot Capture

Usage: npx tsx capture.ts [options]

Options:
  --base-url <url>     App base URL (default: http://localhost:8920)
  --email <email>      Login email (default: admin@turboea.local)
  --password <pw>      Login password (default: admin123)
  --locale <code>      Capture only this locale (default: en,es)
  --marketing          Capture marketing screenshots
  --docs               Capture documentation screenshots (default)
  --all                Capture both docs and marketing
  --only <ids>         Comma-separated ID prefixes to capture (e.g., "01,03,10")
  --dry-run            Print planned captures without taking screenshots
  --help               Show this help

Environment variables:
  BASE_URL             Same as --base-url
  SCREENSHOT_EMAIL     Same as --email
  SCREENSHOT_PASSWORD  Same as --password
`);
}

// ---------------------------------------------------------------------------
// Root directory detection
// ---------------------------------------------------------------------------

function getProjectRoot(): string {
  // Walk up from this script to find VERSION file
  let dir = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "VERSION"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("Could not find project root (no VERSION file found)");
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

async function login(
  page: Page,
  config: Config
): Promise<string> {
  console.log(`  Logging in as ${config.email}...`);

  const resp = await page.request.post(`${config.baseUrl}/api/v1/auth/login`, {
    form: {
      username: config.email,
      password: config.password,
    },
  });

  if (!resp.ok()) {
    throw new Error(
      `Login failed (${resp.status()}): ${await resp.text()}`
    );
  }

  const body = await resp.json();
  const token = body.access_token;
  if (!token) throw new Error("No access_token in login response");

  // Inject token into sessionStorage so the SPA picks it up
  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate((t: string) => {
    sessionStorage.setItem("token", t);
  }, token);

  console.log("  Login successful.");
  return token;
}

// ---------------------------------------------------------------------------
// Locale switching
// ---------------------------------------------------------------------------

async function switchLocale(
  page: Page,
  config: Config,
  token: string,
  locale: string
): Promise<void> {
  console.log(`  Switching locale to "${locale}"...`);

  // Update user locale via API
  const resp = await page.request.patch(
    `${config.baseUrl}/api/v1/users/me`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { locale },
    }
  );

  // Some backends may not have a PATCH /users/me for locale.
  // If so, fall back to setting it in localStorage which i18next reads.
  if (!resp.ok()) {
    console.log(`  API locale switch returned ${resp.status()}, setting via localStorage fallback.`);
  }

  await page.evaluate((loc: string) => {
    localStorage.setItem("i18nextLng", loc);
  }, locale);
}

// ---------------------------------------------------------------------------
// Card ID resolution
// ---------------------------------------------------------------------------

async function resolveCardIds(
  page: Page,
  config: Config,
  token: string
): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {};

  for (const [key, lookup] of Object.entries(CARD_LOOKUPS)) {
    console.log(`  Resolving card "${lookup.name}" (${lookup.type})...`);

    const resp = await page.request.get(
      `${config.baseUrl}/api/v1/cards?type=${lookup.type}&search=${encodeURIComponent(lookup.name)}&page_size=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!resp.ok()) {
      console.warn(`  WARNING: Could not search for card "${lookup.name}": ${resp.status()}`);
      continue;
    }

    const body = await resp.json();
    const items = body.items || body;
    if (Array.isArray(items) && items.length > 0) {
      resolved[key] = items[0].id;
      console.log(`  Resolved "${lookup.name}" → ${items[0].id}`);
    } else {
      console.warn(`  WARNING: Card "${lookup.name}" not found. Screenshots referencing it will be skipped.`);
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Route interpolation
// ---------------------------------------------------------------------------

function interpolateRoute(
  route: string,
  cardIds: Record<string, string>
): string | null {
  return route.replace(/\{\{cardId:(\w+)\}\}/g, (_match, key) => {
    const id = cardIds[key];
    if (!id) return "__MISSING__";
    return id;
  });
}

// ---------------------------------------------------------------------------
// Screenshot actions
// ---------------------------------------------------------------------------

async function executeActions(
  page: Page,
  actions: ScreenshotAction[]
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "scroll":
        if (action.target === "bottom") {
          await page.evaluate(() =>
            window.scrollTo(0, document.body.scrollHeight)
          );
        } else if (action.target === "top") {
          await page.evaluate(() => window.scrollTo(0, 0));
        } else {
          // Scroll to a specific element
          await page
            .locator(action.target)
            .first()
            .scrollIntoViewIfNeeded()
            .catch(() => {});
        }
        break;

      case "click":
        try {
          // Try each comma-separated selector (fallback chain)
          const selectors = action.selector.split(",").map((s) => s.trim());
          let clicked = false;
          for (const sel of selectors) {
            const loc = page.locator(sel).first();
            if ((await loc.count()) > 0) {
              await loc.click({ timeout: 3000 });
              clicked = true;
              break;
            }
          }
          if (!clicked) {
            console.warn(`    WARNING: No clickable element found for: ${action.selector}`);
          }
        } catch (e) {
          console.warn(`    WARNING: Click failed for "${action.selector}": ${e}`);
        }
        break;

      case "hover":
        try {
          await page.locator(action.selector).first().hover({ timeout: 3000 });
        } catch (e) {
          console.warn(`    WARNING: Hover failed for "${action.selector}": ${e}`);
        }
        break;

      case "wait":
        await page.waitForTimeout(action.ms);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Core capture loop
// ---------------------------------------------------------------------------

async function capturePage(
  page: Page,
  pageDef: PageDef,
  outputPath: string,
  cardIds: Record<string, string>,
  config: Config,
  locale: string
): Promise<boolean> {
  // Resolve route
  const route = interpolateRoute(pageDef.route, cardIds);
  if (!route || route.includes("__MISSING__")) {
    console.warn(`  SKIP ${pageDef.id}: unresolved card ID in route`);
    return false;
  }

  const fullUrl = `${config.baseUrl}${route}`;

  // Set viewport
  const vp = pageDef.viewport || config.viewport;
  await page.setViewportSize(vp);

  // Navigate
  await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 30000 });

  // Wait for target element
  if (pageDef.waitFor) {
    try {
      // Wait for any of the comma-separated selectors
      const selectors = pageDef.waitFor.split(",").map((s) => s.trim());
      await Promise.race(
        selectors.map((sel) =>
          page.locator(sel).first().waitFor({ state: "visible", timeout: 15000 })
        )
      );
    } catch {
      console.warn(`  WARNING: waitFor selector not found for ${pageDef.id}: ${pageDef.waitFor}`);
      // Continue anyway — page may still be usable
    }
  }

  // Execute actions
  if (pageDef.actions) {
    await executeActions(page, pageDef.actions);
  }

  // Determine filename
  const filename = (pageDef.filenames[locale] || pageDef.id) + ".png";
  const fullPath = path.join(outputPath, filename);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  // Capture
  if (pageDef.clipSelector) {
    const el = page.locator(pageDef.clipSelector).first();
    await el.screenshot({ path: fullPath, type: "png" });
  } else {
    await page.screenshot({ path: fullPath, fullPage: false, type: "png" });
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = parseArgs();
  const root = getProjectRoot();

  console.log("Turbo EA Screenshot Capture");
  console.log("===========================");
  console.log(`Base URL:  ${config.baseUrl}`);
  console.log(`Locales:   ${config.locales.join(", ")}`);
  console.log(`Docs:      ${config.captureDocs}`);
  console.log(`Marketing: ${config.captureMarketing}`);
  if (config.only.length) console.log(`Only:      ${config.only.join(", ")}`);
  if (config.dryRun) console.log("DRY RUN — no screenshots will be saved.\n");
  console.log();

  // Filter pages by --only
  const filterPages = (pages: PageDef[]): PageDef[] => {
    if (!config.only.length) return pages;
    return pages.filter((p) =>
      config.only.some((prefix) => p.id.startsWith(prefix))
    );
  };

  const docPages = config.captureDocs ? filterPages(DOC_PAGES) : [];
  const mktPages = config.captureMarketing ? filterPages(MARKETING_PAGES) : [];
  const totalCount =
    docPages.length * config.locales.length + mktPages.length;

  if (totalCount === 0) {
    console.log("Nothing to capture. Check your --only filter or --locale.");
    return;
  }

  console.log(`Planned: ${totalCount} screenshots\n`);

  if (config.dryRun) {
    for (const locale of config.locales) {
      for (const p of docPages) {
        const filename = (p.filenames[locale] || p.id) + ".png";
        console.log(`  [docs/${locale}] ${filename}  ←  ${p.route}`);
      }
    }
    for (const p of mktPages) {
      const filename = (p.filenames.en || p.id) + ".png";
      console.log(`  [marketing] ${filename}  ←  ${p.route}`);
    }
    return;
  }

  // Launch browser
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 2, // Retina-quality screenshots
    colorScheme: "light",
  });
  const page = await context.newPage();

  try {
    // Login
    const token = await login(page, config);

    // Resolve card IDs from demo data
    const cardIds = await resolveCardIds(page, config, token);

    let captured = 0;
    let skipped = 0;

    // ── Documentation screenshots ──────────────────────────────────────
    for (const locale of config.locales) {
      if (!docPages.length) continue;

      console.log(`\n--- Documentation screenshots (${locale}) ---\n`);
      await switchLocale(page, config, token, locale);

      // Reload to pick up locale change
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
      await page.evaluate((t: string) => {
        sessionStorage.setItem("token", t);
      }, token);

      const outDir = path.join(root, "docs", "assets", "img", locale);

      for (const pageDef of docPages) {
        const filename = (pageDef.filenames[locale] || pageDef.id) + ".png";
        process.stdout.write(`  Capturing ${filename}...`);

        const ok = await capturePage(
          page, pageDef, outDir, cardIds, config, locale
        );

        if (ok) {
          captured++;
          console.log(" done");
        } else {
          skipped++;
          console.log(" skipped");
        }
      }
    }

    // ── Marketing screenshots ──────────────────────────────────────────
    if (mktPages.length) {
      console.log("\n--- Marketing screenshots ---\n");

      // Marketing screenshots are always in English
      await switchLocale(page, config, token, "en");
      await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
      await page.evaluate((t: string) => {
        sessionStorage.setItem("token", t);
      }, token);

      const outDir = path.join(root, "marketing-site", "assets", "screenshots");

      for (const pageDef of mktPages) {
        const filename = (pageDef.filenames.en || pageDef.id) + ".png";
        process.stdout.write(`  Capturing ${filename}...`);

        const ok = await capturePage(
          page, pageDef, outDir, cardIds, config, "en"
        );

        if (ok) {
          captured++;
          console.log(" done");
        } else {
          skipped++;
          console.log(" skipped");
        }
      }
    }

    console.log(`\nDone! Captured: ${captured}, Skipped: ${skipped}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
