// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { build, transformWithEsbuild } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import { APP_ASSET as LEAF_APP_ASSET, isAppAsset as leafIsAppAsset } from "./app-asset.mjs";
import {
  APP_ASSET,
  chunkPathFor,
  convertCoverage,
  isAppAsset,
  isMeasured,
  main,
  mapTouchesSources,
  mergeRecordings,
  parseArgs,
  readRecordings,
  sourceMapPathFor,
  writeReports,
} from "./e2e-coverage.mjs";
import vitestConfig from "../vitest.config";

describe("isAppAsset", () => {
  it("is the leaf's definition, the one e2e/fixtures.ts records with", () => {
    expect(isAppAsset).toBe(leafIsAppAsset);
    expect(APP_ASSET).toBe(LEAF_APP_ASSET);
  });

  it("keeps the SPA's chunks whatever the origin", () => {
    expect(isAppAsset("http://localhost:4173/assets/index-Ab12Cd.js")).toBe(true);
    expect(isAppAsset("https://ea.example.com/assets/DiagramEditor-x9.js?v=1")).toBe(true);
    expect(isAppAsset("http://localhost:4173/assets/x.js#frag")).toBe(true);
  });

  it("drops DrawIO, stylesheets, the document and non-URLs", () => {
    expect(isAppAsset("http://localhost:4173/drawio/js/app.min.js")).toBe(false);
    expect(isAppAsset("http://localhost:4173/assets/index-Ab12Cd.css")).toBe(false);
    expect(isAppAsset("http://localhost:4173/")).toBe(false);
    expect(isAppAsset("data:text/javascript,1")).toBe(false);
    expect(isAppAsset("not a url")).toBe(false);
    expect(isAppAsset("foo.js")).toBe(false); // an eval'd script's `//# sourceURL`
  });

  it("is anchored at the site root: a vendored bundle's own assets/ directory is not ours", () => {
    expect(isAppAsset("http://localhost:4173/drawio/x/assets/y.js")).toBe(false);
    expect(isAppAsset("http://localhost:4173/assets/sub/x.js")).toBe(false);
    expect(isAppAsset("http://localhost:4173/xassets/x.js")).toBe(false);
    expect(isAppAsset("http://localhost:4173/assets/.js")).toBe(false);
  });
});

describe("isMeasured", () => {
  it("mirrors vitest.config.ts coverage include/exclude", () => {
    expect(isMeasured("src/App.tsx")).toBe(true);
    expect(isMeasured("src/lib/a.ts")).toBe(true);
    expect(isMeasured("src/features/x/Page.test.tsx")).toBe(false);
    expect(isMeasured("src/lib/a.test.ts")).toBe(false);
    expect(isMeasured("src/test/render.tsx")).toBe(false);
    expect(isMeasured("src/main.tsx")).toBe(false);
    expect(isMeasured("src/a.css")).toBe(false);
    expect(isMeasured("node_modules/react/index.js")).toBe(false);
    expect(isMeasured("e2e/fixtures.ts")).toBe(false);
    expect(isMeasured("../other/src/a.ts")).toBe(false);
    expect(isMeasured("srcx/a.ts")).toBe(false);
    expect(isMeasured("src/main.tsx.ts")).toBe(true);
    // The extension tests are anchored at the end of the path.
    expect(isMeasured("src/a.ts.map")).toBe(false);
    expect(isMeasured("src/a.test.ts.helper.ts")).toBe(true);
  });

  it("pins the vitest.config.ts lists it was written against — change both together", () => {
    // The browser report never includes these scripts (the browser never loads
    // them), so they are listed in vitest's include and excluded by isMeasured
    // below without contradiction; merge-lcov.mjs anchors on the unit report
    // anyway, so a drift here can only undercount, never inflate the figure.
    const coverage = vitestConfig.test!.coverage as { include: string[]; exclude: string[] };
    expect(coverage.include, "update isMeasured in scripts/e2e-coverage.mjs").toEqual([
      "src/**/*.{ts,tsx}",
      "scripts/app-asset.mjs",
      "scripts/e2e-coverage.mjs",
      "scripts/merge-lcov.mjs",
    ]);
    expect(coverage.exclude, "update isMeasured in scripts/e2e-coverage.mjs").toEqual([
      "src/test/**",
      "src/**/*.test.{ts,tsx}",
      "src/main.tsx",
    ]);
    for (const script of coverage.include.filter((p) => p.startsWith("scripts/"))) {
      expect(isMeasured(script)).toBe(false);
    }
  });
});

