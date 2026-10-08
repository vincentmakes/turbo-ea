// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  formatLcov,
  linesAddedBeyond,
  main,
  mergeAnchored,
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

  it("accepts a checksum third field, CRLF line endings, indentation and blank lines", () => {
    const parsed = parseLcov("SF:x.ts\r\nDA:4,2,abc\r\nend_of_record\r\n");
    expect(parsed.get("x.ts")!.get(4)).toBe(2);
    const indented = parseLcov("  SF:y.ts  \n\n  DA:1,3\n   \n  end_of_record\n");
    expect([...indented.get("y.ts")!.entries()]).toEqual([[1, 3]]);
  });

  it("sums repeated DA records for one line and keeps an empty file record", () => {
    const parsed = parseLcov("SF:x.ts\nDA:1,1\nDA:1,2\nend_of_record\nSF:empty.ts\nend_of_record\n");
    expect(parsed.get("x.ts")!.get(1)).toBe(3);
    expect(parsed.get("empty.ts")!.size).toBe(0);
  });

  it("refuses a DA record outside a file record", () => {
    expect(() => parseLcov("DA:1,1\nend_of_record\n")).toThrow(/outside a file record/);
    expect(() => parseLcov("SF:x.ts\nend_of_record\nDA:1,1\n")).toThrow(/outside a file record/);
  });

  it("refuses a malformed DA record and an unterminated file", () => {
    for (const bad of ["DA:zero,1", "DA:1.5,1", "DA:0,1", "DA:-3,1", "DA:1,x", "DA:1,-1", "DA:1"]) {
      expect(() => parseLcov(`SF:x.ts\n${bad}\nend_of_record\n`), bad).toThrow(/malformed DA record/);
    }
    expect(() => parseLcov("SF:x.ts\nDA:1,0\nend_of_record\n")).not.toThrow();
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

  it("keeps the anchor's own lines and files whatever the other side says", () => {
    expect(merged.get("frontend/src/a.ts")!.get(1)).toBe(1);
    expect(merged.get("frontend/src/unit-only.ts")!.get(1)).toBe(2);
  });

  it("drops a line and a file only the later report lists, and counts them", () => {
    expect(merged.get("frontend/src/a.ts")!.has(9)).toBe(false);
    expect(merged.has("frontend/src/e2e-only.ts")).toBe(false);
    const { droppedLines, droppedFiles } = mergeAnchored([parseLcov(UNIT), parseLcov(E2E)]);
    expect(droppedLines).toBe(1);
    expect(droppedFiles).toBe(1);
  });

  it("is anchored on the FIRST input: swapping the inputs swaps the universe", () => {
    const { merged: e2eFirst, droppedLines, droppedFiles } = mergeAnchored([parseLcov(E2E), parseLcov(UNIT)]);
    expect([...e2eFirst.keys()]).toEqual(["frontend/src/a.ts", "frontend/src/e2e-only.ts"]);
    expect([...e2eFirst.get("frontend/src/a.ts")!.keys()]).toEqual([2, 3, 9]);
    expect(e2eFirst.get("frontend/src/a.ts")!.get(2)).toBe(5);
    expect(droppedLines).toBe(1); // unit's a.ts line 1
    expect(droppedFiles).toBe(1); // unit-only.ts
  });

  it("does not mutate its inputs", () => {
    const unit = parseLcov(UNIT);
    mergeLcov([unit, parseLcov(E2E)]);
    expect(unit.get("frontend/src/a.ts")!.get(2)).toBe(0);
  });

  it("is its input's line view when given one report", () => {
    const single = mergeLcov([parseLcov(UNIT)]);
    expect(parseLcov(formatLcov(single))).toEqual(parseLcov(formatLcov(parseLcov(UNIT))));
    expect(mergeAnchored([parseLcov(UNIT)])).toMatchObject({ droppedLines: 0, droppedFiles: 0 });
  });

  it("is empty for no inputs", () => {
    expect(mergeLcov([]).size).toBe(0);
  });
});

