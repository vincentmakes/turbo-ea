// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FULL_RUN_TRIGGERS,
  READS_FILES,
  SELF,
  alwaysRun,
  decideScope,
  isFullRunTrigger,
  main,
  matchesTrigger,
  parseArgs,
  parseNameStatus,
  readTests,
} from "./pr-test-scope.mjs";
import vitestConfig from "../vitest.config";

const frontendRoot = path.resolve(__dirname, "..");

const pr = (changes: { status: string; paths: string[] }[], always: string[] = []) =>
  decideScope({ event: "pull_request", changes, always });
const m = (...paths: string[]) => paths.map((p) => ({ status: "M", paths: [p] }));

describe("matchesTrigger", () => {
  it("matches a directory, a stem and an exact path, and nothing beside them", () => {
    expect(matchesTrigger("frontend/src/test/setup.ts", "frontend/src/test/**")).toBe(true);
    expect(matchesTrigger("frontend/src/test/a/b.ts", "frontend/src/test/**")).toBe(true);
    expect(matchesTrigger("frontend/src/testing/a.ts", "frontend/src/test/**")).toBe(false);
    expect(matchesTrigger("frontend/src/test", "frontend/src/test/**")).toBe(false);
    expect(matchesTrigger("frontend/vitest.config.ts", "frontend/vitest*.ts")).toBe(true);
    expect(matchesTrigger("frontend/vitest.ts", "frontend/vitest*.ts")).toBe(true);
    expect(matchesTrigger("frontend/vitestXconfigXts", "frontend/vitest*.ts")).toBe(false);
    expect(matchesTrigger("frontend/vitest/a.ts", "frontend/vitest*.ts")).toBe(false);
    expect(matchesTrigger("frontend/vitest.config.tsx", "frontend/vitest*.ts")).toBe(false);
    expect(matchesTrigger("x/frontend/vitest.config.ts", "frontend/vitest*.ts")).toBe(false);
    expect(matchesTrigger("frontend/vitest.config.ts", "frontend/vitest*")).toBe(true);
    expect(matchesTrigger("frontend/src/lib/agGridSetup.ts", "frontend/src/lib/agGridSetup*")).toBe(true);
    expect(matchesTrigger("frontend/src/lib/agGridSetup/x.ts", "frontend/src/lib/agGridSetup*")).toBe(false);
    expect(matchesTrigger("frontend/src/lib/other.ts", "frontend/src/lib/agGridSetup*")).toBe(false);
    expect(matchesTrigger("frontend/package.json", "frontend/package.json")).toBe(true);
    expect(matchesTrigger("frontend/package.jsonx", "frontend/package.json")).toBe(false);
  });
});

describe("isFullRunTrigger", () => {
  it.each([
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/vite.config.ts",
    "frontend/vitest.config.ts",
    "frontend/vitest.stryker.config.ts",
    "frontend/tsconfig.json",
    "frontend/tsconfig.app.json",
    "frontend/src/test/setup.ts",
    "frontend/src/i18n/index.ts",
    "frontend/src/i18n/locales/de/admin.json",
    "frontend/src/lib/agGridSetup.ts",
    "frontend/src/lib/agGridSetup.test.ts",
    "frontend/scripts/pr-test-scope.mjs",
    ".github/workflows/ci.yml",
  ])("%s runs everything", (file) => {
    expect(isFullRunTrigger(file)).toBe(true);
  });

  it.each([
    "frontend/src/lib/color.ts",
    "frontend/src/App.tsx",
    "frontend/scripts/merge-lcov.mjs",
    "frontend/scripts/pr-test-scope.test.ts",
    "frontend/src/features/i18n-ish/x.ts",
    "backend/app/main.py",
    ".github/workflows/docs.yml",
  ])("%s does not by itself", (file) => {
    expect(isFullRunTrigger(file)).toBe(false);
  });

  it("names the script itself", () => {
    expect(SELF).toBe("frontend/scripts/pr-test-scope.mjs");
    expect(FULL_RUN_TRIGGERS).toContain(SELF);
  });
});

describe("parseNameStatus", () => {
  it("reads one and two path lines", () => {
    expect(parseNameStatus("M\tfrontend/a.ts\nR100\tfrontend/b.ts\tfrontend/c.ts\n\n")).toEqual([
      { status: "M", paths: ["frontend/a.ts"] },
      { status: "R100", paths: ["frontend/b.ts", "frontend/c.ts"] },
    ]);
    expect(parseNameStatus("")).toEqual([]);
  });

  it("refuses a line it cannot read", () => {
    expect(() => parseNameStatus("M frontend/a.ts")).toThrow(/unreadable diff line/);
    expect(() => parseNameStatus("\tfrontend/a.ts")).toThrow(/unreadable diff line/);
    expect(() => parseNameStatus("R100\tfrontend/a.ts\t")).toThrow(/unreadable diff line/);
  });
});