describe("parseArgs", () => {
  const root = "/w/frontend";

  it("defaults every path under the frontend root", () => {
    expect(parseArgs([], root)).toEqual({
      raw: "/w/frontend/.e2e-coverage",
      dist: "/w/frontend/dist",
      out: "/w/frontend/coverage-e2e",
      root: "/w",
    });
  });

  it("resolves a given value against the frontend root", () => {
    const opts = parseArgs(["--raw", "rec", "--dist", "/abs/dist", "--out", "o", "--root", ".."], root);
    expect(opts).toEqual({ raw: "/w/frontend/rec", dist: "/abs/dist", out: "/w/frontend/o", root: "/w" });
  });

  it("refuses an unknown option, a positional, a missing value and a prototype name", () => {
    expect(() => parseArgs(["--bogus", "x"], root)).toThrow(/unknown option --bogus/);
    expect(() => parseArgs(["positional"], root)).toThrow(/unknown option positional/);
    expect(() => parseArgs(["raw", "x"], root)).toThrow(/unknown option raw/); // a known key still needs its dashes
    expect(() => parseArgs(["--raw"], root)).toThrow(/--raw needs a value/);
    for (const name of ["--toString", "--constructor", "--hasOwnProperty", "--__proto__"]) {
      expect(() => parseArgs([name, "x"], root)).toThrow(/unknown option/);
    }
  });
});

describe("paths", () => {
  it("maps a chunk URL onto dist/", () => {
    expect(chunkPathFor("http://localhost:4173/assets/index-Ab12.js", "/w/frontend/dist")).toBe(
      path.join("/w/frontend/dist", "assets", "index-Ab12.js"),
    );
  });

  it("finds the source map from the trailing comment, else beside the chunk", () => {
    expect(sourceMapPathFor("x();\n//# sourceMappingURL=index-Ab12.js.map\n", "/d/assets/index-Ab12.js")).toBe(
      "/d/assets/index-Ab12.js.map",
    );
    expect(sourceMapPathFor("x();\n//# sourceMappingURL=maps/i.map", "/d/assets/i.js")).toBe("/d/assets/maps/i.map");
    expect(sourceMapPathFor("x();\n", "/d/assets/i.js")).toBe("/d/assets/i.js.map");
    expect(sourceMapPathFor("x();\n//# sourceMappingURL=data:application/json;base64,e30=", "/d/assets/i.js")).toBe(
      "/d/assets/i.js.map",
    );
    // The `@` form, no space after the marker, and trailing whitespace all count.
    expect(sourceMapPathFor("x();\n//@sourceMappingURL=a.map  \n\n", "/d/assets/i.js")).toBe("/d/assets/a.map");
    // Only a comment that ENDS the chunk names its map; one in the middle is someone else's.
    expect(sourceMapPathFor("//# sourceMappingURL=mid.map\nx();\n", "/d/assets/i.js")).toBe("/d/assets/i.js.map");
  });

  it("tells a vendor chunk's map from one that touches the sources", () => {
    const js = "/w/frontend/dist/assets/c.js";
    expect(mapTouchesSources({ sources: ["../../node_modules/react/index.js", "\0vite/preload-helper.js"] }, js, "/w/frontend")).toBe(false);
    expect(mapTouchesSources({ sources: ["../../node_modules/react/index.js", "../../src/App.tsx"] }, js, "/w/frontend")).toBe(true);
    expect(mapTouchesSources({ sources: ["../../src/main.tsx"] }, js, "/w/frontend")).toBe(false);
    expect(mapTouchesSources({ sources: ["file:///w/frontend/src/App.tsx"] }, js, "/w/frontend")).toBe(true);
    expect(mapTouchesSources({ sources: ["file:///elsewhere/src/App.tsx"] }, js, "/w/frontend")).toBe(false);
    expect(mapTouchesSources({ sources: [""] }, js, "/w/frontend")).toBe(false);
    expect(mapTouchesSources({}, js, "/w/frontend")).toBe(false);
  });
});

