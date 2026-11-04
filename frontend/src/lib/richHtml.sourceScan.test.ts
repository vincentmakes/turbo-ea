/**
 * Every `dangerouslySetInnerHTML` renders HTML that is known safe — CLAUDE.md
 * Frontend Conventions: "stored HTML through `sanitizeRichHtml`".
 *
 * The `__html` value of each site must be one of:
 *   - `sanitizeRichHtml(…)` (`lib/richHtml.ts`) — stored rich text;
 *   - `escapeHtml(…)`, or a `….sanitize(…)` call (DOMPurify, e.g. an SVG
 *     thumbnail with its own profile);
 *   - a `t(…)` / `i18n.t(…)` / `x.t(…)` call whose options carry
 *     `interpolation: { escapeValue: true }`. `i18n/index.ts` turns escaping
 *     off globally (React escapes text children), so a translation injected as
 *     HTML with a user-typed value interpolated — a card or role name — is
 *     script injection unless the call turns it back on. A card named
 *     `<img src=x onerror=…>` executed from the restore dialog that way.
 * Parentheses, `as` casts and `??` / `||` fallbacks are looked through (the
 * main operand decides), and a `cond ? a : b` passes when both branches do.
 * Anything else needs an `UNSAFE_OK` entry with the reason it is safe.
 */
import fs from "node:fs";
import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, parse, rel, walkSources } from "@/test/sourceScanners";

/** Files whose every `dangerouslySetInnerHTML` is safe for a reason the scan cannot see. */
const UNSAFE_OK: Record<string, string> = {
  "src/features/admin/CalculationsAdmin.tsx":
    "highlightFormula() runs every fragment of the formula through its own escapeHtml before " +
    "wrapping it in highlight spans",
};

/** Anti-rot floor: a parse or walker bug that finds no site must not pass vacuously. */
const MIN_SITES = 10;

const SANITIZERS = new Set(["sanitizeRichHtml", "escapeHtml"]);

function unwrap(expr: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isNonNullExpression(expr)) {
      expr = expr.expression;
    } else if (
      ts.isBinaryExpression(expr) &&
      (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      expr = expr.left;
    } else {
      return expr;
    }
  }
}

function propertyNamed(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === name) {
      return prop.initializer;
    }
  }
  return undefined;
}

/** `t(…)` whose last argument is `{ …, interpolation: { escapeValue: true } }`. */
function isEscapingTranslation(call: ts.CallExpression): boolean {
  const callee = call.expression;
  const isT =
    (ts.isIdentifier(callee) && callee.text === "t") ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === "t");
  const options = call.arguments[call.arguments.length - 1];
  if (!isT || !options || !ts.isObjectLiteralExpression(options)) return false;
  const interpolation = propertyNamed(options, "interpolation");
  if (!interpolation || !ts.isObjectLiteralExpression(interpolation)) return false;
  return propertyNamed(interpolation, "escapeValue")?.kind === ts.SyntaxKind.TrueKeyword;
}

/** True when `expr` is HTML the scan can prove safe. */
function isSafeHtml(expr: ts.Expression): boolean {
  const e = unwrap(expr);
  if (ts.isConditionalExpression(e)) return isSafeHtml(e.whenTrue) && isSafeHtml(e.whenFalse);
  if (!ts.isCallExpression(e)) return false;
  const callee = e.expression;
  if (ts.isIdentifier(callee) && SANITIZERS.has(callee.text)) return true;
  if (ts.isPropertyAccessExpression(callee) && callee.name.text === "sanitize") return true;
  return isEscapingTranslation(e);
}

