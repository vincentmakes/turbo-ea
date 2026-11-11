/**
 * The "@" popup and its store, in isolation: the suggestion plugin's renderer
 * calls are made by hand (`onStart`, `onKeyDown`, `onExit`) with a stubbed
 * caret rectangle, which is what ProseMirror would hand over. The editor-level
 * path ("@" typed in a document) is covered in `RichTextEditor.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));
vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));

import { api } from "@/api/client";
import { invalidateDecisionOptions } from "@/components/DecisionPicker";
import { invalidateUserOptions } from "@/components/UserMultiSelect";
import type { MentionKind } from "@/lib/mentionHtml";
import { CARD_TYPES } from "@/test/fixtures/metamodel";
import { withMetamodel } from "@/test/hooks";
import MentionPopup from "./MentionPopup";
import type { MentionContext } from "./mentionModel";
import { createMentionSuggestionStore, queryRanOn, type MentionSuggestionStore } from "./mentionSuggestionStore";

const CARDS = [
  { id: "c1", name: "SAP ERP", type: "Application", subtype: "microservice" },
  { id: "c2", name: "CRM", type: "Application" },
];
const LINKED = [
  { id: "l1", name: "Zebra Hub", type: "Application" },
  { id: "l2", name: "Old Hub", type: "Application", archived_at: "2026-01-01" },
];
const DECISIONS = [
  { id: "d1", reference_number: "ADR-001", title: "Adopt Kafka", revision_number: 1, status: "draft" },
];
const USERS = [
  { id: "u1", display_name: "Ann Lee", email: "ann@x.io" },
  { id: "u2", display_name: "Bob Ray", email: "bob@x.io" },
];

function mockApi({ cardsStatus, linkedFails }: { cardsStatus?: number; linkedFails?: boolean } = {}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/cards?ids=")) {
      if (linkedFails) throw new Error("refused");
      return { items: LINKED, total: LINKED.length };
    }
    if (path.startsWith("/cards?")) {
      if (cardsStatus) throw Object.assign(new Error("refused"), { status: cardsStatus });
      return { items: CARDS, total: CARDS.length };
    }
    if (path === "/adr?include_earlier=false") return DECISIONS;
    if (path === "/users") return USERS;
    throw new Error(`unexpected ${path}`);
  });
}

function setup(kinds: MentionKind[], context?: MentionContext) {
  const store = createMentionSuggestionStore();
  const renderer = store.render();
  const command = vi.fn();
  const onBrowse = vi.fn();
  store.setBrowseHandler(onBrowse);
  render(<MentionPopup store={store} kinds={kinds} context={context} />);
  const start = (query = "") =>
    act(() => {
      renderer.onStart({
        query,
        clientRect: () => new DOMRect(10, 20, 0, 16),
        command,
      } as never);
    });
  const key = (k: string) => {
    let used = false;
    act(() => {
      used = renderer.onKeyDown({ event: new KeyboardEvent("keydown", { key: k }) } as never);
    });
    return used;
  };
  return { store, renderer, command, start, key, onBrowse };
}

/** The item rows, without the last "Browse…" row. */
const itemTexts = () =>
  screen
    .getAllByRole("option")
    .filter((o) => o.getAttribute("data-testid") !== "mention-browse")
    .map((o) => o.textContent);

beforeEach(() => {
  withMetamodel(CARD_TYPES, []);
  vi.mocked(api.get).mockReset();
  invalidateDecisionOptions();
  invalidateUserOptions();
});