describe("formatLcov", () => {
  it("round-trips and emits LF/LH per file, sorted", () => {
    const merged = mergeLcov([parseLcov(E2E), parseLcov(UNIT)]);
    const text = formatLcov(merged);
    expect(parseLcov(text)).toEqual(merged);
    const a = text.split("end_of_record")[0];
    expect(a).toContain("SF:frontend/src/a.ts");
    expect(a).toContain("DA:2,5\nDA:3,0\nDA:9,1\n");
    expect(a).toContain("LF:3");
    expect(a).toContain("LH:2");
    expect(text.indexOf("SF:frontend/src/a.ts")).toBeLessThan(text.indexOf("SF:frontend/src/e2e-only.ts"));
    expect(text).not.toContain("unit-only");
    expect(text.endsWith("end_of_record\n")).toBe(true);
  });

  it("sorts files by path and lines numerically, and opens every record with TN:", () => {
    const text = formatLcov(parseLcov("SF:z.ts\nDA:10,1\nDA:2,0\nDA:9,1\nend_of_record\nSF:a.ts\nDA:1,1\nend_of_record\n"));
    expect(text).toBe(
      ["TN:", "SF:a.ts", "DA:1,1", "LF:1", "LH:1", "end_of_record", "TN:", "SF:z.ts", "DA:2,0", "DA:9,1", "DA:10,1", "LF:3", "LH:2", "end_of_record", ""].join("\n"),
    );
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
    // a.ts: lines 1,2,3 → 1,2 covered; unit-only 1/1 → 3/4 (line 9 and e2e-only dropped)
    expect(summary.total.lines).toEqual({ total: 4, covered: 3, skipped: 0, pct: 75 });
    expect(summary["frontend/src/a.ts"].lines).toEqual({ total: 3, covered: 2, skipped: 0, pct: 66.66 });
    expect(summary["frontend/src/unit-only.ts"].lines).toEqual({ total: 1, covered: 1, skipped: 0, pct: 100 });
    expect(Object.keys(summary)).toEqual(["total", "frontend/src/a.ts", "frontend/src/unit-only.ts"]);
    // Files sorted by path, whatever order the report listed them in.
    const unsorted = summarize(parseLcov("SF:z.ts\nDA:1,1\nend_of_record\nSF:a.ts\nDA:1,0\nend_of_record\n"));
    expect(Object.keys(unsorted)).toEqual(["total", "a.ts", "z.ts"]);
  });

  it("floors to two decimals and never rounds up", () => {
    expect(percent(1, 3)).toBe(33.33);
    expect(percent(2, 3)).toBe(66.66); // 66.666… floors, it does not round to 66.67
    expect(percent(3, 3)).toBe(100);
    expect(percent(0, 1)).toBe(0);
    expect(percent(5, 0)).toBe(100);
  });
});

