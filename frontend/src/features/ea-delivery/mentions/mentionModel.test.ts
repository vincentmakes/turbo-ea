import { describe, expect, it } from "vitest";

import type { MentionLabels } from "@/lib/mentionHtml";
import type { ArchitectureDecision } from "@/types";
import {
  MENTION_GROUP_LIMIT,
  cardMentionItems,
  decisionMentionItems,
  flattenGroups,
  groupMentionItems,
  mentionAttrsFromElement,
  mentionChipText,
  mentionHref,
  mentionHrefFromTarget,
  mentionSpanAttributes,
  mentionText,
  nextIndex,
  unlinkedMentionedCards,
  userMentionItems,
  type MentionAttrs,
} from "./mentionModel";

const ID = "0b0e5b1e-6a0e-4c43-9b8e-2d1c4a5f7e01";
const ID2 = "1c1f6c2f-7b1f-4d54-8c9f-3e2d5b6a8f02";
const TOKEN = "ab12cd34";

const BASE: MentionAttrs = {
  kind: "card",
  id: ID,
  token: null,
  label: "SAP",
  restricted: false,
  missing: false,
  archived: false,
};

const LABELS: MentionLabels = {
  restricted: { card: "R-card", decision: "R-decision", user: "R-user", other: "R-other" },
  missing: { card: "M-card", decision: "M-decision", user: "M-user", other: "M-other" },
};

function el(html: string): Element {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.firstElementChild!;
}

describe("mentionAttrsFromElement", () => {
  it("reads a resolved card mention, dropping one leading '@' from the label", () => {
    expect(
      mentionAttrsFromElement(
        el(`<span data-type="mention" data-kind="card" data-id="${ID}" data-archived="true">@@SAP</span>`),
      ),
    ).toEqual({ ...BASE, label: "@SAP", archived: true });
  });

  it("keeps a decision's label as written", () => {
    expect(
      mentionAttrsFromElement(
        el(`<span data-type="mention" data-kind="decision" data-id="${ID}">@ADR-1 T</span>`),
      ),
    ).toEqual({ ...BASE, kind: "decision", label: "@ADR-1 T" });
  });

  it("reads restricted and missing spans", () => {
    expect(
      mentionAttrsFromElement(
        el(`<span data-type="mention" data-kind="card" data-restricted="true" data-token="${TOKEN}"></span>`),
      ),
    ).toEqual({ ...BASE, id: null, token: TOKEN, label: "", restricted: true });
    expect(
      mentionAttrsFromElement(
        el(`<span data-type="mention" data-kind="other" data-id="${ID}" data-missing="false"></span>`),
      ),
    ).toEqual({ ...BASE, kind: null, label: "", missing: false });
    expect(
      mentionAttrsFromElement(
        el(`<span data-type="mention" data-kind="card" data-id="${ID}" data-missing="true"></span>`),
      ),
    ).toEqual({ ...BASE, label: "", missing: true });
  });
});

describe("mentionSpanAttributes", () => {
  it("writes type, kind and id in canonical order for a resolved mention", () => {
    expect(Object.entries(mentionSpanAttributes(BASE))).toEqual([
      ["data-type", "mention"],
      ["data-kind", "card"],
      ["data-id", ID],
    ]);
  });

  it("writes a restricted mention back as kind, flag and token, never an id", () => {
    expect(
      Object.entries(
        mentionSpanAttributes({ ...BASE, id: null, token: TOKEN, restricted: true, label: "" }),
      ),
    ).toEqual([
      ["data-type", "mention"],
      ["data-kind", "card"],
      ["data-restricted", "true"],
      ["data-token", TOKEN],
    ]);
  });

  it("puts the missing and archived flags last, and omits an absent kind", () => {
    expect(
      Object.entries(mentionSpanAttributes({ ...BASE, kind: null, missing: true, archived: true })),
    ).toEqual([
      ["data-type", "mention"],
      ["data-id", ID],
      ["data-missing", "true"],
      ["data-archived", "true"],
    ]);
  });
});

