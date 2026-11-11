import { describe, expect, it } from "vitest";

import {
  asMentionKind,
  canonicalMentionHtml,
  decodeEntities,
  fillMentionLabels,
  mentionsIn,
  parseSpanAttributes,
  type MentionLabels,
} from "./mentionHtml";

const ID = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";
const ID2 = "1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02";
const TOKEN = "ab12cd34";

const LABELS: MentionLabels = {
  restricted: { card: "R-card", decision: "R-decision", user: "R-user", other: "R-other" },
  missing: { card: "M-card", decision: "M-decision", user: "M-user", other: "M-other" },
};

describe("fillMentionLabels", () => {
  it("returns the very same string for HTML without mentions", () => {
    const html = "<p>plain <span>text</span></p>";
    expect(fillMentionLabels(html, LABELS)).toBe(html);
    expect(fillMentionLabels("", LABELS)).toBe("");
    expect(fillMentionLabels(null, LABELS)).toBeNull();
    expect(fillMentionLabels(undefined, LABELS)).toBeUndefined();
  });

  it("labels a restricted span by its kind, or neutrally without one", () => {
    expect(
      fillMentionLabels(
        `<p><span data-type="mention" data-kind="card" data-restricted="true" data-token="${TOKEN}"></span></p>`,
        LABELS,
      ),
    ).toBe(
      `<p><span data-type="mention" data-kind="card" data-restricted="true" data-token="${TOKEN}">R-card</span></p>`,
    );
    expect(
      fillMentionLabels(
        `<span data-type="mention" data-kind="decision" data-restricted="true" data-token="${TOKEN}"></span>`,
        LABELS,
      ),
    ).toBe(
      `<span data-type="mention" data-kind="decision" data-restricted="true" data-token="${TOKEN}">R-decision</span>`,
    );
    expect(
      fillMentionLabels(
        `<span data-type="mention" data-restricted="true" data-token="${TOKEN}"></span>`,
        LABELS,
      ),
    ).toBe(`<span data-type="mention" data-restricted="true" data-token="${TOKEN}">R-other</span>`);
  });

  it("labels a missing span by its kind", () => {
    expect(
      fillMentionLabels(
        `<span data-type="mention" data-kind="decision" data-id="${ID}" data-missing="true"></span>` +
          `<span data-type="mention" data-kind="user" data-id="${ID2}" data-missing="true"></span>` +
          `<span data-type="mention" data-kind="bogus" data-id="${ID2}" data-missing="true"></span>`,
        LABELS,
      ),
    ).toBe(
      `<span data-type="mention" data-kind="decision" data-id="${ID}" data-missing="true">M-decision</span>` +
        `<span data-type="mention" data-kind="user" data-id="${ID2}" data-missing="true">M-user</span>` +
        `<span data-type="mention" data-kind="bogus" data-id="${ID2}" data-missing="true">M-other</span>`,
    );
  });

  it("never touches a span that has text, an empty resolved span, or an empty non-mention span", () => {
    const html =
      `<span data-type="mention" data-kind="card" data-restricted="true" data-token="${TOKEN}">kept</span>` +
      `<span data-type="mention" data-kind="card" data-id="${ID}"></span>` +
      `<span data-restricted="true"></span>` +
      `<span data-type="other" data-missing="true"></span>`;
    expect(fillMentionLabels(html, LABELS)).toBe(html);
  });

  it("escapes the label it writes", () => {
    const labels: MentionLabels = {
      ...LABELS,
      missing: { ...LABELS.missing, card: "<b>&gone</b>" },
    };
    expect(
      fillMentionLabels(
        `<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true"></span>`,
        labels,
      ),
    ).toBe(
      `<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true">&lt;b&gt;&amp;gone&lt;/b&gt;</span>`,
    );
  });
});

