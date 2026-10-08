#!/usr/bin/env node
/**
 * Merge LCOV reports line by line, ANCHORED on the first report, and
 * optionally enforce a floor on the merged lines percentage.
 *
 *   node scripts/merge-lcov.mjs --out <dir> [--fail-under <pct> | --fail-under-from-package [package.json]] <anchor.info> [<b.info> ...]
 *
 * `Frontend Tests` (ci.yml) feeds it the unit suite's coverage/lcov.info and
 * the browser suite's coverage-e2e/lcov.info. The two come from different
 * pipelines — Vitest remaps V8 ranges through vite's per-module dev transform,
 * the browser report through the minified production bundle's source map — so
 * their statement, branch and function ids and column positions do not agree
 * for the same file. Source LINES do, which is why this merge works on `DA:`
 * records and nothing else. FN/FNDA/BRDA are not emitted; the unit suite's
 * four metrics stay in Vitest's own report.
 *
 * The FIRST report is the anchor and defines the universe: the files it lists
 * and, within each, the lines it lists. A later report can only raise the hit
 * count of a line the anchor already knows (hits are summed); a line it alone
 * lists, or a file it alone lists, is dropped and counted in the diagnostics.
 * Vitest reports every file `coverage.include` matches, tested or not, so the
 * unit report is the complete universe — and anything the browser report adds
 * beyond it is a disagreement between the two pipelines, not coverage: a
 * `v8 ignore` comment the minifier stripped, a statement boundary the
 * production map places on another line, or an `isMeasured` exclusion that
 * drifted from vitest.config.ts. A union let those in as uncovered lines the
 * diff gate then charged to a PR; anchoring means the merge can only ever
 * undercount, never inflate, whichever way the two reports disagree.
 *
 * With one input the output is that input's line view, so the steps that read
 * `<dir>/lcov.info` and `<dir>/coverage-summary.json` never branch on whether
 * the browser suite ran. `.total.lines.pct` uses istanbul's own rounding so it
 * reads like Vitest's json-summary.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {Map<string, Map<number, number>>} LcovData  file → (line → hits) */

/**
 * Parse an LCOV text into file → line → hits. Only `SF:`, `DA:` and
 * `end_of_record` are read; every other record kind is ignored on purpose
 * (see the module comment). A `DA:` outside a file record is an error, not a
 * line to drop: a malformed input must not pass as "nothing covered".
 * @returns {LcovData}
 */
export function parseLcov(text) {
  /** @type {LcovData} */
  const files = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); // a blank line matches no record kind below and is skipped
    if (line.startsWith("SF:")) {
      const sf = line.slice(3);
      current = files.get(sf) ?? new Map();
      files.set(sf, current);
    } else if (line === "end_of_record") {
      current = null;
    } else if (line.startsWith("DA:")) {
      if (!current) throw new Error(`merge-lcov: DA record outside a file record: ${line}`);
      // DA:<line>,<hits>[,<checksum>]
      const [lineNo, hits] = line.slice(3).split(",");
      const n = Number(lineNo);
      const h = Number(hits);
      if (!Number.isInteger(n) || n < 1 || !Number.isFinite(h) || h < 0) {
        throw new Error(`merge-lcov: malformed DA record: ${line}`);
      }
      current.set(n, (current.get(n) ?? 0) + h);
    }
  }
  if (current) throw new Error("merge-lcov: file record without end_of_record");
  return files;
}

/**
 * Merge onto the first input (the anchor): its files and lines are the
 * universe, later inputs only add hits to lines the anchor lists. Everything a
 * later input knows and the anchor does not is dropped and counted.
 * @param {LcovData[]} inputs
 * @returns {{ merged: LcovData, droppedLines: number, droppedFiles: number }}
 */
export function mergeAnchored(inputs) {
  /** @type {LcovData} */
  const merged = new Map();
  const [anchor, ...rest] = inputs;
  for (const [sf, lines] of anchor ?? []) merged.set(sf, new Map(lines));
  let droppedLines = 0;
  let droppedFiles = 0;
  for (const files of rest) {
    for (const [sf, lines] of files) {
      const target = merged.get(sf);
      if (!target) {
        droppedFiles += 1;
        continue;
      }
      for (const [n, hits] of lines) {
        if (target.has(n)) target.set(n, target.get(n) + hits);
        else droppedLines += 1;
      }
    }
  }
  return { merged, droppedLines, droppedFiles };
}

/** The anchored merge's data alone. @param {LcovData[]} inputs @returns {LcovData} */
export function mergeLcov(inputs) {
  return mergeAnchored(inputs).merged;
}

/** Deterministic LCOV text (files and lines sorted) with LF/LH per file. @param {LcovData} merged */
export function formatLcov(merged) {
  const out = [];
  for (const sf of [...merged.keys()].sort()) {
    const lines = merged.get(sf);
    const numbers = [...lines.keys()].sort((a, b) => a - b);
    out.push("TN:", `SF:${sf}`);
    for (const n of numbers) out.push(`DA:${n},${lines.get(n)}`);
    out.push(`LF:${numbers.length}`);
    out.push(`LH:${numbers.filter((n) => lines.get(n) > 0).length}`);
    out.push("end_of_record");
  }
  return out.length ? `${out.join("\n")}\n` : "";
}

/**
 * istanbul's percentage (istanbul-lib-coverage/lib/percent.js), copied so the
 * figure matches Vitest's json-summary to the digit: floor to two decimals,
 * 100 for an empty set.
 */