describe("mentionText and mentionChipText", () => {
  it("prefixes '@' for a card or person, not for a decision", () => {
    expect(mentionText(BASE)).toBe("@SAP");
    expect(mentionText({ ...BASE, kind: "user", label: "Ann" })).toBe("@Ann");
    expect(mentionText({ ...BASE, kind: "decision", label: "ADR-1 T" })).toBe("ADR-1 T");
  });

  it("writes nothing for restricted, missing or unlabelled mentions", () => {
    expect(mentionText({ ...BASE, restricted: true })).toBe("");
    expect(mentionText({ ...BASE, missing: true })).toBe("");
    expect(mentionText({ ...BASE, label: "" })).toBe("");
  });

  it("shows the reader's words on a restricted or missing chip", () => {
    expect(mentionChipText({ ...BASE, restricted: true }, LABELS)).toBe("R-card");
    expect(mentionChipText({ ...BASE, kind: null, restricted: true }, LABELS)).toBe("R-other");
    expect(mentionChipText({ ...BASE, kind: "decision", missing: true }, LABELS)).toBe("M-decision");
    expect(mentionChipText({ ...BASE, kind: null, missing: true }, LABELS)).toBe("M-other");
    expect(mentionChipText(BASE, LABELS)).toBe("@SAP");
    expect(mentionChipText({ ...BASE, label: "" }, LABELS)).toBe("@");
  });
});

describe("mentionHref", () => {
  it("leads a card to its page and a decision to the decision page", () => {
    expect(mentionHref(BASE)).toBe(`/cards/${ID}`);
    expect(mentionHref({ ...BASE, kind: "decision" })).toBe(`/ea-delivery/adr/${ID}`);
  });

  it("leads nowhere for a person, a restricted, a missing or an id-less mention", () => {
    expect(mentionHref({ ...BASE, kind: "user" })).toBeNull();
    expect(mentionHref({ ...BASE, kind: null })).toBeNull();
    expect(mentionHref({ ...BASE, restricted: true })).toBeNull();
    expect(mentionHref({ ...BASE, missing: true })).toBeNull();
    expect(mentionHref({ ...BASE, id: null })).toBeNull();
  });

  it("finds the mention a click landed in", () => {
    const span = el(`<span data-type="mention" data-kind="card" data-id="${ID}"><b>@SAP</b></span>`);
    expect(mentionHrefFromTarget(span.firstElementChild)).toBe(`/cards/${ID}`);
    expect(mentionHrefFromTarget(el("<p>x</p>"))).toBeNull();
    expect(mentionHrefFromTarget(null)).toBeNull();
    expect(mentionHrefFromTarget(document.createTextNode("x"))).toBeNull();
  });
});

