/**
 * Tests for the Relations section's add + ordering behaviour (discussion #918).
 *
 * Three things are worth guarding, because each was a reported friction:
 *  - related cards render alphabetically, whatever order the API returned;
 *  - the picker never offers a card that is already linked (picking one was a
 *    silent no-op);
 *  - the picker stays open so several relations can be added in a row, and
 *    that batch costs one reconcile fetch, not one per add.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
}));

const ORG_TYPE = { key: "Organization", label: "Organization", color: "#2889ff", subtypes: [] };
const APP_TYPE = { key: "Application", label: "Application", color: "#0f7eb5", subtypes: [] };

const appToOrg = {
  key: "appToOrg",
  label: "is used by",
  reverse_label: "uses",
  source_type_key: "Application",
  target_type_key: "Organization",
  source_visible: true,
  target_visible: true,
  source_mandatory: false,
  target_mandatory: false,
  cardinality: "n:m",
  attributes_schema: [],
};

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    getType: (key: string) =>
      key === "Organization" ? ORG_TYPE : key === "Application" ? APP_TYPE : undefined,
    types: [APP_TYPE, ORG_TYPE],
    relationTypes: [appToOrg],
  }),
}));

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

import { api } from "@/api/client";
import type { Relation } from "@/types";
import RelationsSection from "./RelationsSection";

const FS = "app-1";

function relation(id: string, name: string): Relation {
  return {
    id,
    type: "appToOrg",
    source_id: FS,
    target_id: `org-${id}`,
    source: { id: FS, type: "Application", name: "NexaCore ERP" },
    target: { id: `org-${id}`, type: "Organization", name },
  };
}

/** `GET /cards` page payload for the picker. */
function cardsPage(items: { id: string; name: string }[]) {
  return {
    items: items.map((c) => ({ ...c, type: "Organization" })),
    total: items.length,
    page: 1,
    page_size: 50,
  };
}

/**
 * Wire `api.get` so `/relations` serves the given rows and `/cards` serves the
 * picker catalogue. Returns a counter of the `/relations` fetches so a test can
 * assert how many reconciles a batch of adds cost.
 */
function mockApi(rows: Relation[], catalogue: { id: string; name: string }[]) {
  const state = { relationFetches: 0, rows };
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith("/relations")) {
      state.relationFetches += 1;
      return state.rows as never;
    }
    if (url.startsWith("/cards")) return cardsPage(catalogue) as never;
    return [] as never;
  });
  return state;
}

async function openSection() {
  render(<RelationsSection fsId={FS} cardTypeKey="Application" initialExpanded />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
}

describe("RelationsSection ordering", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("lists related cards alphabetically whatever order the API returned", async () => {
    mockApi([relation("1", "Public Works"), relation("2", "Finance"), relation("3", "Legal")], []);

    await openSection();

    await waitFor(() => expect(screen.getByText("Finance")).toBeInTheDocument());
    const names = ["Public Works", "Finance", "Legal"];
    const rendered = screen
      .getAllByRole("listitem")
      .map((el) => names.find((n) => el.textContent?.includes(n)))
      .filter((n): n is string => Boolean(n));
    expect(rendered).toEqual(["Finance", "Legal", "Public Works"]);
  });
});

describe("RelationsSection add flow", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it("hides already-linked cards from the picker and says how many are hidden", async () => {
    mockApi(
      [relation("1", "Finance")],
      [
        { id: "org-1", name: "Finance" },
        { id: "org-9", name: "Parks & Recreation" },
      ],
    );

    await openSection();
    await waitFor(() => expect(screen.getByText("Finance")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Add Organization/i }));
    // The picker autoFocuses and `openOnFocus` opens the list — no click needed
    // (clicking the input would toggle it shut again).
    await screen.findByPlaceholderText(/Search Organization/i);

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Parks & Recreation" })).toBeInTheDocument(),
    );
    // Already linked, so not on offer — picking it would have been a no-op.
    expect(screen.queryByRole("option", { name: "Finance" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 already linked/i)).toBeInTheDocument();
  });

  it("stays open across consecutive adds and reconciles once on Done", async () => {
    const state = mockApi(
      [],
      [
        { id: "org-a", name: "Legal" },
        { id: "org-b", name: "Public Works" },
      ],
    );
    vi.mocked(api.post).mockImplementation(async (_url: string, body: unknown) => {
      const target = (body as { target_id: string }).target_id;
      const name = target === "org-a" ? "Legal" : "Public Works";
      return {
        id: `rel-${target}`,
        type: "appToOrg",
        source_id: FS,
        target_id: target,
        source: { id: FS, type: "Application", name: "NexaCore ERP" },
        target: { id: target, type: "Organization", name },
      } as never;
    });

    await openSection();
    const fetchesAfterLoad = state.relationFetches;

    await userEvent.click(screen.getByRole("button", { name: /Add Organization/i }));
    await screen.findByPlaceholderText(/Search Organization/i);
    await userEvent.click(await screen.findByRole("option", { name: "Legal" }));

    // The row lands optimistically and the picker is still there for the next.
    await waitFor(() => expect(screen.getByText("Legal")).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/Search Organization/i)).toBeInTheDocument();
    expect(screen.getByText(/1 added/i)).toBeInTheDocument();
    // No refetch per add — the POST response is appended directly.
    expect(state.relationFetches).toBe(fetchesAfterLoad);

    await userEvent.click(await screen.findByRole("option", { name: "Public Works" }));
    await waitFor(() => expect(screen.getByText(/2 added/i)).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(state.relationFetches).toBe(fetchesAfterLoad);

    // Done closes the row and pays for exactly one reconcile fetch.
    state.rows = [relation("a", "Legal"), relation("b", "Public Works")];
    await userEvent.click(screen.getByRole("button", { name: /Done/i }));
    await waitFor(() => expect(state.relationFetches).toBe(fetchesAfterLoad + 1));
    expect(screen.queryByPlaceholderText(/Search Organization/i)).not.toBeInTheDocument();
  });

  it("drops a just-added card out of the dropdown without a refetch", async () => {
    mockApi(
      [],
      [
        { id: "org-a", name: "Legal" },
        { id: "org-b", name: "Public Works" },
      ],
    );
    vi.mocked(api.post).mockResolvedValue({
      id: "rel-a",
      type: "appToOrg",
      source_id: FS,
      target_id: "org-a",
      source: { id: FS, type: "Application", name: "NexaCore ERP" },
      target: { id: "org-a", type: "Organization", name: "Legal" },
    } as never);

    await openSection();
    await userEvent.click(screen.getByRole("button", { name: /Add Organization/i }));
    await screen.findByPlaceholderText(/Search Organization/i);
    await userEvent.click(await screen.findByRole("option", { name: "Legal" }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Public Works" })).toBeInTheDocument(),
    );
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).queryByText("Legal")).not.toBeInTheDocument();
  });
});
