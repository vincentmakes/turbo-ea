/**
 * Reordering a column on the Inventory page must survive a reload — and must
 * not have cost the page anything the layout snapshot used to provide.
 *
 * Inventory is the one grid where three owners meet: `selectedColumns` drives
 * visibility, `frozenColumns` drives pinning, and `columnOrder` now drives
 * order, while the `getColumnState()` snapshot keeps width and sort. This file
 * runs the **real** AG Grid (like `InventoryFreezePersistence.test.tsx`)
 * because the thing under test is exactly that interplay: `applyOrder()`
 * became the single owner of order, the snapshot restore dropped to
 * `applyOrder: false`, and `maintainColumnOrder` — which made AG Grid ignore a
 * colDefs order outright — was removed. Any two of those three without the
 * third is a regression.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import InventoryPage from "./InventoryPage";

vi.mock("@/api/client", () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
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
    // A custom field, so the grid grows an `attr_*` column once a type filter
    // narrows the view — those columns appear *after* the grid is ready.
    fields_schema: [
      { section: "General", fields: [{ key: "owner", label: "Owner", type: "text" }] },
    ],
    is_hidden: false,
  },
];

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
    },
  ],
  total: 1,
  page: 1,
  page_size: 500,
};

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
    if (path.startsWith("/cards")) return Promise.resolve(CARDS);
    return Promise.resolve([]);
  });
});

function mountPage() {
  return render(
    <MemoryRouter>
      <InventoryPage />
    </MemoryRouter>,
  );
}

/** Pre-seed the prefs the way a returning user's browser would have them. */
function seedPrefs(extra: Record<string, unknown> = {}) {
  localStorage.setItem(
    LS_KEY,
    JSON.stringify({
      filters: {
        types: ["Application"],
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
      ...extra,
    }),
  );
}

/** colIds in the order the grid is actually rendering them. */
function renderedOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".ag-header-cell[col-id]")).map(
    (el) => el.getAttribute("col-id") as string,
  );
}

async function waitForColumn(container: HTMLElement, colId: string) {
  await waitFor(() =>
    expect(container.querySelector(`.ag-header-cell[col-id="${colId}"]`)).not.toBeNull(),
  );
}

/** Relative position of two colIds in the rendered header. */
function indexOf(container: HTMLElement, colId: string) {
  return renderedOrder(container).indexOf(colId);
}

describe("Inventory — column order survives a reload", () => {
  it("applies a stored order on mount", async () => {
    seedPrefs({ columnOrder: ["core_name", "core_type"] });
    const { container } = mountPage();
    await waitForColumn(container, "core_name");
    await waitForColumn(container, "core_type");

    // Natural order puts type before name; the preference reverses it. This
    // only holds because `maintainColumnOrder` is gone — with it set, AG Grid
    // would keep its own order and ignore the colDefs entirely.
    await waitFor(() =>
      expect(indexOf(container, "core_name")).toBeLessThan(indexOf(container, "core_type")),
    );
  });

  it("keeps an attribute column's position even though it arrives late", async () => {
    // `attr_owner` only exists once the metamodel resolves the type filter —
    // after the grid is ready. Its slot has to survive that.
    seedPrefs({ columnOrder: ["attr_owner", "core_name", "core_type"] });
    const { container } = mountPage();
    await waitForColumn(container, "attr_owner");

    await waitFor(() =>
      expect(indexOf(container, "attr_owner")).toBeLessThan(indexOf(container, "core_name")),
    );
  });

  it("the layout snapshot no longer dictates order — columnOrder wins", async () => {
    // A snapshot saved before order had its own pref still carries an order in
    // its array positions. `applyOrder: false` is what stops it fighting.
    seedPrefs({
      columnOrder: ["core_name", "core_type"],
      columnState: [
        { colId: "core_type", width: 120 },
        { colId: "core_name", width: 240 },
      ],
    });
    const { container } = mountPage();
    await waitForColumn(container, "core_name");

    await waitFor(() =>
      expect(indexOf(container, "core_name")).toBeLessThan(indexOf(container, "core_type")),
    );
  });

  it("still restores column widths from the layout snapshot", async () => {
    // The snapshot kept width and sort when it gave up order; prove it.
    seedPrefs({ columnState: [{ colId: "core_name", width: 321 }] });
    const { container } = mountPage();
    await waitForColumn(container, "core_name");

    await waitFor(() => {
      const cell = container.querySelector(
        '.ag-header-cell[col-id="core_name"]',
      ) as HTMLElement;
      expect(cell.style.width).toBe("321px");
    });
  });

  it("seeds the order from a snapshot saved before ordering had its own pref", async () => {
    // Migration: an existing user's arrangement lived in `columnState`'s
    // positions. It must carry over rather than resetting to natural order.
    seedPrefs({
      columnState: [
        { colId: "core_name", width: 200 },
        { colId: "core_type", width: 120 },
      ],
    });
    const { container } = mountPage();
    await waitForColumn(container, "core_name");

    await waitFor(() =>
      expect(indexOf(container, "core_name")).toBeLessThan(indexOf(container, "core_type")),
    );
    // …and it is written back under the new key.
    await waitFor(() => {
      const prefs = JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
      expect(prefs.columnOrder?.indexOf("core_name")).toBeLessThan(
        prefs.columnOrder?.indexOf("core_type"),
      );
    });
  });
});