describe("decideScope", () => {
  it("runs everything off a pull request", () => {
    for (const event of ["push", "", "workflow_dispatch"]) {
      const d = decideScope({ event, changes: m("frontend/src/lib/color.ts"), always: [] });
      expect(d.mode).toBe("full");
      expect(d.paths).toEqual([]);
    }
    expect(decideScope({ event: "push", changes: [], always: [] }).reason).toMatch(/push event/);
    expect(decideScope({ event: "", changes: [], always: [] }).reason).toMatch(/missing event/);
  });

  it("runs everything when nothing is listed or nothing under src/ or scripts/ changed", () => {
    expect(pr([])).toMatchObject({ mode: "full", reason: "no changed file listed" });
    expect(pr(m("backend/app/main.py", "docs/index.md"))).toMatchObject({
      mode: "full",
      reason: "nothing under frontend/src or frontend/scripts changed",
    });
  });

  it("selects the changed sources and tests, relative to frontend/, plus the always-run set", () => {
    const d = pr(
      m("frontend/src/lib/color.ts", "frontend/src/App.test.tsx", "backend/app/x.py", "frontend/scripts/merge-lcov.mjs"),
      ["src/z.test.ts", "src/lib/color.ts"],
    );
    expect(d).toEqual({
      mode: "related",
      reason: "",
      paths: ["scripts/merge-lcov.mjs", "src/App.test.tsx", "src/lib/color.ts", "src/z.test.ts"],
    });
  });

  it("accepts an added file and JSON under src/", () => {
    const d = pr([
      { status: "A", paths: ["frontend/src/lib/new.ts"] },
      { status: "M", paths: ["frontend/src/data/table.json"] },
      { status: "A", paths: ["frontend/scripts/new.test.ts"] },
    ]);
    expect(d.mode).toBe("related");
    expect(d.paths).toEqual(["scripts/new.test.ts", "src/data/table.json", "src/lib/new.ts"]);
  });

  it.each([
    ["D", ["frontend/src/lib/gone.ts"]],
    ["R100", ["frontend/src/lib/a.ts", "frontend/src/lib/b.ts"]],
    ["R090", ["backend/a.py", "frontend/src/lib/b.ts"]],
    ["C075", ["frontend/src/lib/a.ts", "frontend/src/lib/c.ts"]],
    ["T", ["frontend/src/lib/a.ts"]],
    ["U", ["frontend/src/lib/a.ts"]],
    ["MM", ["frontend/src/lib/a.ts"]],
  ])("a %s under frontend/ runs everything", (status, paths) => {
    const d = pr([...m("frontend/src/lib/color.ts"), { status, paths }]);
    expect(d.mode).toBe("full");
    expect(d.reason).toContain(`has status ${status}`);
  });

  it.each([
    ['"frontend/src/\\303\\251.ts"'],
    ['"backend/app/\\303\\251.py"'],
    ['"docs/a\\tb.md"'],
    // judged by how the path STARTS: one that only ends in a quote is a name
    ['"frontend/src/unterminated.ts'],
  ])("a path git quoted (%s) runs everything, wherever it may live", (quoted) => {
    const d = pr([...m("frontend/src/lib/color.ts"), { status: "M", paths: [quoted] }]);
    expect(d).toEqual({ mode: "full", reason: `unreadable path ${quoted}`, paths: [] });
    // also as a rename's second path, and ahead of a trigger later in the list
    const r = pr([{ status: "R100", paths: ["docs/x.md", quoted] }, ...m("frontend/package.json")]);
    expect(r.reason).toBe(`unreadable path ${quoted}`);
  });

  it("reads a quoted path off a real diff line and still runs everything", () => {
    const changes = parseNameStatus('M\t"frontend/src/\\303\\251.ts"\nM\tfrontend/src/lib/color.ts\n');
    expect(changes[0].paths).toEqual(['"frontend/src/\\303\\251.ts"']);
    expect(pr(changes).mode).toBe("full");
  });

  it("ignores a deletion or rename outside frontend/", () => {
    const d = pr([{ status: "D", paths: ["backend/a.py"] }, { status: "R100", paths: ["docs/a", "docs/b"] }, ...m("frontend/src/a.ts")]);
    expect(d).toMatchObject({ mode: "related", paths: ["src/a.ts"] });
  });

  it.each([
    ["frontend/src/theme/fonts.css", "is not TypeScript or JSON"],
    ["frontend/src/assets/logo.svg", "is not TypeScript or JSON"],
    ["frontend/src/lib/a.js", "is not TypeScript or JSON"],
    ["frontend/src/lib/a.tsx.snap", "is not TypeScript or JSON"],
    ["frontend/scripts/run.sh", "is not a script Vitest imports"],
    ["frontend/scripts/data.json", "is not a script Vitest imports"],
    ["frontend/scripts/a.ts.bak", "is not a script Vitest imports"],
    ["frontend/index.html", "is outside src/ and scripts/"],
    ["frontend/e2e/login.spec.ts", "is outside src/ and scripts/"],
    ["frontend/stryker.config.json", "is outside src/ and scripts/"],
    ["frontend/srcx/a.ts", "is outside src/ and scripts/"],
  ])("%s runs everything", (file, reason) => {
    const d = pr(m("frontend/src/lib/color.ts", file));
    expect(d.mode).toBe("full");
    expect(d.reason).toBe(`${file} ${reason}`);
  });

  it.each([
    "frontend/src/i18n/locales/fr/cards.json",
    "frontend/src/test/setup.ts",
    "frontend/package-lock.json",
    "frontend/scripts/pr-test-scope.mjs",
    ".github/workflows/ci.yml",
  ])("a trigger (%s) runs everything whatever else changed", (file) => {
    const d = pr(m("frontend/src/lib/color.ts", file));
    expect(d).toEqual({ mode: "full", reason: `${file} changed`, paths: [] });
  });

  it("checks a rename's new path against the triggers too", () => {
    const d = pr([{ status: "R100", paths: ["docs/x.md", "frontend/src/test/x.ts"] }]);
    expect(d.reason).toBe("frontend/src/test/x.ts changed");
  });

  it("never returns an empty related list", () => {
    const d = pr(m("frontend/src/types/index.ts"));
    expect(d.mode).toBe("related");
    expect(d.paths.length).toBeGreaterThan(0);
  });
});

