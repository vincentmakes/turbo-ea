/**
 * Every AG Grid offers column freeze through the shared hook — CLAUDE.md
 * Frontend Conventions ("Every AG Grid offers column freeze through
 * `useColumnFreeze`"), `.claude/rules/frontend-grids.md`.
 *
 * AG Grid Community renders `colDef.pinned` but ships no UI to set it, so the
 * affordance lives in `useColumnFreeze` (`components/grid/useColumnFreeze.ts`).
 * A grid that does not call it silently lacks a per-user preference every
 * other grid has. This scan parses each source file and fails when one renders
 * `<AgGridReact>` as JSX without calling `useColumnFreeze(…)`. A type argument
 * such as `useRef<AgGridReact<Row>>` is not a grid, and a comment is not a call.
 */
import fs from "node:fs";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, parse, rel, walkSources } from "@/test/sourceScanners";

/** Grids that may skip the hook, with the reason. Keep it empty. */
const NO_FREEZE_OK: Record<string, string> = {};

/** Anti-rot floor: eight grids today; a parse bug that finds none must not pass vacuously. */
const MIN_GRIDS = 6;

/** Whether `sf` renders `<AgGridReact>` and whether it calls `useColumnFreeze`. */
function gridUsage(sf: ts.SourceFile): { rendersGrid: boolean; callsFreeze: boolean } {
  let rendersGrid = false;
  let callsFreeze = false;
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sf) === "AgGridReact"
    ) {
      rendersGrid = true;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "useColumnFreeze"
    ) {
      callsFreeze = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { rendersGrid, callsFreeze };
}

describe("gridUsage", () => {
  it("sees a JSX grid and a (generic) hook call", () => {
    const sf = parse(
      "x.tsx",
      [
        "const f = useColumnFreeze<Row>(gridRef, opts);",
        "const g = <AgGridReact<Row> rowData={rows} />;",
      ].join("\n"),
    );
    expect(gridUsage(sf)).toEqual({ rendersGrid: true, callsFreeze: true });
  });

  it("does not take a type argument for a grid, or a comment for a call", () => {
    const sf = parse(
      "x.tsx",
      [
        "const ref = useRef<AgGridReact<Row> | null>(null);",
        "// wire useColumnFreeze(gridRef) on every <AgGridReact>",
        "const g = <AgGridReact rowData={rows}></AgGridReact>;",
      ].join("\n"),
    );
    expect(gridUsage(sf)).toEqual({ rendersGrid: true, callsFreeze: false });
    expect(gridUsage(parse("y.tsx", "const ref = useRef<AgGridReact<Row>>(null);"))).toEqual({
      rendersGrid: false,
      callsFreeze: false,
    });
  });
});

describeSourceScan("every AG Grid wires useColumnFreeze", () => {
  let cached: Map<string, { rendersGrid: boolean; callsFreeze: boolean }> | undefined;
  /** Files that render a grid, keyed by `src/…` path. */
  const grids = (): Map<string, { rendersGrid: boolean; callsFreeze: boolean }> => {
    if (!cached) {
      cached = new Map();
      for (const file of walkSources(SRC)) {
        const source = fs.readFileSync(file, "utf8");
        if (!source.includes("AgGridReact")) continue;
        const usage = gridUsage(parse(file, source));
        if (usage.rendersGrid) cached.set(rel(file), usage);
      }
    }
    return cached;
  };

  itSourceScan("finds the grids (anti-rot floor)", () => {
    expect(grids().size).toBeGreaterThanOrEqual(MIN_GRIDS);
  });

  itSourceScan("every file rendering <AgGridReact> calls useColumnFreeze", () => {
    const missing = [...grids()]
      .filter(([file, usage]) => !usage.callsFreeze && !(file in NO_FREEZE_OK))
      .map(([file]) => file);
    expect(
      missing,
      "Wire column freeze with useColumnFreeze (src/components/grid/useColumnFreeze.ts): " +
        "headerComponentParams on defaultColDef, containerRef + sx on the wrapper, applyFrozen on " +
        "the column defs. .claude/rules/frontend-grids.md.",
    ).toEqual([]);
  });

  itSourceScan("has no stale NO_FREEZE_OK entry", () => {
    const stale = Object.keys(NO_FREEZE_OK).filter((file) => {
      const usage = grids().get(file);
      return !usage || usage.callsFreeze;
    });
    expect(stale, "remove the NO_FREEZE_OK entry").toEqual([]);
  });
});