describe("linesAddedBeyond", () => {
  it("counts the anchor's zero-hit lines the later reports covered", () => {
    const unit = parseLcov(UNIT);
    const merged = mergeLcov([unit, parseLcov(E2E)]);
    // a.ts line 2 (unit 0 → covered); line 3 stays 0; line 9 was dropped
    expect(linesAddedBeyond(unit, merged)).toBe(1);
    expect(linesAddedBeyond(unit, unit)).toBe(0);
    // A file the first report does not know at all: every covered line counts.
    expect(linesAddedBeyond(new Map(), merged)).toBe(3);
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
    // The flag last, so nothing follows it to look at.
    expect(parseArgs(["--out", "o", "a.info", "--fail-under-from-package"])).toEqual({
      out: "o",
      failUnder: undefined,
      failUnderFromPackage: "package.json",
      inputs: ["a.info"],
    });
    // A following option is not taken as the path, even when it ends in .json.
    expect(() => parseArgs(["--out", "o", "--fail-under-from-package", "--bogus.json", "a.info"])).toThrow(
      /unknown option --bogus.json/,
    );
    expect(parseArgs(["--out", "o", "--fail-under-from-package", "--fail-under", "5", "a.info"])).toMatchObject({
      failUnderFromPackage: "package.json",
      failUnder: 5,
    });
  });

  it("refuses missing --out, no inputs, a bad number and unknown options", () => {
    expect(() => parseArgs(["a.info"])).toThrow(/--out/);
    expect(() => parseArgs(["--out", "o"])).toThrow(/at least one/);
    expect(() => parseArgs(["--out", "o", "--fail-under", "x", "a.info"])).toThrow(/needs a number/);
    expect(() => parseArgs(["--out", "o", "--bogus", "a.info"])).toThrow(/unknown option --bogus/);
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

  it("writes lcov.info and coverage-summary.json for two inputs, creating the output directory", async () => {
    await tree();
    const out = path.join(dir, "nested", "merged"); // two levels: the mkdir must be recursive
    const result = await main(["--out", out, path.join(dir, "unit.info"), path.join(dir, "e2e.info")], io);
    expect(result.exitCode).toBe(0);
    expect(result.floor).toBeUndefined();
    const summary = JSON.parse(await readFile(path.join(out, "coverage-summary.json"), "utf8"));
    expect(summary.total.lines.pct).toBe(75);
    expect(parseLcov(await readFile(path.join(out, "lcov.info"), "utf8")).get("frontend/src/a.ts")!.get(2)).toBe(5);
    expect(logs.join("\n")).toContain("merged 2 LCOV report(s) over 2 files");
    expect(logs.join("\n")).toContain("lines: 3/4 (75%)");
    expect(logs.join("\n")).toContain("beyond the first report: 1");
    expect(logs.join("\n")).toContain("dropped (not in the first report): 1 lines, 1 files");
    expect(logs.join("\n")).toContain("no merged-lines floor set");
    expect(errors).toEqual([]);
  });

  it("equals the input's line view with one input, and prints no merge diagnostics", async () => {
    await tree();
    const out = path.join(dir, "merged");
    await main(["--out", out, path.join(dir, "unit.info")], io);
    expect(parseLcov(await readFile(path.join(out, "lcov.info"), "utf8"))).toEqual(parseLcov(UNIT));
    expect(logs.join("\n")).not.toContain("beyond the first report");
    expect(logs.join("\n")).not.toContain("dropped");
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
    expect(missed.floor).toBe(90);
    expect(errors.join("\n")).toMatch(/::error::merged line coverage 75% is below the floor of 90%/);
    // Exactly on the floor is met: the gate is "below", not "at or below".
    const met = await main(["--out", path.join(dir, "o2"), "--fail-under", "75", ...inputs], io);
    expect(met.exitCode).toBe(0);
    expect(logs.join("\n")).toContain("floor: 75% (met)");
    const justUnder = await main(["--out", path.join(dir, "o3"), "--fail-under", "75.01", ...inputs], io);
    expect(justUnder.exitCode).toBe(2);
  });

  it("reads the floor from package.json config and refuses an absent or non-numeric one", async () => {
    await tree();
    const pkg = path.join(dir, "package.json");
    await writeFile(pkg, JSON.stringify({ name: "x", config: { coverageFloorMergedLines: 70 } }));
    const inputs = [path.join(dir, "unit.info"), path.join(dir, "e2e.info")];
    const result = await main(["--out", path.join(dir, "o"), "--fail-under-from-package", pkg, ...inputs], io);
    expect(result.floor).toBe(70);
    expect(result.exitCode).toBe(0);

    // The package floor wins over --fail-under when both are given.
    await writeFile(pkg, JSON.stringify({ name: "x", config: { coverageFloorMergedLines: 90 } }));
    const both = await main(
      ["--out", path.join(dir, "o2"), "--fail-under", "10", "--fail-under-from-package", pkg, ...inputs],
      io,
    );
    expect(both.floor).toBe(90);
    expect(both.exitCode).toBe(2);

    // A missing key is the typo case: it must fail the job, never pass as "no floor".
    await writeFile(pkg, JSON.stringify({ name: "x" }));
    await expect(readFloor(pkg)).rejects.toThrow(/coverageFloorMergedLines is not set/);
    await expect(main(["--out", path.join(dir, "o3"), "--fail-under-from-package", pkg, ...inputs], io)).rejects.toThrow(
      /is not set/,
    );
    // Both ends of the range are valid floors.
    for (const edge of [0, 100]) {
      await writeFile(pkg, JSON.stringify({ name: "x", config: { coverageFloorMergedLines: edge } }));
      expect(await readFloor(pkg)).toBe(edge);
    }
    for (const bad of ['"80"', "true", "null", "-1", "101", "1e999", "-1e999", "[]"]) {
      await writeFile(pkg, `{"name":"x","config":{"coverageFloorMergedLines":${bad}}}`);
      await expect(readFloor(pkg), bad).rejects.toThrow(/must be a number in \[0, 100\]/);
    }
  });
});