describe("MentionPopup", () => {
  it("renders nothing until the suggestion starts", () => {
    mockApi();
    setup(["card", "decision"]);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("groups cards and decisions, without people in a document", async () => {
    mockApi();
    const { start } = setup(["card", "decision"]);
    start();
    const list = await screen.findByRole("listbox", { name: "Mention suggestions" });
    await within(list).findByRole("option", { name: /SAP ERP/ });
    await within(list).findByRole("option", { name: /ADR-001 Adopt Kafka/ });
    expect(within(list).getByRole("group", { name: "Cards" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: "Decisions" })).toBeInTheDocument();
    expect(within(list).queryByRole("group", { name: "People" })).not.toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).not.toContain("/users");
    const cardsUrl = vi.mocked(api.get).mock.calls.map((c) => c[0] as string).find((p) => p.startsWith("/cards?"));
    expect(cardsUrl).toBe("/cards?page=1&page_size=8");
  });

  it("offers people where users may be mentioned", async () => {
    mockApi();
    const { start } = setup(["user"]);
    start();
    const list = await screen.findByRole("listbox");
    expect(await within(list).findByRole("option", { name: /Ann Lee/ })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: "People" })).toBeInTheDocument();
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toEqual(["/users"]);
  });

  it("filters the loaded rows on the raw query at once", async () => {
    mockApi();
    const { start } = setup(["card", "decision"]);
    start();
    await screen.findByRole("option", { name: /CRM/ });
    start("kafka");
    await waitFor(() => expect(itemTexts()).toEqual(["ADR-001Adopt KafkaDraft"]));
  });

  it("walks the rows with the arrow keys, wrapping, and picks with Enter or Tab", async () => {
    mockApi();
    const { start, key, command } = setup(["card", "decision"]);
    start();
    // Both groups load independently: wait for the last row of each.
    await screen.findByRole("option", { name: /ADR-001/ });
    await screen.findByRole("option", { name: /CRM/ });
    const list = screen.getByRole("listbox");
    const options = () => screen.getAllByRole("option");
    expect(options().map((o) => o.textContent)).toEqual([
      "appsSAP ERPApplication · Microservice",
      "appsCRMApplication",
      "ADR-001Adopt KafkaDraft",
      "manage_searchBrowse…",
    ]);
    expect(list).toHaveAttribute("aria-activedescendant", options()[0].id);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    expect(key("ArrowUp")).toBe(true);
    expect(list).toHaveAttribute("aria-activedescendant", options()[3].id);
    expect(key("ArrowDown")).toBe(true);
    expect(list).toHaveAttribute("aria-activedescendant", options()[0].id);
    expect(key("ArrowDown")).toBe(true);
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(options()[0]).toHaveAttribute("aria-selected", "false");

    expect(key("Enter")).toBe(true);
    expect(command).toHaveBeenCalledWith({ kind: "card", id: "c2", label: "CRM" });
    key("ArrowDown");
    expect(key("Tab")).toBe(true);
    expect(command).toHaveBeenLastCalledWith({ kind: "decision", id: "d1", label: "ADR-001 Adopt Kafka" });
    expect(key("a")).toBe(false);
  });

  it("shows the type's icon on a card row and the standing on a decision row", async () => {
    mockApi();
    const { start } = setup(["card", "decision"]);
    start();
    const row = await screen.findByRole("option", { name: /SAP ERP/ });
    expect(within(row).getByTestId("mention-type-icon")).toBeInTheDocument();
    expect(within(row).getByText("Application · Microservice")).toBeInTheDocument();
    const decision = await screen.findByRole("option", { name: /ADR-001/ });
    expect(within(decision).getByText("ADR-001")).toBeInTheDocument();
    expect(within(decision).getByText("Adopt Kafka")).toBeInTheDocument();
    expect(within(decision).getByText("Draft")).toBeInTheDocument();
  });

  it("opens Browse from its row by keyboard and by click", async () => {
    mockApi();
    const { start, key, onBrowse, store, command } = setup(["decision"]);
    start();
    await screen.findByRole("option", { name: /ADR-001/ });
    expect(key("ArrowDown")).toBe(true);
    expect(screen.getByTestId("mention-browse")).toHaveAttribute("aria-selected", "true");
    expect(key("Enter")).toBe(true);
    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(store.isOpen()).toBe(false);
    expect(command).not.toHaveBeenCalled();

    start("ka");
    await userEvent.click(await screen.findByTestId("mention-browse"));
    expect(onBrowse).toHaveBeenCalledTimes(2);
    expect(store.isOpen()).toBe(false);
  });

  it("highlights nothing when nothing matched, so Enter still reaches the editor", async () => {
    mockApi();
    const { start, key, onBrowse } = setup(["decision"]);
    start("zzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.getByRole("listbox")).not.toHaveAttribute("aria-activedescendant");
    expect(key("Enter")).toBe(false);
    expect(onBrowse).not.toHaveBeenCalled();
    expect(key("ArrowDown")).toBe(true);
    expect(key("Tab")).toBe(true);
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it("lists the document's linked cards first, without archived ones", async () => {
    mockApi();
    const { start } = setup(["card"], { linkedCardIds: ["l1", "l2"] });
    start();
    await screen.findByRole("option", { name: /CRM/ });
    await waitFor(() =>
      expect(itemTexts()).toEqual([
        "appsZebra HubApplication",
        "appsSAP ERPApplication · Microservice",
        "appsCRMApplication",
      ]),
    );
    expect(vi.mocked(api.get).mock.calls.map((c) => c[0])).toContain(
      `/cards?ids=${encodeURIComponent("l1,l2")}`,
    );
  });

  it("goes on without the linked cards when they cannot be read", async () => {
    mockApi({ linkedFails: true });
    const { start } = setup(["card"], { linkedCardIds: ["l1"] });
    start();
    await screen.findByRole("option", { name: /CRM/ });
    await waitFor(() => expect(itemTexts()).toEqual(["appsSAP ERPApplication · Microservice", "appsCRMApplication"]));
  });

  it("lists the document's people first in a comment", async () => {
    mockApi();
    const { start } = setup(["user"], { priorityUserIds: ["u2"] });
    start();
    await screen.findByRole("option", { name: /Ann Lee/ });
    expect(itemTexts()).toEqual(["Bob Raybob@x.io", "Ann Leeann@x.io"]);
  });

  it("picks a row on click", async () => {
    mockApi();
    const { start, command } = setup(["decision"]);
    start();
    await userEvent.click(await screen.findByRole("option", { name: /ADR-001/ }));
    expect(command).toHaveBeenCalledWith({ kind: "decision", id: "d1", label: "ADR-001 Adopt Kafka" });
  });

  it("hides the cards group and says why when card search is refused", async () => {
    mockApi({ cardsStatus: 403 });
    const { start } = setup(["card", "decision"]);
    start();
    expect(await screen.findByTestId("mention-cards-forbidden")).toHaveTextContent(
      "Your role cannot search cards; you can still mention decisions.",
    );
    await screen.findByRole("option", { name: /ADR-001/ });
    expect(screen.queryByRole("group", { name: "Cards" })).not.toBeInTheDocument();
  });

  it("does not show the hint for another failure", async () => {
    mockApi({ cardsStatus: 500 });
    const { start } = setup(["card"]);
    start();
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.queryByTestId("mention-cards-forbidden")).not.toBeInTheDocument();
  });

  it("closes on exit and stops handling keys", async () => {
    mockApi();
    const { start, key, renderer, store, command } = setup(["decision"]);
    start();
    await screen.findByRole("option", { name: /ADR-001/ });
    expect(store.isOpen()).toBe(true);
    act(() => renderer.onExit());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(store.isOpen()).toBe(false);
    expect(key("Enter")).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });
});

describe("MentionPopup parent names", () => {
  const SEARCHED = [
    { id: "c1", name: "Billing", type: "Application", subtype: "microservice", parent_id: "p1" },
    { id: "c2", name: "CRM", type: "Application", parent_id: "p2" },
    { id: "c3", name: "Ledger", type: "Application", parent_id: "p1" },
    { id: "c4", name: "Mail", type: "Application" },
  ];
  const LINKED_CHILD = [{ id: "l1", name: "Zebra Hub", type: "Application", parent_id: "p3" }];

  /** p1 is readable, p2 is withheld (absent from the reply), p3 is readable. */
  function serveParents({ fail = false, hold }: { fail?: boolean; hold?: Promise<void> } = {}) {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path === `/cards?ids=${encodeURIComponent("l1")}`) return { items: LINKED_CHILD, total: 1 };
      if (path.startsWith("/cards?ids=")) {
        if (hold) await hold;
        if (fail) throw new Error("refused");
        return {
          items: [
            { id: "p1", name: "Finance Suite", type: "Application" },
            { id: "p3", name: "Hub Platform", type: "Application" },
          ],
          total: 2,
        };
      }
      if (path.startsWith("/cards?")) return { items: SEARCHED, total: SEARCHED.length };
      throw new Error(`unexpected ${path}`);
    });
  }
  const parentCalls = () =>
    vi
      .mocked(api.get)
      .mock.calls.map((c) => c[0] as string)
      .filter((p) => p.startsWith("/cards?ids=") && p !== `/cards?ids=${encodeURIComponent("l1")}`);

  it("adds each parent's name once it arrives, asking for each parent once, and keeps the order", async () => {
    let release = () => {};
    const hold = new Promise<void>((r) => (release = r));
    serveParents({ hold });
    const { start } = setup(["card"]);
    start();
    await screen.findByRole("option", { name: /Mail/ });
    // Before the parents arrive: type and subtype only, in the same order.
    expect(itemTexts()).toEqual([
      "appsBillingApplication · Microservice",
      "appsCRMApplication",
      "appsLedgerApplication",
      "appsMailApplication",
    ]);
    await act(async () => release());
    await waitFor(() =>
      expect(itemTexts()).toEqual([
        "appsBillingApplication · Microservice · in Finance Suite",
        "appsCRMApplication",
        "appsLedgerApplication · in Finance Suite",
        "appsMailApplication",
      ]),
    );
    expect(parentCalls()).toEqual([`/cards?ids=${encodeURIComponent("p1,p2")}`]);

    // Another query over the same rows asks for nothing again, the withheld parent included.
    start("l");
    await waitFor(() => expect(itemTexts()[0]).toBe("appsLedgerApplication · in Finance Suite"));
    start("");
    await screen.findByRole("option", { name: /Mail/ });
    expect(parentCalls()).toHaveLength(1);
  });

  it("names the parent of a linked card listed first", async () => {
    serveParents();
    const { start } = setup(["card"], { linkedCardIds: ["l1"] });
    start();
    await waitFor(() => expect(itemTexts()[0]).toBe("appsZebra HubApplication · in Hub Platform"));
  });

  it("shows no parent when the parents cannot be read, and does not ask again", async () => {
    serveParents({ fail: true });
    const { start } = setup(["card"]);
    start();
    await screen.findByRole("option", { name: /Mail/ });
    await waitFor(() => expect(parentCalls()).toHaveLength(1));
    start("b");
    await waitFor(() => expect(itemTexts()).toEqual(["appsBillingApplication · Microservice"]));
    start("");
    await screen.findByRole("option", { name: /Mail/ });
    expect(itemTexts()[0]).toBe("appsBillingApplication · Microservice");
    expect(parentCalls()).toHaveLength(1);
  });
});

