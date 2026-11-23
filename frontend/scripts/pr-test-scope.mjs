#!/usr/bin/env node
/**
 * Decide which Vitest files a pull request's push has to run.
 *
 *   node scripts/pr-test-scope.mjs --event <github event> --diff <name-status file> [--out <paths file>]
 *
 * `Frontend Tests` (ci.yml) used to run all ~800 test files on every frontend
 * change. On a pull request this script narrows that to the tests the diff can
 * reach: it returns `related` with a path list for `vitest related`, which
 * walks every test file's import graph and runs the ones that import a listed
 * path (or are one), or `full` — today's whole-suite run. Pushes to `main`
 * always run `full`; they are the safety net for anything this misses.
 *
 * It FAILS WIDE. Vitest's graph starts at each test file and follows its
 * imports, so it cannot see:
 *  - `setupFiles` (src/test/setup.ts, which imports the whole of `@/i18n` and
 *    `@/lib/agGridSetup`), hence the `src/test/**`, `src/i18n/**` and
 *    `agGridSetup` triggers below;
 *  - the config and the dependency tree (package*.json, vite/vitest config,
 *    tsconfig), hence those triggers;
 *  - a test that reads a file as text instead of importing it (`node:fs`,
 *    `import.meta.glob`, the source-scan helpers, a `?raw` import): those are
 *    the always-run set, found by scanning, added to every related run;
 *  - a path that no longer exists: any deletion, rename or copy under
 *    frontend/ runs everything.
 * A path git had to quote (a tab, a quote, a backslash, a non-ASCII byte the
 * workflow did not ask it to keep) cannot be placed, frontend or not: full.
 * Any other doubt — a status it does not know, a file under frontend/ outside
 * src/ and scripts/, a non-TypeScript file under src/, nothing under src/ or
 * scripts/ changed at all — also returns `full`.
 */
import { readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SELF = "frontend/scripts/pr-test-scope.mjs";

/**
 * Repository-relative paths whose change runs the whole suite. A trailing
 * `/**` matches everything below a directory; a `*` matches any run of
 * characters within one path segment.
 */
export const FULL_RUN_TRIGGERS = [
  SELF,
  ".github/workflows/ci.yml",
  "frontend/package.json",
  "frontend/package-lock.json",
  "frontend/vite.config.ts",
  "frontend/vitest*.ts",
  "frontend/tsconfig*.json",
  "frontend/src/test/**",
  "frontend/src/i18n/**",
  "frontend/src/lib/agGridSetup*",
];

/** True when `file` (repository-relative, POSIX) matches one trigger pattern. */
export function matchesTrigger(file, pattern) {
  if (pattern.endsWith("/**")) return file.startsWith(pattern.slice(0, -2));
  const regex = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${regex}$`).test(file);
}

export function isFullRunTrigger(file) {
  return FULL_RUN_TRIGGERS.some((pattern) => matchesTrigger(file, pattern));
}

/**
 * `git diff --name-status` output → `[{ status, paths }]`. A rename or copy
 * line carries two paths; both are kept. An unparsable line is an error.
 */
export function parseNameStatus(text) {
  const changes = [];
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [status, ...paths] = line.split("\t");
    if (!status || paths.length === 0 || paths.some((p) => p === "")) {
      throw new Error(`pr-test-scope: unreadable diff line ${JSON.stringify(line)}`);
    }
    changes.push({ status, paths });
  }
  return changes;
}

/** A test file that reads files as text: Vitest's import graph cannot see what it reads. */
export const READS_FILES =
  /\bnode:fs\b|\bfrom\s+["']fs(?:\/promises)?["']|\bimport\.meta\.glob\b|\b(?:describeSourceScan|itSourceScan|readFileSync|readdirSync|walkSources)\b|\?(?:raw|url|inline)["']/;

const TEST_FILE = /\.test\.tsx?$/;

/** Test files (frontend-relative) whose source says they read files as text. */
export function alwaysRun(tests) {
  return tests
    .filter(({ source }) => READS_FILES.test(source))
    .map(({ file }) => file)
    .sort();
}

const full = (reason) => ({ mode: "full", reason, paths: [] });

/**
 * The decision. `changes` are repository-relative; the returned `paths` are
 * relative to frontend/, the directory `vitest related` resolves them against.
 * @param {{ event: string, changes: {status: string, paths: string[]}[], always: string[] }} input
 */
export function decideScope({ event, changes, always }) {
  if (event !== "pull_request") return full(`a ${event || "missing"} event, not a pull request`);
  if (changes.length === 0) return full("no changed file listed");
  const selected = new Set();
  for (const { paths } of changes) {
    // git C-quotes a path with a tab, a quote, a backslash or (without
    // core.quotePath=false) a non-ASCII byte: "frontend/src/\303\251.ts".
    // Such a path does not start with frontend/, so it cannot be placed.
    const quoted = paths.find((p) => p.startsWith('"'));
    if (quoted) return full(`unreadable path ${quoted}`);
  }
  for (const { status, paths } of changes) {
    const frontend = paths.filter((p) => p.startsWith("frontend/"));
    for (const file of paths) {
      if (isFullRunTrigger(file)) return full(`${file} changed`);
    }
    if (frontend.length === 0) continue; // cannot reach a Vitest file except as text (always-run)
    if (!/^[AM]$/.test(status)) return full(`${frontend[0]} has status ${status}`);
    const [file] = frontend;
    const rel = file.slice("frontend/".length);
    if (rel.startsWith("src/")) {
      if (!/\.(?:tsx?|json)$/.test(rel)) return full(`${file} is not TypeScript or JSON`);
    } else if (rel.startsWith("scripts/")) {
      if (!/\.(?:mjs|ts)$/.test(rel)) return full(`${file} is not a script Vitest imports`);
    } else {
      return full(`${file} is outside src/ and scripts/`);
    }
    selected.add(rel);
  }
  if (selected.size === 0) return full("nothing under frontend/src or frontend/scripts changed");
  for (const file of always) selected.add(file);
  return { mode: "related", reason: "", paths: [...selected].sort() };
}

/** Every Vitest file under `root` (the frontend directory), with its source. */
export async function readTests(root, dirs = ["src", "scripts"]) {
  const tests = [];
  for (const dir of dirs) {
    const names = await readdir(path.join(root, dir), { recursive: true });
    for (const name of names) {
      const file = `${dir}/${name.split(path.sep).join("/")}`;
      if (!TEST_FILE.test(file) || file.includes("/node_modules/")) continue;
      tests.push({ file, source: await readFile(path.join(root, file), "utf8") });
    }
  }
  return tests;
}

export function parseArgs(argv) {
  const opts = { event: "", diff: "", out: "pr-test-scope.txt" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!["--event", "--diff", "--out"].includes(key)) {
      throw new Error(`pr-test-scope: unknown option ${key}`);
    }
    if (argv[i + 1] === undefined) throw new Error(`pr-test-scope: ${key} needs a value`);
    opts[key.slice(2)] = argv[i + 1];
  }
  if (!opts.diff) throw new Error("pr-test-scope: --diff is required");
  return opts;
}

/**
 * Writes the path list (one per line, empty in `full` mode) and, under
 * Actions, `mode`, `reason`, `paths` and `tests` to $GITHUB_OUTPUT. Never
 * throws: any error is reported and decides `full`.
 */
export async function main(argv, { root, env = process.env, log = console.log } = {}) {
  const frontendRoot = root ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let decision;
  let total = 0;
  let out = path.resolve(frontendRoot, "pr-test-scope.txt");
  try {
    const opts = parseArgs(argv);
    out = path.resolve(frontendRoot, opts.out);
    const tests = await readTests(frontendRoot);
    total = tests.length;
    const changes = parseNameStatus(await readFile(path.resolve(frontendRoot, opts.diff), "utf8"));
    decision = decideScope({ event: opts.event, changes, always: alwaysRun(tests) });
  } catch (e) {
    decision = full(`scope error: ${e.message}`);
    log(`::warning title=Frontend test scope::${decision.reason} — running every test file.`);
  }
  await writeFile(out, decision.paths.map((p) => `${p}\n`).join(""));
  const lines = [
    `mode=${decision.mode}`,
    `reason=${decision.reason.replace(/[\r\n]+/g, " ")}`,
    `paths=${decision.paths.length}`,
    `tests=${total}`,
  ];
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  log(
    decision.mode === "full"
      ? `Frontend test scope: full (${decision.reason})`
      : `Frontend test scope: related — ${decision.paths.length} path(s) for vitest related, of ${total} test files`,
  );
  return decision;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
