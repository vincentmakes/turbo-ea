// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatLcov,
  linesAddedBeyond,
  main,
  mergeLcov,
  parseArgs,
  parseLcov,
  percent,
  readFloor,
  summarize,
} from "./merge-lcov.mjs";

const UNIT = `TN:
SF:frontend/src/a.ts
FN:1,foo
FNDA:1,foo
FNF:1
FNH:1
DA:1,1
DA:2,0
DA:3,0
BRDA:2,0,0,1
BRF:1
BRH:1
LF:3
LH:1
end_of_record
TN:
SF:frontend/src/unit-only.ts
DA:1,2
LF:1
LH:1
end_of_record
`;

const E2E = `TN:
SF:frontend/src/a.ts
DA:2,5
DA:3,0
DA:9,1
LF:3
LH:2
end_of_record
TN:
SF:frontend/src/e2e-only.ts
DA:1,1
LF:1
LH:1
end_of_record
`;

describe("parseLcov", () => {
  it("keeps SF and DA records and ignores the function and branch ones", () => {
    const parsed = parseLcov(UNIT);
    expect([...parsed.keys()]).toEqual(["frontend/src/a.ts", "frontend/src/unit-only.ts"]);
    expect([...parsed.get("frontend/src/a.ts")!.entries()]).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
    ]);
  });

  it("accepts a checksum third field and CRLF line endings", () => {
    const parsed = parseLcov("SF:x.ts\r\nDA:4,2,abc\r\nend_of_record\r\n");
    expect(parsed.get("x.ts")!.get(4)).toBe(2);
  });

  it("refuses a DA record outside a file record", () => {
    expect(() => parseLcov("DA:1,1\nend_of_record\n")).toThrow(/outside a file record/);
  });

  it("refuses a malformed DA record and an unterminated file", () => {
    expect(() => parseLcov("SF:x.ts\nDA:zero,1\nend_of_record\n")).toThrow(/malformed/);
    expect(() => parseLcov("SF:x.ts\nDA:1,1\n")).toThrow(/without end_of_record/);
  });
});

describe("mergeLcov", () => {
  const merged = mergeLcov([parseLcov(UNIT), parseLcov(E2E)]);

  it("sums hits on lines both reports carry", () => {
    expect(merged.get("frontend/src/a.ts")!.get(2)).toBe(5);
  });

  it("covers a line the unit suite left at zero when the browser suite hit it", () => {
    expect(merged.get("frontend/src/a.ts")!.get(2)).toBeGreaterThan(0);
    expect(merged.get("frontend/src/a.ts")!.get(3)).toBe(0);
  });

  it("keeps lines and files only one side knows", () => {
    expect(merged.get("frontend/src/a.ts")!.get(9)).toBe(1);
    expect(merged.get("frontend/src/unit-only.ts")!.get(1)).toBe(2);
    expect(merged.get("frontend/src/e2e-only.ts")!.get(1)).toBe(1);
  });

  it("is its input's line view when given one report", () => {
    const single = mergeLcov([parseLcov(UNIT)]);
    expect(parseLcov(formatLcov(single))).toEqual(parseLcov(formatLcov(parseLcov(UNIT))));
  });
});

describe("formatLcov", () => {
  it("round-trips and emits LF/LH per file, sorted", () => {
    const merged = mergeLcov([parseLcov(E2E), parseLcov(UNIT)]);
    const text = formatLcov(merged);
    expect(parseLcov(text)).toEqual(merged);
    const a = text.split("end_of_record")[0];
    expect(a).toContain("SF:frontend/src/a.ts");
    expect(a).toContain("LF:4");
    expect(a).toContain("LH:3");
    expect(text.indexOf("SF:frontend/src/a.ts")).toBeLessThan(text.indexOf("SF:frontend/src/e2e-only.ts"));
    expect(text.indexOf("SF:frontend/src/e2e-only.ts")).toBeLessThan(text.indexOf("SF:frontend/src/unit-only.ts"));
  });

  it("is empty for no files", () => {
    expect(formatLcov(new Map())).toBe("");
  });
});

describe("summarize", () => {
  it("rounds like istanbul and reads like Vitest's json-summary", () => {
    expect(percent(2, 3)).toBe(66.66);
    expect(percent(0, 0)).toBe(100);
    const summary = summarize(mergeLcov([parseLcov(UNIT), parseLcov(E2E)]));
    // a.ts: lines 1,2,3,9 → 1,2,9 covered; unit-only 1/1; e2e-only 1/1 → 5/6
    expect(summary.total.lines).toEqual({ total: 6, covered: 5, skipped: 0, pct: 83.33 });
    expect(summary["frontend/src/a.ts"].lines).toEqual({ total: 4, covered: 3, skipped: 0, pct: 75 });
  });
});

describe("linesAddedBeyond", () => {
  it("counts the lines the later reports covered that the first did not", () => {
    const unit = parseLcov(UNIT);
    const merged = mergeLcov([unit, parseLcov(E2E)]);
    // a.ts line 2 (unit 0 → covered), line 9 (new), e2e-only line 1 (new)
    expect(linesAddedBeyond(unit, merged)).toBe(3);
  });
});

