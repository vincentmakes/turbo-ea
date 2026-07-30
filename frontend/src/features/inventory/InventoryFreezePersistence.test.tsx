/**
 * Freezing a column on the Inventory page must survive a reload.
 *
 * Unlike `InventoryPage.test.tsx` this file runs the **real** AG Grid, because
 * the thing under test is the interplay between the page's column-state
 * capture/restore machinery and the grid's own pinning — a stubbed grid can't
 * show that. The "reload" is an unmount followed by a fresh mount reading the
 * same localStorage.
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
vi.mock("ag-grid-community/styles/ag-grid.css", () => ({}));
vi.mock("ag-grid-community/styles/ag-theme-quartz.css", () => ({}));

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
    "turboea_inventory",
    JSON.stringify({
      filters: {
        types: ["Application"],
        search: "",
        subtypes: [],
        lifecyclePhases: [],
        dataQualityMin: null,
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

const nameHeader = (c: HTMLElement) => c.querySelector('.ag-header-cell[col-id="core_name"]');
const pinnedName = (c: HTMLElement) =>
  c.querySelector('.ag-pinned-left-header [col-id="core_name"]');

const header = (c: HTMLElement, colId: string) =>
  c.querySelector(`.ag-header-cell[col-id="${colId}"]`);
const pinnedHeader = (c: HTMLElement, colId: string) =>
  c.querySelector(`.ag-pinned-left-header [col-id="${colId}"]`);

async function freeze(container: HTMLElement, colId: string) {
  const cell = await waitFor(() => {
    const el = header(container, colId);
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });
  const pin = cell.querySelector(".tea-freeze-do") as HTMLElement;
  pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await waitFor(() => expect(pinnedHeader(container, colId)).not.toBeNull());
}

describe("Inventory — a frozen column survives a reload", () => {
  it("restores the pin from localStorage on the next mount", async () => {
    const first = mountPage();
    const header = await waitFor(() => {
      const el = nameHeader(first.container);
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    const pin = header.querySelector(".tea-freeze-do") as HTMLElement;
    pin.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    pin.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await waitFor(() => expect(pinnedName(first.container)).not.toBeNull());

    // It reached localStorage…
    await waitFor(() => {
      const prefs = JSON.parse(localStorage.getItem("turboea_inventory") ?? "{}");
      expect(
        prefs.columnState?.find((c: { colId: string }) => c.colId === "core_name")?.pinned,
      ).toBe("left");
    });

    // …and comes back on the next load.
    first.unmount();
    const second = mountPage();
    await waitFor(() => expect(nameHeader(second.container)).not.toBeNull());
    await waitFor(() => expect(pinnedName(second.container)).not.toBeNull());
  });

  it("restores the pin with a type filter active", async () => {
    seedPrefs();
    const first = mountPage();
    await freeze(first.container, "core_name");

    first.unmount();
    seedPrefs(JSON.parse(localStorage.getItem("turboea_inventory") ?? "{}"));
    const second = mountPage();
    await waitFor(() => expect(header(second.container, "core_name")).not.toBeNull());
    await waitFor(() => expect(pinnedHeader(second.container, "core_name")).not.toBeNull());
  });

  it("restores the pin on an attribute column, which only appears once the type filter resolves", async () => {
    seedPrefs();
    const first = mountPage();
    await freeze(first.container, "attr_owner");

    first.unmount();
    const second = mountPage();
    await waitFor(() => expect(header(second.container, "attr_owner")).not.toBeNull());
    await waitFor(() => expect(pinnedHeader(second.container, "attr_owner")).not.toBeNull());
  });

  it("applies a freeze with no layout snapshot at all — it does not depend on the restore", async () => {
    // The restore only runs until the user first drags or resizes a column, so
    // a freeze must not be carried by the snapshot. Prefs with `frozenColumns`
    // and no `columnState` is exactly that situation.
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({ frozenColumns: ["core_name"] }),
    );
    const { container } = mountPage();
    await waitFor(() => expect(header(container, "core_name")).not.toBeNull());
    await waitFor(() => expect(pinnedHeader(container, "core_name")).not.toBeNull());
  });

  it("carries over a freeze stored the old way, in the layout snapshot", async () => {
    localStorage.setItem(
      "turboea_inventory",
      JSON.stringify({
        columnState: [
          { colId: "core_type", pinned: null },
          { colId: "core_name", pinned: "left" },
        ],
      }),
    );
    const { container } = mountPage();
    await waitFor(() => expect(header(container, "core_name")).not.toBeNull());
    await waitFor(() => expect(pinnedHeader(container, "core_name")).not.toBeNull());
  });
});