describe("mentionsIn", () => {
  it("lists resolved mentions once each, in order, with the label without '@'", () => {
    const html =
      `<p><span data-type="mention" data-kind="card" data-id="${ID}">@SAP &amp; Co</span> ` +
      `<span data-type="mention" data-kind="decision" data-id="${ID2}">ADR-1 · Rev 2 T</span> ` +
      `<span data-type="mention" data-kind="card" data-id="${ID}">@SAP &amp; Co</span></p>`;
    expect(mentionsIn(html)).toEqual([
      { kind: "card", id: ID, label: "SAP & Co" },
      { kind: "decision", id: ID2, label: "ADR-1 · Rev 2 T" },
    ]);
  });

  it("skips restricted, missing, unknown-kind and non-mention spans", () => {
    const html =
      `<span data-type="mention" data-kind="card" data-restricted="true" data-token="${TOKEN}"></span>` +
      `<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true"></span>` +
      `<span data-type="mention" data-kind="tag" data-id="${ID}">@x</span>` +
      `<span data-kind="card" data-id="${ID}">@y</span>`;
    expect(mentionsIn(html)).toEqual([]);
    expect(mentionsIn(null)).toEqual([]);
    expect(mentionsIn("<p>none</p>")).toEqual([]);
  });

  it("keeps a user mention and the same id under two kinds apart", () => {
    const html =
      `<span data-type="mention" data-kind="user" data-id="${ID}">@Ann</span>` +
      `<span data-type="mention" data-kind="card" data-id="${ID}">@Ann</span>`;
    expect(mentionsIn(html)).toEqual([
      { kind: "user", id: ID, label: "Ann" },
      { kind: "card", id: ID, label: "Ann" },
    ]);
  });
});

describe("canonicalMentionHtml", () => {
  it("drops labels, state flags and attribute order", () => {
    expect(
      canonicalMentionHtml(
        `<p>a <span data-archived="true" data-id="${ID}" data-type="mention" data-kind="card">@X</span></p>`,
      ),
    ).toBe(`<p>a <span data-type="mention" data-kind="card" data-id="${ID}"></span></p>`);
  });

  it("keeps a restricted mention's token and nothing else", () => {
    expect(
      canonicalMentionHtml(
        `<span data-type="mention" data-kind="card" data-restricted="true" data-token="${TOKEN}">R</span>`,
      ),
    ).toBe(`<span data-type="mention" data-kind="card" data-token="${TOKEN}"></span>`);
    expect(
      canonicalMentionHtml(`<span data-type="mention" data-restricted="true" data-token="${TOKEN}"></span>`),
    ).toBe(`<span data-type="mention" data-token="${TOKEN}"></span>`);
  });

  it("prefers the id over a token and returns other HTML unchanged", () => {
    expect(
      canonicalMentionHtml(`<span data-type="mention" data-kind="card" data-id="${ID}" data-token="${TOKEN}"></span>`),
    ).toBe(`<span data-type="mention" data-kind="card" data-id="${ID}"></span>`);
    expect(canonicalMentionHtml("<p><span>x</span></p>")).toBe("<p><span>x</span></p>");
  });
});

describe("helpers", () => {
  it("parseSpanAttributes reads every quoted attribute", () => {
    expect(parseSpanAttributes(' data-type="mention" data-kind="card" data-id=""')).toEqual({
      "data-type": "mention",
      "data-kind": "card",
      "data-id": "",
    });
  });

  it("asMentionKind narrows to the three kinds", () => {
    expect(asMentionKind("card")).toBe("card");
    expect(asMentionKind("decision")).toBe("decision");
    expect(asMentionKind("user")).toBe("user");
    expect(asMentionKind("tag")).toBeNull();
    expect(asMentionKind(null)).toBeNull();
    expect(asMentionKind(undefined)).toBeNull();
  });

  it("decodeEntities decodes named, decimal and hex entities and leaves unknown ones", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&#39; &#x41;&#66;&nbsp;&bogus;")).toBe(
      "a & b <c> \"d\" 'e' AB &bogus;",
    );
    expect(decodeEntities("&#X41;&AMP;")).toBe("A&");
  });
});
