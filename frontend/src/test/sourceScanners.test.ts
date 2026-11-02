import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";

import { SRC, parse, rawColours, rel, walkSources } from "./sourceScanners";

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

describe("parse", () => {
  it("parses a .tsx file as TSX and a .ts file as TS", () => {
    const hasJsx = (sf: ts.SourceFile): boolean => {
      let found = false;
      const visit = (n: ts.Node): void => {
        if (ts.isJsxElement(n)) found = true;
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return found;
    };
    const jsx = "const a = <b>x</b>;";
    expect(hasJsx(parse("x.tsx", jsx))).toBe(true);
    expect(hasJsx(parse("x.ts", jsx))).toBe(false);
    const sf = parse("x.tsx", jsx);
    expect(sf.statements[0].parent).toBe(sf);
  });
});

describe("rel", () => {
  it("is a POSIX path from frontend/, starting src/", () => {
    expect(rel(path.join(SRC, "lib", "x.ts"))).toBe("src/lib/x.ts");
    expect(rel(SRC)).toBe("src");
  });
});

describeSourceScan("walkSources", () => {
  itSourceScan("returns sorted .ts/.tsx sources and leaves out tests, .d.ts and src/test", () => {
    const files = walkSources(SRC).map(rel);
    expect(files).toEqual([...files].sort());
    expect(files).toContain("src/App.tsx");
    expect(files).toContain("src/lib/richHtml.ts");
    expect(files.every((f) => /\.tsx?$/.test(f))).toBe(true);
    expect(files.filter((f) => /\.test\.tsx?$/.test(f))).toEqual([]);
    expect(files.filter((f) => f.endsWith(".d.ts"))).toEqual([]);
    expect(files.filter((f) => f.startsWith("src/test/"))).toEqual([]);
    expect(files.filter((f) => f.includes("node_modules"))).toEqual([]);
  });

  itSourceScan("walks only the directory it is given, and honours exclude", () => {
    const lib = walkSources(path.join(SRC, "lib")).map(rel);
    expect(lib.length).toBeGreaterThan(5);
    expect(lib.every((f) => f.startsWith("src/lib/"))).toBe(true);
    const without = walkSources(path.join(SRC, "lib"), {
      exclude: (f) => f === "src/lib/richHtml.ts",
    }).map(rel);
    expect(without).not.toContain("src/lib/richHtml.ts");
    expect(without).toHaveLength(lib.length - 1);
  });
});