export function percent(covered, total) {
  if (total <= 0) return 100;
  return Math.floor((1000 * 100 * covered) / total / 10) / 100;
}

/**
 * The shape of Vitest's coverage-summary.json, lines only: `total` plus one
 * entry per file. @param {LcovData} merged
 */
export function summarize(merged) {
  let total = 0;
  let covered = 0;
  const summary = {};
  for (const sf of [...merged.keys()].sort()) {
    const lines = merged.get(sf);
    const fileTotal = lines.size;
    const fileCovered = [...lines.values()].filter((h) => h > 0).length;
    total += fileTotal;
    covered += fileCovered;
    summary[sf] = { lines: { total: fileTotal, covered: fileCovered, skipped: 0, pct: percent(fileCovered, fileTotal) } };
  }
  return { total: { lines: { total, covered, skipped: 0, pct: percent(covered, total) } }, ...summary };
}

/**
 * Lines covered in the merge that the anchor left at zero: what the later
 * inputs contributed. Printed as a diagnostic — a very large number against a
 * small browser suite means a remap went wrong.
 * @param {LcovData} first @param {LcovData} merged
 */
export function linesAddedBeyond(first, merged) {
  let added = 0;
  for (const [sf, lines] of merged) {
    const base = first.get(sf);
    for (const [n, hits] of lines) {
      if (hits > 0 && !(base?.get(n) > 0)) added += 1;
    }
  }
  return added;
}

/**
 * The merged-lines floor: `config.coverageFloorMergedLines` in package.json.
 * A missing key is an error, not "no floor": `--fail-under-from-package` is
 * how CI asks for the gate, and a key lost to a typo must fail the job rather
 * than let every figure through.
 */
export async function readFloor(packageJsonPath) {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const floor = pkg.config?.coverageFloorMergedLines;
  if (floor === undefined) {
    throw new Error(`merge-lcov: config.coverageFloorMergedLines is not set in ${packageJsonPath}`);
  }
  // Number.isFinite is false for every non-number (no coercion), so it is the
  // whole type check; the range then rules out the ±Infinity JSON can carry (1e999).
  if (!Number.isFinite(floor) || floor < 0 || floor > 100) {
    throw new Error(`merge-lcov: config.coverageFloorMergedLines in ${packageJsonPath} must be a number in [0, 100], got ${JSON.stringify(floor)}`);
  }
  return floor;
}

export function parseArgs(argv) {
  const opts = { out: null, failUnder: undefined, failUnderFromPackage: null, inputs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      opts.out = argv[++i];
    } else if (arg === "--fail-under") {
      opts.failUnder = Number(argv[++i]);
      if (!Number.isFinite(opts.failUnder)) throw new Error("merge-lcov: --fail-under needs a number");
    } else if (arg === "--fail-under-from-package") {
      const next = argv[i + 1];
      opts.failUnderFromPackage = next && !next.startsWith("--") && next.endsWith(".json") ? argv[++i] : "package.json";
    } else if (arg.startsWith("--")) {
      throw new Error(`merge-lcov: unknown option ${arg}`);
    } else {
      opts.inputs.push(arg);
    }
  }
  if (!opts.out) throw new Error("merge-lcov: --out <dir> is required");
  if (opts.inputs.length === 0) throw new Error("merge-lcov: at least one LCOV input is required");
  return opts;
}

/**
 * Merge, write `<out>/lcov.info` + `<out>/coverage-summary.json`, report, and
 * return `{ summary, floor, exitCode }`. `exitCode` is 2 when a floor is set
 * and missed; the CLI shim below maps it onto the process, so tests can call
 * `main` directly.
 */
export async function main(argv, { log = console.log, error = console.error } = {}) {
  const opts = parseArgs(argv);
  const inputs = [];
  for (const file of opts.inputs) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (e) {
      throw new Error(`merge-lcov: cannot read ${file}: ${e.message}`);
    }
    if (!text.trim()) throw new Error(`merge-lcov: ${file} is empty`);
    inputs.push(parseLcov(text));
  }
  const { merged, droppedLines, droppedFiles } = mergeAnchored(inputs);
  const summary = summarize(merged);
  await mkdir(opts.out, { recursive: true });
  await writeFile(path.join(opts.out, "lcov.info"), formatLcov(merged));
  await writeFile(path.join(opts.out, "coverage-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  const { total, covered, pct } = summary.total.lines;
  log(`merged ${opts.inputs.length} LCOV report(s) over ${merged.size} files -> ${opts.out}/lcov.info`);
  log(`lines: ${covered}/${total} (${pct}%)`);
  if (inputs.length > 1) {
    log(`lines covered beyond the first report: ${linesAddedBeyond(inputs[0], merged)}`);
    log(`dropped (not in the first report): ${droppedLines} lines, ${droppedFiles} files`);
  }

  let floor = opts.failUnder;
  if (opts.failUnderFromPackage) floor = await readFloor(opts.failUnderFromPackage);
  let exitCode = 0;
  if (floor === undefined) {
    log("no merged-lines floor set");
  } else if (pct < floor) {
    error(`::error::merged line coverage ${pct}% is below the floor of ${floor}%`);
    exitCode = 2;
  } else {
    log(`floor: ${floor}% (met)`);
  }
  return { summary, floor, exitCode };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    });
}
