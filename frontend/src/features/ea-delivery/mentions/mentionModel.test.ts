import { describe, expect, it } from "vitest";

import type { MentionLabels } from "@/lib/mentionHtml";
import type { ArchitectureDecision } from "@/types";
import {
  BROWSE_HIGHLIGHT,
  MENTION_GROUP_LIMIT,
  cardMentionItems,
  cardRowsReady,
  highlightAfterKey,
  mentionItemKey,
  overFollowingSpace,
  rangeFits,
  cardRowMeta,
  parentIdsToFetch,
  withParentNames,
  comparePreferred,
  decisionMentionItems,
  documentPeopleIds,
  flattenGroups,
  groupMentionItems,
  mentionAttrsFromElement,
  mentionChipText,
  mentionHref,
  mentionHrefFromTarget,
  mentionSpanAttributes,
  mentionInsertContent,
  mentionText,
  nextIndex,
  reconcilePicks,
  resolveActive,
  togglePick,
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
      { kind: "card", id: "c2", label: "Portal", card: { type: "Application", subtype: null, parentId: null } },
      { kind: "card", id: "c3", label: "CRM", card: { type: "Application", subtype: null, parentId: null } },
      { kind: "card", id: "c1", label: "Billing Portal", card: { type: "Application", subtype: null, parentId: null } },
    ]);
    expect(cardMentionItems([{ id: "s", name: "S", type: "T", subtype: "web", parent_id: "p1" }], "")[0].card).toEqual({
      type: "T",
      subtype: "web",
      parentId: "p1",
    });
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
      {
        id: "d1",
        reference_number: "ADR-002",
        title: "Pick a CRM",
        revision_number: 2,
        status: "signed",
        standing: "in_force",
        recorded_at: "2026-01-02",
      },
      { id: "d2", reference_number: "ADR-001", title: "Adopt Kafka", revision_number: 1, status: "draft" },
    ] as ArchitectureDecision[];
    const t = (key: string, opts?: Record<string, unknown>) =>
      key === "adr.revision.reference" ? `${opts?.reference} · Rev ${opts?.number}` : key;
    expect(decisionMentionItems(rows, "", t)).toEqual([
      {
        kind: "decision",
        id: "d1",
        label: "ADR-002 · Rev 2 Pick a CRM",
        decision: {
          reference: "ADR-002 · Rev 2",
          title: "Pick a CRM",
          status: "signed",
          standing: "in_force",
          recorded_at: "2026-01-02",
        },
      },
      {
        kind: "decision",
        id: "d2",
        label: "ADR-001 Adopt Kafka",
        decision: {
          reference: "ADR-001",
          title: "Adopt Kafka",
          status: "draft",
          standing: null,
          recorded_at: null,
        },
      },
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
    // An empty query lists everyone alphabetically.
    expect(userMentionItems(users, "").map((u) => u.id)).toEqual(["u2", "u3", "u4", "u1"]);
    expect(userMentionItems(users, "")[3]).toEqual({
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

describe("ordering that knows the document", () => {
  const page = [
    { id: "a", name: "Alpha", type: "T" },
    { id: "b", name: "Beta Portal", type: "T" },
    { id: "p", name: "Portal", type: "T" },
    { id: "z", name: "Zeta", type: "T" },
  ];
  const linked = [
    { id: "y", name: "Ypsilon Portal", type: "T" },
    { id: "z", name: "Zeta", type: "T" },
    { id: "m", name: "Mu", type: "T" },
  ];

  it("lists linked cards first on an empty query, then the page in its order without them", () => {
    expect(cardMentionItems(page, "", linked).map((i) => i.id)).toEqual(["m", "y", "z", "a", "b", "p"]);
    expect(cardMentionItems(page, "  ", []).map((i) => i.id)).toEqual(["a", "b", "p", "z"]);
  });

  it("puts a linked card first within its tier, never across tiers", () => {
    // "Portal" is exact (tier 0); "Beta Portal" and the linked "Ypsilon Portal"
    // both start a word (tier 2): the linked one leads that tier only.
    expect(cardMentionItems(page, "portal", linked).map((i) => i.id)).toEqual(["p", "y", "b"]);
    // A linked card that does not match is dropped.
    expect(cardMentionItems(page, "zz", linked)).toEqual([]);
  });

  it("caps the group, linked cards included", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `l${i}`, name: `L${i}`, type: "T" }));
    const items = cardMentionItems(page, "", many);
    expect(items).toHaveLength(MENTION_GROUP_LIMIT);
    expect(items.every((i) => i.id.startsWith("l"))).toBe(true);
  });

  it("puts the document's people first, by tier, then alphabetical", () => {
    const users = [
      { id: "u1", display_name: "Ann Zed", email: "az@x.io" },
      { id: "u2", display_name: "Bob", email: "ann.b@x.io" },
      { id: "u3", display_name: "Ann", email: "a@x.io" },
      { id: "u4", display_name: "Carl", email: "c@x.io" },
    ];
    expect(userMentionItems(users, "", ["u4", "u2"]).map((u) => u.id)).toEqual(["u2", "u4", "u3", "u1"]);
    // Exact "Ann" stays ahead of the priority person who only starts with it.
    expect(userMentionItems(users, "ann", ["u1", "u2"]).map((u) => u.id)).toEqual(["u3", "u1", "u2"]);
    expect(userMentionItems(users, "ann", new Set(["u2"])).map((u) => u.id)).toEqual(["u3", "u2", "u1"]);
  });

  it("compares by tier, then preference, then name", () => {
    const cmp = comparePreferred<{ name: string; pick?: boolean }>("ab", (r) => r, (r) => Boolean(r.pick));
    expect(cmp({ name: "ab" }, { name: "abc", pick: true })).toBeLessThan(0);
    expect(cmp({ name: "abd" }, { name: "abc", pick: true })).toBeGreaterThan(0);
    expect(cmp({ name: "abc", pick: true }, { name: "abd" })).toBeLessThan(0);
    expect(cmp({ name: "abd" }, { name: "abc" })).toBeGreaterThan(0);
    expect(cmp({ name: "ABC" }, { name: "abc" })).toBe(0);
    expect(cmp({ name: "zz" }, { name: "x ab" })).toBeGreaterThan(0);
    expect(cmp({ name: "zz" }, { name: "yy" })).toBeGreaterThan(0);
  });

  it("names the document's people: signatories, then user decision makers and participants, once", () => {
    expect(
      documentPeopleIds({
        signatories: [{ user_id: "s1" }, { user_id: "p1" }],
        decision_makers: [{ user_id: null }, { user_id: "d1" }],
        participants: [{ user_id: "p1" }, { user_id: "p2" }],
      }),
    ).toEqual(["s1", "p1", "d1", "p2"]);
    expect(documentPeopleIds({})).toEqual([]);
    expect(documentPeopleIds({ signatories: null, decision_makers: null, participants: null })).toEqual([]);
  });
});

