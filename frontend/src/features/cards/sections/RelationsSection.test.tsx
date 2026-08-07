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

describe("RelationsSection add dialog", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  /** Open the section, then the add dialog from the group's + button. */
  async function openAddDialog() {
    await openSection();
    await userEvent.click(await screen.findByRole("button", { name: /Add Organization/i }));
    return screen.findByRole("dialog");
  }

  it("lists candidates in the dialog body, not in a floating dropdown", async () => {
    // The list must live in normal flow inside the dialog: a popper is what
    // flipped above the field, clipped inside the accordion and repositioned
    // mid-batch, and it is unusable on a phone (#918).
    mockApi(
      [],
      [
        { id: "org-a", name: "Legal" },
        { id: "org-b", name: "Public Works" },
      ],
    );

    const dialog = await openAddDialog();
    await waitFor(() =>
      expect(within(dialog).getByText("Public Works")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // The `+` already says which relation is being added, so the dialog
    // carries no type selector — it was pure clutter at the top.
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    // …and the title names what is being added, since nothing else does.
    expect(within(dialog).getByText(/Add Organization/i)).toBeInTheDocument();
  });

  it("hides already-linked cards and says how many are hidden", async () => {
    mockApi(
      [relation("1", "Finance")],
      [
        { id: "org-1", name: "Finance" },
        { id: "org-9", name: "Parks & Recreation" },
      ],
    );

    const dialog = await openAddDialog();
    await waitFor(() =>
      expect(within(dialog).getByText("Parks & Recreation")).toBeInTheDocument(),
    );
    // Already linked, so not on offer — picking it would have been a no-op.
    expect(within(dialog).queryByText("Finance")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/1 already linked/i)).toBeInTheDocument();
  });

  it("adds several in a row, chipped and undoable, reconciling once on close", async () => {
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

    const dialog = await openAddDialog();
    const fetchesAfterOpen = state.relationFetches;

    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());
    // The picked card leaves the candidate list and becomes a chip.
    expect(within(dialog).getAllByText("Legal")).toHaveLength(1);

    await userEvent.click(await within(dialog).findByText("Public Works"));
    await waitFor(() => expect(within(dialog).getByText(/2 added/i)).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(2);
    // No refetch per add — the POST response is appended directly.
    expect(state.relationFetches).toBe(fetchesAfterOpen);

    state.rows = [relation("a", "Legal"), relation("b", "Public Works")];
    await userEvent.click(within(dialog).getByRole("button", { name: /Done/i }));
    await waitFor(() => expect(state.relationFetches).toBe(fetchesAfterOpen + 1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("undoes an add from its chip without reloading", async () => {
    const state = mockApi([], [{ id: "org-a", name: "Legal" }]);
    vi.mocked(api.post).mockResolvedValue({
      id: "rel-a",
      type: "appToOrg",
      source_id: FS,
      target_id: "org-a",
      source: { id: FS, type: "Application", name: "NexaCore ERP" },
      target: { id: "org-a", type: "Organization", name: "Legal" },
    } as never);
    vi.mocked(api.delete).mockResolvedValue(undefined as never);

    const dialog = await openAddDialog();
    const fetchesAfterOpen = state.relationFetches;
    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());

    await userEvent.click(dialog.querySelector(".MuiChip-deleteIcon") as Element);

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith("/relations/rel-a"));
    await waitFor(() =>
      expect(within(dialog).queryByText(/1 added/i)).not.toBeInTheDocument(),
    );
    expect(state.relationFetches).toBe(fetchesAfterOpen);
    // Back on offer, so it can be re-added.
    await waitFor(() => expect(within(dialog).getByText("Legal")).toBeInTheDocument());
  });

  it("names a new row from the picked card even if the response omits its refs", async () => {
    // Regression guard for the reported "Unknown" rows: the row must never
    // depend on the create response carrying `source`/`target`, because the
    // card that was picked is already known locally.
    mockApi([], [{ id: "org-a", name: "Legal" }]);
    vi.mocked(api.post).mockResolvedValue({
      id: "rel-a",
      type: "appToOrg",
      source_id: FS,
      target_id: "org-a",
    } as never);

    const dialog = await openAddDialog();
    await userEvent.click(await within(dialog).findByText("Legal"));
    await waitFor(() => expect(within(dialog).getByText(/1 added/i)).toBeInTheDocument());

    // The row lands in the section list behind the dialog, named — not
    // "Unknown". Asserted before Done, since the reconcile fetch on close
    // legitimately replaces the optimistic row with the server's. Queried by
    // text rather than role: an open dialog aria-hides everything behind it.
    await waitFor(() => expect(screen.getAllByText("Legal")).toHaveLength(2));
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
  });
});