describe("alwaysRun", () => {
  it.each([
    'import { readFileSync } from "node:fs";',
    'import fs from "fs";',
    'import { readFile } from "fs/promises";',
    "const files = import.meta.glob('./**/*.ts');",
    'describeSourceScan("x", () => {});',
    'itSourceScan("x", () => {});',
    "walkSources(src)",
    "readdirSync(dir)",
    'import css from "./a.css?raw";',
    "import url from './logo.svg?url';",
    'import w from "./w.js?inline";',
  ])("keeps a test that reads files as text: %s", (source) => {
    expect(READS_FILES.test(source)).toBe(true);
    expect(alwaysRun([{ file: "src/a.test.ts", source }])).toEqual(["src/a.test.ts"]);
  });

  it.each([
    'import { render } from "@testing-library/react";',
    'import { foo } from "./fsHelpers";',
    "const raw = data.raw;",
    'import x from "./a?rawish";',
    "// the file's useful name",
  ])("leaves out an ordinary test: %s", (source) => {
    expect(alwaysRun([{ file: "src/a.test.ts", source }])).toEqual([]);
  });

  it("sorts what it keeps", () => {
    const tests = [
      { file: "src/z.test.ts", source: "readFileSync" },
      { file: "src/a.test.ts", source: "readFileSync" },
    ];
    expect(alwaysRun(tests)).toEqual(["src/a.test.ts", "src/z.test.ts"]);
  });

  it("finds the source scans in the real tree", async () => {
    const files = alwaysRun(await readTests(frontendRoot));
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files).toContain("scripts/pr-test-scope.test.ts");
    expect(files.every((f) => /\.test\.tsx?$/.test(f))).toBe(true);
  });
});

describe("readTests", () => {
  it("lists every file Vitest's include matches, under the same root", async () => {
    const tests = await readTests(frontendRoot);
    const include = vitestConfig.test!.include as string[];
    expect(include).toEqual(["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"]);
    expect(tests.length).toBeGreaterThan(500);
    expect(tests.map((t) => t.file)).toContain("scripts/pr-test-scope.test.ts");
    expect(tests.map((t) => t.file)).toContain("src/lib/color.test.ts");
    expect(tests.every((t) => /^(src|scripts)\/.*\.test\.tsx?$/.test(t.file))).toBe(true);
    expect(tests.find((t) => t.file === "src/lib/color.test.ts")!.source.length).toBeGreaterThan(0);
    expect(tests.every((t) => typeof t.source === "string")).toBe(true);
  });
});