describe("createMentionSuggestionStore", () => {
  it("tracks the suggestion and forwards keys only while open with a handler", () => {
    const store: MentionSuggestionStore = createMentionSuggestionStore();
    const renderer = store.render();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const rect = () => new DOMRect();
    const command = vi.fn();
    expect(store.getSnapshot()).toEqual({ open: false, query: "", clientRect: null, command: null });

    renderer.onStart({ query: "sa", clientRect: rect, command } as never);
    expect(store.getSnapshot()).toEqual({ open: true, query: "sa", clientRect: rect, command });
    renderer.onUpdate({ query: "sap", command } as never);
    expect(store.getSnapshot()).toEqual({ open: true, query: "sap", clientRect: null, command });
    expect(listener).toHaveBeenCalledTimes(2);

    const event = new KeyboardEvent("keydown", { key: "ArrowDown" });
    expect(renderer.onKeyDown({ event } as never)).toBe(false);
    const handler = vi.fn(() => true);
    store.setKeyHandler(handler);
    expect(renderer.onKeyDown({ event } as never)).toBe(true);
    expect(handler).toHaveBeenCalledWith(event);

    renderer.onExit();
    expect(store.isOpen()).toBe(false);
    expect(renderer.onKeyDown({ event } as never)).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    renderer.onStart({ query: "", command } as never);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("queryRanOn", () => {
  it("ends a query at two spaces in a row", () => {
    expect(queryRanOn("Customer Portal", 4, null)).toBe(false);
    expect(queryRanOn("Customer  ", 4, null)).toBe(true);
    expect(queryRanOn("a  b", 4, { from: 9, query: "zz" })).toBe(true);
  });

  it("ends a query typed on past one that found nothing at the same '@'", () => {
    const none = { from: 4, query: "zz" };
    expect(queryRanOn("zz", 4, none)).toBe(false);
    expect(queryRanOn("z", 4, none)).toBe(false);
    expect(queryRanOn("zz ", 4, none)).toBe(true);
    expect(queryRanOn("zzq", 4, none)).toBe(true);
    expect(queryRanOn("zzq", 5, none)).toBe(false);
    expect(queryRanOn("zaq", 4, none)).toBe(false);
  });
});

describe("createMentionSuggestionStore lifetime", () => {
  const props = (query: string, from = 4) =>
    ({ query, range: { from, to: from + query.length + 1 }, command: vi.fn() }) as never;

  it("remembers a query that found nothing only while it is the open one", () => {
    const store = createMentionSuggestionStore();
    const renderer = store.render();
    store.reportNoResults("zz");
    expect(store.shouldShow({ range: { from: 4, to: 7 }, query: "zzz" })).toBe(true);

    renderer.onStart(props("zz"));
    store.reportNoResults("z");
    expect(store.shouldShow({ range: { from: 4, to: 7 }, query: "zzz" })).toBe(true);
    store.reportNoResults("zz");
    expect(store.shouldShow({ range: { from: 4, to: 7 }, query: "zzz" })).toBe(false);
    expect(store.shouldShow({ range: { from: 4, to: 6 }, query: "zz" })).toBe(true);
    // Another "@" starts afresh.
    renderer.onExit();
    renderer.onStart(props("zz", 20));
    expect(store.shouldShow({ range: { from: 4, to: 7 }, query: "zzz" })).toBe(true);
    expect(store.shouldShow({ range: { from: 20, to: 24 }, query: "zzz" })).toBe(true);
  });

  it("stops Escape where it is, and passes other keys on", () => {
    const store = createMentionSuggestionStore();
    const renderer = store.render();
    store.setKeyHandler(() => false);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    const stop = vi.spyOn(escape, "stopPropagation");
    expect(renderer.onKeyDown({ event: escape } as never)).toBe(false);
    expect(stop).not.toHaveBeenCalled();

    renderer.onStart(props(""));
    expect(renderer.onKeyDown({ event: escape } as never)).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    const other = new KeyboardEvent("keydown", { key: "x" });
    const otherStop = vi.spyOn(other, "stopPropagation");
    expect(renderer.onKeyDown({ event: other } as never)).toBe(false);
    expect(otherStop).not.toHaveBeenCalled();
  });

  it("closes on request, and one store at a time is open", () => {
    const a = createMentionSuggestionStore();
    const b = createMentionSuggestionStore();
    const ra = a.render();
    const rb = b.render();
    a.close();
    expect(a.isOpen()).toBe(false);
    ra.onStart(props("s"));
    expect(a.isOpen()).toBe(true);
    rb.onStart(props("t"));
    expect(a.isOpen()).toBe(false);
    expect(b.isOpen()).toBe(true);
    const listener = vi.fn();
    b.subscribe(listener);
    b.close();
    expect(b.isOpen()).toBe(false);
    expect(b.getSnapshot()).toEqual({ open: false, query: "", clientRect: null, command: null });
    expect(listener).toHaveBeenCalledTimes(1);
    // A closed store no longer counts as the open one.
    ra.onStart(props("s"));
    expect(b.isOpen()).toBe(false);
    expect(a.isOpen()).toBe(true);
  });
});

describe("createMentionSuggestionStore browse", () => {
  it("closes the suggestion and hands the current '@query' range to the browse handler", () => {
    const store = createMentionSuggestionStore();
    const renderer = store.render();
    const handler = vi.fn();
    store.browse();
    store.setBrowseHandler(handler);
    store.browse();
    expect(handler).not.toHaveBeenCalled();

    renderer.onStart({ query: "s", range: { from: 4, to: 6 }, command: vi.fn() } as never);
    renderer.onUpdate({ query: "sa", range: { from: 4, to: 7 }, command: vi.fn() } as never);
    store.browse();
    expect(handler).toHaveBeenCalledWith({ from: 4, to: 7 });
    expect(store.isOpen()).toBe(false);

    // A new "@" without a range of its own does not reuse the last one.
    renderer.onStart({ query: "", command: vi.fn() } as never);
    store.browse();
    expect(handler).toHaveBeenLastCalledWith(null);

    store.setBrowseHandler(null);
    renderer.onStart({ query: "", command: vi.fn() } as never);
    store.browse();
    expect(handler).toHaveBeenCalledTimes(2);
    expect(store.isOpen()).toBe(false);
  });
});

describe("MentionPopup and an empty result", () => {
  it("reports a settled empty result for a typed query, not before", async () => {
    let answer: (v: unknown) => void = () => {};
    vi.mocked(api.get).mockImplementation(
      (path: string) =>
        path.startsWith("/cards?")
          ? new Promise((resolve) => {
              answer = resolve;
            })
          : Promise.resolve([]),
    );
    const { store, start } = setup(["card"]);
    const report = vi.spyOn(store, "reportNoResults");
    start("zz");
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some(([p]) => String(p).includes("search=zz"))).toBe(true),
    );
    expect(report).not.toHaveBeenCalled();
    await act(async () => answer({ items: [], total: 0 }));
    await waitFor(() => expect(report).toHaveBeenCalledWith("zz"));
  });
});

describe("MentionPopup review fixes", () => {
  it("pins Browse below the scrolling groups, still the listbox's last option", async () => {
    mockApi();
    const { start } = setup(["card", "decision"]);
    start();
    await screen.findByRole("option", { name: /CRM/ });
    const list = screen.getByRole("listbox");
    const scroll = screen.getByTestId("mention-scroll");
    const browse = screen.getByTestId("mention-browse");
    expect(scroll).toContainElement(screen.getByRole("option", { name: /CRM/ }));
    expect(scroll).not.toContainElement(browse);
    expect(list).toContainElement(browse);
    expect(within(list).getAllByRole("option").at(-1)).toBe(browse);
    expect(getComputedStyle(scroll).overflowY).toBe("auto");
    expect(getComputedStyle(list).overflowY).not.toBe("auto");
  });

  it("scrolls a row highlighted by key into view, not one under the mouse", async () => {
    const scrolled = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    try {
      mockApi();
      const { start, key } = setup(["card"]);
      start();
      await screen.findByRole("option", { name: /CRM/ });
      expect(scrolled).not.toHaveBeenCalled();
      key("ArrowUp");
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
      expect(scrolled.mock.contexts[0]).toBe(screen.getByTestId("mention-browse"));
      key("ArrowDown");
      expect(scrolled).toHaveBeenCalledTimes(2);
      expect(scrolled.mock.contexts[1]).toBe(screen.getByRole("option", { name: /SAP ERP/ }));
      fireEvent.mouseEnter(screen.getByRole("option", { name: /CRM/ }));
      expect(screen.getByRole("option", { name: /CRM/ })).toHaveAttribute("aria-selected", "true");
      expect(scrolled).toHaveBeenCalledTimes(2);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("keeps Browse highlighted when rows arrive under it", async () => {
    let release = () => {};
    const hold = new Promise<void>((r) => (release = r));
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?")) {
        await hold;
        return { items: CARDS, total: CARDS.length };
      }
      if (path === "/adr?include_earlier=false") return DECISIONS;
      throw new Error(`unexpected ${path}`);
    });
    const { start, key, command, onBrowse } = setup(["card", "decision"]);
    start();
    await screen.findByRole("option", { name: /ADR-001/ });
    key("ArrowUp");
    expect(screen.getByTestId("mention-browse")).toHaveAttribute("aria-selected", "true");
    await act(async () => release());
    await screen.findByRole("option", { name: /CRM/ });
    expect(screen.getByTestId("mention-browse")).toHaveAttribute("aria-selected", "true");
    expect(key("Enter")).toBe(true);
    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(command).not.toHaveBeenCalled();
  });

  it("keeps a highlighted row highlighted wherever arriving rows move it", async () => {
    let release = () => {};
    const hold = new Promise<void>((r) => (release = r));
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?")) {
        await hold;
        return { items: CARDS, total: CARDS.length };
      }
      if (path === "/users") return USERS;
      throw new Error(`unexpected ${path}`);
    });
    const { start, key, command } = setup(["card", "user"]);
    start();
    await screen.findByRole("option", { name: /Bob Ray/ });
    key("ArrowDown");
    expect(screen.getByRole("option", { name: /Bob Ray/ })).toHaveAttribute("aria-selected", "true");
    await act(async () => release());
    await screen.findByRole("option", { name: /CRM/ });
    expect(screen.getByRole("option", { name: /Bob Ray/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /CRM/ })).toHaveAttribute("aria-selected", "false");
    key("Enter");
    expect(command).toHaveBeenCalledWith({ kind: "user", id: "u2", label: "Bob Ray" });
  });

  it("does not fall onto Browse when the highlighted row leaves, so Enter on nothing reaches the editor", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?")) {
        const search = new URLSearchParams(path.split("?")[1]).get("search");
        return search ? { items: [], total: 0 } : { items: CARDS, total: CARDS.length };
      }
      throw new Error(`unexpected ${path}`);
    });
    const { start, key, onBrowse, command } = setup(["card"]);
    start();
    await screen.findByRole("option", { name: /CRM/ });
    start("cr");
    const crm = await screen.findByRole("option", { name: /CRM/ });
    fireEvent.mouseEnter(crm);
    expect(crm).toHaveAttribute("aria-selected", "true");
    // The server's answer for "cr" leaves no row.
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.getByTestId("mention-browse")).toHaveAttribute("aria-selected", "false");
    expect(key("Enter")).toBe(false);
    expect(onBrowse).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
  });

  it("gives Enter to the editor at the very moment the rows leave", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?")) {
        const search = new URLSearchParams(path.split("?")[1]).get("search");
        return search ? { items: [], total: 0 } : { items: CARDS, total: CARDS.length };
      }
      throw new Error(`unexpected ${path}`);
    });
    const { start, renderer, onBrowse, command } = setup(["card"]);
    start();
    await screen.findByRole("option", { name: /CRM/ });
    start("cr");
    await screen.findByRole("option", { name: /CRM/ });
    // Enter is pressed from inside the commit that takes the rows away, before
    // any passive effect of that render has run: the key handler the editor
    // reaches must already be the one of the rows on the page.
    const used: boolean[] = [];
    const observer = new MutationObserver(() => {
      if (used.length > 0 || !screen.queryByText("No matches")) return;
      used.push(renderer.onKeyDown({ event: new KeyboardEvent("keydown", { key: "Enter" }) } as never));
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await screen.findByText("No matches");
      await waitFor(() => expect(used).toHaveLength(1));
    } finally {
      observer.disconnect();
    }
    expect(used).toEqual([false]);
    expect(command).not.toHaveBeenCalled();
    expect(onBrowse).not.toHaveBeenCalled();
  });

  it("shows no card row before the linked cards have answered on an empty query", async () => {
    let release = () => {};
    const hold = new Promise<void>((r) => (release = r));
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?ids=")) {
        await hold;
        return { items: LINKED, total: LINKED.length };
      }
      if (path.startsWith("/cards?")) return { items: CARDS, total: CARDS.length };
      if (path === "/adr?include_earlier=false") return DECISIONS;
      throw new Error(`unexpected ${path}`);
    });
    const { start } = setup(["card", "decision"], { linkedCardIds: ["l1"] });
    start();
    await screen.findByRole("option", { name: /ADR-001/ });
    await waitFor(() => expect(vi.mocked(api.get).mock.calls.some(([p]) => p === "/cards?page=1&page_size=8")).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole("group", { name: "Cards" })).not.toBeInTheDocument();
    await act(async () => release());
    await waitFor(() =>
      expect(itemTexts()).toEqual([
        "appsZebra HubApplication",
        "appsSAP ERPApplication · Microservice",
        "appsCRMApplication",
        "ADR-001Adopt KafkaDraft",
      ]),
    );
  });

  it("shows no card row before the search page has answered an empty query", async () => {
    let release = () => {};
    const hold = new Promise<void>((r) => (release = r));
    vi.mocked(api.get).mockImplementation(async (path: string) => {
      if (path.startsWith("/cards?ids=")) return { items: LINKED, total: LINKED.length };
      if (path.startsWith("/cards?")) {
        await hold;
        return { items: CARDS, total: CARDS.length };
      }
      throw new Error(`unexpected ${path}`);
    });
    const { start } = setup(["card"], { linkedCardIds: ["l1"] });
    start();
    await waitFor(() =>
      expect(vi.mocked(api.get).mock.calls.some(([p]) => String(p).startsWith("/cards?ids="))).toBe(true),
    );
    await act(async () => {});
    expect(screen.queryByRole("group", { name: "Cards" })).not.toBeInTheDocument();
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    await act(async () => release());
    await waitFor(() =>
      expect(itemTexts()).toEqual([
        "appsZebra HubApplication",
        "appsSAP ERPApplication · Microservice",
        "appsCRMApplication",
      ]),
    );
  });

  it("reads the linked cards once while it lives, and again when the list changes", async () => {
    mockApi();
    const store = createMentionSuggestionStore();
    const renderer = store.render();
    const ui = (ids: string[], hidden = false) => (
      <MentionPopup store={store} kinds={["card"]} context={{ linkedCardIds: ids }} hidden={hidden} />
    );
    const { rerender } = render(ui(["l1"]));
    const open = () =>
      act(() => {
        renderer.onStart({ query: "", clientRect: () => new DOMRect(), command: vi.fn() } as never);
      });
    const linkedCalls = () =>
      vi.mocked(api.get).mock.calls.filter(([p]) => String(p).startsWith("/cards?ids=")).map(([p]) => p);
    open();
    await screen.findByRole("option", { name: /Zebra Hub/ });
    act(() => renderer.onExit());
    open();
    await screen.findByRole("option", { name: /Zebra Hub/ });
    // Hidden while the browse dialog is open: nothing shown, no key taken, nothing forgotten.
    rerender(ui(["l1"], true));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(renderer.onKeyDown({ event: new KeyboardEvent("keydown", { key: "ArrowDown" }) } as never)).toBe(false);
    rerender(ui(["l1"]));
    await screen.findByRole("option", { name: /Zebra Hub/ });
    expect(linkedCalls()).toEqual([`/cards?ids=${encodeURIComponent("l1")}`]);
    rerender(ui(["l1", "l2"]));
    await waitFor(() => expect(linkedCalls()).toHaveLength(2));
    expect(linkedCalls()[1]).toBe(`/cards?ids=${encodeURIComponent("l1,l2")}`);
  });
});

