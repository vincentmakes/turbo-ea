/**
 * The inventory search must survive Back from a card (#1287).
 *
 * Typing in the sidebar search never writes `?search=`, and the card page's
 * back button is `navigate(-1)` — so the page comes back on a bare
 * `/inventory` and restores its filters from `turboea_inventory`. The effect
 * that mirrors `?search=` into the filters used to treat "no param" as "search
 * is empty" and wiped the restored text, while every other restored filter
 * survived. A `?search=` that is actually in the URL (the global search
 * palette, a shared link) still wins.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import InventoryPage from "./InventoryPage";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("ag-grid-react", () => import("@/test/agGridStub").then((m) => m.agGridReactModule()));
// The sidebar owns the search box; a stand-in renders the page's own
// `filters.search` in a text field and writes back through `onFiltersChange`,
// exactly the contract the real one has.
vi.mock("./InventoryFilterSidebar", async () => {
  const actual =
    await vi.importActual<typeof import("./InventoryFilterSidebar")>("./InventoryFilterSidebar");
  return {
    ...actual,
    default: ({
      filters,
      onFiltersChange,
    }: {
      filters: { search: string };
      onFiltersChange: (f: unknown) => void;
    }) => (
      <input
        aria-label="Search"
        value={filters.search}
        onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
      />
    ),
  };
});
vi.mock("@/components/CreateCardDialog", () => ({ default: () => null }));
vi.mock("./ImportDialog", () => ({ default: () => null }));
vi.mock("./RelationCellPopover", () => ({ default: () => null }));
vi.mock("@/components/CardDetailSidePanel", () => ({ default: () => null }));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";

const TYPES = [
  {
    key: "Application",
    label: "Application",
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    has_hierarchy: true,
    subtypes: [],
    fields_schema: [],
    is_hidden: false,
  },
];

const LS_KEY = "turboea_inventory";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(useMetamodel).mockReturnValue({
    types: TYPES,
    relationTypes: [],
    loading: false,
    getType: (key: string) => TYPES.find((t) => t.key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", email: "a@b.c", display_name: "A", role: "admin", permissions: { "*": true } },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/cards")) {
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 500 });
    }
    return Promise.resolve([]);
  });
});

function seedSearch(search: string) {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({ filters: { types: ["Application"], search, subtypes: [] } }),
  );
}

/** The card page's back button, reduced to what matters: `navigate(-1)`. */
function FakeCardPage() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Back
    </button>
  );
}

/** Inventory → card → Back, with the in-app links the grid uses. */
function OpenCardLink() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/cards/c1")}>
      Open card
    </button>
  );
}

/** The toolbar's global search: a navigation to `/inventory?search=` while
 * the page is already mounted. */
function GoToSearchLink() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate("/inventory?search=erp")}>
      Search ERP
    </button>
  );
}

function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/inventory"
          element={
            <>
              <OpenCardLink />
              <GoToSearchLink />
              <InventoryPage />
            </>
          }
        />
        <Route path="/cards/:id" element={<FakeCardPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const searchBox = () => screen.getByLabelText("Search") as HTMLInputElement;

function lastCardsRequest(): string {
  const calls = vi.mocked(api.get).mock.calls.filter(([p]) => String(p).startsWith("/cards?"));
  return String(calls[calls.length - 1]?.[0] ?? "");
}

describe("Inventory — the search survives Back from a card (#1287)", () => {
  it("keeps a restored search when the URL carries no ?search=", async () => {
    seedSearch("sap");
    mount("/inventory");
    await waitFor(() => expect(lastCardsRequest()).toContain("search=sap"));
    expect(searchBox().value).toBe("sap");
  });

  it("lets an explicit ?search= in the URL override the restored one", async () => {
    seedSearch("sap");
    mount("/inventory?search=erp");
    await waitFor(() => expect(lastCardsRequest()).toContain("search=erp"));
    expect(searchBox().value).toBe("erp");
  });

  it("applies a ?search= that arrives while the page is already open", async () => {
    seedSearch("sap");
    mount("/inventory");
    await waitFor(() => expect(lastCardsRequest()).toContain("search=sap"));

    await userEvent.setup().click(screen.getByRole("button", { name: "Search ERP" }));

    await waitFor(() => expect(searchBox().value).toBe("erp"));
    await waitFor(() => expect(lastCardsRequest()).toContain("search=erp"));
  });

  it("still shows the typed search after opening a card and pressing Back", async () => {
    const user = userEvent.setup();
    mount("/inventory");
    await user.type(await screen.findByLabelText("Search"), "sap");
    await waitFor(() => expect(lastCardsRequest()).toContain("search=sap"));

    await user.click(screen.getByRole("button", { name: "Open card" }));
    await user.click(await screen.findByRole("button", { name: "Back" }));

    await waitFor(() => expect(searchBox().value).toBe("sap"));
    await waitFor(() => expect(lastCardsRequest()).toContain("search=sap"));
  });
});
