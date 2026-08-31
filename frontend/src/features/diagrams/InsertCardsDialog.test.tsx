/**
 * Tests for the diagram Insert-Cards dialog, focused on its candidate search:
 * it must narrow from the first character rather than waiting out the debounce
 * plus a round-trip, rank the way every other card picker does, and never lose
 * a pick when the list underneath it is replaced.
 *
 * The api mock below HONOURS `type=` and `search=`. It used to return the same
 * four rows for every request, which made the selection tests here pass
 * vacuously: the loaded page never actually changed, so a picker that resolved
 * its selection against that page looked correct.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn() },
  ApiError: class extends Error {},
}));

const ORG_TYPE = {
  key: "Organization",
  label: "Organization",
  color: "#2889ff",
  icon: "corporate_fare",
  is_hidden: false,
  sort_order: 1,
  subtypes: [],
};

vi.mock("@/hooks/useMetamodel", () => ({
  useMetamodel: () => ({
    types: [ORG_TYPE],
    relationTypes: [],
    getType: (key: string) => (key === "Organization" ? ORG_TYPE : undefined),
  }),
}));

import { api } from "@/api/client";
import InsertCardsDialog from "./InsertCardsDialog";

const CARDS = [
  { id: "org-a", name: "Legal Operations", type: "Organization" },
  { id: "org-b", name: "Legal", type: "Organization" },
  { id: "org-c", name: "Paralegal Services", type: "Organization" },
  { id: "org-d", name: "Finance", type: "Organization" },
];

beforeEach(() => {
  vi.mocked(api.get).mockReset();
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/cards/counts")) {
      return Promise.resolve({
        by_type: [{ type: "Organization", count: CARDS.length }],
        total: CARDS.length,
      }) as never;
    }
    const url = new URL(path, "http://x");
    let items = CARDS;
    const type = url.searchParams.get("type");
    if (type) {
      const keys = new Set(type.split(","));
      items = items.filter((c) => keys.has(c.type));
    }
    const search = url.searchParams.get("search");
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((c) => c.name.toLowerCase().includes(q));
    }
    return Promise.resolve({
      items,
      total: items.length,
      page: 1,
      page_size: 1000,
    }) as never;
  });
});

function mountDialog() {
  const onInsert = vi.fn();
  render(<InsertCardsDialog open onClose={vi.fn()} onInsert={onInsert} />);
  return { onInsert };
}

/** The search only runs once a type chip is picked or a term is typed. */
async function pickTypeChip(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole("dialog");
  await user.click(within(await screen.findByTestId("card-picker-rail")).getByText("Organization"));
  await within(dialog).findByText("Finance");
  return dialog;
}

/** The results list, so a query can't stray into the rail or the chip row. */
function list() {
  return screen.getByTestId("card-picker-list");
}

describe("InsertCardsDialog candidate search", () => {
  it("narrows on the first character, with no debounce to wait out", async () => {
    const user = userEvent.setup();
    mountDialog();
    const dialog = await pickTypeChip(user);

    await user.type(within(dialog).getByPlaceholderText(/Search by name/i), "Legal");

    // Asserted synchronously — no `waitFor`, no timer advance. The loaded page
    // is already in memory, so it filters instantly; before this the list sat
    // unchanged for 200ms plus a round-trip.
    expect(within(list()).queryByText("Finance")).not.toBeInTheDocument();
    expect(within(list()).getByText("Legal")).toBeInTheDocument();
  });

  it("ranks an exact match above starts-with, and both above mid-word", async () => {
    const user = userEvent.setup();
    mountDialog();
    const dialog = await pickTypeChip(user);

    await user.type(within(dialog).getByPlaceholderText(/Search by name/i), "Legal");

    // Compare document order rather than reconstructing rows from the DOM
    // shape, which is an implementation detail of the row markup.
    const before = (a: string, b: string) => {
      const nodeA = within(list()).getByText(a);
      const nodeB = within(list()).getByText(b);
      // eslint-disable-next-line no-bitwise
      return Boolean(
        nodeA.compareDocumentPosition(nodeB) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    };

    // Alphabetically "Legal Operations" would precede "Legal", and
    // "Paralegal Services" would come first of all.
    expect(before("Legal", "Legal Operations")).toBe(true);
    expect(before("Legal Operations", "Paralegal Services")).toBe(true);
  });

  it("still inserts a card selected before the search term was typed", async () => {
    // The filter is render-only. Narrowing what "Insert selected" resolves
    // would silently drop a pick the user made moments earlier.
    const user = userEvent.setup();
    const { onInsert } = mountDialog();
    const dialog = await pickTypeChip(user);

    await user.click(within(list()).getByText("Finance"));
    await user.type(within(dialog).getByPlaceholderText(/Search by name/i), "Legal");
    expect(within(list()).queryByText("Finance")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /Insert selected/i }));

    await waitFor(() => expect(onInsert).toHaveBeenCalled());
    const inserted = vi.mocked(onInsert).mock.calls[0][0] as { name: string }[];
    expect(inserted.map((c) => c.name)).toEqual(["Finance"]);
  });

  it("select-all follows what is on screen, not the whole loaded page", async () => {
    const user = userEvent.setup();
    const { onInsert } = mountDialog();
    const dialog = await pickTypeChip(user);

    await user.type(within(dialog).getByPlaceholderText(/Search by name/i), "Legal");
    await user.click(within(dialog).getByRole("button", { name: /Select all shown/i }));
    await user.click(within(dialog).getByRole("button", { name: /Insert selected/i }));

    await waitFor(() => expect(onInsert).toHaveBeenCalled());
    const inserted = vi.mocked(onInsert).mock.calls[0][0] as { name: string }[];
    expect(inserted.map((c) => c.name).sort()).toEqual([
      "Legal",
      "Legal Operations",
      "Paralegal Services",
    ]);
  });

  it("still inserts a card selected before the SERVER results were replaced", async () => {
    // The client filter is render-only, but the debounced query behind it
    // genuinely swaps the loaded page. Resolving the selection against that
    // page — what this dialog used to do — dropped the earlier pick.
    const user = userEvent.setup();
    const { onInsert } = mountDialog();
    const dialog = await pickTypeChip(user);

    await user.click(within(list()).getByText("Finance"));
    await user.type(within(dialog).getByPlaceholderText(/Search by name/i), "Paralegal");
    await waitFor(() =>
      expect(within(list()).queryByText("Legal Operations")).not.toBeInTheDocument(),
    );
    await user.click(within(list()).getByText("Paralegal Services"));

    await user.click(within(dialog).getByRole("button", { name: /Insert selected/i }));
    await waitFor(() => expect(onInsert).toHaveBeenCalled());
    const inserted = vi.mocked(onInsert).mock.calls[0][0] as { name: string }[];
    expect(inserted.map((c) => c.name).sort()).toEqual(["Finance", "Paralegal Services"]);
  });

  it("hands the editor a card type for every inserted card", async () => {
    const user = userEvent.setup();
    const { onInsert } = mountDialog();
    const dialog = await pickTypeChip(user);

    await user.click(within(list()).getByText("Finance"));
    await user.click(within(dialog).getByRole("button", { name: /Insert selected/i }));

    await waitFor(() => expect(onInsert).toHaveBeenCalled());
    const byId = vi.mocked(onInsert).mock.calls[0][1] as Map<string, { key: string }>;
    expect(byId.get("org-d")?.key).toBe("Organization");
  });
});
