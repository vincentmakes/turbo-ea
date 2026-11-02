/**
 * Raw colours ratchet down to zero — CLAUDE.md "Design tokens": "Never hardcode
 * hex codes — import the named token", UI_GUIDELINES.md §1.3.
 *
 * Every colour the app draws is a design token (`src/theme/tokens.ts`) or a MUI
 * theme value. About a thousand hex / `rgb()` literals predated the rule, so
 * this started as a per-file baseline with EXACT counts rather than a flat ban:
 *
 *   - a file above its count (or an unlisted file with any hit) fails and lists
 *     every hit — a new raw colour is never allowed in;
 *   - a file below its count fails too, asking for the entry to be lowered — so
 *     every PR that swaps colours for tokens moves the number, and the baseline
 *     can never rot into headroom a later PR spends quietly;
 *   - a listed file at zero fails, asking for the entry to be deleted.
 *
 * What counts is `rawColours` (`src/test/sourceScanners.ts`): comments are
 * skipped, string literals, template literals and JSX text are not; selectors,
 * translation keys and links are not colours. `src/theme/**` is where tokens
 * are defined, and `EXEMPT` holds the few files whose colours are data, not
 * styling. Measured 2026-11-02 at the start: 170 files, 972 hits, 624 files
 * scanned. The backlog is now cleared but for one entry, MatrixReport's two
 * (see `RAW_COLOUR_BASELINE`); every other file in `src/` holds no raw colour.
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

/**
 * Raw colours per file, exact. Lower an entry in the PR that removes colours
 * from that file; delete it when the file reaches zero. Never raise one: use a
 * token from `src/theme/tokens.ts` (add a named one if none fits).
 *
 * MatrixReport's two are its diagonal highlight (indigo 50 in light mode, a
 * deep purple 800 wash in dark), deliberately not snapped to a near token. When
 * this entry goes, replace this dict and the
 * per-file checks below with one strict `expect(hits).toEqual([])` over the
 * whole scan (the `ratchet()` self-tests then go with it).
 */
const RAW_COLOUR_BASELINE: Record<string, number> = {
  "src/features/reports/MatrixReport.tsx": 2,
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

/** The ratchet's verdicts for one scan against one baseline — empty when the two agree. */
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
      zero.push(`${file}: no raw colour left — delete the entry from RAW_COLOUR_BASELINE`);
    } else if (found.length < allowed) {
      under.push(`lower RAW_COLOUR_BASELINE["${file}"] to ${found.length} (was ${allowed})`);
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
    expect(under).toEqual(['lower RAW_COLOUR_BASELINE["src/a.ts"] to 1 (was 2)']);
    expect(zero).toEqual(["src/b.ts: no raw colour left — delete the entry from RAW_COLOUR_BASELINE"]);
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

describeSourceScan("raw colours ratchet against RAW_COLOUR_BASELINE", () => {
  itSourceScan("scans the whole of src/", () => {
    expect(scan().size).toBeGreaterThan(MIN_FILES_SCANNED);
  });

  itSourceScan("adds no raw colour to any file", () => {
    expect(ratchet(scan(), RAW_COLOUR_BASELINE).over, TOKEN_HINT).toEqual([]);
  });

  itSourceScan("keeps every baseline entry exact (lower it as colours go)", () => {
    expect(ratchet(scan(), RAW_COLOUR_BASELINE).under).toEqual([]);
  });

  itSourceScan("lists no file that has reached zero", () => {
    expect(ratchet(scan(), RAW_COLOUR_BASELINE).zero).toEqual([]);
  });

  itSourceScan("lists only files that are still scanned (stale baseline entries)", () => {
    const stale = Object.keys(RAW_COLOUR_BASELINE).filter((file) => !scan().has(file));
    expect(stale, "the file was moved, deleted or excluded — remove its entry").toEqual([]);
  });

  itSourceScan("exempts only files that exist", () => {
    const stale = Object.keys(EXEMPT).filter((file) => !fs.existsSync(path.join(SRC, "..", file)));
    expect(stale, "remove the EXEMPT entry").toEqual([]);
  });
});

describe("RAW_COLOUR_BASELINE", () => {
  it("is sorted by path and holds only positive counts", () => {
    const keys = Object.keys(RAW_COLOUR_BASELINE);
    expect(keys).toEqual([...keys].sort());
    expect(Object.values(RAW_COLOUR_BASELINE).filter((n) => !(n > 0))).toEqual([]);
  });
});