describe("card rows", () => {
  const type = {
    key: "Application",
    label: "Application",
    color: "#0f7eb5",
    icon: "apps",
    subtypes: [{ key: "web", label: "Web app" }],
  };
  const typeLabel = (t: { label: string }) => `T:${t.label}`;
  const subLabel = (s: { label: string }) => `S:${s.label}`;

  it("shows the type's colour and icon, the type and the subtype it defines", () => {
    expect(cardRowMeta({ type: "Application", subtype: "web" }, type, typeLabel, subLabel)).toEqual({
      color: "#0f7eb5",
      icon: "apps",
      detail: "T:Application · S:Web app",
    });
    expect(cardRowMeta({ type: "Application", subtype: "gone" }, type, typeLabel, subLabel).detail).toBe(
      "T:Application",
    );
    expect(cardRowMeta({ type: "Application" }, type, typeLabel, subLabel).detail).toBe("T:Application");
  });

  it("adds the parent's name last, once it is known, through the reader's wording", () => {
    const inParent = (name: string) => `in ${name}`;
    expect(
      cardRowMeta({ type: "Application", subtype: "web", parentName: "ERP" }, type, typeLabel, subLabel, inParent)
        .detail,
    ).toBe("T:Application · S:Web app · in ERP");
    expect(cardRowMeta({ type: "Application", parentName: "ERP" }, type, typeLabel, subLabel, inParent).detail).toBe(
      "T:Application · in ERP",
    );
    expect(cardRowMeta({ type: "Application", parentName: "" }, type, typeLabel, subLabel, inParent).detail).toBe(
      "T:Application",
    );
    expect(cardRowMeta({ type: "Application", parentName: "ERP" }, type, typeLabel, subLabel).detail).toBe(
      "T:Application · ERP",
    );
    expect(cardRowMeta({ type: "Hidden", parentName: "ERP" }, undefined, typeLabel, subLabel, inParent)).toEqual({
      color: null,
      icon: null,
      detail: "in ERP",
    });
  });

  it("shows nothing for a type the metamodel does not offer, never its key", () => {
    expect(cardRowMeta({ type: "Hidden", subtype: "web" }, undefined, typeLabel, subLabel)).toEqual({
      color: null,
      icon: null,
      detail: "",
    });
  });
});