describe("popup items", () => {
  const cards = [
    { id: "c1", name: "Billing Portal", type: "Application" },
    { id: "c2", name: "Portal", type: "Application" },
    { id: "c3", name: "CRM", type: "Application", alias: "portal-crm" },
    { id: "c4", name: "HR", type: "Application" },
  ];

  it("ranks cards on the raw query, exact first, alias included, non-matches dropped", () => {
    expect(cardMentionItems(cards, " portal ")).toEqual([
      { kind: "card", id: "c2", label: "Portal", secondary: "Application" },
      { kind: "card", id: "c3", label: "CRM", secondary: "Application" },
      { kind: "card", id: "c1", label: "Billing Portal", secondary: "Application" },
    ]);
  });

  it("keeps the server's order with an empty query and caps every group", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, name: `N${i}`, type: "T" }));
    const items = cardMentionItems(many, "");
    expect(items).toHaveLength(MENTION_GROUP_LIMIT);
    expect(MENTION_GROUP_LIMIT).toBe(8);
    expect(items[0].id).toBe("x0");
    expect(items[7].id).toBe("x7");
  });

  it("labels decisions as the server does and ranks on title and reference", () => {
    const rows = [
      { id: "d1", reference_number: "ADR-002", title: "Pick a CRM", revision_number: 2 },
      { id: "d2", reference_number: "ADR-001", title: "Adopt Kafka", revision_number: 1 },
    ] as ArchitectureDecision[];
    const t = (key: string, opts?: Record<string, unknown>) =>
      key === "adr.revision.reference" ? `${opts?.reference} · Rev ${opts?.number}` : key;
    expect(decisionMentionItems(rows, "", t)).toEqual([
      { kind: "decision", id: "d1", label: "ADR-002 · Rev 2 Pick a CRM" },
      { kind: "decision", id: "d2", label: "ADR-001 Adopt Kafka" },
    ]);
    expect(decisionMentionItems(rows, "kafka", t).map((i) => i.id)).toEqual(["d2"]);
    expect(decisionMentionItems(rows, "ADR-002", t).map((i) => i.id)).toEqual(["d1"]);
  });

  it("ranks people by name with the e-mail as an alias", () => {
    const users = [
      { id: "u1", display_name: "Zoe Ann", email: "zoe@x.io" },
      { id: "u2", display_name: "Ann Lee", email: "lee@x.io" },
      { id: "u3", display_name: "Bob", email: "ann.b@x.io" },
      { id: "u4", display_name: "Carl", email: "carl@x.io" },
    ];
    expect(userMentionItems(users, "ann").map((u) => u.id)).toEqual(["u2", "u3", "u1"]);
    expect(userMentionItems(users, "")[0]).toEqual({
      kind: "user",
      id: "u1",
      label: "Zoe Ann",
      secondary: "zoe@x.io",
    });
  });

  it("groups non-empty kinds in a fixed order and flattens them for the keys", () => {
    const card = { kind: "card" as const, id: "c", label: "C" };
    const dec = { kind: "decision" as const, id: "d", label: "D" };
    const user = { kind: "user" as const, id: "u", label: "U" };
    const groups = groupMentionItems({ user: [user], card: [card], decision: [] });
    expect(groups).toEqual([
      { kind: "card", items: [card] },
      { kind: "user", items: [user] },
    ]);
    expect(flattenGroups(groupMentionItems({ decision: [dec], card: [card] }))).toEqual([card, dec]);
    expect(groupMentionItems({})).toEqual([]);
  });
});

describe("nextIndex", () => {
  it("moves down and wraps to the top", () => {
    expect(nextIndex(0, 3, "ArrowDown")).toBe(1);
    expect(nextIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextIndex(-1, 3, "ArrowDown")).toBe(0);
  });

  it("moves up and wraps to the bottom", () => {
    expect(nextIndex(2, 3, "ArrowUp")).toBe(1);
    expect(nextIndex(0, 3, "ArrowUp")).toBe(2);
    expect(nextIndex(-1, 3, "ArrowUp")).toBe(2);
  });

  it("keeps (and clamps) the row on any other key, and has none in an empty list", () => {
    expect(nextIndex(1, 3, "Enter")).toBe(1);
    expect(nextIndex(5, 3, "a")).toBe(2);
    expect(nextIndex(-4, 3, "a")).toBe(0);
    expect(nextIndex(0, 0, "ArrowDown")).toBe(-1);
    expect(nextIndex(0, -1, "ArrowUp")).toBe(-1);
    expect(nextIndex(0, 1, "ArrowDown")).toBe(0);
  });
});

describe("unlinkedMentionedCards", () => {
  it("offers mentioned cards that are not linked, once each, decisions and people aside", () => {
    const html =
      `<p><span data-type="mention" data-kind="card" data-id="${ID}">@SAP</span>` +
      `<span data-type="mention" data-kind="card" data-id="${ID2}">@CRM</span>` +
      `<span data-type="mention" data-kind="card" data-id="${ID}">@SAP</span>` +
      `<span data-type="mention" data-kind="decision" data-id="d1">ADR-1 T</span>` +
      `<span data-type="mention" data-kind="user" data-id="u1">@Ann</span></p>`;
    expect(unlinkedMentionedCards(html, [ID2])).toEqual([{ id: ID, label: "SAP" }]);
    expect(unlinkedMentionedCards(html, new Set([ID, ID2]))).toEqual([]);
    expect(unlinkedMentionedCards("<p>none</p>", [])).toEqual([]);
  });
});
