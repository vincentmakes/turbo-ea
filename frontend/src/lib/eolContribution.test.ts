import { describe, expect, it } from "vitest";
import type { EolCustomCycle, EolCustomProduct } from "@/types";
import {
  EOL_DATE_CATEGORIES,
  MAX_GITHUB_URL_LENGTH,
  buildEolProductFile,
  eolDateSlug,
  githubNewFileUrl,
} from "./eolContribution";

function cycle(over: Partial<EolCustomCycle>): EolCustomCycle {
  return {
    id: over.cycle ?? "c",
    cycle: "1",
    releaseDate: null,
    support: null,
    eol: null,
    latest: null,
    latestReleaseDate: null,
    sort_order: 0,
    linked_cards: 0,
    updated_at: null,
    ...over,
  };
}

const PRODUCT: Pick<EolCustomProduct, "key" | "title" | "description" | "link" | "cycles"> = {
  key: "acme_erp.suite",
  title: "Acme ERP",
  description: "is an ERP for widget makers.",
  link: "https://acme.example/erp",
  cycles: [
    cycle({ cycle: "1.10", releaseDate: "2020-01-01", eol: true, support: false, latest: "1.10.4" }),
    cycle({
      cycle: "2",
      releaseDate: "2024-03-01",
      eol: "2028-03-01",
      support: "2026-03-01",
      latest: "2.1",
      latestReleaseDate: "2024-09-01",
    }),
    cycle({ cycle: "3", eol: false, support: true }),
  ],
};

const OPTIONS = {
  category: "app" as const,
  today: "2026-11-04",
  policyPlaceholder: "POLICY",
  descriptionPlaceholder: "DESCRIBE",
};

describe("buildEolProductFile", () => {
  it("writes endoflife.date's front matter, newest release first", () => {
    expect(buildEolProductFile(PRODUCT, OPTIONS)).toBe(
      [
        "---",
        'title: "Acme ERP"',
        "addedAt: 2026-11-04",
        "category: app",
        "permalink: /acme-erp-suite",
        'releasePolicyLink: "https://acme.example/erp"',
        "eoasColumn: true",
        "",
        "releases:",
        '  - releaseCycle: "2"',
        "    releaseDate: 2024-03-01",
        "    eoas: 2026-03-01",
        "    eol: 2028-03-01",
        '    latest: "2.1"',
        "    latestReleaseDate: 2024-09-01",
        '  - releaseCycle: "1.10"',
        "    releaseDate: 2020-01-01",
        "    eoas: true",
        "    eol: true",
        '    latest: "1.10.4"',
        '  - releaseCycle: "3"',
        "    eoas: false",
        "    eol: false",
        "",
        "---",
        "",
        "> [Acme ERP](https://acme.example/erp) is an ERP for widget makers.",
        "",
        "POLICY",
        "",
      ].join("\n"),
    );
  });

  it("inverts the API's support boolean into eoas", () => {
    const file = buildEolProductFile(
      { ...PRODUCT, cycles: [cycle({ cycle: "9", support: true, eol: false })] },
      OPTIONS,
    );
    // support: true means still supported, so active support has NOT ended.
    expect(file).toContain("    eoas: false");
    expect(file).toContain("    eol: false");
  });

  it("hides empty columns and falls back to placeholders", () => {
    const file = buildEolProductFile(
      {
        key: "x",
        title: 'Quote "me"',
        description: "  ",
        link: null,
        cycles: [cycle({ cycle: "1", eol: "2030-01-01" })],
      },
      { ...OPTIONS, category: "os" },
    );
    expect(file).toContain('title: "Quote \\"me\\""');
    expect(file).toContain("category: os");
    expect(file).toContain("latestColumn: false");
    expect(file).not.toContain("eoasColumn");
    expect(file).not.toContain("releasePolicyLink");
    expect(file).toContain('> Quote "me" DESCRIBE');
  });

  it("keeps the summary on one line and user text out of link syntax", () => {
    const file = buildEolProductFile(
      {
        key: "x",
        title: "Acme [beta]",
        description: "Line one.\n\n  Line (two) [x].",
        link: "https://acme.example/a (b)",
        cycles: [cycle({ cycle: "1", eol: "2030-01-01" })],
      },
      OPTIONS,
    );
    expect(file).toContain(
      "> [Acme \\[beta\\]](https://acme.example/a%20%28b%29) Line one. Line \\(two\\) \\[x\\].",
    );
    // The blockquote is a single line: nothing of it spills onto the next.
    const quote = file.split("\n").findIndex((l) => l.startsWith("> "));
    expect(file.split("\n")[quote + 1]).toBe("");
  });

  it("uses today when no date is given", () => {
    const { today: _today, ...rest } = OPTIONS;
    expect(buildEolProductFile(PRODUCT, rest)).toMatch(/addedAt: \d{4}-\d{2}-\d{2}\n/);
  });

  it("offers every endoflife.date category", () => {
    expect(EOL_DATE_CATEGORIES).toEqual([
      "app",
      "database",
      "device",
      "framework",
      "lang",
      "os",
      "server-app",
      "service",
      "standard",
    ]);
  });
});

describe("eolDateSlug", () => {
  it.each([
    ["acme-erp", "acme-erp"],
    ["acme_erp.suite", "acme-erp-suite"],
    ["a..b__c", "a-b-c"],
    ["a-.b", "a-b"],
  ])("%j → %j", (key, slug) => {
    expect(eolDateSlug(key)).toBe(slug);
  });
});

describe("githubNewFileUrl", () => {
  it("prefills GitHub's new-file page in the products folder", () => {
    const url = githubNewFileUrl("acme_erp", "a b&c");
    expect(url).toBe(
      "https://github.com/endoflife-date/endoflife.date/new/master/products" +
        "?filename=acme-erp.md&value=a%20b%26c",
    );
  });

  it("gives up past the length a URL survives", () => {
    const base = githubNewFileUrl("k", "") as string;
    const room = MAX_GITHUB_URL_LENGTH - base.length;
    expect(githubNewFileUrl("k", "x".repeat(room))).not.toBeNull();
    expect(githubNewFileUrl("k", "x".repeat(room + 1))).toBeNull();
  });
});
