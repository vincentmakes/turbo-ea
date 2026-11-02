/**
 * Cards by id go through `fetchCardsByIds` (`api/cardsByIds.ts`) — CLAUDE.md
 * Frontend Conventions: "cards by id list go through `fetchCardsByIds`, never
 * a hand-built `/cards?ids=` URL".
 *
 * The shared fetcher chunks the ids (200 per request) so the request line
 * stays under the edge nginx's 8 KB limit — a hand-built URL with a few
 * hundred ids is refused with 414 before it reaches the backend (#1093) — and
 * reports the ids a View deny withheld. This scan fails on any string or
 * template literal that builds an `ids=` query parameter (`?ids=` / `&ids=`).
 * Comments are prose and skipped; `card_ids=` / `type_ids=` are other
 * parameters and do not match.
 */
import fs from "node:fs";
import path from "node:path";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { describeSourceScan, itSourceScan } from "@/test/sourceScan";
import { SRC, parse, rel, walkSources } from "@/test/sourceScanners";

/** The one module allowed to build the URL. */
const FETCHER = "src/api/cardsByIds.ts";

/** An `ids` query parameter: `?ids=` or `&ids=`, never `card_ids=` / `type_ids=`. */
const IDS_PARAM = /[?&]ids=/;

/** Anti-rot floor: the walker must still see the source tree. */
const MIN_FILES_SCANNED = 300;

/** `line: text` for every literal in `sf` that builds an `ids=` query. */
function idsQueries(sf: ts.SourceFile): string[] {
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      IDS_PARAM.test(node.text)
    ) {
      hits.push(`${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function scanSnippet(src: string): string[] {
  return idsQueries(parse("x.ts", src));
}

describe("idsQueries", () => {
  it("finds a hand-built /cards?ids= URL however it is written", () => {
    expect(scanSnippet("api.get(`/cards?ids=${ids.join(\",\")}&page_size=200`);")).toEqual([
      "1: /cards?ids=",
    ]);
    expect(scanSnippet('api.get("/cards?page_size=5&ids=" + ids);')).toEqual([
      "1: /cards?page_size=5&ids=",
    ]);
    expect(scanSnippet("api.get(`/cards?type=${t}&ids=${ids}`);")).toEqual(["1: &ids="]);
  });

  it("ignores other id parameters and comments", () => {
    expect(
      scanSnippet(
        [
          "api.get(`/relations?card_ids=${ids}`);",
          'api.get("/cards?type_ids=" + ids);',
          "// one GET /cards?ids= round-trip",
          "/** `GET /cards?ids=` chunk */",
          "const k = 'ids';",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});

describeSourceScan("cards by id go through fetchCardsByIds", () => {
  itSourceScan("no hand-built ids= query outside api/cardsByIds.ts", () => {
    const files = walkSources(SRC, { exclude: (f) => f === FETCHER });
    expect(files.length).toBeGreaterThan(MIN_FILES_SCANNED);
    const offenders = files.flatMap((file) =>
      idsQueries(parse(file, fs.readFileSync(file, "utf8"))).map((hit) => `${rel(file)}:${hit}`),
    );
    expect(
      offenders,
      "Fetch cards by id with fetchCardsByIds / fetchCardsByIdsDetailed (src/api/cardsByIds.ts): " +
        "it chunks the ids under the proxy's URL limit and reports withheld ids. CLAUDE.md, " +
        "Frontend Conventions.",
    ).toEqual([]);
  });

  itSourceScan("the fetcher itself still builds the query (the exclusion is not stale)", () => {
    const fetcher = path.join(SRC, "api", "cardsByIds.ts");
    expect(idsQueries(parse(fetcher, fs.readFileSync(fetcher, "utf8"))).length).toBeGreaterThan(0);
  });
});
