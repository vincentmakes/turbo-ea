/**
 * No raw colour in `src/` — CLAUDE.md "Design tokens": "Never hardcode hex
 * codes — import the named token", UI_GUIDELINES.md §1.3.
 *
 * Every colour the app draws is a design token (`src/theme/tokens.ts`) or a MUI
 * theme value, and this guard is strict: any hex / `rgb()` literal in a scanned
 * file fails and lists every hit.
 *
 * About a thousand literals predated the rule, so it started as a per-file
 * baseline with EXACT counts (a file above its count failed, so did one below
 * it until the entry was lowered). The backlog was cleared in two PRs; the
 * baseline is gone. `ratchet()` and its self-tests stay so a future backlog
 * (a new rule over old code) can reuse the mechanism: pass it a baseline again.
 *
 * What counts is `rawColours` (`src/test/sourceScanners.ts`): comments are
 * skipped, string literals, template literals and JSX text are not; selectors,
 * translation keys and links are not colours. `src/theme/**` is where tokens
 * are defined, and `EXEMPT` holds the few files whose colours are data, not
 * styling. Measured 2026-11-02 at the start: 170 files, 972 hits, 624 files
 * scanned; zero since the Matrix report's diagonal highlight moved onto
 * `MATRIX_DIAGONAL_COLOR`.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, rawColours, rel, walkSources } from "@/test/sourceScanners";

/** Files whose colours are the data itself, not styling. One-line reason each. */
const EXEMPT: Record<string, string> = {
  "src/components/ColorPicker.tsx": "user-facing swatch palette, the colours are the data",
  "src/features/admin/CalculationsAdmin.tsx":
    "GitHub-Light syntax-highlighting scheme for the formula editor; a third-party colour scheme kept whole, like the brand marks",
  "src/lib/color.ts": "contrast math returns black or white",
  "src/features/diagrams/drawio-shapes.ts":
    "draw.io style strings and inline SVG written at export time",
};

/** Anti-rot floor: a walker or exclusion bug that empties the scan must not pass vacuously. */
const MIN_FILES_SCANNED = 300;

const TOKEN_HINT =
  "Raw colours are not allowed (CLAUDE.md, Design tokens). Use a token from src/theme/tokens.ts " +
  "(add a named one if none fits) or a MUI theme value (\"text.secondary\", " +
  "theme.palette.action.disabled, alpha(theme.palette.common.white, 0.2)).";

function excluded(relPath: string): boolean {
  return relPath.startsWith("src/theme/") || relPath in EXEMPT;
}

let scanned: Map<string, string[]> | undefined;

/** Every scanned file with its hits (`line: match`), keyed by `src/…` path. Read once, on first use. */
function scan(): Map<string, string[]> {
  if (!scanned) {
    scanned = new Map();
    for (const file of walkSources(SRC, { exclude: excluded })) {
      scanned.set(rel(file), rawColours(file, fs.readFileSync(file, "utf8")));
    }
  }
  return scanned;
}

/** The ratchet's verdicts for one scan against one per-file baseline of exact counts — empty when
 *  the two agree. Unused by the live scan while the codebase holds no raw colour; kept, with its
 *  self-tests, for the next rule that has to start from a backlog. */
function ratchet(
  hits: Map<string, string[]>,
  baseline: Record<string, number>,
): { over: string[]; under: string[]; zero: string[] } {
  const over: string[] = [];
  const under: string[] = [];
  const zero: string[] = [];
  for (const [file, found] of hits) {
    const allowed = baseline[file] ?? 0;
    if (found.length > allowed) {
      over.push(...found.map((hit) => `${file}:${hit}`));
    } else if (file in baseline && found.length === 0) {
      zero.push(`${file}: no raw colour left — delete its baseline entry`);
    } else if (found.length < allowed) {
      under.push(`lower the baseline for "${file}" to ${found.length} (was ${allowed})`);
    }
  }
  return { over, under, zero };
}

describe("ratchet", () => {
  const baseline = { "src/a.ts": 2, "src/b.ts": 1 };

  it("passes when every count matches exactly", () => {
    const hits = new Map([
      ["src/a.ts", ["1: #fff", "2: #000"]],
      ["src/b.ts", ["3: rgba("]],
      ["src/c.ts", []],
    ]);
    expect(ratchet(hits, baseline)).toEqual({ over: [], under: [], zero: [] });
  });

  it("fails a file above its count, or an unlisted file with any hit, listing every hit", () => {
    const hits = new Map([
      ["src/a.ts", ["1: #fff", "2: #000", "9: #abc"]],
      ["src/b.ts", ["3: rgba("]],
      ["src/c.ts", ["4: #123"]],
    ]);
    expect(ratchet(hits, baseline).over).toEqual([
      "src/a.ts:1: #fff",
      "src/a.ts:2: #000",
      "src/a.ts:9: #abc",
      "src/c.ts:4: #123",
    ]);
  });

  it("fails a file below its count, and a listed file at zero", () => {
    const hits = new Map([
      ["src/a.ts", ["1: #fff"]],
      ["src/b.ts", []],
    ]);
    const { over, under, zero } = ratchet(hits, baseline);
    expect(over).toEqual([]);
    expect(under).toEqual(['lower the baseline for "src/a.ts" to 1 (was 2)']);
    expect(zero).toEqual(["src/b.ts: no raw colour left — delete its baseline entry"]);
  });

  it("with an empty baseline demands zero hits everywhere", () => {
    const hits = new Map([["src/a.ts", ["1: #fff"]]]);
    expect(ratchet(hits, {}).over).toEqual(["src/a.ts:1: #fff"]);
    expect(ratchet(new Map([["src/a.ts", []]]), {})).toEqual({ over: [], under: [], zero: [] });
  });

  it("counts a colour in a template literal, never one in a comment", () => {
    const src = ["// was #fff before the token", "/* rgba(0,0,0,.5) */", "const b = `1px solid #ccc`;"];
    expect(rawColours("x.ts", src.join("\n"))).toEqual(["3: #ccc"]);
  });
});

describeSourceScan("no raw colour in src/", () => {
  itSourceScan("scans the whole of src/", () => {
    expect(scan().size).toBeGreaterThan(MIN_FILES_SCANNED);
  });

  itSourceScan("holds no raw colour in any scanned file", () => {
    const hits = [...scan()].flatMap(([file, found]) => found.map((hit) => `${file}:${hit}`));
    expect(hits, TOKEN_HINT).toEqual([]);
  });

  itSourceScan("exempts only files that exist", () => {
    const stale = Object.keys(EXEMPT).filter((file) => !fs.existsSync(path.join(SRC, "..", file)));
    expect(stale, "remove the EXEMPT entry").toEqual([]);
  });
});
