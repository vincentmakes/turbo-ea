/**
 * ADREditor — the busy guards on the one-shot workflow actions (a double click
 * must not sign twice, duplicate twice or revise twice, nor link a card twice)
 * and the Recall button's accessible name. Every mock uses the `@/` alias so it
 * also matches when the editor is imported from a copy outside the tree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { ArchitectureDecision, SoAWSignatory } from "@/types";

// The discussion and history side panel has its own tests: here the page
// renders alone, and the props it hands the panel are recorded.
const sidePanel = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./collab/DocumentSidePanel", () => ({
  default: (props: { children: unknown }) => {
    sidePanel.props.push(props);
    return props.children;
  },
}));
vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class ApiError extends Error {},
  isAbortError: () => false,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1", permissions: { "adr.manage": true } } }),
}));
vi.mock("@/hooks/AuthContext", () => ({
  useOptionalAuthUser: () => null,
  useAuthContext: () => ({ user: { id: "u1", permissions: {} }, refreshUser: async () => {} }),
}));
vi.mock("@/features/ea-delivery/adrPrint", () => ({ printAdr: vi.fn() }));
// TipTap has no place in jsdom; a textarea carries the same props.
vi.mock("@/features/ea-delivery/RichTextEditor", () => ({
  default: ({ content, placeholder }: { content: string; placeholder?: string }) => (
    <textarea placeholder={placeholder} value={content} readOnly />
  ),
}));
vi.mock("@/features/ea-delivery/SignatureRequestDialog", () => ({ default: () => null }));
vi.mock("@/features/ea-delivery/adrExport", () => ({ exportAdrsToDocx: vi.fn() }));

import { api } from "@/api/client";
import ADREditor from "./ADREditor";

const base: ArchitectureDecision = {
  id: "adr-1",
  reference_number: "ADR-0001",
  title: "Adopt event bus",
  status: "draft",
  context: null,
  decision: null,
  consequences: null,
  alternatives_considered: null,
  related_decisions: [],
  attributes: {},
  created_by: "u1",
  signatories: [],
  signed_at: null,
  revision_number: 1,
  parent_id: null,
  linked_cards: [],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const ME_PENDING: SoAWSignatory = {
  user_id: "u1",
  display_name: "Me",
  email: "me@x",
  status: "pending",
  signed_at: null,
};
const IN_REVIEW: ArchitectureDecision = { ...base, status: "in_review", signatories: [ME_PENDING] };
const SIGNED: ArchitectureDecision = { ...base, status: "signed", signed_at: "2026-06-03T12:00:00Z" };
const KAFKA = { id: "card-2", name: "Kafka", type: "ITComponent" };

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Serve `/auth/me` as u1 strictly before the record, so the signatory checks are settled once it shows. */
function serve(adr: ArchitectureDecision, post: (path: string) => unknown) {
  vi.mocked(api.get).mockImplementation(async (path: string) => {
    if (path === "/auth/me") return { id: "u1" } as never;
    if (path.startsWith("/adr/")) {
      await new Promise((r) => setTimeout(r, 0));
      return adr as never;
    }
    if (path.startsWith("/metamodel/")) return [] as never;
    if (path.startsWith("/cards?")) return { items: [KAFKA], total: 1 } as never;
    return {} as never;
  });
  vi.mocked(api.post).mockImplementation((async (path: string) => {
    const out = await post(path);
    if (out instanceof Error) throw out;
    return out;
  }) as never);
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

async function renderLoaded(adr: ArchitectureDecision, post: (path: string) => unknown) {
  serve(adr, post);
  render(
    <MemoryRouter initialEntries={["/ea-delivery/adr/adr-1"]}>
      <Routes>
        <Route path="/ea-delivery/adr/:id" element={<ADREditor />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
  await screen.findByDisplayValue(adr.title);
}

const location = () => screen.getByTestId("location").textContent;

const postsTo = (path: string) => vi.mocked(api.post).mock.calls.filter(([p]) => p === path);

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.patch).mockReset();
  vi.mocked(api.delete).mockReset();
});