/** The local modules a file imports: `./x` and `@/x` specifiers, resolved to files. */
async function localImports(file: string): Promise<string[]> {
  const source = await readFile(file, "utf8");
  const specs = [...source.matchAll(/^\s*import\s+(?:[^"';]*?from\s+)?["']([^"']+)["']/gm)].map((x) => x[1]);
  const out: string[] = [];
  for (const spec of specs) {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(frontendRoot, "src", spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(file), spec);
    else continue;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      try {
        await readFile(candidate);
        out.push(candidate);
        break;
      } catch {
        // try the next extension
      }
    }
  }
  return out;
}

describe("the setup file", () => {
  it("imports nothing local that a full-run trigger does not cover", async () => {
    const setupFiles = [vitestConfig.test!.setupFiles].flat() as string[];
    expect(setupFiles).toEqual(["./src/test/setup.ts"]);
    const seen = new Set<string>();
    const queue = setupFiles.map((f) => path.resolve(frontendRoot, f));
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      // Repository-relative by construction, not by walking up one directory:
      // in a StrykerJS sandbox this directory is a copy named sandbox-XXXX,
      // and the triggers are written against `frontend/`.
      const rel = `frontend/${path.relative(frontendRoot, file).split(path.sep).join("/")}`;
      expect(isFullRunTrigger(rel), `${rel} is reached from setupFiles`).toBe(true);
      // Inside a trigger directory everything is covered already; keep walking
      // anyway so an import that leaves it is caught.
      queue.push(...(await localImports(file)));
    }
    // setup.ts itself, @/i18n, @/lib/agGridSetup and the test helpers
    expect(seen.size).toBeGreaterThanOrEqual(4);
    const rels = [...seen].map((f) => path.relative(frontendRoot, f).split(path.sep).join("/"));
    expect(rels).toEqual(expect.arrayContaining(["src/test/setup.ts", "src/i18n/index.ts", "src/lib/agGridSetup.ts"]));
  });
});

describe("parseArgs", () => {
  it("reads the three options and defaults the output", () => {
    expect(parseArgs(["--event", "pull_request", "--diff", "d.txt"])).toEqual({
      event: "pull_request",
      diff: "d.txt",
      out: "pr-test-scope.txt",
    });
    expect(parseArgs(["--diff", "d", "--out", "o", "--event", "push"])).toEqual({ event: "push", diff: "d", out: "o" });
    expect(parseArgs(["--diff", "d"])).toEqual({ event: "", diff: "d", out: "pr-test-scope.txt" });
  });

  it("refuses an unknown option, a missing value and a missing diff", () => {
    expect(() => parseArgs(["--bogus", "x", "--diff", "d"])).toThrow(/unknown option --bogus/);
    expect(() => parseArgs(["--diff"])).toThrow(/--diff needs a value/);
    expect(() => parseArgs(["--event", "push"])).toThrow(/--diff is required/);
    expect(() => parseArgs(["--toString", "x", "--diff", "d"])).toThrow(/unknown option/);
  });
});

describe("main", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function fixture(diff: string) {
    dir = await mkdtemp(path.join(os.tmpdir(), "pr-test-scope-"));
    await mkdir(path.join(dir, "src", "lib"), { recursive: true });
    await mkdir(path.join(dir, "scripts"), { recursive: true });
    await writeFile(path.join(dir, "src", "lib", "a.test.ts"), "import { a } from './a';\n");
    await writeFile(path.join(dir, "src", "scan.test.ts"), 'import { readFileSync } from "node:fs";\n');
    await writeFile(path.join(dir, "src", "lib", "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(dir, "scripts", "s.test.ts"), "\n");
    await writeFile(path.join(dir, "diff.txt"), diff);
    return dir;
  }

  it("writes the related list and the step outputs", async () => {
    const root = await fixture("M\tfrontend/src/lib/a.ts\n");
    const output = path.join(root, "github-output");
    const logs: string[] = [];
    const d = await main(["--event", "pull_request", "--diff", "diff.txt", "--out", "scope.txt"], {
      root,
      env: { GITHUB_OUTPUT: output },
      log: (s: string) => logs.push(s),
    });
    expect(d.mode).toBe("related");
    expect(await readFile(path.join(root, "scope.txt"), "utf8")).toBe("src/lib/a.ts\nsrc/scan.test.ts\n");
    expect(await readFile(output, "utf8")).toBe("mode=related\nreason=\npaths=2\ntests=3\n");
    expect(logs).toEqual(["Frontend test scope: related — 2 path(s) for vitest related, of 3 test files"]);
  });

  it("writes an empty list in full mode", async () => {
    const root = await fixture("M\tfrontend/package.json\n");
    const output = path.join(root, "github-output");
    const logs: string[] = [];
    await main(["--event", "pull_request", "--diff", "diff.txt"], { root, env: { GITHUB_OUTPUT: output }, log: (s: string) => logs.push(s) });
    expect(await readFile(path.join(root, "pr-test-scope.txt"), "utf8")).toBe("");
    expect(await readFile(output, "utf8")).toBe("mode=full\nreason=frontend/package.json changed\npaths=0\ntests=3\n");
    expect(logs).toEqual(["Frontend test scope: full (frontend/package.json changed)"]);
  });

  it("turns any error into a full run with a warning, and never throws", async () => {
    const root = await fixture("garbage line\n");
    const output = path.join(root, "github-output");
    const logs: string[] = [];
    const d = await main(["--event", "pull_request", "--diff", "diff.txt"], { root, env: { GITHUB_OUTPUT: output }, log: (s: string) => logs.push(s) });
    expect(d.mode).toBe("full");
    expect(logs[0]).toMatch(/^::warning title=Frontend test scope::scope error: pr-test-scope: unreadable diff line/);
    expect(await readFile(output, "utf8")).toMatch(/^mode=full\nreason=scope error: .*\npaths=0\ntests=3\n$/);
    expect(await readFile(path.join(root, "pr-test-scope.txt"), "utf8")).toBe("");
  });

  it("runs everything on a missing diff file or a bad option, and without $GITHUB_OUTPUT", async () => {
    const root = await fixture("M\tfrontend/src/lib/a.ts\n");
    const logs: string[] = [];
    const missing = await main(["--event", "pull_request", "--diff", "nope.txt"], { root, env: {}, log: (s: string) => logs.push(s) });
    expect(missing.mode).toBe("full");
    expect(missing.reason).toMatch(/^scope error: .*ENOENT/);
    const bad = await main(["--bogus", "x"], { root, env: {}, log: (s: string) => logs.push(s) });
    expect(bad.mode).toBe("full");
    expect(logs.filter((l) => l.startsWith("::warning")).length).toBe(2);
  });

  it("puts a multi-line reason on one output line", async () => {
    const root = await fixture("M\tfrontend/src/lib/a.ts\n");
    const output = path.join(root, "github-output");
    await main(["--event", "push\r\nmode=related", "--diff", "diff.txt"], { root, env: { GITHUB_OUTPUT: output }, log: () => {} });
    const text = await readFile(output, "utf8");
    expect(text.split("\n").filter((l) => l.startsWith("mode="))).toEqual(["mode=full"]);
    // one space per run of line breaks: neither one per character nor none
    expect(text.split("\n")).toContain("reason=a push mode=related event, not a pull request");
  });

  it("defaults to the frontend directory the script lives in", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "pr-test-scope-"));
    const diff = path.join(dir, "diff.txt");
    const out = path.join(dir, "scope.txt");
    const output = path.join(dir, "github-output");
    await writeFile(diff, "M\tfrontend/src/lib/color.ts\n");
    const d = await main(["--event", "pull_request", "--diff", diff, "--out", out], {
      env: { GITHUB_OUTPUT: output },
      log: () => {},
    });
    // the real tree: its test count, and its always-run set beside the changed file
    expect(d.mode).toBe("related");
    expect(d.paths).toEqual(expect.arrayContaining(["src/lib/color.ts", "scripts/pr-test-scope.test.ts"]));
    expect(Number(/^tests=(\d+)$/m.exec(await readFile(output, "utf8"))![1])).toBeGreaterThan(500);
    expect(await readFile(out, "utf8")).toContain("src/lib/color.ts\n");
  });
});

describe("measured and mutated like the other CI scripts", () => {
  it("is in coverage.include and Stryker's mutate list", async () => {
    const coverage = vitestConfig.test!.coverage as { include: string[] };
    expect(coverage.include).toContain("scripts/pr-test-scope.mjs");
    const stryker = JSON.parse(await readFile(path.join(frontendRoot, "stryker.config.json"), "utf8"));
    expect(stryker.mutate).toContain("scripts/pr-test-scope.mjs");
  });
});
