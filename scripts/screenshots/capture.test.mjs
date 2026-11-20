import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const locales = ["en", "de", "fr", "es", "it", "pt", "zh", "ru", "da", "ar"];

// Drive the CLI with two demo pages and a local Playwright stand-in. Real output files
// and process exit codes exercise the same contract as the isolated capture container.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "tea-capture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "VERSION"), "test");
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  copyFileSync(new URL("./capture.ts", import.meta.url), join(root, "capture.ts"));
  writeFileSync(join(root, "pages.js"), `
    export const LOCALES = ${JSON.stringify(locales)};
    export const DOC_PAGES = [
      { id: "01_ok", route: "/ok", filenames: { de: "01_gut" } },
      { id: "02_missing", route: "/cards/{{cardId:absent}}", filenames: {} },
    ];
    export const MARKETING_PAGES = [], CARD_LOOKUPS = {}, DIAGRAM_LOOKUPS = {},
      RISK_LOOKUPS = {}, BOOKMARK_LOOKUPS = {};
  `);
  const lib = join(root, "node_modules", "playwright");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, "package.json"), '{"type":"module","main":"index.js"}');
  writeFileSync(join(lib, "index.js"), `
    import { writeFileSync } from "node:fs";
    const ok = { ok: () => true };
    const page = {
      request: {
        post: () => ({ ...ok, json: () => ({ access_token: "test" }) }),
        get: () => ({ ...ok, json: () => ({ id: "user" }) }),
        patch: () => ok,
      },
      goto() {}, evaluate() {}, setViewportSize() {}, waitForTimeout() {},
      screenshot: ({ path }) => writeFileSync(path, "fresh"),
    };
    export const chromium = { launch: () => ({
      newContext: () => ({ newPage: () => page }), close() {},
    }) };
  `);
  function run(...args) {
    const result = spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), "capture.ts", ...args],
      { cwd: root, encoding: "utf8" });
    assert.ifError(result.error);
    return { status: result.status, log: result.stdout + result.stderr };
  }
  return { run, image: (locale, name) => join(root, "docs", "assets", "img", locale, name + ".png") };
}

test("a targeted capture writes the selected screenshot in all ten locales", (t) => {
  const { run, image } = fixture(t);
  const { status, log } = run("--only", "01");
  assert.equal(status, 0, log);
  for (const locale of locales) {
    assert.equal(readFileSync(image(locale, locale === "de" ? "01_gut" : "01_ok"), "utf8"), "fresh");
  }
});

test("a skipped request fails the capture even alongside successes and an old PNG", (t) => {
  const { run, image } = fixture(t);
  const stale = image("en", "02_missing");
  mkdirSync(dirname(stale), { recursive: true });
  writeFileSync(stale, "old");
  const { status, log } = run("--only", "01,02");
  assert.equal(status, 1, log);
  assert.match(log, /02_missing/);
  assert.equal(readFileSync(stale, "utf8"), "old");
  assert.equal(readFileSync(image("ar", "01_ok"), "utf8"), "fresh");
});

test("empty or unmatched ID prefixes fail before capture", (t) => {
  const { run } = fixture(t);
  for (const filter of ["", "01,", "missing", "01,missing"]) {
    const { status, log } = run("--dry-run", "--only", filter);
    assert.equal(status, 1, `filter ${JSON.stringify(filter)}\n${log}`);
    assert.match(log, /--only/);
  }
});