describe("mergeRecordings", () => {
  it("tolerates a recording without a result list", () => {
    expect(mergeRecordings([{}, { result: [] }])).toEqual([]);
  });

  it("accumulates counts per app chunk across recordings and drops other scripts", () => {
    const fn = (count: number) => ({
      functionName: "f",
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: 10, count }],
    });
    const merged = mergeRecordings([
      {
        result: [
          { scriptId: "1", url: "http://localhost:4173/assets/a.js", functions: [fn(0)] },
          { scriptId: "2", url: "http://localhost:4173/drawio/js/app.min.js", functions: [fn(7)] },
        ],
      },
      { result: [{ scriptId: "9", url: "http://localhost:4173/assets/a.js", functions: [fn(1)] }] },
    ]);
    expect(merged.map((s) => s.url)).toEqual(["http://localhost:4173/assets/a.js"]);
    expect(merged[0].functions[0].ranges[0].count).toBe(1);
  });
});

describe("readRecordings", () => {
  it("names the env var when the directory is missing or empty", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "e2e-cov-"));
    try {
      await expect(readRecordings(path.join(dir, "nope"))).rejects.toThrow(/E2E_COVERAGE=1/);
      await expect(readRecordings(dir)).rejects.toThrow(/no recordings/);
      await writeFile(path.join(dir, "t1-0.json"), JSON.stringify({ result: [] }));
      await writeFile(path.join(dir, "notes.txt"), "ignored");
      expect(await readRecordings(dir)).toEqual([{ result: [] }]);
      // Any other failure to list the directory is reported as itself.
      await expect(readRecordings(path.join(dir, "notes.txt"))).rejects.toThrow(/ENOTDIR/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * A tiny build: one TypeScript source, minified the way vite's build output is
 * (whitespace and syntax, identifiers kept so the test can find the functions),
 * with Rollup's relative `sources`. The chunk ends up on ONE line, which is the
 * case a line-based converter gets wrong and an AST-based one does not.
 */
async function buildTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), "e2e-cov-tree-"));
  const frontendRoot = path.join(root, "frontend");
  const srcDir = path.join(frontendRoot, "src", "lib");
  const distAssets = path.join(frontendRoot, "dist", "assets");
  await mkdir(srcDir, { recursive: true });
  await mkdir(distAssets, { recursive: true });
  const source = ["export function add(a: number, b: number) {", "  return a + b;", "}", "export function sub(a: number, b: number) {", "  return a - b;", "}", ""].join("\n");
  const sourcePath = path.join(srcDir, "sum.ts");
  await writeFile(sourcePath, source);
  const result = await transformWithEsbuild(source, sourcePath, {
    loader: "ts",
    format: "esm",
    minifyWhitespace: true,
    minifySyntax: true,
    minifyIdentifiers: false,
    sourcemap: true,
    sourcefile: "sum.ts",
  });
  const map = { ...(result.map as object), sources: ["../../src/lib/sum.ts"] } as Record<string, unknown>;
  const code = `${result.code.trimEnd()}\n//# sourceMappingURL=sum-x1.js.map\n`;
  await writeFile(path.join(distAssets, "sum-x1.js"), code);
  await writeFile(path.join(distAssets, "sum-x1.js.map"), JSON.stringify(map));
  // A vendor chunk: the same shape, but its map names only node_modules.
  const vendorMap = { ...(result.map as object), sources: ["../../node_modules/x/index.js"] };
  const vendorCode = `${result.code.trimEnd()}\n//# sourceMappingURL=vendor-x2.js.map\n`;
  await writeFile(path.join(distAssets, "vendor-x2.js"), vendorCode);
  await writeFile(path.join(distAssets, "vendor-x2.js.map"), JSON.stringify(vendorMap));
  return { root, frontendRoot, code, sourcePath, vendorCode };
}

/**
 * A real vite build of a tiny project, so ONE chunk's map names several
 * sources: two measured files that exist, one that exists but is excluded
 * (src/main.tsx) and one that was deleted after the build. The converter must
 * keep exactly the first two.
 */