describe("createMentionSuggestionStore dismiss", () => {
  it("remembers the '@query' a blur closed while its text is still there, once", () => {
    let text = "@sa";
    const editor = {
      isDestroyed: false,
      state: { doc: { content: { size: 20 }, textBetween: vi.fn(() => text) } },
    };
    const store = createMentionSuggestionStore();
    const renderer = store.render();
    // Nothing open: nothing remembered.
    store.dismiss();
    expect(store.takeDismissed()).toBeNull();

    renderer.onStart({ query: "sa", range: { from: 4, to: 7 }, editor, command: vi.fn() } as never);
    store.dismiss();
    expect(store.isOpen()).toBe(false);
    // A second blur, with nothing open, keeps it.
    store.dismiss();
    expect(store.takeDismissed()).toEqual({ from: 4, to: 7 });
    expect(editor.state.doc.textBetween).toHaveBeenCalledWith(4, 7);
    expect(store.takeDismissed()).toBeNull();

    // The text there changed: forgotten.
    renderer.onStart({ query: "sa", range: { from: 4, to: 7 }, editor, command: vi.fn() } as never);
    store.dismiss();
    text = "@sx";
    expect(store.takeDismissed()).toBeNull();

    // The range runs past a shorter document: forgotten, the text not even read.
    text = "@sa";
    renderer.onStart({ query: "sa", range: { from: 18, to: 21 }, editor, command: vi.fn() } as never);
    store.dismiss();
    editor.state.doc.textBetween.mockClear();
    expect(store.takeDismissed()).toBeNull();
    expect(editor.state.doc.textBetween).not.toHaveBeenCalled();

    // A new "@" forgets the last one; so does close() by itself.
    renderer.onStart({ query: "sa", range: { from: 4, to: 7 }, editor, command: vi.fn() } as never);
    store.dismiss();
    renderer.onStart({ query: "", range: { from: 9, to: 10 }, editor, command: vi.fn() } as never);
    expect(store.takeDismissed()).toBeNull();
    store.close();
    expect(store.takeDismissed()).toBeNull();

    // A destroyed editor: nothing.
    renderer.onStart({ query: "sa", range: { from: 4, to: 7 }, editor, command: vi.fn() } as never);
    store.dismiss();
    editor.isDestroyed = true;
    expect(store.takeDismissed()).toBeNull();
  });
});