/** `line: verdict` for every `dangerouslySetInnerHTML` in a parsed file. */
function innerHtmlSites(sf: ts.SourceFile): { line: number; safe: boolean }[] {
  const sites: { line: number; safe: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "dangerouslySetInnerHTML") {
      const init = node.initializer;
      const value =
        init && ts.isJsxExpression(init) && init.expression ? unwrap(init.expression) : undefined;
      const html =
        value && ts.isObjectLiteralExpression(value) ? propertyNamed(value, "__html") : undefined;
      sites.push({
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        safe: html !== undefined && isSafeHtml(html),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function verdicts(snippet: string): boolean[] {
  return innerHtmlSites(parse("x.tsx", snippet)).map((s) => s.safe);
}

describe("innerHtmlSites", () => {
  it("flags a translation that interpolates without escaping", () => {
    expect(verdicts('<b dangerouslySetInnerHTML={{ __html: t("k", { name }) }} />')).toEqual([false]);
    expect(
      verdicts(
        '<b dangerouslySetInnerHTML={{ __html: t("k", { name, interpolation: { escapeValue: false } }) }} />',
      ),
    ).toEqual([false]);
  });

  it("passes a translation that turns escaping on, however t is reached", () => {
    expect(
      verdicts(
        [
          '<b dangerouslySetInnerHTML={{ __html: t("k", { name, interpolation: { escapeValue: true } }) }} />',
          '<b dangerouslySetInnerHTML={{ __html: i18n.t("k", { n, interpolation: { escapeValue: true } }) }} />',
        ].join(""),
      ),
    ).toEqual([true, true]);
  });

  it("passes sanitizeRichHtml, escapeHtml and DOMPurify.sanitize, through parens, casts and fallbacks", () => {
    expect(
      verdicts(
        [
          "<b dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(x) }} />",
          "<b dangerouslySetInnerHTML={{ __html: (escapeHtml(x) as string) }} />",
          '<b dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svg) ?? "" }} />',
        ].join(""),
      ),
    ).toEqual([true, true, true]);
  });

  it("needs both branches of a conditional to be safe", () => {
    const ok = 't("a", { interpolation: { escapeValue: true } })';
    expect(
      verdicts(
        [
          `<b dangerouslySetInnerHTML={{ __html: c ? ${ok} : sanitizeRichHtml(x) }} />`,
          `<b dangerouslySetInnerHTML={{ __html: c ? ${ok} : t("b", { name }) }} />`,
        ].join(""),
      ),
    ).toEqual([true, false]);
  });

  it("fails a bare variable, a shorthand __html and a non-literal object", () => {
    expect(
      verdicts(
        [
          "<b dangerouslySetInnerHTML={{ __html: html }} />",
          "<b dangerouslySetInnerHTML={{ __html }} />",
          "<b dangerouslySetInnerHTML={props} />",
          "<b dangerouslySetInnerHTML={{ __html: render(x) }} />",
        ].join(""),
      ),
    ).toEqual([false, false, false, false]);
  });
});

describeSourceScan("dangerouslySetInnerHTML renders only sanitised or escaped HTML", () => {
  let cached: Map<string, { line: number; safe: boolean }[]> | undefined;
  /** Files with at least one site, keyed by `src/…` path. */
  const sitesByFile = (): Map<string, { line: number; safe: boolean }[]> => {
    if (!cached) {
      cached = new Map();
      for (const file of walkSources(SRC)) {
        const source = fs.readFileSync(file, "utf8");
        if (!source.includes("dangerouslySetInnerHTML")) continue;
        const sites = innerHtmlSites(parse(file, source));
        if (sites.length) cached.set(rel(file), sites);
      }
    }
    return cached;
  };

  itSourceScan("finds the sites (anti-rot floor)", () => {
    const total = [...sitesByFile().values()].reduce((n, sites) => n + sites.length, 0);
    expect(total).toBeGreaterThanOrEqual(MIN_SITES);
  });

  itSourceScan("every site is sanitizeRichHtml / escapeHtml / DOMPurify / an escaping t()", () => {
    const unsafe = [...sitesByFile()]
      .filter(([file]) => !(file in UNSAFE_OK))
      .flatMap(([file, sites]) => sites.filter((s) => !s.safe).map((s) => `${file}:${s.line}`));
    expect(
      unsafe,
      "HTML injected through dangerouslySetInnerHTML must be sanitizeRichHtml(…) (lib/richHtml.ts), " +
        "escapeHtml(…), DOMPurify's sanitize(…), or a t() call with interpolation: { escapeValue: true } " +
        "(i18n escaping is off globally). CLAUDE.md Frontend Conventions.",
    ).toEqual([]);
  });

  itSourceScan("has no stale UNSAFE_OK entry", () => {
    const stale = Object.keys(UNSAFE_OK).filter(
      (file) =>
        !fs.existsSync(path.join(SRC, "..", file)) ||
        (sitesByFile().get(file) ?? []).every((s) => s.safe),
    );
    expect(stale, "the file no longer has an unprovable site — remove its UNSAFE_OK entry").toEqual([]);
  });
});
