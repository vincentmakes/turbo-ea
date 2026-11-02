// Shared building blocks for the guard tests that read `src/` as text: a
// walker, a path normaliser, a TypeScript parse, and the raw-colour detector
// behind the design-token ratchet (`theme/rawColours.sourceScan.test.ts`).
// Every test that calls `walkSources` / `parse` reads files off disk, so it
// must also import `describeSourceScan` / `itSourceScan` from
// "@/test/sourceScan" and wrap the disk-reading blocks in them (see that
// module for why: StrykerJS's sandbox holds instrumented copies of src/).
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

/** Absolute path of `frontend/src`. */
export const SRC = path.resolve(__dirname, "..");

/**
 * Every `.ts` / `.tsx` source file under `dir`, recursively and sorted. Leaves
 * out tests (`*.test.*`), declaration files (`*.d.ts`), `node_modules` and the
 * test helpers in `src/test/`. `exclude` receives each candidate's `rel()` path
 * (`src/…`) and drops it when it returns true.
 */
export function walkSources(
  dir: string,
  opts: { exclude?: (relPath: string) => boolean } = {},
): string[] {
  const testDir = path.join(SRC, "test");
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || full === testDir) continue;
        visit(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith(".d.ts") &&
        !opts.exclude?.(rel(full))
      ) {
        out.push(full);
      }
    }
  };
  visit(dir);
  return out.sort();
}

/** `file` as a POSIX path relative to `frontend/`, so it starts `src/`. */
export function rel(file: string): string {
  return path.relative(path.dirname(SRC), file).split(path.sep).join("/");
}

/** `source` (read from `file` when omitted) parsed with parent links, as TSX for a `.tsx` file. */
export function parse(file: string, source = fs.readFileSync(file, "utf8")): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

// ---------------------------------------------------------------------------
// Raw colours (CLAUDE.md "Design tokens", UI_GUIDELINES.md §1.3)
// ---------------------------------------------------------------------------
// Comments are skipped (an issue reference such as "#910" is prose, not a
// colour); string literals, template literals and JSX text are not. The
// TypeScript parser decides what is a comment, so a `//` inside a URL or a
// quote inside a regex cannot fool it.

/**
 * A hex colour's shape: `#` and exactly 3, 4, 6 or 8 hex digits, ending a token (a quote, a
 * backtick, `;`, `)`, `,`, `}`, `<` before JSX text closes, whitespace or the end). Not after a
 * word character, `/`, `&` or `#`, so `&#160;`, `page#dee` and `/docs#abc` are not colours.
 */
export const HEX =
  /(?<![\w&#/])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?=["'`;),}<\s]|$)/g;
export const RGB = /rgba?\(/g;

/** Calls whose string argument is a selector or a translation key, never a colour. */
export const NON_COLOUR_CALLS = new Set([
  "t",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "closest",
  "matches",
]);
/** JSX attributes whose string value is a link or an id, never a colour. */
export const NON_COLOUR_ATTRIBUTES = new Set(["href", "to", "id"]);

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
export function rawColours(fileName: string, source: string): string[] {
  const sf = parse(fileName, source);
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