describe("parseArgs", () => {
  it("reads --out, --fail-under and the inputs", () => {
    expect(parseArgs(["--out", "o", "--fail-under", "72.5", "a.info", "b.info"])).toEqual({
      out: "o",
      failUnder: 72.5,
      failUnderFromPackage: null,
      inputs: ["a.info", "b.info"],
    });
  });

  it("defaults --fail-under-from-package to package.json and accepts a path", () => {
    expect(parseArgs(["--out", "o", "--fail-under-from-package", "a.info"]).failUnderFromPackage).toBe("package.json");
    expect(parseArgs(["--out", "o", "--fail-under-from-package", "pkg/x.json", "a.info"]).failUnderFromPackage).toBe(
      "pkg/x.json",
    );
  });

  it("refuses missing --out, no inputs, a bad number and unknown options", () => {
    expect(() => parseArgs(["a.info"])).toThrow(/--out/);
    expect(() => parseArgs(["--out", "o"])).toThrow(/at least one/);
    expect(() => parseArgs(["--out", "o", "--fail-under", "x", "a.info"])).toThrow(/needs a number/);
    expect(() => parseArgs(["--out", "o", "--bogus", "a.info"])).toThrow(/unknown option/);
  });
});

describe("main", () => {
  let dir: string;
  const logs: string[] = [];
  const errors: string[] = [];
  const io = { log: (s: string) => logs.push(s), error: (s: string) => errors.push(s) };

  afterEach(async () => {
    logs.length = 0;
    errors.length = 0;
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function tree() {
    dir = await mkdtemp(path.join(os.tmpdir(), "merge-lcov-"));
    await writeFile(path.join(dir, "unit.info"), UNIT);
    await writeFile(path.join(dir, "e2e.info"), E2E);
    return dir;
  }

  it("writes lcov.info and coverage-summary.json for two inputs", async () => {
    await tree();
    const out = path.join(dir, "merged");
    const result = await main(["--out", out, path.join(dir, "unit.info"), path.join(dir, "e2e.info")], io);
    expect(result.exitCode).toBe(0);
    expect(result.floor).toBeUndefined();
    const summary = JSON.parse(await readFile(path.join(out, "coverage-summary.json"), "utf8"));
    expect(summary.total.lines.pct).toBe(83.33);
    expect(parseLcov(await readFile(path.join(out, "lcov.info"), "utf8")).get("frontend/src/a.ts")!.get(2)).toBe(5);
    expect(logs.join("\n")).toContain("lines: 5/6 (83.33%)");
    expect(logs.join("\n")).toContain("beyond the first report: 3");
    expect(logs.join("\n")).toContain("no merged-lines floor set");
  });

  it("equals the input's line view with one input", async () => {
    await tree();
    const out = path.join(dir, "merged");
    await main(["--out", out, path.join(dir, "unit.info")], io);
    expect(parseLcov(await readFile(path.join(out, "lcov.info"), "utf8"))).toEqual(parseLcov(UNIT));
  });

  it("rejects a missing or empty input", async () => {
    await tree();
    await writeFile(path.join(dir, "empty.info"), "\n");
    await expect(main(["--out", path.join(dir, "o"), path.join(dir, "missing.info")], io)).rejects.toThrow(/cannot read/);
    await expect(main(["--out", path.join(dir, "o"), path.join(dir, "empty.info")], io)).rejects.toThrow(/is empty/);
  });

  it("enforces --fail-under: exit code 2 and an ::error:: when missed, 0 when met", async () => {
    await tree();
    const inputs = [path.join(dir, "unit.info"), path.join(dir, "e2e.info")];
    const missed = await main(["--out", path.join(dir, "o1"), "--fail-under", "90", ...inputs], io);
    expect(missed.exitCode).toBe(2);
    expect(errors.join("\n")).toMatch(/::error::merged line coverage 83\.33% is below the floor of 90%/);
    const met = await main(["--out", path.join(dir, "o2"), "--fail-under", "83.33", ...inputs], io);
    expect(met.exitCode).toBe(0);
    expect(logs.join("\n")).toContain("floor: 83.33% (met)");
  });

  it("reads the floor from package.json config and treats an absent one as no floor", async () => {
    await tree();
    const pkg = path.join(dir, "package.json");
    await writeFile(pkg, JSON.stringify({ name: "x", config: { coverageFloorMergedLines: 80 } }));
    const result = await main(
      ["--out", path.join(dir, "o"), "--fail-under-from-package", pkg, path.join(dir, "unit.info"), path.join(dir, "e2e.info")],
      io,
    );
    expect(result.floor).toBe(80);
    expect(result.exitCode).toBe(0);

    await writeFile(pkg, JSON.stringify({ name: "x" }));
    expect(await readFloor(pkg)).toBeUndefined();
    await writeFile(pkg, JSON.stringify({ name: "x", config: { coverageFloorMergedLines: "80" } }));
    await expect(readFloor(pkg)).rejects.toThrow(/must be a number/);
  });
});
