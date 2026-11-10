/**
 * The "@" popup and its store, in isolation: the suggestion plugin's renderer
 * calls are made by hand (`onStart`, `onKeyDown`, `onExit`) with a stubbed
 * caret rectangle, which is what ProseMirror would hand over. The editor-level
 * path ("@" typed in a document) is covered in `RichTextEditor.test.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
}));

import { api } from "@/api/client";
import { invalidateDecisionOptions } from "@/components/DecisionPicker";
import { invalidateUserOptions } from "@/components/UserMultiSelect";
import type { MentionKind } from "@/lib/mentionHtml";
import MentionPopup from "./MentionPopup";
import { createMentionSuggestionStore, type MentionSuggestionStore } from "./mentionSuggestionStore";

const CARDS = [
  { id: "c1", name: "SAP ERP", type: "Application" },
  { id: "c2", name: "CRM", type: "Application" },
];
const DECISIONS = [{ id: "d1", reference_number: "ADR-001", title: "Adopt Kafka", revision_number: 1 }];
const USERS = [{ id: "u1", display_name: "Ann Lee", email: "ann@x.io" }];

function mockApi({ cardsStatus }: { cardsStatus?: number } = {}) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path.startsWith("/cards?")) {
      if (cardsStatus) throw Object.assign(new Error("refused"), { status: cardsStatus });
      return { items: CARDS, total: CARDS.length };
    }
    if (path === "/adr?include_earlier=false") return DECISIONS;
    if (path === "/users") return USERS;
    throw new Error(`unexpected ${path}`);
  });
}

function setup(kinds: MentionKind[]) {
  const store = createMentionSuggestionStore();
  const renderer = store.render();
  const command = vi.fn();
  render(<MentionPopup store={store} kinds={kinds} />);
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
  return { store, renderer, command, start, key };
}

beforeEach(() => {
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
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["ADR-001 Adopt Kafka"]),
    );
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
      "SAP ERPApplication",
      "CRMApplication",
      "ADR-001 Adopt Kafka",
    ]);
    expect(list).toHaveAttribute("aria-activedescendant", options()[0].id);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");

    expect(key("ArrowUp")).toBe(true);
    expect(list).toHaveAttribute("aria-activedescendant", options()[2].id);
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
