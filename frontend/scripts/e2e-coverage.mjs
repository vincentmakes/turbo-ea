#!/usr/bin/env node
/**
 * Turn the browser suite's raw V8 coverage into an LCOV report of the SPA's
 * sources.
 *
 *   node scripts/e2e-coverage.mjs [--raw .e2e-coverage] [--dist dist] [--out coverage-e2e] [--root ..]
 *
 * With `E2E_COVERAGE=1`, the `page` fixture in e2e/fixtures.ts records
 * Chromium's coverage of every `/assets/*.js` chunk a test loaded, one JSON
 * file per test under .e2e-coverage/. This script merges those recordings
 * (counts accumulate across tests), remaps each chunk through the build's own
 * source map (vite's `build.sourcemap: true`) with `ast-v8-to-istanbul` — the
 * converter Vitest uses, AST-based so a minified one-line chunk is not read as
 * one statement — keeps the same files vitest.config.ts measures, and writes
 * coverage-e2e/lcov.info with `SF:` paths rooted at the repository
 * (`frontend/src/...`), like Vitest's own LCOV. `Frontend Tests` (ci.yml)
 * merges the two line by line with scripts/merge-lcov.mjs.
 *
 * Every "nothing to report" case is an error: no recordings, no app chunk in
 * them, no measured source file. A silent empty report would publish a
 * unit-only figure as the merged one.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { mergeProcessCovs } from "@bcoe/v8-coverage";
import { convert } from "ast-v8-to-istanbul";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { parseAstAsync } from "vite";

// The one definition of "an app chunk", shared with the recording side (e2e/fixtures.ts).
import { APP_ASSET, isAppAsset } from "./app-asset.mjs";

export { APP_ASSET, isAppAsset };

/**
 * Mirrors vitest.config.ts `coverage.include` / `coverage.exclude`:
 * src/**\/*.{ts,tsx} minus the tests, the test kit and main.tsx.
 * @param {string} relPath POSIX path relative to frontend/
 */
export function isMeasured(relPath) {
  if (!relPath.startsWith("src/")) return false;
  if (!/\.tsx?$/.test(relPath)) return false;
  if (/\.test\.tsx?$/.test(relPath)) return false;
  if (relPath.startsWith("src/test/")) return false;
  if (relPath === "src/main.tsx") return false;
  return true;
}

export function toPosixRelative(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

/** Every recording in `rawDir`, as V8 ProcessCov objects (`{ result: ScriptCov[] }`). */
export async function readRecordings(rawDir) {
  let names;
  try {
    names = await readdir(rawDir);
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(`e2e-coverage: no recordings directory ${rawDir} — was Playwright run with E2E_COVERAGE=1?`);
    }
    throw e;
  }
  const files = names.filter((n) => n.endsWith(".json")).sort();
  if (files.length === 0) throw new Error(`e2e-coverage: no recordings in ${rawDir} — was Playwright run with E2E_COVERAGE=1?`);
  return Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(rawDir, name), "utf8"))));
}

/**
 * One ScriptCov per app chunk URL, with the counts of every recording that
 * loaded it accumulated. Non-app scripts are dropped first.
 * @returns {Array<{ url: string, functions: object[] }>}
 */
export function mergeRecordings(processCovs) {
  const filtered = processCovs.map((p) => ({
    result: (p.result ?? []).filter((script) => isAppAsset(script.url)),
  }));
  return mergeProcessCovs(filtered).result;
}

/** `dist/assets/<chunk>.js` for a chunk URL the preview server handed out. */
export function chunkPathFor(url, distDir) {
  return path.join(distDir, decodeURIComponent(new URL(url).pathname));
}

/** The chunk's source map: the `//# sourceMappingURL=` comment it ENDS with, else `<chunk>.map`. */
export function sourceMapPathFor(code, jsPath) {
  const match = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/.exec(code);
  if (match && !match[1].startsWith("data:")) return path.resolve(path.dirname(jsPath), match[1]);
  return `${jsPath}.map`;
}

