/**
 * The Inventory's Logo column.
 *
 * Runs the **real** AG Grid (like the freeze/order persistence suites): what is
 * under test is where the tile lands in the cell, what the rows measure while
 * the column is on, and that the column disappears for types that cannot carry
 * a logo at all — none of which a stubbed grid can show.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import InventoryPage from "./InventoryPage";
import { logoColumnApplies } from "./InventoryFilterSidebar";
import { INVENTORY_LOGO_ROW_HEIGHT } from "./LogoCell";
import type { CardType } from "@/types";

vi.mock("@/api/client", () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  ApiError: class extends Error {},
  isAbortError: () => false,
}));
vi.mock("@/hooks/useMetamodel", () => ({ useMetamodel: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("./InventoryFilterSidebar", async () => {
  const actual =
    await vi.importActual<typeof import("./InventoryFilterSidebar")>("./InventoryFilterSidebar");
  return { ...actual, default: () => <div data-testid="filter-sidebar" /> };
});
vi.mock("@/components/CreateCardDialog", () => ({ default: () => null }));
vi.mock("./ImportDialog", () => ({ default: () => null }));
vi.mock("./RelationCellPopover", () => ({ default: () => null }));
// The brand-icon dialog fetches its own page of icons; the menu item is all
// this suite needs from it.
vi.mock("@/components/BrandIconPicker", () => ({ default: () => null }));

import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useAuth } from "@/hooks/useAuth";

const APPLICATION = {
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  category: "Application & Data",
  has_hierarchy: true,
  subtypes: [],
  fields_schema: [],
  is_hidden: false,
  allow_card_logo: true,
};

const OBJECTIVE = {
  key: "Objective",
  label: "Objective",
  icon: "flag",
  color: "#c7527d",
  category: "Strategy & Transformation",
  has_hierarchy: false,
  subtypes: [],
  fields_schema: [],
  is_hidden: false,
  allow_card_logo: false,
};

const CARDS = {
  items: [
    {
      id: "c1",
      name: "SAP ERP",
      type: "Application",
      status: "ACTIVE",
      approval_status: "APPROVED",
      data_quality: 85,
      lifecycle: {},
      attributes: {},
      logo_updated_at: "2026-08-28T10:00:00Z",
    },
    {
      id: "c2",
      name: "Grow revenue",
      type: "Objective",
      status: "ACTIVE",
      approval_status: "DRAFT",
      data_quality: 40,
      lifecycle: {},
      attributes: {},
      logo_updated_at: null,
    },
  ],
  total: 2,
  page: 1,
  page_size: 500,
};

function mockTypes(types: unknown[]) {
  vi.mocked(useMetamodel).mockReturnValue({
    types,
    relationTypes: [],
    loading: false,
    getType: (key: string) => types.find((t) => (t as CardType).key === key),
    getRelationsForType: () => [],
    invalidateCache: vi.fn(),
  } as unknown as ReturnType<typeof useMetamodel>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockTypes([APPLICATION, OBJECTIVE]);
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "u1", email: "a@b.c", display_name: "A", role: "admin", permissions: { "*": true } },
    loading: false,
  } as unknown as ReturnType<typeof useAuth>);
  vi.mocked(api.get).mockImplementation((path: string) => {
    if (path.startsWith("/cards")) return Promise.resolve(CARDS);
    return Promise.resolve([]);
  });
});

/** Prefs as a returning user's browser would hold them. */
function seedPrefs(columns: string[], typeKeys: string[] = []) {
  localStorage.setItem(
    "turboea_inventory",
    JSON.stringify({
      filters: {
        types: typeKeys,
        search: "",
        subtypes: [],
        lifecyclePhases: [],
        dataQualityBands: [],
        orphanedOnly: false,
        staleOnly: false,
        approvalStatuses: [],
        showArchived: false,
        attributes: {},
        relations: {},
        tagIds: [],
        mineScope: null,
      },
      columns,
      coreTagsMerged: true,
    }),
  );
}

function mountPage() {
  return render(
    <MemoryRouter>
      <InventoryPage />
    </MemoryRouter>,
  );
}

const header = (c: HTMLElement, colId: string) =>
  c.querySelector(`.ag-header-cell[col-id="${colId}"]`);
const cells = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.ag-cell[col-id="core_logo"]')) as HTMLElement[];

describe("logoColumnApplies", () => {
  it("is true when any type in view carries logos", () => {
    const types = [APPLICATION, OBJECTIVE] as unknown as CardType[];
    expect(logoColumnApplies(types, [])).toBe(true);
    expect(logoColumnApplies(types, ["Application"])).toBe(true);
  });

  it("is false when the types in view cannot carry a logo", () => {
    const types = [APPLICATION, OBJECTIVE] as unknown as CardType[];
    expect(logoColumnApplies(types, ["Objective"])).toBe(false);
    expect(logoColumnApplies([OBJECTIVE] as unknown as CardType[], [])).toBe(false);
  });
});

