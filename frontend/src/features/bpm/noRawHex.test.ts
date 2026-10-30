/**
 * No raw colours in the BPM feature — CLAUDE.md "Design tokens",
 * UI_GUIDELINES.md §1.3.
 *
 * Every colour BPM draws is a design token (`src/theme/tokens.ts`) or a MUI
 * theme value; this scan keeps a hex code or an `rgb()` / `rgba()` literal from
 * creeping back into `src/features/bpm/`. Comments are skipped (an issue
 * reference such as "#910" is prose, not a colour); string literals, template
 * literals and JSX text are not. The TypeScript parser decides what is a
 * comment, so a `//` inside a URL or a quote inside a regex cannot fool it.
 */
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";

/**
 * A hex colour's shape: `#` and exactly 3, 4, 6 or 8 hex digits, ending a token (a quote, a
 * backtick, `;`, `)`, `,`, `}`, `<` before JSX text closes, whitespace or the end). Not after a
 * word character, `/`, `&` or `#`, so `&#160;`, `page#dee` and `/docs#abc` are not colours.
 */
const HEX = /(?<![\w&#/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?=["'`;),}<\s]|$)/g;
const RGB = /rgba?\(/g;

/** Calls whose string argument is a selector or a translation key, never a colour. */
const NON_COLOUR_CALLS = new Set([
  "t",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "closest",
  "matches",
]);
/** JSX attributes whose string value is a link or an id, never a colour. */
const NON_COLOUR_ATTRIBUTES = new Set(["href", "to", "id"]);

/** True when `pos` lies in a comment: the trivia before a token, not the token itself. */
function inComment(sf: ts.SourceFile, pos: number): boolean {
  let node: ts.Node = sf;
  for (;;) {
    const child = node.getChildren(sf).find((c) => c.getFullStart() <= pos && pos < c.getEnd());
    if (!child) return false;
    if (pos < child.getStart(sf)) return true;
    if (child.getChildCount(sf) === 0) return false;
    node = child;
  }
}

/** The innermost node at `pos`. */
function nodeAt(sf: ts.SourceFile, pos: number): ts.Node {
  let node: ts.Node = sf;
  for (;;) {
    const child = node.getChildren(sf).find((c) => c.getStart(sf) <= pos && pos < c.getEnd());
    if (!child) return node;
    node = child;
  }
}

/** True when `pos` lies in a string that is a selector, a translation key or a link, not a colour. */
function inNonColourString(sf: ts.SourceFile, pos: number): boolean {
  const lit = nodeAt(sf, pos);
  if (!ts.isStringLiteral(lit) && !ts.isNoSubstitutionTemplateLiteral(lit)) return false;
  const parent = lit.parent;
  if (ts.isCallExpression(parent) && parent.arguments.includes(lit as ts.Expression)) {
    const callee = parent.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : "";
    return NON_COLOUR_CALLS.has(name);
  }
  if (ts.isJsxAttribute(parent)) return NON_COLOUR_ATTRIBUTES.has(parent.name.getText(sf));
  return false;
}

/** `line: match` for every raw colour outside a comment. */
function rawColours(fileName: string, source: string): string[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits: { pos: number; text: string }[] = [];
  for (const re of [HEX, RGB]) {
    for (const m of source.matchAll(re)) {
      if (!inComment(sf, m.index) && !inNonColourString(sf, m.index)) {
        hits.push({ pos: m.index, text: m[0] });
      }
    }
  }
  return hits
    .sort((a, b) => a.pos - b.pos)
    .map(({ pos, text }) => `${sf.getLineAndCharacterOfPosition(pos).line + 1}: ${text}`);
}

describe("rawColours", () => {
  it("finds hex and rgb literals in strings, templates, JSX attributes and JSX text", () => {
    const src = [
      'const a = "#1976d2";',
      "const b = `border: 1px solid #ccc; background: rgba(0,0,0,.1)`;",
      'const c = <Icon color="#fff" />;',
      "const d = <p>#abcdef</p>;",
    ].join("\n");
    expect(rawColours("x.tsx", src)).toEqual(["1: #1976d2", "2: #ccc", "2: rgba(", "3: #fff", "4: #abcdef"]);
  });

  it("finds every colour shape — 3, 4, 6 and 8 digits — however the token ends", () => {
    const src = [
      'const a = ["#abc", "#abcd", "#aabbcc", "#aabbccdd"];',
      "const b = `color:#123;fill: #456)`;",
      "const c = { x: '#789' };",
      "const d = `#fedcba`",
      'const e = alpha("#0f0", 0.2);',
      "const f = { bg: `#a1b2c3` }; const g = '#f00'",
    ].join("\n");
    expect(rawColours("x.ts", src)).toEqual([
      "1: #abc",
      "1: #abcd",
      "1: #aabbcc",
      "1: #aabbccdd",
      "2: #123",
      "2: #456",
      "3: #789",
      "4: #fedcba",
      "5: #0f0",
      "6: #a1b2c3",
      "6: #f00",
    ]);
  });

  it("does not flag selectors, entities, URL fragments, i18n keys or non-colour lengths", () => {
    const src = [
      'el.querySelector("#add");',
      'document.querySelectorAll("#bad, #cab");',
      "const nbsp = `a&#160;b`;",
      'const url = "https://example.com/page#dee";',
      'const rel = "/docs/#cafe";',
      'const label = t("#abc");',
      'const label2 = i18n.t("#fed");',
      'const link = <a href="#dee">x</a>;',
      'const five = "#abcde"; const seven = "#abcdef0"; const nine = "#abcdef012";',
      'const id = "#add-button"; const ref = "#1a2b_x";',
    ].join("\n");
    expect(rawColours("x.tsx", src)).toEqual([]);
  });

  it("skips comments of every kind, and a URL or regex that only looks like one", () => {
    const src = [
      "// pinned in #910 — was #fff",
      "/* rgba(0,0,0,0.5) */",
      'const ns = "http://www.w3.org/2000/svg"; // trailing #770',
      "const q = text.replace(/'/g, \"&#39;\");",
      "const j = <div>{/* #e65100 */}</div>;",
    ].join("\n");
    expect(rawColours("x.tsx", src)).toEqual([]);
  });
});

describeSourceScan("BPM colours come from the design tokens", () => {
  const BPM = __dirname;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  itSourceScan("no hex or rgb() literal outside a comment in src/features/bpm", () => {
    const files = walk(BPM);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.flatMap((file) =>
      rawColours(file, fs.readFileSync(file, "utf8")).map(
        (hit) => `src/features/bpm/${path.relative(BPM, file)}:${hit}`,
      ),
    );
    expect(
      offenders,
      "Raw colours are not allowed in feature code (CLAUDE.md, Design tokens). Use a token from " +
        "src/theme/tokens.ts (add a named one in its BPM block if none fits) or a MUI theme value " +
        '("text.secondary", theme.palette.action.disabled, alpha(theme.palette.common.white, 0.2)).',
    ).toEqual([]);
  });
});