/** Whether a chunk's map names any source this report measures — vendor chunks are skipped unconverted. */
export function mapTouchesSources(sourceMap, jsPath, frontendRoot) {
  const dir = path.dirname(jsPath);
  return (sourceMap.sources ?? []).some((source) => {
    if (!source || source.startsWith("\0")) return false;
    const abs = source.startsWith("file://") ? fileURLToPath(source) : path.resolve(dir, source);
    return isMeasured(toPosixRelative(frontendRoot, abs));
  });
}

/**
 * Remap every chunk's V8 coverage onto the sources and keep the measured ones.
 * @returns {Promise<import("istanbul-lib-coverage").CoverageMap>}
 */
export async function convertCoverage(scripts, { distDir, frontendRoot, log = () => {} }) {
  const map = libCoverage.createCoverageMap({});
  let converted = 0;
  for (const script of scripts) {
    const jsPath = chunkPathFor(script.url, distDir);
    if (!existsSync(jsPath)) {
      throw new Error(
        `e2e-coverage: ${script.url} is not in ${distDir} — the recording was made against another build; rebuild and rerun the suite`,
      );
    }
    const code = await readFile(jsPath, "utf8");
    const mapPath = sourceMapPathFor(code, jsPath);
    if (!existsSync(mapPath)) throw new Error(`e2e-coverage: no source map for ${jsPath} (vite build.sourcemap must stay on)`);
    const sourceMap = JSON.parse(await readFile(mapPath, "utf8"));
    if (!mapTouchesSources(sourceMap, jsPath, frontendRoot)) continue;
    const data = await convert({
      code,
      ast: parseAstAsync(code),
      wrapperLength: 0,
      sourceMap,
      // ast-v8-to-istanbul resolves the map's `sources` against this file's directory.
      coverage: { url: pathToFileURL(jsPath).href, functions: script.functions },
    });
    map.merge(data);
    converted += 1;
  }
  map.filter((file) => existsSync(file) && isMeasured(toPosixRelative(frontendRoot, file)));
  log(`converted ${converted} of ${scripts.length} chunks`);
  return map;
}

/** lcov.info (SF rooted at `projectRoot`), coverage-final.json, coverage-summary.json and a text summary. */
export function writeReports(map, { outDir, projectRoot }) {
  const context = libReport.createContext({ dir: outDir, coverageMap: map });
  for (const [name, options] of [
    ["lcovonly", { projectRoot }],
    ["json", {}],
    ["json-summary", {}],
    ["text-summary", {}],
  ]) {
    reports.create(name, options).execute(context);
  }
}

export function parseArgs(argv, frontendRoot) {
  const opts = {
    raw: path.join(frontendRoot, ".e2e-coverage"),
    dist: path.join(frontendRoot, "dist"),
    out: path.join(frontendRoot, "coverage-e2e"),
    root: path.resolve(frontendRoot, ".."),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = arg.replace(/^--/, "");
    // hasOwn, not `in`: `--toString x` must be an unknown option, not a prototype hit.
    if (!arg.startsWith("--") || !Object.hasOwn(opts, key)) throw new Error(`e2e-coverage: unknown option ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`e2e-coverage: ${arg} needs a value`);
    opts[key] = path.resolve(frontendRoot, value);
  }
  return opts;
}

export async function main(argv, { frontendRoot, log = console.log } = {}) {
  const root = frontendRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const opts = parseArgs(argv, root);
  const recordings = await readRecordings(opts.raw);
  const scripts = mergeRecordings(recordings);
  if (scripts.length === 0) {
    throw new Error(`e2e-coverage: ${recordings.length} recording(s) but none of them covers an /assets/*.js chunk`);
  }
  const map = await convertCoverage(scripts, { distDir: opts.dist, frontendRoot: root, log });
  if (map.files().length === 0) throw new Error("e2e-coverage: no measured source file in the recordings");
  writeReports(map, { outDir: opts.out, projectRoot: opts.root });
  log(`${recordings.length} recordings, ${scripts.length} chunks, ${map.files().length} source files -> ${opts.out}/lcov.info`);
  return { recordings: recordings.length, chunks: scripts.length, files: map.files().length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
