/**
 * Route pages are code-split — CLAUDE.md Frontend Conventions: "Route-level
 * pages use `lazy()` imports in `App.tsx` for code splitting."
 *
 * A static `import X from "@/features/…"` in `App.tsx` puts that page, and
 * everything it imports, in the entry chunk every visitor downloads before the
 * first paint — the login screen included. This scan parses `App.tsx`, takes
 * every static default import from a feature module (`@/features/…`,
 * `./features/…`, `./pages/…`) and fails when one is rendered inside a
 * `<Route element={…}>`, unless `EAGER_OK` says why it must stay eager.
 */
import fs from "node:fs";
import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, parse } from "@/test/sourceScanners";

/** Route pages that are imported statically on purpose. One-line reason each. */
const EAGER_OK: Record<string, string> = {
  LoginPage: "first screen; a lazy chunk would flash a spinner",
};

const PAGE_MODULE = /^(?:@\/features\/|\.\/features\/|@\/pages\/|\.\/pages\/)/;

function tagName(node: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  return node.tagName.getText();
}

/** Local names of static default imports from a page module. */
function staticPageImports(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (
      ts.isImportDeclaration(stmt) &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      PAGE_MODULE.test(stmt.moduleSpecifier.text) &&
      stmt.importClause?.name &&
      !stmt.importClause.isTypeOnly
    ) {
      names.add(stmt.importClause.name.text);
    }
  }
  return names;
}

/** Every JSX tag rendered anywhere inside a `<Route element={…}>`. */
function tagsInRouteElements(sf: ts.SourceFile): Set<string> {
  const tags = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) tags.add(tagName(node));
    ts.forEachChild(node, collect);
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node) === "Route") {
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && attr.name.getText() === "element" && attr.initializer) {
          collect(attr.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return tags;
}

/** Static page imports rendered as a route element: the eager route pages. */
function eagerRoutePages(sf: ts.SourceFile): string[] {
  const rendered = tagsInRouteElements(sf);
  return [...staticPageImports(sf)].filter((name) => rendered.has(name)).sort();
}

describe("eagerRoutePages", () => {
  it("finds a statically imported feature page rendered in a route, however deep", () => {
    const sf = parse(
      "App.tsx",
      [
        'import Login from "@/features/auth/Login";',
        'import Other from "./features/x/Other";',
        'import Layout from "@/layouts/Layout";',
        'const Lazy = lazy(() => import("@/features/y/Lazy"));',
        "const r = <Routes>",
        '  <Route path="/a" element={<Login />} />',
        '  <Route path="/b" element={<Layout><Suspense><Other /></Suspense></Layout>} />',
        '  <Route path="/c" element={<Lazy />} />',
        "</Routes>;",
      ].join("\n"),
    );
    expect(eagerRoutePages(sf)).toEqual(["Login", "Other"]);
  });

  it("ignores a static feature import that is not rendered by a route", () => {
    const sf = parse(
      "App.tsx",
      [
        'import Helper from "@/features/auth/Helper";',
        'import type Page from "@/features/auth/Page";',
        "const r = <div><Helper /></div>;",
        'const s = <Route path="/a" element={<Page />} />;',
      ].join("\n"),
    );
    expect(eagerRoutePages(sf)).toEqual([]);
  });
});

describeSourceScan("App.tsx lazy-loads its route pages", () => {
  const app = (): ts.SourceFile => {
    const file = path.join(SRC, "App.tsx");
    return parse(file, fs.readFileSync(file, "utf8"));
  };

  itSourceScan("renders no statically imported page in a route outside EAGER_OK", () => {
    const eager = eagerRoutePages(app()).filter((name) => !(name in EAGER_OK));
    expect(
      eager,
      'Import route pages with lazy(() => import("@/features/…")) in App.tsx (CLAUDE.md, ' +
        "Frontend Conventions), or add an EAGER_OK entry saying why the page must be in the entry chunk.",
    ).toEqual([]);
  });

  itSourceScan("has no stale EAGER_OK entry", () => {
    const eager = new Set(eagerRoutePages(app()));
    const stale = Object.keys(EAGER_OK).filter((name) => !eager.has(name));
    expect(stale, "no longer a static route page in App.tsx — remove its EAGER_OK entry").toEqual([]);
  });

  itSourceScan("sees the route table (anti-rot floor)", () => {
    expect(tagsInRouteElements(app()).size).toBeGreaterThan(40);
  });
});
