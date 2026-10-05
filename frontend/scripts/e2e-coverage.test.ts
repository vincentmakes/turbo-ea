// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { transformWithEsbuild } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import {
  chunkPathFor,
  convertCoverage,
  isAppAsset,
  isMeasured,
  main,
  mapTouchesSources,
  mergeRecordings,
  readRecordings,
  sourceMapPathFor,
  writeReports,
} from "./e2e-coverage.mjs";

describe("isAppAsset", () => {
  it("keeps the SPA's chunks whatever the origin", () => {
    expect(isAppAsset("http://localhost:4173/assets/index-Ab12Cd.js")).toBe(true);
    expect(isAppAsset("https://ea.example.com/assets/DiagramEditor-x9.js?v=1")).toBe(true);
  });

  it("drops DrawIO, stylesheets, the document and non-URLs", () => {
    expect(isAppAsset("http://localhost:4173/drawio/js/app.min.js")).toBe(false);
    expect(isAppAsset("http://localhost:4173/assets/index-Ab12Cd.css")).toBe(false);
    expect(isAppAsset("http://localhost:4173/")).toBe(false);
    expect(isAppAsset("data:text/javascript,1")).toBe(false);
    expect(isAppAsset("not a url")).toBe(false);
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
  });

  it("tells a vendor chunk's map from one that touches the sources", () => {
    const js = "/w/frontend/dist/assets/c.js";
    expect(mapTouchesSources({ sources: ["../../node_modules/react/index.js", "\0vite/preload-helper.js"] }, js, "/w/frontend")).toBe(false);
    expect(mapTouchesSources({ sources: ["../../node_modules/react/index.js", "../../src/App.tsx"] }, js, "/w/frontend")).toBe(true);
    expect(mapTouchesSources({ sources: ["../../src/main.tsx"] }, js, "/w/frontend")).toBe(false);
    expect(mapTouchesSources({}, js, "/w/frontend")).toBe(false);
  });
});

describe("mergeRecordings", () => {
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
  return { root, frontendRoot, code, sourcePath };
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

  it("refuses a chunk that is not in dist/", async () => {
    const tree = await buildTree();
    root = tree.root;
    await expect(
      convertCoverage([scriptCov(tree.code, "http://localhost:4173/assets/other-9.js")], {
        distDir: path.join(tree.frontendRoot, "dist"),
        frontendRoot: tree.frontendRoot,
      }),
    ).rejects.toThrow(/not in .*dist/);
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
});