describe("Inventory — Logo column", () => {
  it("is off by default: a fresh grid grows neither the column nor its rows", async () => {
    const { container } = mountPage();
    await waitFor(() => expect(header(container, "core_name")).not.toBeNull());

    expect(header(container, "core_logo")).toBeNull();
    const row = container.querySelector(".ag-row") as HTMLElement;
    expect(row.style.height).not.toBe(`${INVENTORY_LOGO_ROW_HEIGHT}px`);
  });

  it("renders the card's logo, centred, once the column is turned on", async () => {
    seedPrefs(["core_type", "core_name", "core_logo"]);
    const { container } = mountPage();
    await waitFor(() => expect(header(container, "core_logo")).not.toBeNull());

    const logoCells = await waitFor(() => {
      const found = cells(container);
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    const img = logoCells[0].querySelector("img");
    expect(img?.getAttribute("src")).toContain("/api/v1/cards/c1/logo");
    // Centred both ways — the cell is the box, the tile is what sits in it.
    expect(logoCells[0].style.display).toBe("flex");
    expect(logoCells[0].style.alignItems).toBe("center");
    expect(logoCells[0].style.justifyContent).toBe("center");
  });

  it("falls back to the type icon for a logo-bearing card that has none", async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path.startsWith("/cards")) {
        return Promise.resolve({
          ...CARDS,
          items: [{ ...CARDS.items[0], logo_updated_at: null }],
          total: 1,
        });
      }
      return Promise.resolve([]);
    });
    seedPrefs(["core_type", "core_name", "core_logo"]);
    const { container } = mountPage();

    const logoCells = await waitFor(() => {
      const found = cells(container);
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(logoCells[0].querySelector("img")).toBeNull();
    expect(logoCells[0].textContent).toContain("apps");
  });

  it("leaves the cell empty for a card type that cannot carry a logo", async () => {
    seedPrefs(["core_type", "core_name", "core_logo"]);
    const { container } = mountPage();

    const logoCells = await waitFor(() => {
      const found = cells(container);
      expect(found.length).toBe(2);
      return found;
    });
    // Row 2 is the Objective — no tile, and so nothing suggesting an upload
    // the backend would refuse.
    expect(logoCells[1].querySelector("img")).toBeNull();
    expect(logoCells[1].textContent).toBe("");
  });

  it("makes rows taller while the column is shown", async () => {
    seedPrefs(["core_type", "core_name", "core_logo"]);
    const { container } = mountPage();
    await waitFor(() => expect(header(container, "core_logo")).not.toBeNull());

    await waitFor(() => {
      const row = container.querySelector(".ag-row") as HTMLElement;
      expect(row.style.height).toBe(`${INVENTORY_LOGO_ROW_HEIGHT}px`);
    });
  });

  it("drops the column when no type in view can carry a logo", async () => {
    // Selected in the saved prefs, but the type filter is on Objective — the
    // column would be a stripe of blanks and taller rows for nothing.
    seedPrefs(["core_type", "core_name", "core_logo"], ["Objective"]);
    const { container } = mountPage();
    await waitFor(() => expect(header(container, "core_name")).not.toBeNull());

    expect(header(container, "core_logo")).toBeNull();
    const row = container.querySelector(".ag-row") as HTMLElement;
    expect(row.style.height).not.toBe(`${INVENTORY_LOGO_ROW_HEIGHT}px`);
  });

  it("opens the change-logo menu from the cell and uploads through the card's own route", async () => {
    vi.mocked(api.upload).mockResolvedValue({
      ok: true,
      logo_updated_at: "2026-08-29T09:00:00Z",
    });
    seedPrefs(["core_type", "core_name", "core_logo"]);
    const { container } = mountPage();

    const logoCells = await waitFor(() => {
      const found = cells(container);
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    (logoCells[0].firstElementChild as HTMLElement).click();

    // "Replace logo…" — the card already has one.
    await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items.length).toBe(3); // replace / brand icon / remove

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.getAttribute("accept")).toBe("image/png,image/jpeg,image/webp,image/gif");
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "sap.png", {
      type: "image/png",
    });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await waitFor(() =>
      expect(vi.mocked(api.upload)).toHaveBeenCalledWith("/cards/c1/logo", file),
    );
    // The new timestamp lands on the row without a reload of the grid.
    await waitFor(() => {
      const img = cells(container)[0].querySelector("img");
      expect(img?.getAttribute("src")).toContain("2026-08-29T09");
    });
  });

  it("offers no edit affordance to a user without inventory.edit", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        id: "u2",
        email: "v@b.c",
        display_name: "V",
        role: "viewer",
        permissions: { "inventory.view": true },
      },
      loading: false,
    } as unknown as ReturnType<typeof useAuth>);
    seedPrefs(["core_type", "core_name", "core_logo"]);
    const { container } = mountPage();

    const logoCells = await waitFor(() => {
      const found = cells(container);
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    (logoCells[0].firstElementChild as HTMLElement).click();

    expect(screen.queryByRole("menu")).toBeNull();
  });
});