describe("the popup's rows and the browse picks", () => {
  it("follows the highlighted row by identity, falling back to the first item, never to Browse", () => {
    const keys = ["card:c1", "decision:d1", "user:u1"];
    expect(resolveActive(null, keys)).toBe(0);
    expect(resolveActive(null, [])).toBe(-1);
    expect(resolveActive("user:u1", keys)).toBe(2);
    expect(resolveActive(BROWSE_HIGHLIGHT, keys)).toBe(3);
    expect(resolveActive(BROWSE_HIGHLIGHT, [])).toBe(0);
    // Rows arriving above the highlighted one: it stays highlighted where it moved.
    expect(resolveActive("decision:d1", ["card:c9", "card:c8", ...keys])).toBe(3);
    // Browse stays Browse when rows arrive under it.
    expect(resolveActive(BROWSE_HIGHLIGHT, ["card:c9", ...keys])).toBe(4);
    // A highlighted row that is gone: the first item, not Browse; nothing without items.
    expect(resolveActive("card:gone", ["card:c1"])).toBe(0);
    expect(resolveActive("card:gone", [])).toBe(-1);
  });

  it("walks the items and Browse with the arrow keys, wrapping", () => {
    const keys = ["card:c1", "card:c2"];
    expect(highlightAfterKey(null, keys, "ArrowDown")).toBe("card:c2");
    expect(highlightAfterKey(null, keys, "ArrowUp")).toBe(BROWSE_HIGHLIGHT);
    expect(highlightAfterKey("card:c2", keys, "ArrowDown")).toBe(BROWSE_HIGHLIGHT);
    expect(highlightAfterKey(BROWSE_HIGHLIGHT, keys, "ArrowDown")).toBe("card:c1");
    expect(highlightAfterKey(BROWSE_HIGHLIGHT, keys, "ArrowUp")).toBe("card:c2");
    expect(highlightAfterKey("card:c1", keys, "ArrowUp")).toBe(BROWSE_HIGHLIGHT);
    expect(highlightAfterKey(null, [], "ArrowDown")).toBe(BROWSE_HIGHLIGHT);
    expect(highlightAfterKey(null, [], "ArrowUp")).toBe(BROWSE_HIGHLIGHT);
    expect(mentionItemKey({ kind: "decision", id: "d1" })).toBe("decision:d1");
  });

  it("shows the card group only once its rows can no longer shift", () => {
    const base = { query: "", answeredFor: "", pending: false, wantLinked: true, linkedLoaded: true };
    expect(cardRowsReady(base)).toBe(true);
    // The linked cards have not answered: never, typed query or not.
    expect(cardRowsReady({ ...base, linkedLoaded: false })).toBe(false);
    expect(cardRowsReady({ ...base, query: "sa", linkedLoaded: false })).toBe(false);
    expect(cardRowsReady({ ...base, wantLinked: false, linkedLoaded: false })).toBe(true);
    // On an empty query the search page must have answered for it.
    expect(cardRowsReady({ ...base, answeredFor: null })).toBe(false);
    expect(cardRowsReady({ ...base, answeredFor: "sa" })).toBe(false);
    expect(cardRowsReady({ ...base, pending: true })).toBe(false);
    expect(cardRowsReady({ ...base, query: " ", answeredFor: " " })).toBe(true);
    expect(cardRowsReady({ ...base, query: " ", answeredFor: "" })).toBe(false);
    // A typed query filters the loaded page at once.
    expect(cardRowsReady({ ...base, query: "sa", answeredFor: null, pending: true })).toBe(true);
  });

  const c1 = { kind: "card" as const, id: "c1", label: "C1" };
  const c2 = { kind: "card" as const, id: "c2", label: "C2" };
  const d1 = { kind: "decision" as const, id: "d1", label: "D1" };
  const u1 = { kind: "user" as const, id: "u1", label: "U1" };

  it("keeps pick order across pickers when one changes its selection", () => {
    let picks = reconcilePicks([], "card", [c1]);
    picks = togglePick(picks, d1);
    picks = reconcilePicks(picks, "card", [c1, c2]);
    picks = reconcilePicks(picks, "user", [u1]);
    expect(picks).toEqual([c1, d1, c2, u1]);
    expect(reconcilePicks(picks, "card", [c2])).toEqual([d1, c2, u1]);
    expect(reconcilePicks(picks, "card", [])).toEqual([d1, u1]);
    expect(togglePick(picks, d1)).toEqual([c1, c2, u1]);
    // Same id, other kind: a separate pick.
    expect(togglePick([c1], { kind: "decision", id: "c1", label: "X" })).toHaveLength(2);
  });

  it("inserts one mention per pick, in order, each followed by a space", () => {
    expect(mentionInsertContent([c1, d1])).toEqual([
      { type: "mention", attrs: { kind: "card", id: "c1", label: "C1", mentionSuggestionChar: "@" } },
      { type: "text", text: " " },
      { type: "mention", attrs: { kind: "decision", id: "d1", label: "D1", mentionSuggestionChar: "@" } },
      { type: "text", text: " " },
    ]);
    expect(mentionInsertContent([])).toEqual([]);
  });

  it("takes over a space that already follows the insertion point", () => {
    expect(overFollowingSpace({ from: 4, to: 8 }, " ")).toEqual({ from: 4, to: 9 });
    expect(overFollowingSpace({ from: 4, to: 4 }, " ")).toEqual({ from: 4, to: 5 });
    expect(overFollowingSpace({ from: 4, to: 8 }, "x")).toEqual({ from: 4, to: 8 });
    expect(overFollowingSpace({ from: 4, to: 8 }, "")).toEqual({ from: 4, to: 8 });
  });

  it("keeps a saved range only while it lies inside the document", () => {
    expect(rangeFits({ from: 4, to: 8 }, 10)).toBe(true);
    expect(rangeFits({ from: 4, to: 10 }, 10)).toBe(true);
    expect(rangeFits({ from: 0, to: 0 }, 0)).toBe(true);
    expect(rangeFits({ from: 4, to: 11 }, 10)).toBe(false);
    expect(rangeFits({ from: 11, to: 12 }, 10)).toBe(false);
    expect(rangeFits({ from: -1, to: 2 }, 10)).toBe(false);
    expect(rangeFits({ from: 5, to: 4 }, 10)).toBe(false);
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

describe("parent names on card rows", () => {
  const card = (id: string, parentId?: string | null) => ({
    kind: "card" as const,
    id,
    label: id.toUpperCase(),
    card: { type: "Application", subtype: null, parentId },
  });
  const person = { kind: "user" as const, id: "u1", label: "Ann" };

  it("asks for each unknown parent once, in row order", () => {
    const items = [card("a", "p2"), person, card("b", null), card("c", "p1"), card("d", "p2"), card("e", "p3")];
    const known = new Map<string, string | null>([["p3", null]]);
    expect(parentIdsToFetch(items, known)).toEqual(["p2", "p1"]);
    expect(parentIdsToFetch(items, new Map([["p1", "X"], ["p2", null], ["p3", "Y"]]))).toEqual([]);
    expect(parentIdsToFetch([card("x")], new Map())).toEqual([]);
  });

  it("fills a known name in, leaves withheld and unknown parents and other rows alone, and never reorders", () => {
    const items = [card("a", "p1"), person, card("b", "p2"), card("c", "p3"), card("d")];
    const known = new Map<string, string | null>([
      ["p1", "ERP"],
      ["p2", null],
    ]);
    const out = withParentNames(items, known);
    expect(out.map((i) => i.id)).toEqual(["a", "u1", "b", "c", "d"]);
    expect(out[0].card).toEqual({ type: "Application", subtype: null, parentId: "p1", parentName: "ERP" });
    expect(items[0].card).not.toHaveProperty("parentName");
    expect(out[1]).toBe(person);
    expect(out[2]).toBe(items[2]);
    expect(out[3]).toBe(items[3]);
    expect(out[4]).toBe(items[4]);
  });
});