describe("ADREditor — one request per workflow action, however often it is clicked", () => {
  it("signs once on a double click, and can sign again once the first attempt failed", async () => {
    const first = deferred();
    let calls = 0;
    await renderLoaded(IN_REVIEW, () => {
      calls += 1;
      return calls === 1 ? first.promise : { ...IN_REVIEW, signatories: [{ ...ME_PENDING, status: "signed" }] };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^draw Sign$/ }));
    const sign = within(await screen.findByRole("dialog")).getByRole("button", { name: "Sign" });

    await user.dblClick(sign);
    expect(postsTo("/adr/adr-1/sign")).toHaveLength(1);
    expect(postsTo("/adr/adr-1/sign")[0][1]).toEqual({});

    first.reject(new Error("down"));
    expect(await screen.findByText("Failed to sign")).toBeInTheDocument();
    // The dialog stays open on a failure: sign again from it.
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Sign" }));
    expect(await screen.findByText("Signature recorded")).toBeInTheDocument();
    expect(postsTo("/adr/adr-1/sign")).toHaveLength(2);
  });

  it("saves once on a double click of Save, and the buttons that run an action are disabled while it runs", async () => {
    const patched = deferred();
    vi.mocked(api.patch).mockImplementation((() => patched.promise) as never);
    const dup = deferred();
    await renderLoaded(base, () => dup.promise);
    const user = userEvent.setup();

    await user.dblClick(screen.getByRole("button", { name: /^save Save$/ }));
    expect(vi.mocked(api.patch).mock.calls.filter(([p]) => p === "/adr/adr-1")).toHaveLength(1);
    patched.resolve({});
    await waitFor(() => expect(screen.getByRole("button", { name: /^save Save$/ })).toBeEnabled());

    // A workflow action in flight disables the other action buttons too.
    await user.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(screen.getByRole("button", { name: /Duplicate/ })).toBeDisabled();
    dup.resolve({ ...base, id: "adr-copy" });
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-copy"));
  });

  it("duplicates once on a double click", async () => {
    const dup = deferred();
    await renderLoaded(base, () => dup.promise);
    const user = userEvent.setup();

    await user.dblClick(screen.getByRole("button", { name: /Duplicate/ }));
    expect(postsTo("/adr/adr-1/duplicate")).toHaveLength(1);

    dup.resolve({ ...base, id: "adr-copy" });
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-copy"));
    expect(postsTo("/adr/adr-1/duplicate")).toHaveLength(1);
  });

  it("can duplicate again once the first attempt failed", async () => {
    let calls = 0;
    await renderLoaded(base, () => {
      calls += 1;
      return calls === 1 ? new Error("down") : { ...base, id: "adr-copy" };
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Duplicate/ }));
    expect(await screen.findByText("Failed to duplicate")).toBeInTheDocument();
    expect(location()).toBe("/ea-delivery/adr/adr-1");

    await user.click(screen.getByRole("button", { name: /Duplicate/ }));
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-copy"));
    expect(postsTo("/adr/adr-1/duplicate")).toHaveLength(2);
  });

  it("creates one revision while the menu is busy, and can retry once the first attempt failed", async () => {
    const first = deferred();
    let calls = 0;
    await renderLoaded(SIGNED, () => {
      calls += 1;
      return calls === 1 ? first.promise : { ...SIGNED, id: "adr-rev" };
    });
    const user = userEvent.setup();
    const reviseButton = () => screen.getByRole("button", { name: /Revise/ });

    await user.click(reviseButton());
    await user.dblClick(screen.getByRole("menuitem", { name: /Revise this decision/ }));
    expect(postsTo("/adr/adr-1/revise")).toHaveLength(1);
    // The menu cannot be reopened while the revise is in flight.
    expect(reviseButton()).toBeDisabled();

    first.reject(new Error("down"));
    expect(await screen.findByText("Failed to create revision")).toBeInTheDocument();
    expect(location()).toBe("/ea-delivery/adr/adr-1");
    expect(reviseButton()).toBeEnabled();
    await user.click(reviseButton());
    await user.click(screen.getByRole("menuitem", { name: /Revise this decision/ }));
    await waitFor(() => expect(location()).toBe("/ea-delivery/adr/adr-rev"));
    expect(postsTo("/adr/adr-1/revise")).toHaveLength(2);
  });

  it("links a card once on a double click of its result row", async () => {
    const link = deferred();
    await renderLoaded(base, () => link.promise);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add Card/ }));
    await screen.findByRole("dialog");
    const row = await screen.findByRole("option", { name: "Kafka" });

    await user.dblClick(row);
    expect(postsTo("/adr/adr-1/cards")).toHaveLength(1);

    link.resolve({ ...base, linked_cards: [KAFKA] });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(postsTo("/adr/adr-1/cards")).toHaveLength(1);
    expect(screen.getByText("Kafka")).toBeInTheDocument();
  });

  it("can link another card after a link failed", async () => {
    let calls = 0;
    await renderLoaded(base, () => {
      calls += 1;
      return calls === 1 ? new Error("refused") : { ...base, linked_cards: [KAFKA] };
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Add Card/ }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(await screen.findByRole("option", { name: "Kafka" }));
    expect(await screen.findByText("Failed to link")).toBeInTheDocument();

    await user.click(dialog.getByPlaceholderText("Search cards..."));
    await user.click(await screen.findByRole("option", { name: "Kafka" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(postsTo("/adr/adr-1/cards")).toHaveLength(2);
  });
});

describe("ADREditor — the Recall button", () => {
  it("is named by its visible label and described by its tooltip", async () => {
    await renderLoaded(IN_REVIEW, () => ({}));
    const recall = screen.getByText("Recall Signatures").closest("button") as HTMLButtonElement;
    // WCAG 2.5.3 label-in-name: the visible text is the name, not the tooltip.
    expect(recall).toHaveAccessibleName("undo Recall Signatures");
    expect(recall).toHaveAccessibleDescription(
      "Reset to draft and recall all pending signature requests",
    );
    expect(screen.getByRole("button", { name: /Recall Signatures$/ })).toBe(recall);
  });
});