async function buildViteTree() {
  const root = await mkdtemp(path.join(os.tmpdir(), "e2e-cov-vite-"));
  const frontendRoot = path.join(root, "frontend");
  const src = path.join(frontendRoot, "src");
  await mkdir(path.join(src, "lib"), { recursive: true });
  await writeFile(path.join(src, "lib", "sum.ts"), "export function add(a: number, b: number) {\n  return a + b;\n}\n");
  await writeFile(path.join(src, "lib", "ghost.ts"), "export const GHOST = 'ghost';\n");
  await writeFile(path.join(src, "main.tsx"), "export const MAIN = 'main';\n");
  await writeFile(
    path.join(src, "entry.ts"),
    "import { add } from './lib/sum';\nimport { GHOST } from './lib/ghost';\nimport { MAIN } from '../src/main';\nconsole.log(add(1, 2), GHOST, MAIN);\n",
  );
  await build({
    root: frontendRoot,
    configFile: false,
    logLevel: "silent",
    build: {
      outDir: "dist",
      sourcemap: true,
      minify: true,
      rollupOptions: { input: path.join(src, "entry.ts"), output: { entryFileNames: "assets/[name]-v1.js" } },
    },
  });
  await rm(path.join(src, "lib", "ghost.ts"));
  const jsPath = path.join(frontendRoot, "dist", "assets", "entry-v1.js");
  const code = await readFile(jsPath, "utf8");
  return { root, frontendRoot, src, code };
}

function scriptCov(code: string, url: string) {
  const fnRange = (name: string, count: number) => {
    const start = code.indexOf(`function ${name}`);
    const end = code.indexOf("}", start) + 1;
    expect(start, `function ${name} in ${code}`).toBeGreaterThanOrEqual(0);
    return { functionName: name, isBlockCoverage: true, ranges: [{ startOffset: start, endOffset: end, count }] };
  };
  return {
    scriptId: "1",
    url,
    functions: [
      { functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }] },
      fnRange("add", 3),
      fnRange("sub", 0),
    ],
  };
}

describe("convertCoverage + writeReports", () => {
  let root: string;
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("remaps a minified one-line chunk onto its TypeScript source, line by line", async () => {
    const tree = await buildTree();
    root = tree.root;
    expect(tree.code.split("\n").filter((l) => l && !l.startsWith("//#")).length).toBe(1);
    const url = "http://localhost:4173/assets/sum-x1.js";
    const map = await convertCoverage([scriptCov(tree.code, url)], {
      distDir: path.join(tree.frontendRoot, "dist"),
      frontendRoot: tree.frontendRoot,
    });
    expect(map.files()).toEqual([tree.sourcePath]);
    const lines = map.fileCoverageFor(tree.sourcePath).getLineCoverage();
    expect(lines[2]).toBeGreaterThan(0); // return a + b
    expect(lines[5]).toBe(0); // return a - b

    const outDir = path.join(root, "coverage-e2e");
    writeReports(map, { outDir, projectRoot: root });
    const lcov = await readFile(path.join(outDir, "lcov.info"), "utf8");
    expect(lcov).toContain("SF:frontend/src/lib/sum.ts");
    expect(lcov).toMatch(/DA:2,[1-9]/);
    expect(lcov).toContain("DA:5,0");
    const summary = JSON.parse(await readFile(path.join(outDir, "coverage-summary.json"), "utf8"));
    expect(summary.total.lines.total).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(path.join(outDir, "coverage-final.json"), "utf8"))[tree.sourcePath]).toBeTruthy();
  });

  it("refuses a chunk that is not in dist/, and one without a source map", async () => {
    const tree = await buildTree();
    root = tree.root;
    const opts = { distDir: path.join(tree.frontendRoot, "dist"), frontendRoot: tree.frontendRoot };
    await expect(convertCoverage([scriptCov(tree.code, "http://localhost:4173/assets/other-9.js")], opts)).rejects.toThrow(
      /not in .*dist/,
    );
    await rm(path.join(opts.distDir, "assets", "sum-x1.js.map"));
    await expect(convertCoverage([scriptCov(tree.code, "http://localhost:4173/assets/sum-x1.js")], opts)).rejects.toThrow(
      /no source map for .*sum-x1\.js \(vite build\.sourcemap must stay on\)/,
    );
  });

  it("skips a vendor chunk unconverted and says how many it converted", async () => {
    const tree = await buildTree();
    root = tree.root;
    const opts = { distDir: path.join(tree.frontendRoot, "dist"), frontendRoot: tree.frontendRoot };
    const logs: string[] = [];
    const vendor = scriptCov(tree.vendorCode, "http://localhost:4173/assets/vendor-x2.js");
    const app = scriptCov(tree.code, "http://localhost:4173/assets/sum-x1.js");
    const both = await convertCoverage([vendor, app], { ...opts, log: (s: string) => logs.push(s) });
    expect(both.files()).toEqual([tree.sourcePath]);
    expect(logs).toEqual(["converted 1 of 2 chunks"]);
    const only = await convertCoverage([vendor], { ...opts, log: (s: string) => logs.push(s) });
    expect(only.files()).toEqual([]);
    expect(logs.at(-1)).toBe("converted 0 of 1 chunks");
  });

  it("keeps only the measured sources that exist when one chunk maps to several files", async () => {
    const tree = await buildViteTree();
    root = tree.root;
    const url = "http://localhost:4173/assets/entry-v1.js";
    const whole = {
      scriptId: "1",
      url,
      functions: [{ functionName: "", isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: tree.code.length, count: 1 }] }],
    };
    const map = await convertCoverage([whole], { distDir: path.join(tree.frontendRoot, "dist"), frontendRoot: tree.frontendRoot });
    // entry.ts and lib/sum.ts: measured and on disk. main.tsx: on disk, excluded.
    // lib/ghost.ts: measured by name, deleted after the build.
    expect(map.files().sort()).toEqual([path.join(tree.src, "entry.ts"), path.join(tree.src, "lib", "sum.ts")]);
  });

  it("resolves the default roots from its own location when none is given", async () => {
    const tree = await buildTree();
    root = tree.root;
    const raw = path.join(tree.frontendRoot, ".e2e-coverage");
    await mkdir(raw);
    await writeFile(path.join(raw, "t1-0.json"), JSON.stringify({ result: [scriptCov(tree.code, "http://localhost:4173/assets/sum-x1.js")] }));
    // Only --raw is pointed at the fixture: dist/ then defaults to the real frontend/dist, which has no such chunk.
    const realDist = path.resolve(__dirname, "..", "dist");
    await expect(main(["--raw", raw], { log: () => {} })).rejects.toThrow(`is not in ${realDist}`);
  });

  it("runs end to end from recordings to lcov.info", async () => {
    const tree = await buildTree();
    root = tree.root;
    const raw = path.join(tree.frontendRoot, ".e2e-coverage");
    await mkdir(raw);
    const url = "http://localhost:4173/assets/sum-x1.js";
    await writeFile(path.join(raw, "t1-0.json"), JSON.stringify({ result: [scriptCov(tree.code, url)] }));
    await writeFile(
      path.join(raw, "t2-0.json"),
      JSON.stringify({ result: [{ scriptId: "5", url: "http://localhost:4173/drawio/js/app.min.js", functions: [] }] }),
    );
    const logs: string[] = [];
    const result = await main([], { frontendRoot: tree.frontendRoot, log: (s: string) => logs.push(s) });
    expect(result).toEqual({ recordings: 2, chunks: 1, files: 1 });
    expect(logs.at(-1)).toMatch(/2 recordings, 1 chunks, 1 source files/);
    expect(await readFile(path.join(tree.frontendRoot, "coverage-e2e", "lcov.info"), "utf8")).toContain(
      "SF:frontend/src/lib/sum.ts",
    );
  });

  it("fails when the recordings hold no app chunk", async () => {
    const tree = await buildTree();
    root = tree.root;
    const raw = path.join(tree.frontendRoot, ".e2e-coverage");
    await mkdir(raw);
    await writeFile(
      path.join(raw, "t1-0.json"),
      JSON.stringify({ result: [{ scriptId: "5", url: "http://localhost:4173/drawio/js/app.min.js", functions: [] }] }),
    );
    await expect(main([], { frontendRoot: tree.frontendRoot, log: () => {} })).rejects.toThrow(/none of them covers/);
  });

  it("fails when the app chunks map to no measured source file", async () => {
    const tree = await buildTree();
    root = tree.root;
    const raw = path.join(tree.frontendRoot, ".e2e-coverage");
    await mkdir(raw);
    const vendor = scriptCov(tree.vendorCode, "http://localhost:4173/assets/vendor-x2.js");
    await writeFile(path.join(raw, "t1-0.json"), JSON.stringify({ result: [vendor] }));
    await expect(main([], { frontendRoot: tree.frontendRoot, log: () => {} })).rejects.toThrow(/no measured source file/);
  });
});
